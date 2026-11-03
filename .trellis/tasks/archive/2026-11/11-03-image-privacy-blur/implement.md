# 图片隐私模糊实施计划

## Ordered Checklist

- [x] 最终规划摘要获得用户后续明确批准，再执行 `task.py start`；读取 `trellis-before-dev`、相关前端规范、frontend-design 和 React 最佳实践，核对 Ant Design 当前 API。
- [x] 增加节点 `privacyBlurred` 字段和既有图片工具栏切换动作；沿用 `project.tsx` 节点状态更新与保存链路，不重置工具偏好，不做全局图片控制。
- [x] 给主图、展开图片组、元素列表、引用条、快捷预览和大图添加显示模糊；同图副本保留标记，原地重新生成不丢状态；原图编辑入口加入主动取消提示。
- [x] 贯通提示词引用候选/内嵌图片/点击预览和 Agent 画布引用显示；已经打开的预览、已插入的 DOM token 也更新，保持原 URL 和 AI 参考不变。
- [x] 对照 AC1-AC7 静态检查相关 diff 和全部显示入口；读取 `trellis-check`，仅做规范/数据流/差异复核，不执行自动检查。
- [x] 检查中英文 TODO（无同类事项则保持不变），更新中英文 pending-test 与 `CHANGELOG.md` 的中文 Unreleased；不提前更新正式功能介绍。
- [x] 记录相关画布规范与任务结果，读取 `trellis-finish-work` 按项目覆盖规则收尾；归档和会话记录均使用 `--no-commit`，未提交、推送或发版。

## Affected Files

- 节点/动作：`web/src/types/canvas.ts`、`web/src/components/canvas/canvas-node-hover-toolbar.tsx`、`web/src/pages/canvas/project.tsx`；快捷工具定义保持不变，隐私按钮不受显隐配置控制。
- 共享显示样式：`web/src/lib/canvas/canvas-image-privacy.ts`。
- 显示：`web/src/components/canvas/canvas-node.tsx`、`web/src/components/canvas/canvas-side-panel.tsx`、`web/src/components/canvas/canvas-node-reference-bar.tsx`。
- 提示词引用：`web/src/lib/canvas/canvas-resource-references.ts`、`web/src/components/canvas/canvas-node-generation.ts`、`web/src/components/canvas/canvas-resource-mention-textarea.tsx`、`web/src/components/canvas/canvas-prompt-chip-input.tsx`、`web/src/components/canvas/canvas-config-composer.tsx`。
- Agent 显示：`web/src/components/agent/agent-canvas-reference-preview.tsx`、`web/src/components/agent/agent-chat-prompt-input.tsx`、`web/src/components/agent/agent-chat-message.tsx`、`web/src/pages/canvas/hooks/use-agent-bridge.ts`；不修改 Agent 服务端、消息协议或持久化格式。
- 文案/文档：`web/src/i18n/locales/zh-CN.ts`、`web/src/i18n/locales/en-US.ts`、两个 pending-test MDX、`CHANGELOG.md`，以及必要的相关画布规范。

## Validation And Review

- 可执行的只读差异命令：`git status --short`、`git diff --stat`、针对上述文件的 `git diff`；不自动运行语法/类型/lint/测试/格式化/构建命令。
- 人工用一张普通图片、一个多图组验证单独切换、展开/选主图/同图副本、原地重试、移动/缩放和两种主题（AC1、AC2、AC7）。
- 保存成功后刷新/重开，测试取消后再次保存，以及服务端断开时原有错误提示（AC3）。
- 列表/悬停/大图/引用条/@ 候选/内嵌图片/点击预览/Agent 画布引用逐项查看；覆盖已打开预览后切换标记的情况（AC4、AC5）。
- 下载和 ZIP 中检查原文件未变，图生图仍引用原内容，素材与工作台独立记录以及 Agent 单独上传附件不受影响（AC5、AC6）。

## Risky Areas And Rollback

- `project.tsx` 同时拥有本地节点和保存/历史；不转移所有权，不引入全局状态与本地状态互相覆盖。
- contentEditable 中不要为了同步模糊重置正在输入的内容或光标；预览不能仅缓存裸 URL。
- 工具偏好不得因新增按钮清空；模糊状态下必须能找到取消入口。
- 回退限本任务新增行，不动六个 Agnes 未跟踪研究文件，不用 `git reset` / `git checkout --`。

## Pre-Start Gate

- [x] 用户已确认逐节点控制、画布内显示范围、保存生命周期及原图边界。
- [x] 已研究图片组、保存/hydration/ZIP 以及各类引用入口；无需要后端迁移的技术未知项。
- [x] PRD 已收敛为目标、背景、R1-R5、AC1-AC7、范围与约束，无阻塞开放问题。
- [x] 用户在最新最终摘要之后明确回复「可以没问题」，批准开始实施。

## Result

- 实现和规范/diff 复核已完成，已补齐所有约定的图片与引用入口；PRD 的运行验收项仍交给用户确认，不把静态复核标为测试通过。
- 已添加画布隐私显示契约，更新中英文待测试说明和中文 Unreleased；中英文 TODO 没有同类事项，无需修改，正式功能介绍保持不变。
- 按规则未运行语法、类型、lint、测试、格式化、构建或浏览器验收；未暂存、提交、推送或发版，六个已有 Agnes 研究文件保持原样。
- 本任务从未创建 PR，是主 Agent 在 `main` 上直接完成的未提交改动；已按无 PR 任务使用 `--skip-branch-validation --no-commit` 归档，并以 `--no-commit` 记录会话。运行验收仍在待测试文档中，不宣称用户验收已通过。
