"""内存任务表：记录每个下载任务的状态与进度（无数据库，轻量级）。

任务状态流转：
  queued -> downloading <-> paused -> processing -> finished
                                    -> cancelled / error
"""
import os
import threading
import time

_tasks = {}
_lock = threading.Lock()

# 视频落盘缓存：canonical_key -> filepath
_video_cache: dict[str, str] = {}

# 任务控制：cancel / pause / done 信号（按 task_id 隔离）
_controls: dict[str, dict[str, threading.Event]] = {}


def _get_controls(task_id: str) -> dict[str, threading.Event]:
    with _lock:
        if task_id not in _controls:
            _controls[task_id] = {
                "cancel": threading.Event(),
                "pause": threading.Event(),
                "done": threading.Event(),
            }
        return _controls[task_id]


def clear_task_controls(task_id: str) -> None:
    with _lock:
        _controls.pop(task_id, None)


def request_cancel(task_id: str) -> None:
    _get_controls(task_id)["cancel"].set()


def request_pause(task_id: str) -> None:
    _get_controls(task_id)["pause"].set()


def request_resume(task_id: str) -> None:
    _get_controls(task_id)["pause"].clear()


def is_cancel_requested(task_id: str) -> bool:
    with _lock:
        ctrl = _controls.get(task_id)
        return bool(ctrl and ctrl["cancel"].is_set())


def is_paused(task_id: str) -> bool:
    with _lock:
        ctrl = _controls.get(task_id)
        return bool(ctrl and ctrl["pause"].is_set())


def wait_while_paused(task_id: str) -> bool:
    """下载进度回调中调用：暂停时阻塞，返回 False 表示应继续，True 表示已请求取消。"""
    while is_paused(task_id):
        if is_cancel_requested(task_id):
            return True
        update_task(task_id, status="paused")
        time.sleep(0.4)
    return is_cancel_requested(task_id)


def create_task(task_id: str, url: str, title: str | None = None) -> None:
    _get_controls(task_id)
    with _lock:
        _tasks[task_id] = {
            "task_id": task_id,
            "url": url,
            "title": title,
            "status": "queued",
            "percent": 0.0,
            "speed": None,
            "eta": None,
            "filepath": None,
            "filename": None,
            "error": None,
            "error_code": None,
            "created_at": time.time(),
        }


def update_task(task_id: str, **kwargs) -> None:
    with _lock:
        if task_id in _tasks:
            _tasks[task_id].update(kwargs)
            status = _tasks[task_id].get("status")
            fp = _tasks[task_id].get("filepath")
            url = _tasks[task_id].get("url")
            if status in ("finished", "error", "cancelled"):
                ctrl = _controls.get(task_id)
                if ctrl:
                    ctrl["done"].set()
            if status == "finished" and fp and os.path.isfile(fp):
                _register_cache_locked(url, fp)


def _canonical_keys(raw_url: str) -> list[str]:
    keys = []
    if not raw_url:
        return keys
    keys.append(raw_url.strip())
    try:
        from url_normalize import extract_douyin_aweme_id, normalize_url

        norm = normalize_url(raw_url)
        if norm and norm not in keys:
            keys.append(norm)
        aweme_id = extract_douyin_aweme_id(norm) or extract_douyin_aweme_id(raw_url)
        if aweme_id:
            keys.append(f"douyin:{aweme_id}")
    except Exception:
        pass
    return keys


_CACHE_FILE = os.path.join(os.path.dirname(__file__), "downloads", "video_cache.json")


def _load_disk_cache_locked() -> None:
    if os.path.isfile(_CACHE_FILE):
        try:
            import json

            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for k, v in data.items():
                        if os.path.isfile(v) and os.path.getsize(v) > 0:
                            _video_cache[k] = v
        except Exception:
            pass


def _save_disk_cache_locked() -> None:
    try:
        import json

        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        valid = {
            k: v
            for k, v in _video_cache.items()
            if os.path.isfile(v) and os.path.getsize(v) > 0
        }
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(valid, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _register_cache_locked(url: str | None, filepath: str) -> None:
    if not url or not filepath or not os.path.isfile(filepath):
        return
    for k in _canonical_keys(url):
        _video_cache[k] = filepath
    _save_disk_cache_locked()


def register_video_cache(url: str, filepath: str) -> None:
    with _lock:
        _register_cache_locked(url, filepath)


def find_existing_video_file(url: str) -> str | None:
    """查找当前是否已有相同 URL 下载完成的本地文件（内存与磁盘映射双重检索）。"""
    keys = _canonical_keys(url)
    with _lock:
        _load_disk_cache_locked()
        for k in keys:
            fp = _video_cache.get(k)
            if fp and os.path.isfile(fp) and os.path.getsize(fp) > 0:
                return fp
        # 从活跃任务中寻找已完成者
        for t in _tasks.values():
            if t.get("status") == "finished":
                tfp = t.get("filepath")
                if tfp and os.path.isfile(tfp) and os.path.getsize(tfp) > 0:
                    tkeys = _canonical_keys(t.get("url") or "")
                    if any(k in tkeys for k in keys):
                        _register_cache_locked(url, tfp)
                        return tfp
    return None


def wait_for_existing_download(
    url: str, timeout: float = 600.0, on_progress: callable = None
) -> str | None:
    """若相同视频正处于下载阶段，协同等待其完成，避免重复网络下载抢带宽。"""
    keys = _canonical_keys(url)
    target_task_id = None
    done_event = None
    with _lock:
        for tid, t in _tasks.items():
            if t.get("status") in ("queued", "downloading", "processing"):
                tkeys = _canonical_keys(t.get("url") or "")
                if any(k in tkeys for k in keys):
                    target_task_id = tid
                    ctrl = _controls.get(tid)
                    if ctrl:
                        done_event = ctrl["done"]
                    break

    if not target_task_id or not done_event:
        return None

    deadline = time.time() + timeout
    while time.time() < deadline:
        if done_event.is_set():
            break
        t = get_task(target_task_id)
        if not t or t.get("status") not in ("queued", "downloading", "processing"):
            break
        if on_progress:
            on_progress(t.get("percent") or 0.0, t.get("speed"))
        time.sleep(0.5)

    # 下载完成后，确认并返回落盘文件
    return find_existing_video_file(url)


def get_task(task_id: str):
    with _lock:
        t = _tasks.get(task_id)
        return dict(t) if t else None


def all_tasks():
    with _lock:
        return [dict(t) for t in _tasks.values()]
