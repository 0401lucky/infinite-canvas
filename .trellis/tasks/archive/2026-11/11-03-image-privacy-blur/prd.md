# 画布图片主动隐私模糊

## Goal

用户会使用审核较宽松的模型生成敏感图片，希望在不方便展示的场合主动点击模糊图片，避免旁人直接看到内容。

## Background

- 用户提供了带「2 张」标记的画布图片组截图，已确认下述节点级范围，并在最终规划摘要之后明确批准开始实施。
- 画布图片组使用节点的 `metadata.images` 与 `primaryImageId`，主图和展开后的候选图分别渲染：`web/src/components/canvas/canvas-node.tsx:764`、`web/src/components/canvas/canvas-node.tsx:788`、`web/src/components/canvas/canvas-node.tsx:881`。
- 图片已有可配置的节点工具栏，可复用入口而不新增常驻面板：`web/src/components/canvas/canvas-node-hover-toolbar.tsx:158`、`web/src/components/canvas/canvas-node-hover-toolbar.tsx:160`。
- 图片同时出现在元素列表、大图弹窗和快捷预览中，单独模糊节点不能覆盖这些显示入口：`web/src/components/canvas/canvas-side-panel.tsx:280`、`web/src/components/canvas/canvas-side-panel.tsx:324`、`web/src/pages/canvas/project.tsx:3336`、`web/src/pages/canvas/project.tsx:3473`。
- 引用条还会显示节点缩略图和悬停预览：`web/src/components/canvas/canvas-node-reference-bar.tsx:41`、`web/src/components/canvas/canvas-node-reference-bar.tsx:55`；画布记录保存完整节点，支持将标记随节点保存：`web/src/stores/canvas/use-canvas-store.ts:18`、`web/src/stores/canvas/use-canvas-store.ts:160`。
- 提示词引用还包括候选缩略图、内嵌图片和点击预览：`web/src/components/canvas/canvas-prompt-chip-input.tsx:196`、`web/src/components/canvas/canvas-prompt-chip-input.tsx:265`、`web/src/components/canvas/canvas-config-composer.tsx:187`、`web/src/components/canvas/canvas-config-composer.tsx:235`；Agent 消息中的画布引用已有当前节点查找：`web/src/components/agent/agent-chat-message.tsx:159`。
- 当前项目没有已记录的图片隐私模糊需求；现有 TODO 没有同类事项。

## Requirements

- R1：在既有图片工具栏增加「模糊图片 / 取消模糊」操作，分别控制每个图片节点/图片组，不影响未标记的其他图片。
- R2：模糊只影响界面显示，不修改原文件、尺寸和原始比例；下载、导出和 AI 参考使用原图，不增加内容审核。悬停、预览和切换显示入口不得自动取消模糊。会直接展示清晰原图的编辑工具先提示主动取消模糊，不自动揭示图片。
- R3：图片组统一受开关控制，切换主图、展开组和已有节点原地重新生成后仍遵守标记；从模糊组创建同图副本时保留标记，避免副本立即露出原图。
- R4：标记随画布节点保存，刷新或重新打开后保留，主动取消后的状态也保存；沿用现有会话隔离与服务端保存失败提示。
- R5：画布内该节点的图片、元素缩略图、大图、快捷预览和提示词/Agent 画布引用预览同步模糊；素材页、工作台和单独上传的 Agent 附件属于独立记录，不联动。

## Acceptance Criteria

- [ ] AC1（R1）：点击图片工具栏的模糊按钮，该节点立即明显模糊，按钮可取消；其他图片保持原样，既有工具配置仍可使用。
- [ ] AC2（R3）：主图和展开的组内图片均模糊；切换主图、重试/原地重新生成和创建同图副本不会意外露出清晰图片，节点位置和比例保持原规则。
- [ ] AC3（R4）：成功保存后刷新或重新打开该画布，节点仍模糊；主动取消后再次打开显示正常，服务端保存失败不宣称已保存。
- [ ] AC4（R5）：元素列表、列表悬停/快捷预览、大图弹窗、引用条、提示词和 Agent 的相关引用缩略图及预览均遵守标记，包括已经打开的预览。
- [ ] AC5（R2）：悬停/双击/查看大图不恢复清晰图；编辑工具提示先取消模糊；原文件下载、ZIP 导出和生图参考保持原内容。
- [ ] AC6（R5）：素材页、工作台独立记录以及未标记图片正常显示；标记不是按 `storageKey` 全局关联。
- [ ] AC7（R1）：沿用画布主题、中文文案和现有工具栏交互；浅色/深色和桌面/移动端入口可用，不新增常驻面板。

## Out Of Scope

- 自动 NSFW 检测、内容审核或对模型请求新增审核逻辑。
- 不可逆图片编辑、原文件模糊导出和媒体存储格式变更。
- 新增模糊强度配置、复杂权限控制或新的浏览器业务存储。
- 全局隐私模式或自动模糊所有图片。
- 将显示模糊宣称为加密、访问控制或原图脱敏；下载/导出的原图仍需用户自行注意使用场合。

## Constraints

- 按 `AGENTS.md` 在主 Agent 内执行，不委派；不自动运行语法、类型、测试或构建，不自动提交。
- 状态复用服务端画布记录，不新增 IndexedDB/localStorage 业务数据，不做旧字段迁移。
- 保留现有 Agnes 任务下六个未跟踪研究文件，不修改无关内容。
- 完成后按实际变更检查 TODO、更新待测试说明和 `CHANGELOG.md` 的 `Unreleased`，未经用户验收不提升为正式功能说明。

