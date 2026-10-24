# twmd（twitter-media-downloader）二进制

X / Twitter 视频解析使用 [mmpx12/twitter-media-downloader](https://github.com/mmpx12/twitter-media-downloader)（twmd）。

## 下载

从 [Releases v1.15.0](https://github.com/mmpx12/twitter-media-downloader/releases/tag/v1.15.0) 下载对应平台包，解压后将可执行文件放到本目录：

| 系统 | 文件名 |
|------|--------|
| Windows amd64 | `twitter-media-downloader.exe` |
| Linux amd64 | `twitter-media-downloader` |

也可用环境变量 `TWMD_PATH` 指向任意路径。

## X 登录 Cookie

2026 年起 X 访客接口常返回 404，**公开视频推文通常也需要**浏览器 Cookie（`auth_token` + `ct0`）。

用扩展导出 `x.com` 的 cookies.txt 到 `backend/cookies.txt`，或在前端勾选读取 Firefox 登录态。
