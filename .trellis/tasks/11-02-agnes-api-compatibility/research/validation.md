# 脱敏调用记录

本文件记录实施前的提供方协议调研，不将其当作修改后的应用验收。后续用户授权的 Docker 本地启动、专用测试及模拟浏览器结果见 `docker-validation.md`；该轮未取得实际 Agnes 凭据，也未再次调用真实生成接口。

## 方法与安全边界

- 用户允许实际生成，只调用官方价格页标价为 0 的模型。
- 凭据通过进程内存交给系统 curl 的标准输入，不放在命令行参数、脚本文件、仓库、报告或输出中。
- 生成的猫图与临时协议探针仅在系统临时目录，任务文件只保留结果摘要。
- 没有启动应用、修改线上配置、执行构建、类型/语法检查、仓库自动化测试、Git 提交或部署。
- 浏览器探针使用独立 headless profile，仅关闭自己新启动的实例，不接管或关闭用户已有页面。

## 结果

| 验证 | 结果 | 能说明什么 |
| --- | --- | --- |
| 有效 Key 读取 `/v1/models` | 200，返回 9 个模型 | 凭据和模型发现可用 |
| 2.5 Flash，当前纯文本 Responses SSE 请求 | 200，最终返回 `OK` | 当前纯文本路径本身兼容 |
| 3.0 Flash，当前纯文本 Responses SSE 请求 | 200，最终返回 `OK` | 新版免费文本模型也可用 |
| 2.5 Flash，Responses `reasoning.effort=xhigh` | 200，返回文本 | 不能笼统认定 Responses 推理参数失败 |
| 2.5 Flash，Responses 携带 Data URI `input_image` | 400，内容块转换后为 `unknown` | 当前识图请求链路确有协议兼容问题 |
| 2.5 Flash，同图改用 Chat `image_url` | 200，中文描述橘猫 | Chat 是已验证的识图适配路径 |
| 3.0 Flash，同图改用 Chat `image_url` | 200，中文描述橘猫 | 识图适配不限于 2.5 Flash |
| Chat 顶层 `reasoning_effort=xhigh` | 400，枚举允许 `none/low/medium/high/max` | Chat 分支不能原样发送 xhigh |
| 生图使用现有完整字段 | 400，拒绝 `output_format` | 复现用户截图 |
| 生图仅删除 `output_format` | 200，返回图片结果 | 截图的直接阻塞点得到验证；仍须按官方完整契约适配 |
| 生图使用 `size=1K`、`return_base64=true` | 200，1 张可解码的 1024×1024 PNG | 官方最小生图请求可用 |
| 生图使用 `n=3` | 400，`n must be 1` | 单请求不能承载三张，需沿用已有逐张槽位 |
| 图生图使用原图 Data URI 与 `extra_body.image` | 200，1 张可解码 PNG | 私有画布原图可以经 Base64 编辑，无需公开存储 |
| 视频使用现有 multipart 请求 | 400，只支持 JSON | 视频的首个协议阻塞点 |
| 视频仅把旧字段改成 JSON | 400，拒绝 `generate_audio` | 仅更换 Content-Type 不够 |
| 视频单独使用 `mode=frames` | 400，`invalid mode` | 模式需要映射 |
| Flash 视频单独使用像素式 `size` | 400，要求 720P | 分辨率字段需要映射 |
| 官方最小免费文生视频 JSON | 503，`video_queue_full` | 上游队列满；没有 video_id，未生成或查询真实任务 |
| 首帧 Data URI 的免费视频 JSON | 503，`video_queue_full` | 只验证到队列入口，不能证明 Data URI 推理支持 |
| 使用虚构 ID 请求两种视频查询路径 | 分别 400/404，task not found | 只做路由探测，不能证明创建与查询闭环 |
| 模型、文本、图片、视频及 `/agnesapi` OPTIONS | 204，跨域响应头 | 预检层面可达 |
| 独立 Chrome，带虚构 Bearer 读取模型接口 | 能读取 401 JSON | 不是普遍的 Authorization 预检阻断 |
| 独立 Chrome，真实 Key 文本/识图探针 | 未取得完整结果，已关闭独立实例 | 不记作浏览器生成成功，保留人工验收 |

## 当前明确的验证缺口

1. 用户线上域名中的真实浏览器生成、媒体持久化、刷新和原文件下载。
2. 免费视频队列恢复后，创建返回 `video_id`、正确查询、完成视频下载与刷新恢复的闭环。
3. 视频推理是否支持 Data URI，或提供方是否有可用的私有参考文件上传能力；当前不能承诺私有参考视频/音频/图片接入。
4. 非免费模型只取得官方协议证据，没有付费调用。
5. Chat 的 `max` 推理档位未取得已完成的生成结果；实施时可验证，不能因枚举允许就承诺输出效果。

## 文档状态

此处为早期调研阶段的文档状态：当时已检查中英文 TODO 和两份 pending-test，只有调研与规划，没有产品实现变更，因此未移动待办或追加 CHANGELOG。后续实施及授权的 Docker 本地验证已更新任务、两份 pending-test 和 Unreleased，具体通过与未通过事项见 `docker-validation.md`。
