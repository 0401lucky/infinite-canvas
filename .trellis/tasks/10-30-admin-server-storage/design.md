# 管理员登录与服务端持久化：技术设计

## 状态与变更边界

产品范围和三个默认边界已确认，IP 登录限流明确不做。用户已批准最终方案；主 Agent 已完成实施与代码/diff 审阅，当前等待人工验收，未执行运行检查或提交。

实施前的最小行为差距是：浏览器直接保存私有业务数据且没有认证；目标为认证后的服务端持久化与可控图片清理。真正入口散落于 Zustand adapter、两工作台、媒体服务、提示词缓存和插件存储，须覆盖这些入口，但不重写页面业务、不恢复旧后台。

## 架构与选型

```text
浏览器
  ├─ 同源 /api：登录、状态、记录、媒体、统计与清理
  │    └─ server/：Node 24 LTS + Express 5
  │         ├─ SQLite：认证、会话、业务 JSON、媒体元数据
  │         └─ 持久化目录：原文件、缩略图、上传临时文件
  ├─ 既有 AI 请求 → 用户配置的提供商 / 既有 canvas-proxy
  └─ 既有本地 Agent → 用户本机 canvas-agent
```

- 新建独立 `server/` 私有包，沿用 `canvas-agent/` 的 TypeScript、Express、tsx 和边界验证写法，不复用其本机 Token、CORS 或消息数据库。
- SQLite 使用 `better-sqlite3`，密码使用 `argon2` 的 Argon2id，Cookie 使用 Express/cookie-parser，上传使用 multer，DTO 使用 Zod。采用成熟库，不手写协议、密码算法或 multipart/Range 解析。
- Node 24 满足已调查稳定版本的运行要求：Express 5、better-sqlite3 13、argon2、multer 2、cookie-parser、Zod 和 tsx。server 运行 tsx，不另建多层 ORM/repository/service 框架。
- 单进程提供应用 API 与静态前端，Docker 不再仅启动 Nginx；继续支持 SPA 路由、插件静态注册表和运行期统计配置。
- 开发时前端仍使用 3000，应用服务使用 3001，经 Vite `/api` 代理保持同源；生产容器仅暴露 3000。

## 持久化所有权

| 数据 | 新所有者 | 保留的调用入口 |
| --- | --- | --- |
| 管理员与会话 | SQLite `admin`、`sessions` | `use-user-store` 与统一 server API |
| 配置、画布、素材、提示词源、插件清单 | SQLite `records` 的 `app_state` 命名空间 | 各 Zustand store 的现有动作与 partialize |
| 图片/视频工作台历史、提示词缓存 | SQLite 各记录命名空间 | 两工作台、`prompts.ts`、`app-sync.ts` |
| 插件私有数据 | SQLite 按插件 ID 隔离的记录命名空间 | 现有 `PluginStorage.get/set/remove` |
| 图片、视频、音频及引用媒体 | 文件目录与 SQLite `media` | `image-storage.ts`、`file-storage.ts` |
| 图片预览 | 文件目录与原图的关联元数据 | 现有预览订阅和生成队列 |
| 本机偏好与本地 Agent 历史 | 现有浏览器偏好 / 本机 Agent | 不改变其存储或通信协议 |

`records` 保留现有业务结构为 JSON，不为每个节点建立新关系模型；键、命名空间、记录修订号和集合修订号由服务端管理。查询使用参数绑定，更新使用 SQLite 事务。新服务器从新结构开始，不从浏览器读旧数据，也不加迁移兜底。

持久化目录包含 `app.sqlite`、SQLite 关联文件、`media/`、`previews/` 和上传临时目录。路径仅由服务端生成的文件 ID 构造；请求中的 storageKey 用于数据库查询，不直接成为文件路径。不把数据目录暴露为静态站点。

## 认证与启动

- 只维护一条管理员记录。首次启动必须设置管理员密码，用户名默认 `admin`；数据库保存密码哈希，没有内置密码或公开初始化入口。
- `ADMIN_PASSWORD` 用于首次设置及操作员主动改密；再次启动时密码未变不撤销会话，明确更换用户名/密码时更新唯一账号并撤销旧会话。日志不得输出密码、API Key、Cookie 或敏感 URL 参数。
- 会话使用安全随机不透明 Token，Cookie 为 HttpOnly、SameSite=Strict，HTTPS 部署时设置 Secure。SQLite 只保存 Token 摘要和固定到期时间，不用浏览器 localStorage 保存会话 Token。
- 会话从登录起默认 7 天，不因刷新自动延长。退出删除服务端会话并清 Cookie；服务端未确认退出时不提示退出成功。
- 写接口校验配置的 `APP_ORIGIN`，不开放跨域 Cookie 访问，不盲目信任任意转发头。公开接口仅包含登录、会话检查与不含私有数据的静态资源/健康状态。
- 不做 IP 限流、账号锁定或验证码。公网使用强密码和 HTTPS；没有限流意味着不宣称具备防暴力尝试能力。

前端在确认会话后才手动 hydration 业务 store，所有服务端 persist 使用 `skipHydration`。`ClientRootInit` 与 `UserLayout` 协调会话、加载状态和受保护路由；配置/数据加载成功后才启动提示词刷新、插件与 Agent 页面。网络错误与匿名会话分开处理，加载失败不得进入空数据可编辑状态。

URL 中现有 `baseUrl/apiKey` 参数尽早移除，仅暂存在内存；登录且配置恢复成功后才应用一次。退出或 401 时停止私有副作用、取消客户端请求、清理查询缓存/对象 URL/业务内存和待保存状态；这些清空不能触发服务器空数据写入。

## API 合同

所有业务请求放在 `web/src/services/api/server.ts`，使用同源 Cookie；不经过 AI 本地代理。JSON 响应统一为有明确数据或错误码的结构，私有响应禁止浏览器缓存。

| 接口 | 行为 |
| --- | --- |
| `POST /api/auth/login` | 验证用户名与密码，创建会话并返回管理员信息；错误不区分账号是否存在 |
| `GET /api/auth/session` | 返回当前管理员或匿名状态；服务故障不伪装成匿名成功 |
| `DELETE /api/auth/session` | 撤销当前会话并清 Cookie；可重复退出 |
| `GET /api/records/:namespace` | 返回集合、记录修订号与集合修订号 |
| `GET/PUT/DELETE /api/records/:namespace/:key` | 读取、条件保存、删除指定记录 |
| `PUT/DELETE /api/records/:namespace` | 事务内替换或清空集合，用于同步等现有消费者 |
| `GET /api/media` | 返回媒体元数据及明确的可用/已清理状态，用于恢复与缓存 |
| `PUT /api/media/:key` | 上传一个原文件，验证完成后登记元数据 |
| `PUT /api/media/:key/preview` | 保存现有浏览器队列生成的预览；没有预览也不丢原图 |
| `GET /api/media/:key/original`、`GET /api/media/:key/preview` | 认证后提供文件，Range 交由 Express 文件服务处理 |
| `DELETE /api/media/:key` | 删除现有动作明确指定的媒体，不扫描外部目录 |
| `GET /api/storage` | 真实服务端占用、图片数量、原文件与预览统计 |
| `DELETE /api/storage/images` | 按确认范围清理全部已保存图片原文件和预览 |

错误含义：400 无效请求，401 会话无效，403 来源不符，404 资源不存在，409 旧版本写入冲突，410 图片已清理，413 请求过大，500 存储故障。认证在解析私有上传和读取文件前执行；未登录时不能通过 404/410 探测私有资源。

JSON 默认 32 MiB，单文件默认 512 MiB，均按确认值配置；不截断、不残留不完整资源。不会新增应用级上传总时长、自动重试或生成并发阈值，现有图片下载/解码和 WebDAV 并发值不变。

## 存储适配与一致性

- `web/src/lib/server-storage.ts` 替换旧 localforage adapter；提供现有消费者实际使用的 JSON 记录操作，不伪装成完整 IndexedDB 实现，不保留本地回退。
- 同一文档按顺序保存，修订号只随确认的服务端操作更新。画布已有 400ms 防抖保持不变，提供显式 flush 以覆盖清理前的待保存状态。
- 记录和集合的写入携带已读取修订号。冲突返回 409，保留服务端权威数据并提示重新加载，不自动合并两个浏览器的整份画布/素材快照。
- 记录删除仍保留必要修订元数据；集合替换在事务中完成，不沿用先 clear 再逐条写入的中间空状态。
- hydration 失败、写入失败和冲突可由全局状态订阅，提示留在现有全局 UI 初始化入口或全局 hook，不把弹窗/提示塞进 store。
- 持久化只保留媒体 storageKey、元数据与必要引用，不将临时 blob URL 当作权威资源。媒体缓存仅存在内存，原文件 Blob 通过认证接口按需取得。
- 保持当前 768px、WebP 0.86 的浏览器缩略图策略和队列，服务端只负责保存；不新增另一套图像压缩阈值或服务器图像处理。

## 全图片清理

1. 前端展示真实数量与占用，确认文字明确包括画布、素材和历史引用；先 flush 当前待保存数据。
2. 服务端在事务中确定清理开始时已保存的图片集合，记录清理状态和相关引用更新；视频/音频原文件不在集合内。
3. 删除受管理的原文件与关联预览。逐项维护文件状态，失败保留可人工继续清理的元数据；重复操作可完成未结束的清理，不新增自动重试次数。
4. 对已删除图片保留轻量 tombstone，清空文件路径和占用；相关业务 JSON 中的内容/备用 URL 清空并标记已清理，保留提示词、尺寸、结构和非图片字段。
5. 服务端保存入口同样识别 tombstone，旧快照不能写回有效图片内容，也不能覆盖已清理文件。前端撤销旧对象 URL、刷新业务状态与查询结果，原页面和历史统一显示“已清理”。

清理只作用于应用自己的图片文件，不递归删除数据根目录，不碰 SQLite、管理员、配置或本机 Agent 目录。文件系统不能参加 SQLite 回滚，因此以可见的分阶段状态处理部分失败，而不是吞掉失败后报告成功。统计按实际存在的受管理文件计算，尚未释放空间的文件不能报作已释放。

保留旧 storageKey 仅用于“已清理”归属，不作为可用图片。WebDAV 缺失文件补齐须跳过主动清理资源；ZIP 导出记录清理状态，主动导入包含原文件的备份时分配新媒体键并更新引用，不复活旧键。浏览器已经自行下载的文件与 WebDAV 备份不在服务器清理范围内。

## 文件与 UI 责任

- `server/src/config.ts`、`storage.ts`、`auth.ts`、`media.ts`、`index.ts`：单一配置、SQLite、认证、文件操作、HTTP 与静态资源；不增加多层转发模块。
- `web/src/services/api/server.ts`、`web/src/lib/server-storage.ts`、相关 stores：请求、适配、认证/加载/保存状态，直接使用全局入口。
- `router.tsx`、`ClientRootInit`、`UserLayout`、`pages/login/index.tsx`、`UserStatusActions`：登录、启动门控、退出；登录页主业务直接写页面入口。
- 现有媒体服务、两工作台、画布 hydration/导入导出、素材 UI、插件存储和 `app-sync.ts`：替换真实存储调用，处理已清理状态，不重写主业务组件。
- 现有配置的本地存储组件改为服务端统计/清理组件；移除不再被使用的浏览器用量服务，不保留两套业务模式。
- 新 UI 保持中文及现有中英文资源组织，复用 Ant Design 6 与全局主题；画布占位、按钮和退出入口沿用 canvasThemes 的轻量风格。

## 部署、文档与回退

- Docker 保留现有前端构建阶段，运行阶段改为 Node 24 应用服务，单容器提供 API 和静态资源；挂载完整数据目录。
- 根 `.env.example` 说明管理员凭据、APP_ORIGIN、目录与三个已确认默认值；Compose 与本地启动清楚区分外部 3000 与开发 API 3001。
- 保留统计分析的运行期配置，但 `/config.js` 只能包含既有公开统计变量，不能包含密码、API Key 或会话信息。
- 新个人版需要应用服务，不能宣称单独静态托管已支持 SQLite。只更新说明，不改造 Render/Vercel 平台；Docker生产验证仍待用户完成。
- 更新 AGENTS、相关 specs、README/部署与本地开发说明、AI 文档索引和安全说明；TODO 与 pending-test 中英文同步检查，Unreleased 只做一句版本级归纳。正式 features 等用户验收后再改。
- 不自动迁移旧浏览器数据，也不删除其数据库。现有未提交改动保持不动。回退应用镜像不应删除持久化目录，但旧纯静态版本不会读取新 SQLite 数据。

## 验证与风险

按 `implement.md` 人工检查完整数据流和 diff，不执行语法检查、类型检查、测试或构建。原文件依赖真实 API、浏览器及 Docker 环境，未执行的验证不描述为已通过。

剩余已知风险：公网无登录次数防护；认证浏览器能读取 API Key；图片清理不可撤销；原生 SQLite/Argon2 依赖的实际安装与容器权限仍需用户验证；其他已打开客户端需重新加载才能同步清理状态，本任务不提供实时协作。
