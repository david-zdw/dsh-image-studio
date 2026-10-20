# dsh-image-studio · 生图工作台

DeepSeek Harness 的多服务商生图插件：**Agnes / OpenAI GPT Image / Grok Image / OpenAI 兼容**，每个服务商独立 Key；侧边栏一级页面 + `/image` 对话调用，复用 `open-storyboard-canvas` 的 Agnes 请求契约，并补齐 OpenAI Images 与 Grok Imagine 接口；支持文生图与最多 5 张参考图的图生图。

当前版本：**v0.7.1** · [CHANGELOG](CHANGELOG.md)

![多服务商生图面板](docs/panel.png)

## 功能

- **四个服务商，四个独立 Key**：互不回退、互不覆盖；Key 只保存在本机插件目录，不写入 dsh 模型凭据或其他插件配置。
- **侧边栏一级入口**：与「插件」「自动化任务」「上下文洞察」同级，点击直接打开完整面板。
- **完整面板**：服务商切换、模型/尺寸/比例/质量、提示词、参考图、Ctrl/⌘+Enter、**整块画布中心扩散的矩阵点动画（遮罩扩展到画布边界与四角）**、结果预览、**全屏看图与删除**、**下载原图**、复制路径、最近 80 张历史；静止/出图状态也用静态矩阵点，不再显示棋盘格；结果图按画布大小等比缩放，1:1 图不会把面板撑出窗口。
- **GPT 4K / 比例**：自定义 GPT Image 模型支持 4K 像素尺寸和比例选择（比例会映射到对应尺寸）；官方 gpt-image-1.x 仍只显示其支持的尺寸。
- **图生图（最多 5 张参考图）**：提示词下方「添加参考图」，支持 PNG / JPEG / WebP，可点选或拖入多张，缩略图逐张可移除；Agnes 走 `extra_body.image[]`，OpenAI / 兼容走 `multipart /v1/images/edits`（重复 `image` 字段），Grok 走 JSON `/v1/images/edits` 的 `images[]`；DALL·E 3 不支持参考图。
- **`/image` 对话调用**：作为普通消息发送，模型调用 `image_studio_generate` 工具生成/修改；图片以工具结果返回当前对话，输入框正常清空，可继续聊天。同一对话首条文生图，后续自动基于上一张修改，`--new` 重新生成。
- **模型嗅探**：配置 Key 后在「生图设置」点「嗅探模型」，用已保存的 Key 拉取服务商 `/v1/models`；结果可多选，只有勾选的模型保存后会进入主面板下拉，图像模型带「图像」标记。
- **与 dsh 主题融合**：使用 `--dsw-alias-*`、`--dsh-frame-top-clearance` 等实时 token。
- **明确失败**：未配置 / 401 / 402 / 429 / 超时 / 网络 / 无图片数据分别有可执行提示。

![生成中的矩阵点动画](docs/loading.png)

*生成中：矩阵点铺满整块画布，中心向外扩散波动，遮罩扩展到画布边界与四角；左右卡片等高，下方「最近生成」在同一屏内可见。*

## 服务商

| id | 面板名称 | 默认 Base URL | 默认模型 | 参数形态 | 图生图 |
|---|---|---|---|---|---|
| `agnes` | Agnes | `https://apihub.agnes-ai.cn` | `agnes-image-2.5-flash` | `size` 档位 1K–4K + `ratio` | 同 generations，`extra_body.image` |
| `openai` | OpenAI GPT Image | `https://api.openai.com` | `gpt-image-1.5` | 像素 `size` + `quality`；DALL·E 3 自动切换尺寸/质量 | `multipart /v1/images/edits`（DALL·E 3 不支持） |
| `grok` | Grok Image | `https://api.x.ai` | `grok-imagine-image-2.0` | `aspect_ratio` + `resolution`（1K/2K）+ `quality` | JSON `/v1/images/edits`，`images[]` |
| `openai-compatible` | OpenAI 兼容 | `https://api.example.com` | `gpt-image-1` | 自己填 Base URL / 接口路径 / 模型，标准 Images body | `multipart /v1/images/edits` |

OpenAI 兼容档可接任意 `POST /images/generations` 风格的中转/聚合器；模型名、尺寸、接口路径都可以在面板里改。图生图接口按生成路径把 `generations` 替换为 `edits`（默认 `/v1/images/edits`），Base URL 不变。

## 安装

```powershell
git clone https://github.com/david-zdw/dsh-image-studio.git

# 在 DSH profile 中安装这个本地包（路径换成你的 clone 目录）
dsh plugin --profile desktop add link:D:/path/to/dsh-image-studio
# macOS / Linux:
# dsh plugin --profile desktop add link:/path/to/dsh-image-studio
```

也可以在 DSH 插件管理器里选择 `install_bundle`，目标目录指向 clone 下来的仓库。

安装后侧边栏出现「生图工作台」。如果当前窗口是在安装前启动的，重新加载窗口/重启 DSH 一次即可。卸载：

```powershell
dsh plugin --profile desktop remove dsh-image-studio
```

## 更新

当前版本 `v0.7.1`。更新后顶栏会显示 `IMAGE WORKBENCH · v0.7.1`，可以用它确认是否生效。

### 本地 link 安装（推荐）

```powershell
cd D:/path/to/dsh-image-studio
git fetch --tags
git pull --ff-only

# 或固定到某个版本
git checkout v0.7.1
```

然后重启 DSH，或在插件管理器里禁用/启用一次「生图工作台」。HMR 只用于开发；普通用户重启最稳。

### 插件管理器安装

在插件管理器里更新/重装 `dsh-image-studio`，目标仍指向同一个 clone 目录。也可以走 profile 的 pnpm：

```powershell
dsh plugin --profile desktop update dsh-image-studio
```

注意：`dsh plugin` 只是把参数转发给 pnpm。如果当初是 `link:` 安装，`pnpm update` 不会帮你拉取 git 更新，仍然要先 `git pull`。

### 更新不会丢配置

Key、Base URL、模型、历史都在：

```text
$DSH_HOME/image-studio/
```

更新/重装插件不会清空这个目录。不要为了更新去删除它。

## 使用

1. 点击侧边栏「生图工作台」。
2. 选择服务商页签（Agnes / GPT Image / Grok / 兼容接口）。
3. 点右上角「配置」，给**当前服务商**填 Key、Base URL、模型、默认参数；Agnes 配置里有「获取 Agnes Key」直达平台。保存 Key 后可点「嗅探模型」，从服务商 `/v1/models` 拉取列表；勾选需要的模型（可多选）后保存，主面板下拉只显示勾选的模型。
4. 需要图生图时，在提示词下方点「添加参考图」，可选择或拖入多张 PNG / JPEG / WebP（最多 5 张）；缩略图会显示在参考图区域，可逐张移除。
5. 输入提示词，点「生成图片」。
6. 生成后结果右上角有全屏图标、**删除**、**下载原图**（PNG/JPEG/WebP）和「复制路径」；点全屏图标或图片本身可全屏查看（Esc/点背景关闭，全屏内也可删除/下载），历史缩略图右上角也可删除。

或直接发送：

```text
# 第一条：文生图
/image gpt 2k 16:9 一只戴宇航头盔的橘猫

# 同一对话第二条：自动基于上一张修改
/image 把背景改成雨夜霓虹街道，保留橘猫和头盔

# 同一对话想重新文生图：加 --new
/image --new agnes 1k 1:1 一只在窗边晒太阳的猫

# 也支持显式参数（老写法）
/image --provider openai --size 1024x1024 --quality high 一只戴宇航头盔的橘猫
```

`/image` 不是 DSH 斜杠命令，而是消息里的调用语法；发送后由模型调用 `image_studio_generate` 工具。工具返回的图片会留在当前对话里，不会跳到工作台；输入框会像普通消息一样清空，之后可以继续聊天。需要下载原图、看历史或换更多参数时再点侧边栏「生图工作台」。

提示：GPT Image 没有 2K/4K 档，`gpt 2k 16:9` 会映射为 `1536x1024`（竖图为 `1024x1536`，方形为 `1024x1024`）；Grok/Agnes 保留原生 2K 档。

简写规则：**开头的服务商/尺寸/比例可以任意顺序写**，遇到第一个不认识的词就开始当提示词。`gpt 2k 16:9`、`grok 2k 9:16`、`agnes 1k 1:1`、`2k 16:9` 都行。

`--provider` 支持 `agnes`、`openai`（别名 `gpt`）、`grok`、`openai-compatible`（别名 `compatible`/`custom`）。

`/image` 工具支持对话内连续修改：第一条生成，第二条起自动把上一张作为参考图；`/image --new <提示词>` 强制重新文生图。

## 数据位置

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/image-studio/credentials.json` | `{ "keys": { "agnes": "...", "openai": "...", "grok": "...", "openai-compatible": "..." } }` |
| `$DSH_HOME/image-studio/config.json` | `defaultProvider` 与每个服务商的 Base URL / 模型 / 默认参数 |
| `$DSH_HOME/image-studio/history.json` | 最近 80 条生成元数据（含 provider） |
| `$DSH_HOME/image-studio/outputs/` | 生成的 PNG/JPEG/WebP/GIF |
| 参考图 | 只在浏览器内存中参与当前请求；不写入 history、outputs 或任何配置文件 |

`$DSH_HOME` 默认是 `~/.dsh`（Windows：`C:\Users\<你>\.dsh`）。

## 配置字段

顶层：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `defaultProvider` | `agnes` | `/image` 未写 `--provider` 时使用；点击面板服务商页签会自动更新 |
| `providers.<id>.*` | 见下表 | 每个服务商的独立配置 |

每个 `providers.<id>`：

| 字段 | 说明 |
|---|---|
| `baseUrl` | 根地址；不能带查询参数 |
| `endpointPath` | 默认 `/v1/images/generations`，兼容中转可改 |
| `model` | 默认模型 |
| `size` | 默认尺寸；Agnes/Grok 用 1K/2K，OpenAI 用 1024x1024 等 |
| `ratio` | 仅 Agnes/Grok 使用 |
| `quality` | 仅 OpenAI/Grok 使用 |

Key 的环境变量兜底（文件 Key 优先）：

| 服务商 | 环境变量 |
|---|---|
| Agnes | `DSH_IMAGE_STUDIO_AGNES_API_KEY`，兼容旧 `DSH_IMAGE_STUDIO_API_KEY` |
| OpenAI | `DSH_IMAGE_STUDIO_OPENAI_API_KEY` |
| Grok | `DSH_IMAGE_STUDIO_GROK_API_KEY` |
| 兼容接口 | `DSH_IMAGE_STUDIO_OPENAI_COMPATIBLE_API_KEY` |

Key 优先级：**`credentials.json` 中该服务商的 Key > 该服务商环境变量 > 无**；不会读取其他服务商的 Key，也不会读取 dsh 的模型凭据。

## 开发与测试

```powershell
# 四服务商宿主冒烟（mock 上游）：Key 隔离、请求体、image_studio_generate、文件路由
$env:DSH_HOME='D:\deepseek\_smoke-home'
node scripts/smoke-host.mjs
```

设计、请求映射、Key 存储、两条调用链路和改动点见 [docs/design.md](docs/design.md)。

## 备注

- GPT Image 使用标准 `/v1/images/generations` JSON body；参考图编辑走 `/v1/images/edits` multipart，支持 1–5 张（重复 `image` 字段）。
- Grok Imagine 使用 `grok-imagine-image-2.0` 的 `aspect_ratio` + `resolution` + `quality`；如果 xAI 改了参数，Base URL/模型可改，body 变更需要同步 `lib/providers.js`。
- OpenAI 兼容档的 `auto` 尺寸会省略 `size` 字段，尽量兼容不同中转。
