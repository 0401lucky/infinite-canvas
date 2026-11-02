# Docker 本地验收记录

## 授权与隔离

- 用户在实施后明确要求用 Docker Desktop 启动项目测试，因此本轮允许必要的本地镜像构建、Agnes 专用测试与独立浏览器验收；仍不执行语法/type/lint 检查、格式化、Git 提交或远程部署。
- 仍由主 Agent 执行，没有子 Agent。Docker 使用 `desktop-linux`，Server 为 `29.9.2`，本地镜像为 `linux/amd64`，浏览器为独立 headless Chrome `156.0.8078.74`。
- 使用独立容器 `infinite-canvas-agnes-verify-56c827`、同名 `:local` 镜像及 `infinite-canvas-agnes-verify-56c827-data` 数据卷，仅绑定 `http://127.0.0.1:3030`；未改动其他 Docker 容器、已有数据卷或用户浏览器页面。
- 当前只收到不能解析的受保护凭据引用，明确检查的对应进程环境别名也不存在；未从历史日志或其他文件找 Key，未把占位引用当作真实 Bearer 发出。
- 临时控制器通过仅监听 loopback 的输入页接收凭据，只留在测试进程内存。应用渠道只存测试 marker；不会将真实 Key 放入参数、脚本、配置、SQLite、报告或日志。后续若收到凭据，只替换官方免费 API 请求中已经存在的 marker Authorization，不给媒体下载添加认证，不发送应用 Cookie。
- 已重新读取官方 `https://wiki.agnes-ai.com/en/docs/pricing.md`，六个预填 Flash 模型当前试用价仍为零；本轮没有执行真实 Agnes 生成或视频查询，过去的 503 队列满结果不算本轮结果。

## 已执行命令

| 操作 | 结果 |
| --- | --- |
| `docker build --tag infinite-canvas-agnes-verify-56c827:local .` | 成功，未发布镜像 |
| `docker build --target web-build --tag infinite-canvas-agnes-verify-56c827:web-test .` | 成功 |
| `docker run --rm infinite-canvas-agnes-verify-56c827:web-test bun test tests/agnes-api.test.ts` | 17 pass / 0 fail / 93 assertions，仅此专用文件，不是全仓测试 |
| 最终镜像中 SQLite 内存查询及 Argon2 hash/verify | 成功；安装脚本告警未导致这两个原生模块不可用 |
| 启动及重启独立应用容器 | `/health` 为 200；管理员登录、SPA、私有原文件和数据卷读写可用 |

构建有既有包体积/动态导入告警，没有为此重构或新增限制。运行元数据在 `docker-runtime.json`，脱敏步骤、失败尝试和结果在 `docker-browser-results.json`；控制入口与进程 ID 在 `docker-control.json`，没有凭据。

## 已通过的浏览器案例

除应用自身认证与存储外，下列生成响应均为显式模拟，不能作为 Agnes 上游成功的证据。

| 案例 | 可观察结果 |
| --- | --- |
| 登录与权限 | 登录成功并正常 hydration；未登录读取 records、图片原文件、视频原文件均为 401 |
| 内置入口 | 新增菜单打开 Agnes 抽屉，官方地址只读，六个 Flash 模型预填，保存及刷新保留 `agnes`；只保存 marker，不覆盖原默认模型 |
| 手填渠道转换 | 即使域名和模型名都为 Agnes，原 OpenAI 类型也不自动转换；UI 明确切换后保留原单模型、脚本和 marker，不补六个模型、不改变默认模型 |
| 删除及配置文件 | 删除渠道或某个预填模型后刷新不补回；配置 JSON 导出、导入、刷新保留类型；明确导入空渠道并保留旧扁平字段，刷新仍没有渠道；最后通过显式导入恢复测试配置 |
| 文本 | 模拟纯文本使用 `/v1/responses`，自动档不发送推理参数，SSE 内容正确累积并持久化 |
| 识图 | 两张私有原图走 `/v1/chat/completions`；SSE 和 JSON 内容可显示，`xhigh` 发送 `max`，自动档不发 effort，刷新文本保留 |
| 三张图片 | 三个独立 JSON 请求均为 `n: 1`，没有 `output_format` 或顶层 `response_format`；模拟第二槽失败后仍保留三槽和两张成功图 |
| 单槽重试与原图 | 手动重试只增加一次请求，不替换其他成功键；请求预设为 1:1，模拟返回 1200×600 时节点仍为原始 2:1；刷新可显示，下载字节与 732044 字节原 PNG 完全相同，不是预览 |
| 两图编辑 | 在组装提示词中明确 `@[node:...]` 引用两张私有原图，JSON 使用 `extra_body.image`，两个 Data URI 与原文件完全相同；结果保留两个 storageKey 引用及原始比例 |
| 视频队列满 | 模拟 503 `video_queue_full` 显示完整手动重试文案，恰好一次创建，无任务、无自动重试或收费兜底 |
| 视频身份和恢复 | 创建同时返回不同含义的 `id`、`task_id`、`video_id` 时只保存后者及 `agnes`；刷新仅继续根路径 `/agnesapi`，携带同一 ID 与 `agnes-video-2.5-flash`，未再创建；pending 的 URL 不当作结果 |
| 协议改变 | UI 将渠道改为 OpenAI 后，恢复任务在发请求前明确阻断并保留原任务 ID；明确改回 Agnes 时 Key/模型仍保留 |
| 私有视频参考 | 在组装提示词中明确引用两张原图时，在外部请求前阻断；保留两个参考键，没有公开媒体、丢弃素材或虚构任务 |
| 视频原文件 | 模拟 completed 返回 MDN 公共 CC0 `flower.mp4`，保存完整 1128375 字节；刷新播放为 960×540，Range 0–15 返回 206 / 16 字节，未登录返回 401；下载源请求不带 Authorization 或应用 Cookie。该视频不是 Agnes 生成结果 |
| 退出时取消 | 模拟任务 pending 后实际点击退出，等待超过原轮询间隔，没有新查询、媒体写入或画布 revision 变化；私有接口为 401，随后可重新登录 |
| 容器重启 | 重启仅该独立容器后，会话、Agnes 类型、用户已删减的五个模型、六个测试画布节点及图片/视频原文件仍可读取 |
| 主题/尺寸 | 动画结束后，390×844 浅色抽屉在 x=0、宽390；1440×1000 深色抽屉在 x=800、宽640，均不越界；截图在 `agnes-config-mobile-light.png`、`agnes-config-desktop-dark.png` |

## 探针修正与限制

- 首次导航早于应用初始化完成，出现 `ERR_EMPTY_RESPONSE`；应用就绪后重新导航通过，未修改应用启动限制。
- Windows 工具的非 PTY stdin 会立即关闭，PTY 启动被系统拒绝。已改为仅 loopback 的内存输入页，不通过命令行或文件传递 Key。
- 早期抽屉定位按旧的 Ant Design 类名、获取配置时未等待实际保存、截图未等待动画结束；已改为真实 dialog、等待保存快照和稳定截图后重验。这些失败尝试保留在结果 JSON 中。
- headless canvas MediaRecorder 只产生无帧 WebM 头，不能用作播放验收素材；替换成已知公开 CC0 MP4 后通过。没有把这个失败夹具当成真实视频成功。
- 配置节点的组装提示词沿既有规则只发送显式 `@[node:...]` 选中的参考。最初未写 token 的夹具实际上是文生图，已用明确双参考重验；未改变既有引用语义。
- 手机上的既有紧凑模型行会截断长模型名；视口边界检查通过不等于完整移动端交互验收，已写入 pending-test，没有顺手重构列表。

## 仍待验收

1. 取得可用的内存凭据后，优先调用当时官方仍明确免费的 Flash 文生视频；队列满只记录一次失败，不自动重试或切换收费模型。
2. 真实视频 `video_id`、根路径状态、实际上游媒体下载/保存/播放及刷新闭环；当前模拟不能证明这些，也不能证明有效 Key 的 CORS。
3. 真实纯文本 Responses、识图 Chat（含 max 效果）、文生图和原图编辑，以及这些模型的真实尺寸/数量与产物有效性。
4. 生产域名、其他渠道/脚本/实际代理回归，以及存储失败、不同取消/会话过期阶段等尚未覆盖的案例。
5. 私有视频参考素材继续暂缓；未公开应用媒体或证明 Data URI 推理支持。

已检查中英文 TODO，原 Agent 后续事项和私有视频参考素材保持待办；更新两份 pending-test、CHANGELOG Unreleased 与任务/spec 状态。任务仍为 `in_progress`，没有暂存、提交或归档。
