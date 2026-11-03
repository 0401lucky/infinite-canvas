# 图片隐私模糊设计

## Architecture And Boundaries

- 在 `CanvasNodeMetadata` 增加可选 `privacyBlurred?: boolean`。仅内置图片节点使用该字段；缺失等于未开启，不改图片存储键、原文件或服务端媒体结构。
- `project.tsx` 已拥有当前画布的节点状态、编辑动作、历史与保存。复用现有 `setNodes` 更新单个节点的 metadata，再经 `updateProject` 写入认证后的服务端画布记录；不新增全局 store，不重构本地节点所有权。
- 在既有悬浮工具栏追加独立眼睛按钮，使用状态相关中文标签和原有 `ToolbarAction` 视觉。该按钮不纳入可隐藏快捷工具列表，确保始终保留取消入口，不修改工具定义或重置用户工具偏好。
- `canvas-image-privacy.ts` 集中提供固定强度 CSS 样式及 Ant Design `imageRender` 的原图元素克隆；样式仅作用于图像元素并由显示容器裁切。工具按钮、节点选择/缩放、文字、视频和音频不参与模糊，不用清晰到模糊的过渡，不产生额外图片或缩略图文件。

## Display Data Flow

1. 节点主图和 `ExpandedImageCard` 直接读取已有 `node.metadata.privacyBlurred`，图片组共享节点标记。
2. 元素列表、引用条、大图 Modal 和快捷预览读取对应节点标记。快捷预览保留来源节点 ID，淡出期间也依据当前节点状态渲染，避免保留旧的清晰预览。
3. `CanvasResourceReference` 与 `NodeGenerationResourceInput` 可以带仅用于显示的标记，供提示词候选、内嵌引用与点击预览使用；URL、原始 `ReferenceImage` 和 AI 请求内容不变。
4. 对 contentEditable 中既有 DOM 图片同步更新显示状态，不依赖重新输入提示词；点击预览保留来源节点/引用身份而不是仅存裸 URL，使已打开的预览也跟随标记。
5. Agent 画布引用优先从现有 `useAgentStore.canvasContext.snapshot` 按 `nodeId` 读取当前标记，覆盖候选、输入 token、消息 token 和 Popover；桥接 hook 在 paint 前发布快照，输入框用 `useShallow` 订阅模糊节点 ID，避免拖拽时因整份节点快照重复渲染。独立附件不联动，不增加 Agent 消息存储字段、版本或协议。

## Actions And Original Images

- 切换主图、原地重新生成和重试都保留现有 metadata 标记；`duplicateBatchImage` 的显式新建 metadata 补上原节点标记。普通复制粘贴已复制 metadata，不增加迁移逻辑。
- 会显示清晰原图的裁剪、局部重绘、拆图、放大和角度编辑入口在模糊期间提示「请先取消图片模糊，再进行编辑」，不自动取消标记，也不把 CSS 模糊后的图传给编辑/生成 API。
- 下载、生成参考、ZIP 导出和媒体缓存继续使用原图。新生成的独立图片不自动标记；素材与工作台独立记录不按存储键联动。

## Persistence And Compatibility

- `use-canvas-store.ts` 已保存完整节点（`18`、`160`），hydration 通过 metadata 展开保留字段（`canvas-generation-helpers.ts:61`）；服务端 `normalizeMedia`（`server/src/storage.ts:58`）和 ZIP 序列化（`web/src/services/file-storage.ts:114`）递归保留普通字段，无需后端改动或媒体迁移。
- 不改变既有 400ms 保存防抖、会话 epoch、401 停写、版本冲突或图片清理规则；不新增 localStorage 业务字段。
- 模糊属于视觉隐私，不是访问控制。原始媒体、导出和已独立保存的副本仍可能清晰显示，文档必须明确边界。

## Rollout And Risk

- 主要风险是多入口漏掉原图、预览只缓存 URL 导致标记变更失效、contentEditable 引用不能及时更新，以及图片组副本丢失标记。
- 以 PRD AC1-AC7 做人工验收，并逐项静态追踪显示入口。未经用户要求不运行测试、类型检查、构建或浏览器验证。
- 回退只需移除本任务新增的字段消费和入口，不触碰原文件、存储键或用户其他修改；不要执行仓库级回滚。
