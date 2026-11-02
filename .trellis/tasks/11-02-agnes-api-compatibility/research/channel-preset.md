# 内置 Agnes 渠道的现有结构

## 用户新增意图

用户认可原有文本/图片/视频兼容方案，要求视频先做协议适配，不等待免费队列恢复；同时提出增加内置 Agnes 渠道，预填接口与模型，只需输入 Key，并让提供方适配显式隔离。

## 代码证据

| 位置 | 现有行为 | 本次影响 |
| --- | --- | --- |
| `web/src/stores/use-config-store.ts:10` | ApiCallFormat 只有 openai / gemini | 增加显式 agnes 类型，作为选择专用适配的依据 |
| `web/src/stores/use-config-store.ts:324` | createModelChannel 生成渠道身份和归一化模型 | 复用该工厂和既有模型列表结构，不新建渠道 store |
| `web/src/stores/use-config-store.ts:489` | normalizeApiFormat 会把未知格式变成 openai | 必须保留 agnes，否则刷新后会丢失专用协议 |
| `web/src/stores/use-config-store.ts:460` | hydration 归一化已保存渠道和模型 | 不在 hydration 自动新增 Agnes、迁移旧渠道或补回用户删掉的模型 |
| `web/src/stores/use-config-store.ts:450` | 请求配置从选中模型解析所属渠道 | 复用，不依据模型名或 hostname 自动接管其他渠道 |
| `web/src/components/layout/app-config-modal.tsx:111` | 新增渠道按钮创建默认 OpenAI 渠道并打开已有 Drawer | 用新增菜单提供自定义 / Agnes 两种入口，保持现有编辑路径 |
| `web/src/components/layout/channel-editor-drawer.tsx:17` | 协议选择器只有 OpenAI / Gemini | 增加 Agnes（内置），可显式转换原有手填渠道 |
| `web/src/components/layout/channel-editor-drawer.tsx:32` | 切换协议时尽量保留自定义地址 | Agnes 使用固定官方地址；明确切换才改变类型，不迁移已有配置 |
| `web/src/components/layout/channel-editor-drawer.tsx:77` | 编辑接口地址与 Key | Agnes 只需 Key，地址只读并预填；模型编辑/拉取/脚本仍可复用 |
| `web/src/components/layout/app-config-modal.tsx:404` | withChannels 保留可用的当前默认模型 | 新增 Agnes 不覆盖已有默认模型或画布节点选择 |
| `web/src/services/config-file.ts:21` | 整体 JSON 导出与导入 AiConfig | 新格式可随原有配置文件保存，不需要新版本或迁移 |
| `web/src/services/api/video.ts:24` | 任务 provider 是 openai / gemini / plugin | 增加 agnes，让新视频任务显式保存提供方类型 |
| `web/src/types/canvas.ts:87` | 画布持久化 videoTaskProvider 是 openai / gemini | 扩展 agnes 枚举，与创建及刷新恢复的两处读写对齐 |
| `web/src/pages/canvas/project.tsx:326` | 非 Gemini 任务统一保存为 openai | 必须保留新任务的 agnes 类型，不把它扁平化成通用 OpenAI |
| `web/src/pages/canvas/project.tsx:353` | 恢复时只重建 openai / gemini 类型 | 按保存的 agnes 类型恢复；不误用 /videos/{id} |

## 推荐边界

- UI 保持已有 Ant Design Drawer、Select、Dropdown 和主题；不新增页面、封装转发组件或全局 CSS。
- 内置预设只包含当前官方价格页列为免费的 Flash 模型，不预选收费 Pro 或普通视频模型；拉取额外模型仍是用户明确操作，免费促销不做永久承诺。
- 独立 agnes 类型取代前一版设计的运行时官方域名自动识别。旧手填 OpenAI 渠道保持不变，用户在编辑器切换到 Agnes 后才用专用协议，Key、模型和已有脚本保留。
- 地址和推荐模型作为全局渠道预设放到现有配置入口，不通过组件层层传递；API 参数与查询 URL 的 Agnes 私有规则集中在 `web/src/services/api/agnes.ts`，共用现有 HTTP、流式和持久化流程，不做通用适配框架。
- 优先实现视频协议与恢复，再实现图片和带图文本；队列满时明确显示并停止，不增加自动重试。

参考 Ant Design 官方 `https://ant.design/llms-full.txt` 中 Dropdown 的 menu/trigger 与 Select 的 options API，匹配项目当前 antd 6 写法。
