/**
 * Provider presets and request shaping for dsh-image-studio.
 *
 * The Agnes branch is the same contract as open-storyboard-canvas's
 * customProviderGateway (base URL / endpoint / size tier / ratio / 2.0 pixel
 * table / extra_body).  The OpenAI and Grok branches follow their Images API
 * shape; `openai-compatible` is the user-editable OpenAI Images profile.
 *
 * Pure module: no Node built-ins, no Tauri, no DOM.  The Host imports it and
 * the browser receives the same metadata through /image-studio/status.
 */

/** Sidebar/panel order; the first provider is the built-in default. */
export const PROVIDER_ORDER = ['agnes', 'openai', 'grok', 'minimax', 'openai-compatible']

/** Default provider id. */
export const DEFAULT_PROVIDER = 'agnes'

/** Reference-image limits shared by the panel and the host. */
export const MAX_REFERENCE_IMAGES = 5
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024
export const MAX_REFERENCE_TOTAL_BYTES = 48 * 1024 * 1024

/** Validate/normalize image-to-image reference data URLs (no Node built-ins). */
function parseReferenceImages(values, maxImages = MAX_REFERENCE_IMAGES) {
  if (!Array.isArray(values) || values.length === 0) return []
  if (values.length > maxImages) {
    throw new Error(`参考图最多 ${maxImages} 张。`)
  }
  let totalBytes = 0
  return values.map((value, index) => {
    const raw = typeof value === 'string' ? value.trim() : ''
    const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw)
    if (!match) {
      throw new Error(`第 ${index + 1} 张参考图格式不支持，只接受 PNG / JPEG / WebP。`)
    }
    const mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg')
    const payload = match[2].replace(/\s+/g, '')
    if (payload === '') throw new Error(`第 ${index + 1} 张参考图为空。`)
    const bytes = Math.floor((payload.length * 3) / 4)
    if (bytes > MAX_REFERENCE_BYTES) {
      throw new Error(`第 ${index + 1} 张参考图超过 ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)}MB。`)
    }
    totalBytes += bytes
    if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
      throw new Error(`参考图总大小超过 ${Math.round(MAX_REFERENCE_TOTAL_BYTES / 1024 / 1024)}MB。`)
    }
    return {
      dataUrl: `data:${mime};base64,${payload}`,
      mime,
      filename: `reference-${index + 1}.${mime.split('/')[1].replace('jpeg', 'jpg')}`,
      bytes,
    }
  })
}

/** Agnes Image 2.x aspect ratios (2.0 has no `auto`). */
const AGNES_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']

/** Agnes Image 2.0 predates the tier+ratio scheme; exact pixel fallback. */
const AGNES_20_SIZE_BY_TIER = {
  '1K': {
    '1:1': '1024x1024',
    '16:9': '1024x576',
    '9:16': '576x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '3:2': '1024x682',
    '2:3': '682x1024',
    '21:9': '1344x576',
  },
  '2K': {
    '1:1': '2048x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '3:2': '2048x1365',
    '2:3': '1365x2048',
    '21:9': '2560x1080',
  },
  '3K': {
    '1:1': '2048x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '3:2': '2048x1365',
    '2:3': '1365x2048',
    '21:9': '2560x1080',
  },
  '4K': {
    '1:1': '4096x4096',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '4096x3072',
    '3:4': '3072x4096',
    '3:2': '3840x2560',
    '2:3': '2560x3840',
    '21:9': '5120x2160',
  },
}

/** GPT Image model sizes; DALL·E 3 uses its own three. */
const GPT_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto']
const GPT_IMAGE_CUSTOM_SIZES = ['1K', '2K', '3K', '4K']
const OPENAI_TIER_PIXELS = {
  '1K': {
    '1:1': '1024x1024', '4:3': '1024x768', '3:4': '768x1024',
    '16:9': '1280x720', '9:16': '720x1280', '3:2': '1024x688', '2:3': '688x1024', '21:9': '1344x576',
  },
  '2K': {
    '1:1': '2048x2048', '4:3': '2048x1536', '3:4': '1536x2048',
    '16:9': '2048x1152', '9:16': '1152x2048', '3:2': '2048x1360', '2:3': '1360x2048', '21:9': '2560x1088',
  },
  '3K': {
    '1:1': '2880x2880', '4:3': '3072x2304', '3:4': '2304x3072',
    '16:9': '3072x1728', '9:16': '1728x3072', '3:2': '3072x2048', '2:3': '2048x3072', '21:9': '3584x1536',
  },
  '4K': {
    '1:1': '2880x2880', '4:3': '3264x2448', '3:4': '2448x3264',
    '16:9': '3840x2160', '9:16': '2160x3840', '3:2': '3456x2304', '2:3': '2304x3456', '21:9': '3840x1648',
  },
}
const DALLE_3_SIZES = ['1024x1024', '1792x1024', '1024x1792']

/** OpenAI Images quality accepted by the GPT Image family. */
const GPT_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high']
const GPT_IMAGE_25_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Presets.  `sizeByModel` / `qualityByModel` let the browser adapt the
 * selectors without another round-trip; `sizes` / `qualities` are fallbacks.
 */
export const PROVIDERS = Object.freeze({
  agnes: {
    id: 'agnes',
    label: 'Agnes',
    shortLabel: 'Agnes',
    description: 'Agnes Image 2.5 / 2.1 / 2.0，按尺寸档 + 比例生图',
    kind: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.cn',
    endpointPath: '/v1/images/generations',
    models: ['agnes-image-2.5-flash', 'agnes-image-2.1-flash', 'agnes-image-2.0-flash'],
    defaultModel: 'agnes-image-2.5-flash',
    sizes: ['1K', '2K', '3K', '4K'],
    defaultSize: '2K',
    sizeByModel: {},
    ratios: AGNES_RATIOS,
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: [],
    defaultQuality: '',
    qualityByModel: {},
    supportsQuality: false,
    keyPlaceholder: 'sk-...',
    keyHint: 'Agnes 官方网关 Key',
    envKeys: ['DSH_IMAGE_STUDIO_AGNES_API_KEY', 'DSH_IMAGE_STUDIO_API_KEY'],
    editableEndpoint: true,
    sizeMode: 'tier',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI GPT Image',
    shortLabel: 'GPT Image',
    description: 'OpenAI 官方 Images API：gpt-image-1.5 / gpt-image-1 / DALL·E 3',
    kind: 'openai',
    baseUrl: 'https://api.openai.com',
    endpointPath: '/v1/images/generations',
    models: ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'chatgpt-image-latest', 'dall-e-3'],
    defaultModel: 'gpt-image-1.5',
    sizes: GPT_IMAGE_CUSTOM_SIZES,
    defaultSize: '1024x1024',
    sizeByModel: {
      'gpt-image-1.5': GPT_IMAGE_SIZES,
      'gpt-image-1': GPT_IMAGE_SIZES,
      'gpt-image-1-mini': GPT_IMAGE_SIZES,
      'chatgpt-image-latest': GPT_IMAGE_SIZES,
      'dall-e-3': DALLE_3_SIZES,
    },
    ratios: AGNES_RATIOS,
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: GPT_IMAGE_QUALITIES,
    defaultQuality: 'auto',
    qualityByModel: {
      'gpt-image-1.5': GPT_IMAGE_QUALITIES,
      'gpt-image-1': GPT_IMAGE_QUALITIES,
      'gpt-image-1-mini': GPT_IMAGE_QUALITIES,
      'chatgpt-image-latest': GPT_IMAGE_QUALITIES,
      'dall-e-3': ['standard', 'hd'],
    },
    supportsQuality: true,
    keyPlaceholder: 'sk-...',
    keyHint: 'OpenAI 平台 Key（只用于本插件）',
    envKeys: ['DSH_IMAGE_STUDIO_OPENAI_API_KEY'],
    editableEndpoint: true,
    sizeMode: 'pixel',
  },
  grok: {
    id: 'grok',
    label: 'Grok Image',
    shortLabel: 'Grok',
    description: 'xAI Grok Imagine：grok-imagine-image-2.0，按比例 + 分辨率',
    kind: 'grok',
    baseUrl: 'https://api.x.ai',
    endpointPath: '/v1/images/generations',
    models: ['grok-imagine-image-2.0', 'grok-imagine-image'],
    defaultModel: 'grok-imagine-image-2.0',
    sizes: ['1K', '2K'],
    defaultSize: '1K',
    sizeByModel: {
      'grok-imagine-image-2.0': ['1K', '2K'],
      'grok-imagine-image': ['1K', '2K'],
    },
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'],
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: ['low', 'medium'],
    defaultQuality: 'medium',
    qualityByModel: {
      'grok-imagine-image-2.0': ['low', 'medium'],
      'grok-imagine-image': ['low', 'medium'],
    },
    supportsQuality: true,
    keyPlaceholder: 'xai-...',
    keyHint: 'xAI API Key（只用于本插件）',
    envKeys: ['DSH_IMAGE_STUDIO_GROK_API_KEY'],
    editableEndpoint: true,
    sizeMode: 'tier',
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax H3 Image',
    shortLabel: 'MiniMax H3',
    description: 'MiniMax-H3-Image：文生图 / 图片编辑，最多 16 张参考图，按面积档 + 比例',
    kind: 'minimax',
    baseUrl: 'https://api.minimax.io',
    endpointPath: '/v1/images/generations',
    models: ['MiniMax-H3-Image', 'MiniMax-H3-Image-Highspeed'],
    defaultModel: 'MiniMax-H3-Image',
    sizes: ['1K', '2K', '4K', 'auto'],
    defaultSize: '2K',
    sizeByModel: {},
    ratios: AGNES_RATIOS,
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: [],
    defaultQuality: '',
    qualityByModel: {},
    supportsQuality: false,
    keyPlaceholder: 'sk-...',
    keyHint: 'MiniMax 平台 API Key（只用于本插件）',
    envKeys: ['DSH_IMAGE_STUDIO_MINIMAX_API_KEY'],
    editableEndpoint: true,
    sizeMode: 'tier',
    maxReferenceImages: 16,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI 兼容',
    shortLabel: '兼容接口',
    description: '任何 OpenAI Images 兼容中转/聚合器：自己填 Base URL、接口路径和模型',
    kind: 'openai',
    baseUrl: 'https://api.example.com',
    endpointPath: '/v1/images/generations',
    models: ['gpt-image-1', 'dall-e-3', 'nano-banana'],
    defaultModel: 'gpt-image-1',
    sizes: ['auto', '1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792', '1K', '2K'],
    defaultSize: 'auto',
    sizeByModel: {},
    ratios: [],
    defaultRatio: '',
    supportsRatio: false,
    qualities: GPT_IMAGE_QUALITIES,
    defaultQuality: 'auto',
    qualityByModel: {},
    supportsQuality: true,
    keyPlaceholder: 'sk-...',
    keyHint: '该兼容接口自己的 Key',
    envKeys: ['DSH_IMAGE_STUDIO_OPENAI_COMPATIBLE_API_KEY'],
    editableEndpoint: true,
    sizeMode: 'pixel',
    omitSizeWhenAuto: true,
  },
})

/** Type guard for a provider id. */
export function getProvider(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id)
    ? PROVIDERS[id]
    : undefined
}

/** Accept aliases users may type on the command line. */
export function normalizeProviderId(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === '') return undefined
  if (normalized === 'gpt' || normalized === 'openai-images' || normalized === 'gpt-image') return 'openai'
  if (normalized === 'grok-image' || normalized === 'xai') return 'grok'
  if (normalized === 'minimax-h3' || normalized === 'minimax-h3-image' || normalized === 'h3') return 'minimax'
  if (normalized === 'compatible' || normalized === 'custom' || normalized === 'openai-compat') return 'openai-compatible'
  return getProvider(normalized) !== undefined ? normalized : undefined
}

/** Sizes available for one provider + model. */
export function sizesForProvider(preset, model) {
  if (preset === undefined) return []
  const mapped = preset.sizeByModel !== undefined && model !== undefined ? preset.sizeByModel[model] : undefined
  return Array.isArray(mapped) && mapped.length > 0 ? mapped : preset.sizes
}

/** Qualities available for one provider + model. */
export function qualitiesForProvider(preset, model) {
  if (preset === undefined || preset.supportsQuality !== true) return []
  if (preset.id === 'openai' && typeof model === 'string' && /^gpt-image-2\.5/i.test(model)) {
    return GPT_IMAGE_25_QUALITIES
  }
  const mapped = preset.qualityByModel !== undefined && model !== undefined ? preset.qualityByModel[model] : undefined
  return Array.isArray(mapped) && mapped.length > 0 ? mapped : preset.qualities
}

/** Normalize a base URL to `origin + optional path`, without query/hash. */
export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.search !== '' || url.hash !== '') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Normalize a size expression; returns null for unsupported spellings. */
export function normalizeSize(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '') return null
  if (/^auto$/i.test(raw)) return 'auto'
  if (/^[1-4]k$/i.test(raw)) return raw.toUpperCase()
  if (/^\d{3,5}x\d{3,5}$/i.test(raw)) return raw.toLowerCase()
  return null
}

/** Normalize a ratio against the provider's whitelist. */
export function normalizeRatio(value, preset) {
  if (typeof value !== 'string' || preset === undefined || !Array.isArray(preset.ratios)) return ''
  const raw = value.trim()
  if (raw === '' || raw === 'auto') return preset.defaultRatio
  return preset.ratios.includes(raw) ? raw : preset.defaultRatio
}

/** Normalize quality against the provider + model whitelist. */
export function normalizeQuality(value, preset, model) {
  const allowed = qualitiesForProvider(preset, model)
  if (allowed.length === 0) return ''
  if (typeof value !== 'string' || value.trim() === '') return preset.defaultQuality
  const raw = value.trim().toLowerCase()
  return allowed.includes(raw) ? raw : preset.defaultQuality
}

/** Merge saved provider config over the preset defaults. */
/** Model ids accepted from setup/sniffing. */
function validModelId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value.trim())
}

export function resolveProviderConfig(preset, saved) {
  const source = saved !== null && typeof saved === 'object' ? saved : {}
  const model = typeof source.model === 'string' && source.model.trim() !== ''
    ? source.model.trim()
    : preset.defaultModel
  const allowedSizes = sizesForProvider(preset, model)
  const requestedSize = normalizeSize(source.size)
  const size = requestedSize !== null && (allowedSizes.length === 0 || allowedSizes.includes(requestedSize))
    ? requestedSize
    : (allowedSizes.includes(preset.defaultSize) ? preset.defaultSize : (allowedSizes[0] || ''))
  const ratio = preset.supportsRatio
    ? normalizeRatio(source.ratio, preset)
    : ''
  const quality = normalizeQuality(source.quality, preset, model)
  const selectedModels = Array.isArray(source.models)
    ? [...new Set(source.models.filter(validModelId).map((item) => item.trim()))].slice(0, 50)
    : []
  return {
    baseUrl: normalizeBaseUrl(source.baseUrl) ?? preset.baseUrl,
    endpointPath: typeof source.endpointPath === 'string' && source.endpointPath.startsWith('/')
      ? source.endpointPath.trim()
      : preset.endpointPath,
    model,
    size,
    ratio,
    quality,
    models: selectedModels,
  }
}

/** Validate a setup patch and merge it over the current provider config. */
export function validateProviderPatch(preset, current, patch) {
  const body = patch !== null && typeof patch === 'object' ? patch : {}
  const next = { ...current }

  if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) {
    const normalized = normalizeBaseUrl(body.baseUrl)
    if (normalized === null) throw new Error('Base URL 必须是 http(s) 地址，且不能带查询参数。')
    next.baseUrl = normalized
  }
  if (Object.prototype.hasOwnProperty.call(body, 'endpointPath')) {
    const endpoint = typeof body.endpointPath === 'string' ? body.endpointPath.trim() : ''
    if (!endpoint.startsWith('/') || endpoint.length > 200) {
      throw new Error('接口路径必须以 / 开头，且长度不超过 200。')
    }
    next.endpointPath = endpoint
  }
  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model)) {
      throw new Error('模型名不合法（只允许字母、数字、`.` `_` `:` `/` `-`，最长 120）。')
    }
    next.model = model
  }
  if (Object.prototype.hasOwnProperty.call(body, 'size')) {
    const size = normalizeSize(body.size)
    if (size === null) throw new Error('尺寸必须是 1K/2K/3K/4K、auto 或 WxH。')
    next.size = size
  }
  if (Object.prototype.hasOwnProperty.call(body, 'ratio') && preset.supportsRatio) {
    if (typeof body.ratio !== 'string' || !preset.ratios.includes(body.ratio)) {
      throw new Error(`${preset.label} 不支持该比例。可选：${preset.ratios.join(' / ')}`)
    }
    next.ratio = body.ratio
  }
  if (Object.prototype.hasOwnProperty.call(body, 'quality') && preset.supportsQuality) {
    const allowed = qualitiesForProvider(preset, next.model || preset.defaultModel)
    if (allowed.length > 0 && !allowed.includes(String(body.quality).toLowerCase())) {
      throw new Error(`${preset.label} 不支持该质量。可选：${allowed.join(' / ')}`)
    }
    next.quality = String(body.quality).toLowerCase()
  }
  if (Object.prototype.hasOwnProperty.call(body, 'models')) {
    if (!Array.isArray(body.models)) throw new Error('models 必须是模型名数组。')
    const selected = []
    for (const item of body.models) {
      if (!validModelId(item)) throw new Error('模型名不合法（只允许字母、数字、`.` `_` `:` `/` `-`，最长 120）。')
      const id = item.trim()
      if (!selected.includes(id)) selected.push(id)
    }
    next.models = selected.slice(0, 50)
    if (next.models.length > 0 && !next.models.includes(next.model || preset.defaultModel)) {
      next.model = next.models[0]
    }
  }
  return resolveProviderConfig(preset, next)
}

/** Join origin/path with the endpoint; tolerates a base ending in /v1. */
export function buildEndpointUrl(config, overridePath) {
  const base = String(config.baseUrl || '').replace(/\/+$/, '')
  let endpoint = String(overridePath || config.endpointPath || '/v1/images/generations')
  if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`
  if (base.endsWith('/v1') && endpoint.startsWith('/v1/')) endpoint = endpoint.slice(3)
  return `${base}${endpoint}`
}

/** Derive the edit endpoint from the generation path (`generations` → `edits`). */
export function buildEditEndpointPath(config) {
  const source = String(config.endpointPath || '/v1/images/generations')
  if (source.includes('/generations')) return source.replace(/\/generations\/?$/, '/edits')
  return '/v1/images/edits'
}

/** Derive the provider's model-list path from its image endpoint. */
export function buildModelsEndpointPath(config) {
  const source = String(config.endpointPath || '/v1/images/generations').split('?')[0].replace(/\/+$/, '')
  const match = /\/images\/(?:generations|edits)$/i.exec(source)
  if (match) return `${source.slice(0, match.index)}/models`
  if (/\/generations$/i.test(source)) return source.replace(/\/generations$/i, '/models')
  return '/v1/models'
}

/** Absolute URL for the provider model list, used by the model sniffing action. */
export function buildModelsEndpointUrl(config) {
  return buildEndpointUrl(config, buildModelsEndpointPath(config))
}

/** Resolve model name with a safe fallback. */
function resolveModel(value, fallback) {
  if (typeof value === 'string' && value.trim() !== '' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value.trim())) {
    return value.trim()
  }
  return fallback
}

/** Resolve a size request against the provider/model whitelist. */
function resolveRequestedSize(preset, model, value, fallback) {
  const allowed = sizesForProvider(preset, model)
  const requested = normalizeSize(value)
  if (requested !== null && (allowed.length === 0 || allowed.includes(requested))) return requested
  const fallbackSize = normalizeSize(fallback)
  if (fallbackSize !== null && (allowed.length === 0 || allowed.includes(fallbackSize))) return fallbackSize
  return preset.defaultSize || allowed[0] || ''
}

/** Read a ratio for size selection even when the provider does not send it. */
function ratioHint(value) {
  return typeof value === 'string' && /^\d{1,2}:\d{1,2}$/.test(value.trim()) ? value.trim() : ''
}

/**
 * OpenAI GPT Image has no 2K/4K tier; map the friendly tier to its three
 * pixel sizes. Square → 1024x1024, landscape → 1536x1024, portrait → 1024x1536.
 */
function openAiSizeForTier(tier, ratio) {
  const hint = ratioHint(ratio)
  if (hint === '9:16' || hint === '3:4' || hint === '2:3') return '1024x1536'
  if (hint !== '' && hint !== '1:1' && hint !== 'auto') return '1536x1024'
  return '1024x1024'
}

/**
 * Build the upstream JSON body and the effective values.
 * @returns {{body:object, model:string, size:string, ratio:string, quality:string}}
 */
export function buildRequestBody(preset, config, request) {
  const body = request !== null && typeof request === 'object' ? request : {}
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt === '') throw new Error('请先填写提示词。')
  // The @ picker is a UI aid; upstream APIs have no @ syntax. Send it as a
  // plain reference phrase ("参考图2") and keep the images in upload order.
  const upstreamPrompt = prompt.replace(/@参考图\s*(\d+)/g, preset.kind === 'minimax' ? 'image $1' : '参考图$1')

  const model = resolveModel(body.model, config.model || preset.defaultModel)
  const requestedRatio = typeof body.ratio === 'string'
    ? body.ratio.trim()
    : (typeof config.ratio === 'string' ? config.ratio.trim() : '')
  let sizeInput = body.size ?? config.size
  const standardOpenAiModel = preset.id === 'openai' && preset.sizeByModel[model] !== undefined
  if (standardOpenAiModel && /^[1-4]K$/i.test(String(sizeInput).trim())) {
    sizeInput = openAiSizeForTier(String(sizeInput).trim().toUpperCase(), requestedRatio)
  }
  const size = resolveRequestedSize(preset, model, sizeInput, config.size)
  const ratio = preset.supportsRatio
    ? normalizeRatio(body.ratio ?? config.ratio, preset)
    : ''
  const quality = preset.supportsQuality
    ? normalizeQuality(body.quality ?? config.quality, preset, model)
    : ''
  const referenceImages = parseReferenceImages(body.referenceImages, preset.maxReferenceImages ?? MAX_REFERENCE_IMAGES)

  if (preset.kind === 'minimax') {
    const area = /^[1-4]K$/i.test(size) ? size.toUpperCase() : '2K'
    const miniBody = {
      model,
      prompt: upstreamPrompt,
      n: 1,
      size: 'auto',
      area,
      response_format: 'b64_json',
      output_format: 'png',
    }
    if (ratio !== '') miniBody.aspect_ratio = ratio
    if (referenceImages.length > 0) {
      miniBody.images = referenceImages.map((item) => ({ image_url: item.dataUrl }))
      return {
        body: miniBody,
        model,
        size: area,
        ratio,
        quality: '',
        endpointPath: buildEditEndpointPath(config),
        referenceCount: referenceImages.length,
      }
    }
    return { body: miniBody, model, size: area, ratio, quality: '', referenceCount: 0 }
  }

  if (preset.kind === 'agnes') {
    const tier = /^[1-4]K$/.test(size) ? size : (/^2K$/.test(size) ? size : '2K')
    const legacy20 = /image-2\.0/i.test(model)
    const agnesBody = {
      model,
      prompt: upstreamPrompt,
      size: legacy20
        ? (AGNES_20_SIZE_BY_TIER[tier]?.[ratio] ?? AGNES_20_SIZE_BY_TIER[tier]?.['1:1'] ?? '2048x2048')
        : tier,
    }
    if (!legacy20) agnesBody.ratio = ratio
    if (referenceImages.length > 0) {
      agnesBody.extra_body = {
        image: referenceImages.map((item) => item.dataUrl),
        response_format: 'b64_json',
      }
    } else {
      agnesBody.return_base64 = true
    }
    return { body: agnesBody, model, size: tier, ratio, quality: '', referenceCount: referenceImages.length }
  }

  if (preset.kind === 'grok') {
    const grokBody = { model, prompt: upstreamPrompt, n: 1, response_format: 'b64_json' }
    if (/imagine/i.test(model)) {
      grokBody.aspect_ratio = ratio
      grokBody.resolution = String(size).toLowerCase()
    }
    if (quality !== '') grokBody.quality = quality
    if (referenceImages.length > 0) {
      grokBody.images = referenceImages.map((item) => item.dataUrl)
      return {
        body: grokBody,
        model,
        size,
        ratio,
        quality,
        endpointPath: buildEditEndpointPath(config),
        referenceCount: referenceImages.length,
      }
    }
    return { body: grokBody, model, size, ratio, quality, referenceCount: 0 }
  }

  // OpenAI Images / OpenAI-compatible.
  const openAiSize = preset.id === 'openai'
    && preset.sizeByModel[model] === undefined
    && /^[1-4]K$/i.test(size)
    ? (OPENAI_TIER_PIXELS[size.toUpperCase()]?.[ratio || '1:1'] || size)
    : size
  if (preset.id === 'openai' && preset.sizeByModel[model] === undefined) {
    const match = /^(\d+)x(\d+)$/i.exec(openAiSize)
    if (match) {
      const width = Number(match[1])
      const height = Number(match[2])
      const longest = Math.max(width, height)
      const shortest = Math.min(width, height)
      const area = width * height
      if (width % 16 !== 0 || height % 16 !== 0 || longest > 3840
        || longest / shortest > 3 || area < 655360 || area > 8294400) {
        throw new Error(
          `gpt-image-2.5 尺寸 ${openAiSize} 不合法：宽高需为 16 的倍数、最长边≤3840、长短边比≤3:1、总像素 655,360–8,294,400。`,
        )
      }
    }
  }
  const openAiBody = { model, prompt: upstreamPrompt, n: 1 }
  const omitSize = preset.omitSizeWhenAuto === true && openAiSize === 'auto'
  if (openAiSize !== '' && !omitSize) openAiBody.size = openAiSize
  if (quality !== '' && quality !== 'auto') openAiBody.quality = quality
  if (referenceImages.length > 0) {
    if (preset.id === 'openai' && /^dall-e-3$/i.test(model)) {
      throw new Error('DALL·E 3 不支持参考图编辑，请切换到 gpt-image 系列模型后再试。')
    }
    return {
      body: openAiBody,
      model,
      size: openAiSize,
      ratio,
      quality,
      mode: 'multipart',
      endpointPath: buildEditEndpointPath(config),
      files: referenceImages,
      referenceCount: referenceImages.length,
    }
  }
  return { body: openAiBody, model, size: openAiSize, ratio, quality, referenceCount: 0 }
}
