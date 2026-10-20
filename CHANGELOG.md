# Changelog

## v0.2.0 — 2026-10-20

- 新增图生图：提示词下方「添加参考图」，支持 PNG / JPEG / WebP，可点选或拖入、更换、移除。
- Agnes 图生图复用 `extra_body.image`；OpenAI / OpenAI 兼容走 `multipart /v1/images/edits`；Grok 走 JSON `/v1/images/edits` 的 `images[]`。
- DALL·E 3 明确拒绝参考图；非法/超大参考图有明确错误。
- 生成中矩阵点改为整块画布的中心向外扩散波动；径向遮罩扩展到画布边界与四角。
- 左右卡片等高拉伸，提示词框压缩，参考图区域与「最近生成」都在首屏内，无需滚动。
- 顶栏显示插件版本（`IMAGE WORKBENCH · v0.2.0`），方便确认是否更新成功。

## v0.1.0 — 2026-10-20

- 首个公开版本：Agnes / OpenAI GPT Image / Grok Image / OpenAI 兼容四个服务商，独立 Key。
- 侧边栏一级页面 + `/image` 简写命令；结果下载原图、本机历史、主题 token 适配。
