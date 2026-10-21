# 生图工作台（dsh-image-studio）设计说明

> 目标：在 DeepSeek Harness 里做一个与「上下文洞察」同级的一级侧边栏生图插件，支持 **Agnes / OpenAI GPT Image / Grok Image / OpenAI 兼容** 四个服务商，每个服务商独立 Key；同时提供 `/image` 对话调用（模型工具 `image_studio_generate`）。Agnes 复用 `open-storyboard-canvas` 既有请求契约，OpenAI/Grok/兼容档使用各自的标准 Images API。

## 1. 方案概述

插件是标准 DSH 双半包：

```text
┌──────────────────────────── dsh-image-studio ────────────────────────────┐
│ Host (lib/index.js + lib/providers.js, Node)                             │
│   config.json / credentials.json（每个 provider 独立 key）                │
│   POST /image-studio/generate ─► generateImage() ─► requestGeneration()  │
│   GET  status|history|files                                              │
│   /image command ─────────────► generateImage()（同一条链路）             │
└──────────────────────────────────▲───────────────────────────────────────┘
                                   │ loopback HTTP（Key 不下发浏览器）
┌──────────────────────────────────┴───────────────────────────────────────┐
│ Client (lib/client.js, browser)                                           │
│   sidebar.panellist  「生图工作台」                                          │
│   main / key=image-studio   面板：服务商页签 + 提示词 + 结果 + 历史         │
│   工具 image_studio_generate 返回 Markdown 图片                            │
└──────────────────────────────────────────────────────────────────────────┘
```

核心原则：

1. **一个生成管线**：面板与 `/image` 都调用 `generateImage()`；只有“参数来源”不同。
2. **一个 provider 抽象**：`lib/providers.js` 定义四个 preset；`buildRequestBody()` 按 preset 生成 body。
3. **Key 分槽**：`credentials.json` 的 `keys.<providerId>`，绝不跨服务商回退。
4. **主题原生**：只用 `--dsw-alias-*`、`--dsh-frame-top-clearance` 等 DSH token。

## 2. 四个服务商的请求契约

### 2.1 Agnes（复用 open-storyboard-canvas）

代码库：`open-storyboard-canvas`（本地开发副本；Agnes 改动未提交）。关键路径：

- `src/features/canvas/infrastructure/customProviderGateway.ts:704` `buildAgnesImageRequestBody`
- `:618` `resolveAgnesImageSizeTier`，`:637` `resolveAgnesImageRatio`
- `:660` `AGNES_IMAGE_20_SIZE_BY_TIER`
- `src/stores/customProvidersStore.ts:131` `AGNES_PROVIDER_DEFAULTS`
- 传输：`src/commands/ai.ts:263` `customHttpRequest` → Tauri `invoke('custom_http_request')`

请求：

```http
POST https://apihub.agnes-ai.cn/v1/images/generations
Authorization: Bearer <agnes key>
Content-Type: application/json
```

```json
{"model":"agnes-image-2.5-flash","prompt":"…","size":"2K","ratio":"16:9","return_base64":true}
```

参考图时改为（可以传 1–5 张，`image` 为数组）；OpenAI 自定义 GPT 模型的面板尺寸为 1K/2K/3K/4K，请求时按比例换算像素：

```json
{"model":"…","prompt":"…","size":"2K","ratio":"16:9",
 "extra_body":{"image":["data:image/png;base64,…"],"response_format":"b64_json"}}
```

`agnes-image-2.0-*` 用精确像素、省略 `ratio`。响应取 `data[0].b64_json` 或 `data[0].url`。

### 2.2 OpenAI GPT Image

```http
POST https://api.openai.com/v1/images/generations
Authorization: Bearer <openai key>
```

```json
{"model":"gpt-image-1.5","prompt":"…","n":1,"size":"1024x1024","quality":"high"}
```

- 模型：`gpt-image-1.5` / `gpt-image-1` / `gpt-image-1-mini` / `chatgpt-image-latest` / `dall-e-3`。
- GPT Image 尺寸：`1024x1024`、`1536x1024`、`1024x1536`、`auto`；质量 `auto/low/medium/high`。
- 工具/short手里的友好档位会映射到像素：`2k`/`4k` + 横图 → `1536x1024`，竖图 → `1024x1536`，方形 → `1024x1024`；也可直接写像素。
- DALL·E 3 尺寸：`1024x1024`、`1792x1024`、`1024x1792`；质量 `standard/hd`。
- 面板在切换模型时自动切换尺寸/质量选项；`quality=auto` 时不发送，使用上游默认。
- 图生图：`POST /v1/images/edits`，`multipart/form-data`，字段 `model / prompt / n / size / quality` + 1–5 个 `image` 文件（重复 `image` 字段）；DALL·E 3 不支持编辑，会返回明确错误。
- 自定义 GPT 模型：面板尺寸为 `1K/2K/3K/4K`，比例换算成像素后写入 `size`（`1K+16:9 → 1024x576`、`2K+16:9 → 2048x1152`、`4K+16:9 → 3840x2160`）；官方 gpt-image-1.x 仍用其固定像素尺寸。
- gpt-image-2.5 官方约束：推荐 `1024x1024 / 1536x1024 / 1024x1536`，也支持自定义 `WIDTHxHEIGHT`，宽高必须为 16 的倍数、比例 1:3–3:1；质量支持 `low / medium / high / xhigh / max / auto`。表内所有尺寸都按此校验，旧的 682/1365/1080 等非 16 倍数值已移除。
- 编辑路径由生成路径把 `generations` 替换为 `edits`，默认 `/v1/images/edits`。

### 2.3 Grok Image（xAI Imagine）

```http
POST https://api.x.ai/v1/images/generations
Authorization: Bearer <xai key>
```

```json
{"model":"grok-imagine-image-2.0","prompt":"…","n":1,
 "aspect_ratio":"16:9","resolution":"1k","quality":"medium","response_format":"url"}
```

- 模型：`grok-imagine-image-2.0`（默认）/ `grok-imagine-image`。
- `resolution` 使用小写 `1k` / `2k`（xAI 字段是大小写敏感的）；`aspect_ratio` 支持 `1:1/16:9/9:16/4:3/3:4/3:2/2:3/21:9/5:2`。
- 响应通常为 `data[0].url`，Host 下载后落盘；下载 xAI 同根域子域（如 `imgen.x.ai`）时带 Key，401/403 自动无 Key 重试，失败信息带 HTTP 状态和响应片段。
- 图生图：`POST /v1/images/edits`，JSON body 增加 `images: ["data:image/png;base64,…", …]`，比例/分辨率/质量沿用同一套参数；面板最多传 5 张，单张也用一元素数组。
- xAI 的旧 `grok-2-image-1212` 参数不同，未列入默认；如要接旧模型，需要另加 branch 或自建兼容接口。

> 参考：xAI Imagine 文档（`docs.x.ai/developers/model-capabilities/imagine`）与 Grok Imagine Image 2.0 的 `aspect_ratio` / `resolution` / `quality` 说明。若 xAI 调整参数，改 `lib/providers.js` 的 `buildRequestBody` 即可，UI 配置可继续复用。

### 2.4 OpenAI 兼容

标准 OpenAI Images 协议，用户自己填 Base URL、接口路径、模型：

```json
{"model":"my-image-model","prompt":"…","n":1,"size":"1024x1024"}
```

- 默认 Base URL `https://api.example.com`，必须由用户改成自己的中转地址。
- `size=auto` 时**省略 `size` 字段**，尽量兼容不同聚合器。
- 质量只在不是 `auto` 时发送。
- 图生图：`multipart /v1/images/edits`（`image` 文件 + 同一套字段）；不支持编辑的中转会返回上游错误。
- 响应仍按 `data[0].b64_json|url`、`images[]`、嵌套 JSON 字符串等深度扫描。

## 3. Provider 抽象与两条调用链路

`lib/providers.js` 导出：

```js
PROVIDER_ORDER = ['agnes','openai','grok','openai-compatible']
PROVIDERS[id] = {
  id, label, shortLabel, kind, baseUrl, endpointPath,
  models, defaultModel, sizes, defaultSize, sizeByModel,
  ratios, defaultRatio, supportsRatio,
  qualities, defaultQuality, qualityByModel, supportsQuality,
  keyPlaceholder, envKeys, editableEndpoint, sizeMode
}
buildRequestBody(preset, config, request) → {
  body, model, size, ratio, quality, referenceCount,
  mode?: 'multipart', endpointPath?: string, files?: [{dataUrl,mime,filename}]
}
buildEndpointUrl(config, overridePath?)
buildEditEndpointPath(config)
```

Host：

```js
async function generateImage(pluginConfig, input) {
  const providerId = normalizeProviderId(input.provider) ?? configDoc.defaultProvider
  const preset = getProvider(providerId)
  const config = resolveProviderConfig(preset, configDoc.providers[providerId])
  const key = credentialFor(credentialsDoc, preset).key
  if (!key) throw unconfigured(preset)
  const built = buildRequestBody(preset, config, input)
  const {buffer, mime} = await requestGeneration(preset, config, key, built)
  // JSON 或 multipart 由 built.mode 决定；落盘 + history + 返回 referenceCount
}
```

面板：

```text
POST /image-studio/generate {
  provider, prompt, model, size, ratio?, quality?,
  referenceImages?: ["data:image/png;base64,…"]
}
  → generateImage(pluginConfig, body)
```

斜杠：

```text
/image --provider openai --size 1024x1024 --quality high <prompt>
  → parseImageCommand(rawInput)
  → generateImage(pluginConfig, parsed)
```

两条链路只在参数来源和展示方式不同；请求体、鉴权、超时、错误映射、落盘、历史共用。

## 4. 侧边栏 UI

注册：

```js
slots.register({ name: 'sidebar.panellist', id: 'image-studio', order: 30,
                 label: () => '生图工作台' }, StudioIcon)
slots.register({ name: 'main', key: 'image-studio' }, StudioPage)
```

页面结构：

- 顶部：图标 + 标题 + 版本（`IMAGE WORKBENCH · v0.8.2`，来自 `/status.version`）+ 服务商说明 + 当前服务商 Key 状态 + 「配置」。
- **服务商页签**：Agnes / GPT Image / Grok / 兼容接口；每个页签带 Key 配置状态点。
- 未配置当前服务商时：整宽警告条 + 「现在配置」，明确说明“只用于该服务商”。
- 左列：提示词（4000 字上限）、**参考图（1–5 张，PNG/JPEG/WebP，可点选/多选/拖入，缩略图逐张移除，仅内存）**、模型、尺寸、比例（Agnes/Grok）、质量（OpenAI/Grok）、生成按钮、快捷用法；提示词框压缩为 90px，把空间留给参考图和参数。
- 右列：结果画布、provider/model/size/ratio/quality/耗时/像素 meta、**全屏看图**（结果卡图标/点图打开；Esc/点背景关闭，全屏内可删除/下载）、**删除**、**下载原图**（`?download=1` 附件）、复制路径；参考图生成会显示「参考图 N」标签。结果图在固定画布内绝对居中、等比缩放，1:1 图不会把面板撑出窗口。静止/出图状态显示静态矩阵点，生成中在整块结果画布内显示中心向外扩散的矩阵点（Canvas 绘制，径向遮罩扩展到画布边界与四角；`prefers-reduced-motion` 时静止），不再使用棋盘格。左右卡片等高拉伸，「最近生成」收在结果卡片底部，常规桌面高度内不需要滚动。
- 配置弹窗：服务商页签 + 该服务商的 Key、Base URL、接口路径、默认模型、默认尺寸/比例/质量；Agnes 附带「获取 Agnes Key」直达 `https://platform.agnes-ai.cn/`（另附国际站），清除 Key 只清当前服务商。默认模型旁有「嗅探模型」：用已保存的 Key 请求 `GET /v1/models`，图像模型优先并标「图像」；模型 chips 可多选，保存后只有勾选的模型进入主面板下拉。
- 底部：无独立区块，历史在右卡底部。
- 主题：`--dsw-alias-bg-base/layer-1/layer-2`、`--dsw-alias-border-l1`、`--dsw-alias-brand-primary`、`--dsw-alias-state-*`、`--dsh-frame-top-clearance`；CSS 热更新时替换 `<style>` 节点，避免旧样式残留。

## 5. `/image` 对话调用（工具）

`/image` **不是** DSH 斜杠命令，而是一段普通用户消息；Host 注册模型工具：

```js
ctx.tools.register({
  name: 'image_studio_generate',
  description: '…Call this whenever a user message begins with "/image" …',
  parameters: { request, prompt, provider, size, ratio, quality, model, fresh },
  output: { schema, render: (_args, value) => [{ type: 'text', text: value.markdown }] },
  async execute(args, exec) { return executeImageTool(pluginConfig, args, exec) },
})
ctx.systemPrompt.section({
  name: 'tool:image-studio',
  order: 120,
  text: 'When a user message begins with /image, call image_studio_generate …',
})
```

用户把 `/image ...` 当普通消息发送：输入框正常清空，会话正常落盘，模型调用工具，工具返回 Markdown 图片；之后可以继续聊天，不会再触发命令卡或占住输入框。

语法：

```text
# 推荐简写：服务商 + 尺寸 + 比例，顺序可换，遇到第一个不认识的词即提示词
/image gpt 2k 16:9 一只猫
/image grok 2k 9:16 雨夜霓虹街道
/image agnes 1k 1:1 电影感棚拍
/image 2k 16:9 默认服务商

# 显式参数（兼容老写法）
/image [--new] [--provider agnes|openai|grok|openai-compatible]
       [--size 1K|2K|3K|4K|1024x1024|…]
       [--ratio 1:1|…|21:9]
       [--quality auto|low|medium|high|standard|hd]
       [--model <id>]
       <提示词>
```

解析规则：

- 只解析**开头**的 provider/size/ratio；一旦遇到不认识的词，剩余全部作为提示词。
- 服务商别名：`gpt`→openai、`grok`、`agnes`、`compatible`/`custom`→openai-compatible。
- 尺寸 token：`1k/2k/3k/4k`、`1024x1024` 等像素、`auto`。
- 比例 token：`1:1/3:4/4:3/16:9/9:16/2:3/3:2/21:9/5:2`。
- 质量仍用 `--quality`（避免把提示词里的 “high quality” 误吞）。
- GPT Image 没有 2K/4K 档：`gpt 2k 16:9` 会映射为 `1536x1024`，`gpt 2k 9:16` → `1024x1536`，方形 → `1024x1024`；其他 OpenAI 尺寸仍可直接写像素。
- 未写 `--provider` 时用 `config.json` 的 `defaultProvider`；点击面板页签会更新它。
- **同一对话的上下文**：第一次调用是文生图；之后同一 session 再次调用，会自动把上一张图读成 data URL 作为参考图（图生图）。`--new` / `fresh:true` 强制重新文生图。
- 会话上下文只存在 Host 内存（按 session id，最多 200 个会话），不写盘；DSH 重启后第一条会重新文生图。
- 图片被删除或超过 12MB 时，后续修改会明确报错，提示用 `--new` 重新生成。
- 结果：
  ```text
  已生成图片 · Grok Image · grok-imagine-image-2.0 · 2K · 16:9 · medium · 3.2s

  ![生图结果](/image-studio/files/img-….png)

  本地文件：C:\…\.dsh\image-studio\outputs\img-….png
  ```
- 工具输出 `render` 返回 Markdown 文本；客户端注册 `tool.call.toolview` key=`image_studio_generate`，从工具结果中解析图片 URL 并渲染大图，提供「打开本地文件 / 打开原图」。系统提示要求模型把该 Markdown 图片也带回最终回复，保证对话内联显示。旧会话里的历史 commandview 卡片仍保留。
- 系统提示片段确保模型把 `/image` 当工具请求，而不是普通文本回复；工具描述同时保留这条规则。

## 6. Key 与配置存储

```text
$DSH_HOME/image-studio/
  credentials.json   { "version": 2, "keys": { "agnes": "…", "openai": "…", "grok": "…", "openai-compatible": "…" } }
  config.json        { "version": 2, "enabled": true, "defaultProvider": "agnes", "providers": { … } }
  history.json
  outputs/
```

Key 读取优先级（按 provider）：

1. `credentials.json` → `keys[providerId]`（面板写入）
2. 该 provider 的环境变量：`DSH_IMAGE_STUDIO_AGNES_API_KEY` / `..._OPENAI_API_KEY` / `..._GROK_API_KEY` / `..._OPENAI_COMPATIBLE_API_KEY`
3. Agnes 额外兼容旧 `DSH_IMAGE_STUDIO_API_KEY`
4. 无 → `configured:false`

- 不会读取 dsh 的模型凭据、`settings.yaml`、`ctx.credentials` 或画布的 `agnesApiKey`。
- 状态接口只返回 `masked`（如 `sk-m…-123`）与 `keySource`，不返回完整 Key。
- 旧版单 provider 文件自动迁移：`{apiKey}` → `keys.agnes`；`{baseUrl,model}` → `providers.agnes`。

配置优先级：面板保存的 `config.json` > 插件部署配置 > preset 默认值。

## 7. Host 路由

| Method | Path | 作用 |
|---|---|---|
| GET | `/image-studio/status` | `{enabled, version, defaultProvider, providers[], storageDir}`，每个 provider 含配置/Key 状态/模型/尺寸/比例/质量 |
| POST | `/image-studio/setup` | `{providerId?, defaultProvider?, apiKey?, clearKey?, baseUrl?, endpointPath?, model?, size?, ratio?, quality?}` |
| POST | `/image-studio/models` | `{provider}`；用已保存的 Key 请求该 provider 的 `GET /v1/models`，返回 `{provider, providerLabel, endpoint, models:[{id,imageLike}], fetchedAt}`，不回传 Key |
| POST | `/image-studio/generate` | `{provider?, prompt, model?, size?, ratio?, quality?, referenceImages?}` |
| GET | `/image-studio/history` | 最近 80 条（含 provider） |
| DELETE | `/image-studio/history/<id>` | 删除一条历史记录及本地文件；id 必须匹配图片文件白名单 |
| GET | `/image-studio/files/<id>` | 图片字节；`?download=1` 附件下载 |

安全：loopback socket + Host 头 + Origin + 拒绝 `X-Forwarded-For`/`Forwarded`；文件 ID 白名单 + 解析后目录校验；body 上限 24MB；并发上限。

## 8. 配置字段

顶层：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `defaultProvider` | `agnes` | `/image` 默认服务商 |
| `providers.<id>` | preset | 每个服务商独立配置 |

每个 provider：

| 字段 | 默认值（按 provider） | 说明 |
|---|---|---|
| `baseUrl` | Agnes `https://apihub.agnes-ai.cn`；OpenAI `https://api.openai.com`；Grok `https://api.x.ai`；兼容 `https://api.example.com` | 根地址 |
| `endpointPath` | `/v1/images/generations` | 可改中转路径 |
| `model` | Agnes `agnes-image-2.5-flash`；OpenAI `gpt-image-1.5`；Grok `grok-imagine-image-2.0`；兼容 `gpt-image-1` | 默认模型 |
| `size` | Agnes `2K`；OpenAI `1024x1024`；Grok `1K`；兼容 `auto` | 默认尺寸 |
| `ratio` | Agnes `1:1`；Grok `1:1`；OpenAI/兼容为空 | 仅比例型服务商 |
| `quality` | OpenAI `auto`；Grok `medium`；兼容 `auto`；Agnes 空 | 质量 |

所有图片 URL 由 `webServer.getOrigin()` 拼成绝对地址（如 `http://127.0.0.1:6354/image-studio/files/...`），避免 6355/6356 页面拿到相对路径后 401。

`待补充`：

- Agnes 以后新增的模型/尺寸档；
- xAI 后续 Imagine 模型参数变化；
- 兼容接口的私有参数（如 `n>1`、seed、negative prompt）目前未暴露 UI，可按需扩展。

## 9. 改动点清单

新增/修改（本插件包）：

| 文件 | 作用 |
|---|---|
| `lib/providers.js` | 四个 provider preset、尺寸/比例/质量归一、文生图/图生图请求体、参考图校验、URL 拼接 |
| `lib/index.js` | Host：配置/Key、路由、生成、JSON/multipart 传输、错误映射、`/image` |
| `lib/client.js` | Client：服务商页签、1–5 张参考图上传/缩略图/移除、面板、配置弹窗、`image_studio_generate` 工具结果视图、旧命令结果视图、主题 CSS |
| `package.json` / `cordis.patch.yml` | DSH bundle + client 声明 |
| `icon.svg` | 图标 |
| `README.md` / `docs/design.md` | 使用与设计 |
| `scripts/smoke-host.mjs` | 四服务商宿主冒烟 |

Profile（安装自动产生）：

- `~/.dsh/profiles/desktop/package.json`：`dsh-image-studio: link:<plugin 目录>`，`dsh.profile.bundles` 增加 `dsh-image-studio`。

未修改 `open-storyboard-canvas` 仓库。

可选上游重构：把 Agnes 纯函数抽到 `src/shared/agnesRequest.ts`，画布和插件共用；当前为等价移植，避免动用户未提交改动。

## 10. 验证

- **宿主冒烟**（`scripts/smoke-host.mjs`，mock 四个上游）：
  - 旧版单 Key 文件迁移到 `keys.agnes`；
  - 四个 provider 分别配置 Key，状态全部 `configured`；
  - 模型嗅探：四个 provider 的 `GET /v1/models` 均返回图像模型并标 `imageLike`；未知 provider 422；`models` 多选保存后只暴露勾选模型；自定义 GPT 模型暴露 1K/2K/3K/4K 档，4K + 16:9 映射 `3840x2160`、1K + 16:9 映射 `1024x576`，且 `supportsRatio=true`；
  - 历史删除：`DELETE /history/<id>` 同时移除记录与文件，重复删除 404；`filePath` 随历史返回；图片 URL 是 `webServer.getOrigin()` 拼出的绝对地址；
  - Agnes body 逐字节等于画布契约；
  - OpenAI body：`{model,prompt,n:1,size,quality}`；
  - Grok body：`{model,prompt,n:1,response_format:"url",aspect_ratio,resolution:小写 1k/2k,quality}`；xAI 子域下载带 Key，401/403 无 Key 重试；
  - 兼容 body：`{model,prompt,n:1,size}`，`auto` 时省略 size；
  - 清除 OpenAI Key 不影响 Agnes/Grok；缺 Key 返回 409 且 `error.provider` 正确；
  - `image_studio_generate` 工具注册，`request` 原样接收 `/image …` 并解析；
  - `/image --provider grok …` 走 Grok Key 和参数；简写 `gpt 2k 16:9` 映射为 OpenAI `1536x1024`；`grok 2k 9:16`、`agnes 1k 1:1`、无 provider 均通过；
  - 同一 session：第一次工具调用文生图；第二次自动带上一张 `extra_body.image`，Markdown 显示「基于 1 张参考图」；`--new` 后不再带参考图；
  - 工具 `output.render` 返回 Markdown 图片；客户端 `tool.call.toolview` 注册并能从结果文本解析 URL；参考图 1–5 张与图生图接口均通过；
  - 图生图：Agnes `extra_body.image`、OpenAI/兼容 `multipart /v1/images/edits`、Grok JSON `/v1/images/edits` `images[]` 均通过；DALL·E 3 参考图 422；非法参考图 422；history `referenceCount` 正确；
  - 历史 8+ 条、文件路由、参数传递、路径穿越 404、未知 provider 422。
- **隔离 profile + headless 浏览器**：
  - 服务商页签 `Agnes / GPT Image / Grok / 兼容接口`；
  - 默认 provider 正确选中；
  - 切换到 GPT Image 后模型/尺寸/质量选项正确，Key chip 显示掩码；
  - 自定义 GPT 模型尺寸只有 1K/2K/3K/4K；比例切换后显示实际像素（如 4K + 16:9 → 3840x2160），官方 gpt-image-1.x 不显示这些档位；
  - `/image` 工具结果卡有图片和「打开本地文件 / 打开原图」，模型最终回复也包含图片 Markdown；
  - 用 mock 上游生成成功，结果 meta 显示 `OpenAI GPT Image / gpt-image-1.5 / 1024x1024 / high`；
  - 配置弹窗有四个服务商页签、独立 Key/Base URL/接口路径/默认模型/尺寸/质量；Agnes 页有「获取 Agnes Key」；
  - 配置弹窗的「嗅探模型」显示模型 chips，可多选，图像模型带「图像」标记；保存后主面板模型下拉只出现勾选项；
  - 参考图按钮选择文件后能正常出缩略图（FileList 在清空 input 前复制）；
  - 结果卡全屏图标/点击图片打开全屏层，Esc 或点背景关闭；结果卡、全屏层、历史缩略图均可删除；
  - 复制路径在 Clipboard API 失败时走 textarea 回退；
  - 1:1 结果图在固定画布内等比缩放并居中，不把窗口撑出滚动；
  - mock 请求体确认为标准 OpenAI Images body；
  - 参考图上传：一次选择两张后出现两个缩略图，可逐张移除；Agnes 请求 `extra_body.image` 长度为 2，结果 meta 出现「参考图 2」；
  - 超过 5 张被拒绝；DALL·E 3 下参考图入口禁用/生成按钮禁用；
  - 加载态：Canvas 与结果区同尺寸（510×450），中心向外扩散的矩阵点 + 径向遮罩扩展到画布边界与四角，无 spinner；
  - 静止/出图态：静态矩阵点铺满结果画布，无棋盘格；
  - 1296×755 视口：`pageScroll = clientHeight = 755`，左右卡片底部同为 731px，最近生成底部约 714px，无需滚动。
- **桌面窗口**：一级侧边栏「生图工作台」、版本号 `v0.8.2`、多服务商页签、参考图区域、静态矩阵点、未配置警告、配置入口均正常显示。

未验证 / 待补充：

- 本机没有真实 Agnes/OpenAI/xAI Key，未发起真实计费请求；OpenAI/Grok 的 body 按官方/公开文档实现，真实账号首次调用请留意上游参数差异。
- 有模型会话中的 `/image` 行内图：工具注册、参数解析和 Markdown 输出已用 mock 验证；真实模型是否稳定调用该工具、以及工具结果卡片里的图片渲染，建议在正常会话里目测一次。
- 参考图真实上游未用真实计费 Key 验证：OpenAI multipart / Grok JSON edits 按官方接口实现，首次使用请留意上游参数/字段差异。

## 11. 边界情况

| 场景 | 行为 |
|---|---|
| 当前 provider 未配置 Key | 409 `unconfigured`，文案带 provider 名称；面板弹出该 provider 配置；`/image` 返回同文案 |
| Key 无效 | 401/403 → `auth`，文案如 `OpenAI GPT Image Key 无效或无权限（HTTP 401）。上游信息：…` |
| 未知 provider | 422 `bad-request`：`未知的生图服务商：xxx` |
| Base URL/接口路径错 | 404 文案带当前 URL，提示检查 Base URL / 接口路径 |
| 参数被拒 | 400/422 → `bad-request`，带上游 message |
| 额度/限流 | 402 `quota`；429 `rate-limit` |
| 超时 | 504 `timeout`，提示调高 timeoutMs |
| 网络失败 | 502 `network`，带 provider 与 baseUrl |
| 200 无图 | 502 `no-image`，带 400 字响应预览 |
| Key 含空白/过短 | setup 422，不写盘 |
| 清某一家 Key | 只删 `keys.<id>`，其他 provider 不受影响 |
| 参考图格式/大小不合法 | 422 `bad-request`，文案指出第几张、只接受 PNG/JPEG/WebP、上限 12MB |
| 参考图超过 5 张 | 422 `bad-request`；面板最多保留 5 张，超出部分不添加 |
| `/models` 不支持/空列表 | 502 `upstream`：提示该服务商可能不支持 `GET /models` |
| 模型嗅探 401/429/超时 | 分别为 401 `auth`、429 `rate-limit`、504 `timeout`，文案带 provider |
| DALL·E 3 + 参考图 | 422 `bad-request`：DALL·E 3 不支持参考图，请切到 gpt-image 系列 |
| 兼容中转不支持 edits | 上游 4xx 原样映射，提示检查编辑接口路径/中转能力 |
| 参考图持久化 | 只在浏览器内存中参与当前请求，不写 history/outputs/配置文件 |
| 路径穿越 | 404 |
| 模型未调用工具 | 系统提示片段 + 工具描述双重引导；若模型仍只回文本，可在系统提示中进一步约束 |

## 12. 参考

- OpenAI Images API：<https://platform.openai.com/docs/guides/image-generation>
- OpenAI Create image edit：<https://platform.openai.com/docs/api-reference/images/createEdit>
- xAI Imagine / Image Generation：<https://docs.x.ai/developers/model-capabilities/imagine>
- xAI edit endpoint：<https://docs.x.ai/developers/model-capabilities/imagine/files/inputs>
- open-storyboard-canvas Agnes 实现：`customProviderGateway.ts` / `customProvidersStore.ts`（本地仓库）
