# Agnes 内置渠道与最小适配设计

## 状态与边界

用户已明确批准最新的基础兼容方案、内置渠道与显式提供方身份。本会话已读取批准方案并执行 `task.py start`，任务为 `in_progress`，实施进度记录在 `implement.md`；不重复任务创建或同一方案确认。研究证据见 `research/agnes-protocol.md`、`research/validation.md`、`research/channel-preset.md`。

第一轮范围：内置 Agnes 渠道、模型发现、纯文本与识图、文生图与图生图、文生视频创建/查询/恢复。先适配视频，不等待上游免费队列恢复。暂不接入需要公开 URL 的私有视频参考素材，不改应用认证、媒体存储或部署。

按同一请求层和同一渠道兼容契约组织为一个任务。三种能力共享渠道识别、取消和结果持久化约束，不创建额外子任务或子 Agent。

## 1. 内置渠道与显式隔离

- 在既有 `ApiCallFormat` 增加 `"agnes"`，更新默认地址、格式归一化与标签。用当前已选渠道的显式类型选择适配，不依据 hostname 或模型名自动接管请求。
- 「新增渠道」使用项目已有 Ant Design Dropdown 提供「自定义渠道」与「Agnes（内置）」；复用同一个编辑 Drawer，不创建新页面或转发组件。
- Agnes 预填固定官方 `https://apihub.agnes-ai.com`，接口地址只读，只需填写 Key。全局地址与当前免费 Flash 模型预设放在现有配置入口，模型支持继续选择、拉取、删除和设置自定义脚本。
- 预填 `agnes-2.5-flash`、`agnes-3.0-flash`、`agnes-image-2.0-flash`、`agnes-image-2.1-flash`、`agnes-image-2.5-flash`、`agnes-video-2.5-flash`，不预选收费 Pro 或普通视频模型；注明促销及账号账单以官方平台为准。
- 旧手填 OpenAI 渠道可在协议选择器明确切换为 Agnes，保留 Key、已有模型与脚本，显示固定官方地址；没有模型时才填预设，不以 hydration 迁移数据。
- 新增不覆盖现有默认模型或节点选择；仍在已有模型选择器选择 Agnes 模型。用户删掉的渠道/模型不在刷新时补回。
- 保存与配置 JSON 导入/导出沿用当前字段和服务端 SQLite；normalizeApiFormat 必须保留 agnes，不提升存储版本或增加旧数据兼容层。
- `web/src/services/api/agnes.ts` 集中 Agnes 专用参数构造、已支持设置验证与视频查询 URL；实际 HTTP、SSE、原图读取和持久化复用既有 owner，不创建通用适配框架。
- 自定义调用脚本仍优先；其他 OpenAI/Gemini 分支不变。本地代理包装在实际 URL 构造后执行，应用 `/api` 继续绕过 AI 代理。

## 2. 文本与识图

文件：`web/src/services/api/image.ts`。

1. 纯文本继续使用已验证的 Responses 请求，不强行改写所有文本调用。
2. 显式 Agnes 渠道消息包含图片时改走 Chat Completions，直接复用现有 `AiTextMessage` 的 `text` / `image_url` 内容和 system/history 消息。
3. 在现有 SSE 消费流程中增加 Chat `choices[].delta.content` 映射，复用现有分块读取和累积文本回调，不再手写一套底层 SSE 协议解析。
4. JSON 响应读取 Chat `choices[].message.content`，避免服务返回普通 JSON 时被当作空 SSE；错误继续保留提供方消息与取消状态。
5. Chat 的低/中/高推理档位按 `reasoning_effort` 发送；现有 UI 的 `xhigh` 对应 Agnes Chat 的 `max`，`auto` 不发送。该映射需要随本提案取得确认，不调整全局档位或纯文本 Responses 参数。

所有 fetch 和 reader 使用原始 `serverSessionSignal`，退出、取消或会话过期后不启动新请求，不保存旧会话结果。

## 3. 图片

文件：`web/src/services/api/image.ts`、`web/src/services/api/agnes.ts`。在自定义脚本优先的流程中增加显式 Agnes 专用分支，普通 OpenAI/Gemini 分支不变。

- 文生图和图生图共用 `/images/generations` JSON。
- 文生图发送 `return_base64: true`；图生图通过 `extra_body.image` 发送 `imageToDataUrl` 读取的原图，并用 `extra_body.response_format: "b64_json"`。
- 不发送 GPT Image 的 `output_format`、顶层 `response_format`、未支持的 quality/background 扩展字段。
- 质量默认使用模型自身能力；显式透明背景等未支持的功能不宣称生效。出现无法表达的显式选项时给出清楚的不支持提示，不改写成另一模型。
- 单次始终只请求 1 张。画布和工作台已有的逐张生成、部分成功和重试逻辑不变；其他 API 消费者如传入多张数量，沿用已有 Gemini 的逐次请求模式返回对应结果，不新增并发上限或重试策略。
- 复用 `inferMediaScale`、尺寸预设和比例函数。已选分辨率转换成 `1K` / `2K` / `4K`，自动分辨率按本提案使用 `1K`；自动比例不发送，采用模型默认 `1:1`。明确不支持的 `9:21` 不偷偷改为 `9:16`。
- 自定义像素尺寸保持明确的请求意图，并在文档说明提供方可能归一化；最终几何仍从返回原文件解码，不能拉伸图片到请求预设。
- 结果复用 `parseImagePayload` 与既有 `uploadImage`，继续由同源应用服务持久化，不添加浏览器业务存储或失败回退。

保留当前图片请求 10 分钟超时，不因官方建议区间调整默认值。

## 4. 视频

文件：`web/src/services/api/video.ts`、`web/src/services/api/agnes.ts`，任务身份同步更新 `web/src/types/canvas.ts` 与 `web/src/pages/canvas/project.tsx` 的创建/恢复两处。

### 创建

- 保留既有任务函数签名，新增 `provider: "agnes"`。只有已选渠道 apiFormat 为 agnes 才创建专用任务，持久化与恢复保留该身份。
- 第一轮支持无参考素材的文生视频，JSON 只发送公开契约字段：`model`、`prompt`、`seconds`、`size`、`aspect_ratio`、`mode: "text"`。
- Flash 的分辨率发送大写 `720P`；默认自动/720p 使用该值。显式不支持的分辨率直接提示，不静默降级，也不切换收费模型。
- Agnes 时长遵守官方 4–12 秒范围，现有默认 6 秒不变。超过支持范围提示用户，不偷偷截为 12 秒；不修改全站 4–30 秒滑杆。
- 不发送 `generate_audio`、`watermark`、`ratio`、`resolution_name` 或 `frames` 模式。独立配音/水印开关若无法满足明确意图，提示不支持，不承诺该选项生效。
- 有私有参考素材时在请求前解释当前限制，不丢弃输入后假装完成有参考生成。不能向 Agnes 发送应用会话 cookie 或让 `/api/media` 公开。
- 必须取得 `video_id`。将它作为既有 `VideoGenerationTask.id`，不回退到含义不同的 `id` / `task_id`。

### 查询和恢复

- 构造域名根路径 `/agnesapi`，通过 `URL` / `URLSearchParams` 设置 `video_id` 和所选原始 `model_name`，再使用现有 `withLocalProxy`。
- `status: completed` 才使用顶层 URL；失败状态返回失败，完成却缺 URL 时提示无有效视频，其他状态保持 pending。
- 继续复用结果下载、`storeGeneratedVideo` 和画布的 `videoTaskId` 恢复逻辑；`videoTaskProvider` 枚举及 project.tsx 的两处读写保留 agnes，不将其归入 openai。既有存储字段不变，不做数据迁移。
- 恢复查询前确认保存的任务提供方与当前已选渠道仍匹配；类型不符时明确阻断，不改用另一种查询协议或其他渠道。
- 队列满时显示明确的“队列已满，稍后手动重试”错误，不创建虚构任务、不自动重试，不用收费模型兜底。
- 最多 120 次轮询、2500ms 间隔不变；退出、取消、401 与无效模型按现有约束阻断。

## 5. 不做的扩展

- 不新增公共素材上传、签名 URL 服务、认证绕过、服务器 AI 代理或通用多提供方插件框架。
- 不自动覆盖用户已有调用脚本，不全量改写模板。
- 不自动新增或迁移已保存渠道，不根据模型名/域名触发隐式适配，不覆盖原有默认模型。
- 不硬编码长期免费承诺，不穷举 Pro/付费模型，不进行批量压测。
- 私有视频参考素材、音视频参考、复杂工具调用，以及完整生产部署验收另行规划。

## 6. 风险与验收

- 免费视频上游持续返回 `video_queue_full`，可完成协议代码，但真正的视频创建/查询/下载闭环需队列恢复后验证，不能宣布已经验证可用。
- 官方图片文档与实际接受的顶层 response_format 行为不完全一致，以文档正向请求为设计依据，不用错误后自动试参数。
- Chat `max` 枚举有效性有错误响应证据，生成效果仍需验证；若出现新的明确限制，回到规划更新映射，不静默调整。
- API 成功不代表媒体已经保存，原文件解码、同源存储、刷新恢复与下载必须单独验收。
- 真正浏览器生成探针没有完整结果；预检及虚构 Key 的可读 401 只提供 CORS 基础证据。
- 实施后更新中英文 pending-test，并在 CHANGELOG Unreleased 用一句中文归纳；用户确认前不更新正式功能说明。

## 7. 回退边界

代码回退只涉及本任务的预设入口、agnes 类型和专用分支，不自动改写已保存渠道或任务记录。若要运行旧代码，需要用户自行移除或改回新格式配置；不得加入未知类型静默转发兜底。没有数据库迁移或线上数据操作，不使用 Git reset/checkout 回退用户改动。
