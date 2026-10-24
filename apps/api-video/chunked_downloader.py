"""多线程分片并发下载器：突破单连接 QOS 限速（适用于支持 Range 的国内 CDN）。

设计原则：
1. 探测 Content-Length 与 Range 支持，满足条件时多线程分块并发下载；
2. 不满足或异常时安全优雅降级；
3. 支持进度、实时速度与 ETA 汇报，响应暂停与取消信号。
"""
from __future__ import annotations

import os
import time
import shutil
import threading
from typing import Callable, Optional

import requests

from tasks import is_cancel_requested, update_task, wait_while_paused

CHUNK_SIZE = 64 * 1024  # 64KB 单次读取块大小


class DownloadCancelled(Exception):
    pass


def download_file_chunked(
    url: str,
    output_path: str,
    headers: Optional[dict] = None,
    concurrency: int = 4,
    task_id: Optional[str] = None,
    on_progress: Optional[Callable[[float, Optional[float], Optional[int]], None]] = None,
    timeout: int = 20,
) -> bool:
    """使用多线程分片下载目标 URL，成功返回 True。"""
    req_headers = dict(headers or {})
    sess = requests.Session()
    sess.trust_env = False

    # 1. 探测落地页、Cookies 与 Content-Length
    try:
        probe = sess.get(url, headers=req_headers, stream=True, allow_redirects=True, timeout=timeout)
        final_url = probe.url
        total_size = int(probe.headers.get("Content-Length", 0))
        cookies = sess.cookies.get_dict()
        probe.close()
    except Exception:
        return False

    # 2. 小文件或未知大小：降级为普通单连接流式下载
    if total_size < 3 * 1024 * 1024:
        return _download_single_stream(
            final_url, output_path, req_headers, cookies, total_size, task_id, on_progress, timeout
        )

    # 3. 划分多线程分片
    concurrency = max(1, min(concurrency, 8))
    part_size = total_size // concurrency
    ranges = []
    for i in range(concurrency):
        start = i * part_size
        end = total_size - 1 if i == concurrency - 1 else (i + 1) * part_size - 1
        ranges.append((start, end, i))

    temp_files = [f"{output_path}.part{i}" for i in range(concurrency)]
    downloaded_bytes = [0] * concurrency
    stop_event = threading.Event()
    thread_error: list[Exception] = []

    def _worker(start: int, end: int, index: int, temp_file: str):
        t_sess = requests.Session()
        t_sess.trust_env = False
        t_sess.cookies.update(cookies)
        h = dict(req_headers)
        h["Range"] = f"bytes={start}-{end}"
        try:
            with t_sess.get(final_url, headers=h, stream=True, timeout=timeout) as resp:
                if resp.status_code not in (200, 206):
                    raise RuntimeError(f"分片 {index} HTTP 状态码异常：{resp.status_code}")
                with open(temp_file, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                        if stop_event.is_set():
                            return
                        if task_id and is_cancel_requested(task_id):
                            stop_event.set()
                            return
                        if task_id and wait_while_paused(task_id):
                            stop_event.set()
                            return
                        if chunk:
                            f.write(chunk)
                            downloaded_bytes[index] += len(chunk)
        except Exception as e:
            thread_error.append(e)
            stop_event.set()

    threads = []
    for s, e, i in ranges:
        t = threading.Thread(
            target=_worker, args=(s, e, i, temp_files[i]), name=f"chunked-dl-{i}", daemon=True
        )
        threads.append(t)
        t.start()

    # 4. 进度监控与速度计算
    last_time = time.time()
    last_bytes = 0
    while any(t.is_alive() for t in threads):
        time.sleep(0.5)
        now = time.time()
        curr_bytes = sum(downloaded_bytes)
        dt = now - last_time
        if dt >= 0.5:
            instant_speed = max(0.0, (curr_bytes - last_bytes) / dt)
            last_time = now
            last_bytes = curr_bytes
            pct = min(99.0, (curr_bytes / total_size) * 100.0) if total_size > 0 else 0.0
            eta = int((total_size - curr_bytes) / instant_speed) if instant_speed > 0 else None
            if task_id:
                update_task(task_id, percent=round(pct, 1), speed=instant_speed, eta=eta)
            if on_progress:
                on_progress(pct, instant_speed, eta)

        if task_id and is_cancel_requested(task_id):
            stop_event.set()
            break
        if stop_event.is_set():
            break

    for t in threads:
        t.join(timeout=5)

    # 检查是否被取消或出错
    if stop_event.is_set() or thread_error:
        for f in temp_files:
            if os.path.exists(f):
                os.remove(f)
        if task_id and is_cancel_requested(task_id):
            raise DownloadCancelled("下载已被用户取消")
        # 多线程出错，安全回退
        return False

    # 5. 合并分片到最终文件
    part_tmp_output = f"{output_path}.merging"
    try:
        with open(part_tmp_output, "wb") as outfile:
            for tf in temp_files:
                with open(tf, "rb") as infile:
                    shutil.copyfileobj(infile, outfile, length=1024 * 1024)
                os.remove(tf)
        os.replace(part_tmp_output, output_path)
    except Exception:
        if os.path.exists(part_tmp_output):
            os.remove(part_tmp_output)
        for f in temp_files:
            if os.path.exists(f):
                os.remove(f)
        return False

    if task_id:
        update_task(task_id, percent=100.0, speed=None, eta=0)
    if on_progress:
        on_progress(100.0, None, 0)
    return True


def _download_single_stream(
    url: str,
    output_path: str,
    headers: dict,
    cookies: dict,
    total_size: int,
    task_id: Optional[str],
    on_progress: Optional[Callable],
    timeout: int,
) -> bool:
    """降级单流下载。"""
    s = requests.Session()
    s.trust_env = False
    s.cookies.update(cookies)
    part_path = f"{output_path}.single.part"
    downloaded = 0
    t0 = time.time()
    try:
        with s.get(url, headers=headers, stream=True, timeout=timeout) as resp:
            resp.raise_for_status()
            with open(part_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                    if task_id and is_cancel_requested(task_id):
                        raise DownloadCancelled("下载已被用户取消")
                    if task_id and wait_while_paused(task_id):
                        raise DownloadCancelled("下载已被用户取消")
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        now = time.time()
                        dt = now - t0
                        if dt >= 0.5:
                            pct = min(99.0, (downloaded / total_size) * 100.0) if total_size > 0 else 0.0
                            spd = downloaded / dt
                            eta = int((total_size - downloaded) / spd) if spd > 0 and total_size > 0 else None
                            if task_id:
                                update_task(task_id, percent=round(pct, 1), speed=spd, eta=eta)
                            if on_progress:
                                on_progress(pct, spd, eta)
        os.replace(part_path, output_path)
        return True
    except Exception:
        if os.path.exists(part_path):
            os.remove(part_path)
        return False
