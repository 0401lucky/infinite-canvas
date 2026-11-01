# 续接调查与存储入口

## 已恢复的决策

- 原会话：`01a18b8e-bcfa-73b0-a64d-25405cab9764`，工作目录与当前仓库一致。
- 用户已批准服务端 SQLite、Docker 数据目录持久化和单管理员方向。
- 用户已明确同意清空全部图片原文件和缩略图，保留账号、配置及非图片内容；旧图片显示“已清理”。
- 用户已确认 7 天会话、512 MiB 单文件上传和 32 MiB JSON 写入限制，明确不要 IP 登录限流；不得替换为其他未批准的登录限制。
- 原会话确认后没有继续执行工具或修改业务代码；本调查开始时任务只有 PRD，状态为 `planning`，尚未激活。后续审批和实施进度见 `implement.md`。
- 当前工作区的 Trellis 初始化、AGENTS 与文档改动是已有改动，不得回滚或覆盖。

## 实际入口

| 入口 | 调查时行为（基线） | 适配责任 |
| --- | --- | --- |
| `web/src/stores/use-user-store.ts:15` | 空用户状态，没有认证动作 | 会话检查、登录、退出与私有状态释放 |
| `web/src/router.tsx:16`、`web/src/layouts/user-layout.tsx:8` | 所有业务路由公开挂载 | 登录页面与认证后的业务布局 |
| `web/src/components/layout/client-root-init.tsx:16` | 根组件启动提示词刷新和 URL 密钥导入 | 登录且配置加载成功后才能执行私有副作用；URL 中的密钥仍应尽早移除 |
| `web/src/lib/localforage-storage.ts:9` | Zustand 异步存储，有 localStorage 回退 | 服务端状态适配，失败不可回退为浏览器存储 |
| `web/src/stores/use-config-store.ts:216`、`web/src/stores/use-prompt-source-store.ts:31` | 未指定 storage，默认写 localStorage | 显式使用服务端持久化，并延后 hydration |
| `web/src/stores/canvas/use-canvas-store.ts:48` | 保存整个项目集合，已有 400ms 防抖 | 维持当前间隔，串行保存、报告错误，退出时清除待保存状态 |
| `web/src/stores/use-asset-store.ts:47` | 读取时解析媒体 URL，并可能补存旧内嵌图片 | 新数据仅按服务端存储读取，不添加旧浏览器数据迁移 |
| `web/src/services/image-storage.ts:17` | 原图、预览和两类历史分属 IndexedDB store | 服务端原文件和预览读写，维持原图/缩略图用途区分 |
| `web/src/services/file-storage.ts:8` | 视频、音频等媒体保存在 IndexedDB | 服务端媒体文件适配，不因图片清理删除非图片文件 |
| `web/src/pages/image/index.tsx:68`、`web/src/pages/video/index.tsx:68` | 页面直接读写生成历史 | 使用统一服务端记录入口，不保留独立浏览器业务数据库 |
| `web/src/services/app-sync.ts:79` | WebDAV 同步直接读写历史并下载缺失媒体 | 适配服务端历史，区分主动清理与普通缺失，防止同步恢复已清理图片 |
| `web/src/services/api/prompts.ts:49` | 提示词缓存保存在 IndexedDB | 保留当前来源、刷新周期及消费者，替换存储入口 |
| `web/src/stores/canvas/use-plugin-store.ts:42`、`web/src/lib/canvas/canvas-event-bus.ts:35` | 插件清单与插件命名空间私有数据分别持久化 | 使用认证后的服务端存储，不重构插件 SDK 与事件协议 |
| `web/src/components/layout/config-local-storage.tsx:20` | 展示浏览器 IndexedDB 和配额 | 改为真实服务端空间统计与全图片清理入口 |
| `Dockerfile:13`、`docker-compose.yml:1`、`docker-compose.local.yml:1` | Nginx 静态站点，没有数据目录挂载 | 增加应用服务并保留静态路由、运行期配置与持久化目录 |

## 设计必须覆盖的风险

- 只替换 localforage adapter 会漏掉默认 localStorage 配置、页面历史、提示词缓存与插件私有存储。
- 模块导入时的自动 hydration 和根组件副作用必须受认证控制；读取失败不能标记成功，空内存不能覆盖服务端数据。
- 当前画布与素材整体快照写入没有服务端冲突保护；服务端适配需要防止异步乱序和旧页面在清理后写回失效图片。
- `resolveImageUrl` 当前在文件缺失时返回备用地址。主动清理必须有明确状态，不能显示旧 blob URL、远端原图或通过同步补回原文件。
- 清理必须更新原文件、缩略图、统计与内存 URL 缓存，保留项目结构、文字、视频、音频、配置和本地 Agent 消息历史。
- 同源媒体读取不能误走外部 AI 代理；参考图、下载、导出和 WebDAV 必须继续使用原文件。
- 登录后浏览器仍会取得 API Key 并直连 AI 提供商；数据库持久化不等于密钥对浏览器不可见。
- Docker 数据目录必须覆盖数据库、SQLite 关联文件及媒体；不允许静态暴露该目录，图片与预览接口也需要认证。

## 调查收敛与后续状态

调查完成后已收敛 PRD、`design.md` 与 `implement.md`，并在用户批准最终方案后激活任务。服务端持久化与前端适配已实施，代码/diff 审阅和文档更新已完成，当前保持 `in_progress` 等待用户人工验收；仍不自动检查、测试、构建、委派或提交。

本文件保留实施前调查证据，不作为当前能力清单。TODO 的两项 Agent 后续工作无需调整，本次可测试变更已进入中英文 pending-test，正式 features 不提前更新。

## 技术选型证据

- `canvas-agent/package.json`、`canvas-agent/src/server/http.ts` 已使用 TypeScript、Express、tsx 与 Zod；新应用服务沿用这一技术风格，不复用本机 Agent 的认证或 CORS。
- npm 官方 registry 的稳定版元数据已只读查询：Express 5.3.0 支持 Node >=18，better-sqlite3 13.0.3 要求 Node >=22，argon2 0.45.1 要求 Node >=16.17；Node 24 LTS 满足这些要求。
- multer 2.5.0、cookie-parser 1.4.7、Zod 4.6.7、tsx 4.23.15 的元数据同样已查询；未安装依赖、未编译原生模块或运行程序。
- SQLite、密码哈希、Cookie、multipart 与 Range 使用成熟库；不手写底层格式或协议。
- `web/src/lib/image-thumbnail.ts:1` 与现有生成函数的 768px、WebP 0.86 策略保留，不改成新的压缩阈值。
- 当前插件源码没有依赖 Blob/Map 等非 JSON 私有存储的实际调用；服务端存储保留现有 get/set/remove API 和当前 JSON 业务值，不扩展为完整 IndexedDB 克隆。
