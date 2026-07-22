# Gemini TTS API 使用指南

面向 API 调用方的接入说明。

---

## 基本信息

| 项目 | 值 |
|------|-----|
| **服务地址** | `https://tts.zlcggb.com` |
| **协议** | HTTPS |
| **音频格式** | MP3 |
| **鉴权方式** | 请求头 `X-API-Key` |

> API Key 由服务提供方单独发放，请勿泄露或提交到公开仓库。

---

## 快速开始

### 1. 检查服务状态（无需密钥）

```bash
curl https://tts.zlcggb.com/health
```

正常返回示例：

```json
{
  "status": "ok",
  "credentials_exists": true
}
```

### 2. 合成一段语音（返回 MP3 文件）

将 `YOUR_API_KEY` 替换为你获得的密钥：

```bash
curl -X POST https://tts.zlcggb.com/v1/tts/synthesize \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"text":"你好，欢迎使用语音合成服务"}' \
  -o output.mp3
```

生成 `output.mp3` 后可直接播放。

---

## 鉴权说明

所有 **`/v1/tts/*`** 接口都需要在请求头携带 API Key：

```http
X-API-Key: YOUR_API_KEY
```

| HTTP 状态码 | 含义 |
|-------------|------|
| `401` | API Key 缺失或错误 |
| `400` | 请求参数不合法 |
| `502` | 上游 TTS 服务调用失败 |

---

## 接口列表

### `GET /health`

健康检查，**不需要** API Key。

---

### `GET /v1/tts/models`

查询支持的模型、音色和默认配置。

**请求头：**

```http
X-API-Key: YOUR_API_KEY
```

**响应示例：**

```json
{
  "models": [
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-tts",
    "gemini-2.5-pro-tts",
    "gemini-2.5-flash-lite-preview-tts"
  ],
  "voices": ["Kore", "Puck", "Charon", "Aoede", "Zephyr", "Fenrir", "Leda", "Callirrhoe"],
  "default_model": "gemini-3.1-flash-tts-preview",
  "default_voice": "Kore",
  "default_language": "cmn-CN",
  "region": "us-central1"
}
```

---

### `POST /v1/tts/synthesize`

将文本合成为语音。

**请求头：**

```http
Content-Type: application/json
X-API-Key: YOUR_API_KEY
```

**请求体参数：**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `text` | string | ✅ | - | 要合成的文本，最长 4000 字符 |
| `prompt` | string | ❌ | 服务端默认 | 语气/风格提示，如「用兴奋语气朗读」 |
| `voice` | string | ❌ | `Kore` | 语音角色名 |
| `model` | string | ❌ | `gemini-3.1-flash-tts-preview` | TTS 模型 |
| `language_code` | string | ❌ | `cmn-CN` | 语言代码，**中文请用 `cmn-CN`** |
| `region` | string | ❌ | `us-central1` | Google 服务区域 |
| `response_format` | string | ❌ | `binary` | `binary` 返回 MP3；`base64` 返回 JSON |

**请求示例：**

```json
{
  "text": "[excited] 大家好，今天天气真不错！",
  "prompt": "用自然、热情的中文语气朗读",
  "voice": "Kore",
  "model": "gemini-3.1-flash-tts-preview",
  "language_code": "cmn-CN",
  "response_format": "binary"
}
```

**响应：**

- `response_format = "binary"`（默认）  
  - Content-Type: `audio/mpeg`  
  - 响应体为 MP3 二进制数据

- `response_format = "base64"`  
  - Content-Type: `application/json`

```json
{
  "format": "mp3",
  "size": 27264,
  "audio_base64": "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA..."
}
```

---

## 支持的模型

| 模型 ID | 说明 |
|---------|------|
| `gemini-3.1-flash-tts-preview` | 默认，最新 Gemini TTS，低延迟 |
| `gemini-2.5-flash-tts` | 稳定版 Flash |
| `gemini-2.5-pro-tts` | 质量更高，适合长文本 |
| `gemini-2.5-flash-lite-preview-tts` | 更轻量 |

## 支持的音色（部分）

| 名称 | 特点 |
|------|------|
| `Kore` | 女声，沉稳（默认） |
| `Puck` | 男声，活泼 |
| `Charon` | 男声，沉稳 |
| `Aoede` | 女声，轻快 |
| `Zephyr` | 女声，明亮 |

完整列表可调用 `GET /v1/tts/models` 获取。

## 语言代码

| 语言 | 代码 |
|------|------|
| 普通话（中国大陆） | `cmn-CN` |
| 英语（美国） | `en-US` |

> ⚠️ 中文不要使用 `zh-CN`，应使用 `cmn-CN`。

---

## 调用示例

### Python

```python
import requests

API_URL = "https://tts.zlcggb.com/v1/tts/synthesize"
API_KEY = "YOUR_API_KEY"

resp = requests.post(
    API_URL,
    headers={
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
    },
    json={
        "text": "你好，这是一段测试语音。",
        "voice": "Kore",
        "language_code": "cmn-CN",
    },
    timeout=60,
)
resp.raise_for_status()

with open("output.mp3", "wb") as f:
    f.write(resp.content)

print("已保存 output.mp3")
```

### Python（base64 响应）

```python
import base64
import requests

resp = requests.post(
    "https://tts.zlcggb.com/v1/tts/synthesize",
    headers={"Content-Type": "application/json", "X-API-Key": "YOUR_API_KEY"},
    json={"text": "你好", "response_format": "base64"},
    timeout=60,
)
data = resp.json()
audio = base64.b64decode(data["audio_base64"])
open("output.mp3", "wb").write(audio)
```

### JavaScript（Node.js）

```javascript
const fs = require("fs");

async function synthesize(text) {
  const resp = await fetch("https://tts.zlcggb.com/v1/tts/synthesize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "YOUR_API_KEY",
    },
    body: JSON.stringify({ text, voice: "Kore", language_code: "cmn-CN" }),
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync("output.mp3", buffer);
  console.log("已保存 output.mp3");
}

synthesize("你好，欢迎使用 TTS 服务");
```

### JavaScript（浏览器）

```javascript
async function playTTS(text) {
  const resp = await fetch("https://tts.zlcggb.com/v1/tts/synthesize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "YOUR_API_KEY",
    },
    body: JSON.stringify({ text }),
  });

  if (!resp.ok) throw new Error(await resp.text());

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();
}
```

> 浏览器直连需服务端已配置 CORS。若跨域失败，请通过你自己的后端转发请求。

### Windows PowerShell

```powershell
curl -Method POST https://tts.zlcggb.com/v1/tts/synthesize `
  -Headers @{"Content-Type"="application/json"; "X-API-Key"="YOUR_API_KEY"} `
  -Body '{"text":"你好，测试语音合成"}' `
  -OutFile output.mp3
```

### Windows CMD（推荐用 JSON 文件）

先创建 `request.json`：

```json
{"text":"你好，测试语音合成","voice":"Kore","language_code":"cmn-CN"}
```

再执行：

```bat
curl -X POST https://tts.zlcggb.com/v1/tts/synthesize -H "Content-Type: application/json" -H "X-API-Key: YOUR_API_KEY" -d @request.json -o output.mp3
```

---

## 在线调试

浏览器打开交互式文档（仅用于调试，生产环境请勿暴露密钥）：

```text
https://tts.zlcggb.com/docs
```

在 `POST /v1/tts/synthesize` 中点击 **Try it out**，填写参数和 `X-API-Key` 即可测试。

---

## 使用建议

1. **文本长度**：单次建议不超过 500 字，过长可能超时或截断。
2. **语气控制**：可在 `text` 里使用 `[excited]`、`[sigh]` 等标签，或用 `prompt` 描述语气。
3. **超时设置**：建议客户端超时设为 **60 秒**。
4. **密钥安全**：API Key 只放在服务端或环境变量，不要写进前端公开代码。
5. **错误重试**：遇到 `502` 可间隔 2～3 秒后重试，不要高频轰炸。

---

## 常见错误

| 错误信息 | 原因 | 处理 |
|----------|------|------|
| `无效的 API Key` | 密钥错误或缺失 | 检查请求头 `X-API-Key` |
| `text 不能为空` | 未传 text | 补充 text 字段 |
| `不支持的 model` | 模型名写错 | 调用 `/v1/tts/models` 查看列表 |
| `不支持的 voice` | 音色名写错 | 使用 Kore、Puck 等支持的名称 |
| `TTS 调用失败` | 上游 Google 服务异常 | 稍后重试或联系管理员 |
| JSON 解析失败（Windows） | CMD 转义问题 | 使用 JSON 文件或 PowerShell |

---

## 联系与配额

- **服务地址**：https://tts.zlcggb.com
- **API Key**：向服务提供方申请
- **配额/故障**：请联系管理员

---

*文档版本：v1.0 | 更新日期：2026-06-11*
