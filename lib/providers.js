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
export const PROVIDER_ORDER = ['agnes', 'openai', 'grok', 'openai-compatible']

/** Default provider id. */
export const DEFAULT_PROVIDER = 'agnes'

/** Reference-image limits shared by the panel and the host. */
export const MAX_REFERENCE_IMAGES = 5
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024

/** Validate/normalize image-to-image reference data URLs (no Node built-ins). */
function parseReferenceImages(values) {
  if (!Array.isArray(values) || values.length === 0) return []
  if (values.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`参考图最多 ${MAX_REFERENCE_IMAGES} 张。`)
  }
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
const DALLE_3_SIZES = ['1024x1024', '1792x1024', '1024x1792']

/** OpenAI Images quality accepted by the GPT Image family. */
const GPT_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high']

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
    sizes: GPT_IMAGE_SIZES,
    defaultSize: '1024x1024',
    sizeByModel: {
      'gpt-image-1.5': GPT_IMAGE_SIZES,
      'gpt-image-1': GPT_IMAGE_SIZES,
      'gpt-image-1-mini': GPT_IMAGE_SIZES,
      'chatgpt-image-latest': GPT_IMAGE_SIZES,
      'dall-e-3': DALLE_3_SIZES,
    },
    ratios: [],
    defaultRatio: '',
    supportsRatio: false,
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
export function resolveProviderConfig(preset, saved) {
  const source = saved !== null && typeof saved === 'object' ? saved : {}
  const model = typeof source.model === 'string' && source.model.trim() !== ''
    ? source.model.trim()
    : preset.defaultModel
  const allowedSizes = sizesForProvider(preset, model)
  const requestedSize = normalizeSize(source.size)
  const size = requestedSize !== null && (allowedSizes.length === 0 || allowedSizes.includes(requestedSize))
    ? requestedSize
    : (preset.defaultSize || allowedSizes[0] || '')
  const ratio = preset.supportsRatio
    ? normalizeRatio(source.ratio, preset)
    : ''
  const quality = normalizeQuality(source.quality, preset, model)
  return {
    baseUrl: normalizeBaseUrl(source.baseUrl) ?? preset.baseUrl,
    endpointPath: typeof source.endpointPath === 'string' && source.endpointPath.startsWith('/')
      ? source.endpointPath.trim()
      : preset.endpointPath,
    model,
    size,
    ratio,
    quality,
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

  const model = resolveModel(body.model, config.model || preset.defaultModel)
  const requestedRatio = typeof body.ratio === 'string'
    ? body.ratio.trim()
    : (typeof config.ratio === 'string' ? config.ratio.trim() : '')
  let sizeInput = body.size ?? config.size
  if (preset.id === 'openai' && /^[1-4]K$/i.test(String(sizeInput).trim())) {
    sizeInput = openAiSizeForTier(String(sizeInput).trim().toUpperCase(), requestedRatio)
  }
  const size = resolveRequestedSize(preset, model, sizeInput, config.size)
  const ratio = preset.supportsRatio
    ? normalizeRatio(body.ratio ?? config.ratio, preset)
    : ''
  const quality = preset.supportsQuality
    ? normalizeQuality(body.quality ?? config.quality, preset, model)
    : ''
  const referenceImages = parseReferenceImages(body.referenceImages)

  if (preset.kind === 'agnes') {
    const tier = /^[1-4]K$/.test(size) ? size : (/^2K$/.test(size) ? size : '2K')
    const legacy20 = /image-2\.0/i.test(model)
    const agnesBody = {
      model,
      prompt,
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
    const grokBody = { model, prompt, n: 1, response_format: 'url' }
    if (/imagine/i.test(model)) {
      grokBody.aspect_ratio = ratio
      grokBody.resolution = size
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
  const openAiBody = { model, prompt, n: 1 }
  const omitSize = preset.omitSizeWhenAuto === true && size === 'auto'
  if (size !== '' && !omitSize) openAiBody.size = size
  if (quality !== '' && quality !== 'auto') openAiBody.quality = quality
  if (referenceImages.length > 0) {
    if (preset.id === 'openai' && /^dall-e-3$/i.test(model)) {
      throw new Error('DALL·E 3 不支持参考图编辑，请切换到 gpt-image 系列模型后再试。')
    }
    return {
      body: openAiBody,
      model,
      size,
      ratio,
      quality,
      mode: 'multipart',
      endpointPath: buildEditEndpointPath(config),
      files: referenceImages,
      referenceCount: referenceImages.length,
    }
  }
  return { body: openAiBody, model, size, ratio, quality, referenceCount: 0 }
}
