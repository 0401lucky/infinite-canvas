# Agnes API 协议证据

## 官方来源

下列文档由 Agnes 官网的 Developer Docs 入口指向，使用公开 Markdown 页面读取，不包含凭据。

| 来源 | 用途 |
| --- | --- |
| https://wiki.agnes-ai.com/llms.txt | 完整文档索引 |
| https://wiki.agnes-ai.com/en/docs/pricing.md | 当前免费项目与收费项目 |
| https://wiki.agnes-ai.com/en/docs/agnes-25-flash.md | 文本、Responses、Chat Completions、识图 |
| https://wiki.agnes-ai.com/en/docs/agnes-30-flash.md | 3.0 Flash 文本及识图 |
| https://wiki.agnes-ai.com/en/docs/agnes-image-25-flash.md | 生图、图生图、尺寸与返回格式 |
| https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash.md | 免费视频、Flash 限制与查询 |
| https://wiki.agnes-ai.com/en/docs/agnes-video-25.md | 视频通用协议、模式、任务标识 |
| https://wiki.agnes-ai.com/zh-Hans/docs/agnes-image-25-flash.md | 中文生图说明交叉核对 |
| https://wiki.agnes-ai.com/zh-Hans/docs/agnes-video-25-flash.md | 中文视频说明交叉核对 |

## 免费范围

| 能力 | 当前标价为 0 的模型 | 说明 |
| --- | --- | --- |
| 文本 | `agnes-2.5-flash`、`agnes-3.0-flash` | 缓存输入、普通输入、输出均为 0 |
| 图片 | `agnes-image-2.0-flash`、`agnes-image-2.1-flash`、`agnes-image-2.5-flash` | 支持的分辨率与参考图当前免费 |
| 视频 | `agnes-video-2.5-flash` | 限时免费，仅支持 720P |

普通 `agnes-video-2.5` 与文本 Pro 系列不是免费验证对象。促销、账号资格及真实账单以 Agnes 平台为准，不将这份调研变成永久免费的产品承诺。

## 文本

- Base URL 为 `https://apihub.agnes-ai.com/v1`，认证为 Bearer Key。
- 官方同时声明支持 `/chat/completions` 与 `/responses`；不能因为默认代码使用 Responses 就认定文本接口不兼容。
- `web/src/services/api/image.ts:828` 的纯文本分支发送 `input`，通过 `requestStreamingResponse` 读取 Responses SSE，实测 2.5 Flash、3.0 Flash 均成功。
- `web/src/services/api/image.ts:366` 把参考图转换成 Responses `input_image`；实测携带 Data URI 图像时上游返回 400，错误包含内容块被转换为 `unknown`。
- 同一张 Data URI 图像改用 Chat Completions `messages[].content` 的 `text` 与 `image_url` 后，2.5 Flash、3.0 Flash 均成功识图。
- Chat SSE 的文字位于 `choices[].delta.content`，与 Responses 的 `response.output_text.delta` 不同。现有累积文本回调语义必须保持。
- Responses 的 `reasoning.effort: "xhigh"` 实测可用；Chat 的 `reasoning_effort: "xhigh"` 实测 400，错误列出允许值 `none`、`low`、`medium`、`high`、`max`。`max` 仅由该错误建立枚举证据，未完成真实浏览器生成验证。

## 图片

`web/src/services/api/image.ts:733` 的默认请求固定发送 `output_format: "png"`。实测原请求返回与截图相同的 400：`output_format is not supported by text image queue`。

### 文生图契约

```json
{
  "model": "agnes-image-2.5-flash",
  "prompt": "一只可爱的橘猫，简洁背景。",
  "size": "1K",
  "ratio": "1:1",
  "return_base64": true
}
```

- 请求为 JSON，路径 `/v1/images/generations`。
- 文档要求 `size`，推荐 `1K`、`2K`、`3K`、`4K`，也接受部分像素尺寸并可能归一化。
- 文档要求不要在顶层放 `response_format`；应使用 `return_base64` 或 `extra_body.response_format`。实测仅删除 `output_format` 后，旧顶层 `response_format` 的文生图请求也暂时成功；不能据此依赖文档明确禁止的形式。
- 实测 `n=3` 返回 `n must be 1`。画布与图片工作台本来就在各个槽位使用 `count: "1"`，见 `web/src/pages/canvas/project.tsx:2492`、`web/src/pages/image/index.tsx:359`，不能把截图里的“3 张”误认为一次请求必须发送 `n=3`。
- 结果为 `data[].b64_json` 或 `data[].url`；现有 `parseImagePayload` 可读取，无需新增图片持久化格式。

### 图生图契约

```json
{
  "model": "agnes-image-2.5-flash",
  "prompt": "把背景换成淡蓝色，保留猫的外观。",
  "size": "1K",
  "ratio": "1:1",
  "extra_body": {
    "image": ["data:image/png;base64,<原图数据>"],
    "response_format": "b64_json"
  }
}
```

- 图生图与多参考图仍使用 `/v1/images/generations`，不是当前 `web/src/services/api/image.ts:820` 的 `/images/edits` multipart。
- 参考图允许 Data URI，可以直接复用按 `storageKey` 读取原图的 `imageToDataUrl`，不需要公开应用媒体。
- 质量、透明背景与 `output_format` 不在该模型的公开请求契约中；不得把 GPT Image 扩展参数原样转发，也不得承诺未验证的效果。
- 支持比例为 `1:1`、`3:4`、`4:3`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9`，不包含画布另有的 `9:21`。
- 实际输出尺寸可能不等于画布尺寸预设，显示与存储仍须以解码后的原始比例为准。

## 视频

### 创建契约

```json
{
  "model": "agnes-video-2.5-flash",
  "prompt": "A cute orange cat slowly turns its head in a quiet garden.",
  "seconds": "4",
  "mode": "text",
  "size": "720P",
  "aspect_ratio": "16:9"
}
```

- 创建路径 `/v1/videos`，只接受 JSON。
- 现有 `web/src/services/api/video.ts:151` 构造 multipart，实测被直接拒绝。
- 将旧字段转成 JSON 仍然失败，实测 `generate_audio is not an allowed request field`；`mode: "frames"` 与像素式 `size: "1280x720"` 分别被拒绝。
- 允许模式为 `text`、`keyframe`、`reference`，与画布的 `frames` / `reference` 表达不同。
- 允许时长为字符串 `"4"` 至 `"12"`，`n` 只能为 1。Flash 仅支持 `"720P"`；不能自动改用收费的普通版本。
- 参考图通过 `first_frame` / `last_frame` 或 `images`，音频通过 `audios`，视频通过 `videos[].url`；Flash 不支持非空参考视频。
- 官方要求参考媒体 URL 可由 Agnes 公网访问。当前应用 `/api/media` 要求管理员会话，`blob:` 地址也不是公网 URL，不能为了适配绕过认证或公开原文件。Data URI 首帧请求进入了队列满错误分支，但这不证明推理服务能读取 Data URI。

### 查询与任务标识

官方创建响应包含不同含义的 `id` / `task_id` 与 `video_id`。查询应使用 `video_id`：

```text
GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-2.5-flash
```

- `/agnesapi` 位于域名根路径，不在 `/v1` 下；当前 `buildApiUrl` 总会追加 `/v1`，不能直接拿它拼查询地址。
- 当前 `web/src/services/api/video.ts:198` 按 `/videos/{task.id}` 查询，并仅保存 `id`，需要 Agnes 专用分支。
- 只有 `status: "completed"` 时才能读取顶层 `url` 作为结果；`failed` 必须保留错误，不能仅凭存在 URL 判断成功。
- 当前画布只持久化 `videoTaskId`、`videoTaskProvider`、模型。可将 Agnes 的 `video_id` 放入既有任务 ID 字段，并在服务层根据已选渠道走专用查询，无需新增存储版本或修改画布 UI。
- 已知默认等待窗口为最多 120 次、间隔 2500ms，见 `web/src/services/api/video.ts:52`；本轮不增加自动重试或改变这个窗口。

## 已确认的不属于参数兼容的问题

- 官方最小文生视频请求多次返回 `503`、`code: "video_queue_full"`，没有创建任务。不能宣称视频已经生成成功，也不能把它归为 Key 无效。
- Python 默认 TLS 链验证在本机报过证书过期，但系统 `curl.exe` 正常验证 HTTPS；读取到的叶证书覆盖该域名，有效期内。公开资料曾仅为研究绕过 Python 验证，所有携带 Key 的请求使用正常验证的系统 curl。不要将关闭 TLS 验证加入应用。
- 浏览器 OPTIONS 返回 204；独立 Chrome 页面能携带虚构 Bearer 请求并读取 401。真实 Key 的浏览器生成探针未取得完整结果，生产域名直连和视频媒体下载仍需验收。
