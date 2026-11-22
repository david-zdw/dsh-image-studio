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
export const PROVIDER_ORDER = ['agnes', 'openai', 'grok', 'minimax', 'seedream', 'nanobanana', 'openai-compatible']

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
/** Seedream 4.0 resolution tiers mapped to the official aspect-ratio sizes. */
const SEEDREAM_TIER_PIXELS = {
  '1K': {
    '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152',
    '16:9': '1280x720', '9:16': '720x1280', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1512x648',
  },
  '2K': {
    '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304',
    '16:9': '2848x1600', '9:16': '1600x2848', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344',
  },
  '4K': {
    '1:1': '4096x4096', '4:3': '4704x3520', '3:4': '3520x4704',
    '16:9': '5504x3040', '9:16': '3040x5504', '3:2': '4992x3328', '2:3': '3328x4992', '21:9': '6240x2656',
  },
}

/** Seedream 5.5 / 5.0 Pro use 1K / 1.5K / 2K tiers. */
const SEEDREAM_5_TIER_PIXELS = {
  '1K': {
    '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152',
    '16:9': '1424x800', '9:16': '800x1424', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1568x672',
  },
  '1.5K': {
    '1:1': '1536x1536', '4:3': '1792x1344', '3:4': '1344x1792',
    '16:9': '2048x1152', '9:16': '1152x2048', '3:2': '1872x1248', '2:3': '1248x1872', '21:9': '2352x1008',
  },
  '2K': {
    '1:1': '2048x2048', '4:3': '2368x1776', '3:4': '1776x2368',
    '16:9': '2816x1584', '9:16': '1584x2816', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344',
  },
}

const DALLE_3_SIZES = ['1024x1024', '1792x1024', '1024x1792']

/**
 * A compatible endpoint speaks one schema: GPT Image or MiniMax H3. Resolve
 * the capabilities/payload shape from the saved schema so the rest of the
 * pipeline can treat it like that provider.
 */
export function effectivePreset(preset, config) {
  if (preset === undefined) return preset
  if (preset.id === 'nanobanana') {
    const schema = config !== null && typeof config === 'object' && config.schema === 'openai'
      ? 'openai'
      : 'gemini'
    if (schema === 'openai') {
      return {
        ...preset,
        kind: 'openai',
        endpointPath: '/v1/images/generations',
        sizes: ['1K', '2K', '3K', '4K'],
        defaultSize: '1K',
        sizeMode: 'tier',
        schema,
      }
    }
    return { ...preset, kind: 'gemini', schema }
  }
  if (preset.id !== 'openai-compatible') return preset
  const schema = config !== null && typeof config === 'object' && config.schema === 'minimax' ? 'minimax' : 'openai'
  if (schema === 'minimax') {
    return {
      ...preset,
      kind: 'minimax',
      sizes: ['1K', '2K', '4K'],
      defaultSize: '2K',
      ratios: AGNES_RATIOS,
      defaultRatio: '1:1',
      supportsRatio: true,
      qualities: [],
      defaultQuality: '',
      supportsQuality: false,
      maxReferenceImages: 16,
      sizeMode: 'tier',
      omitSizeWhenAuto: false,
      schema,
    }
  }
  return {
    ...preset,
    kind: 'openai',
    sizes: [...GPT_IMAGE_CUSTOM_SIZES, 'auto'],
    defaultSize: '1K',
    ratios: AGNES_RATIOS,
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: GPT_IMAGE_QUALITIES,
    defaultQuality: 'auto',
    supportsQuality: true,
    maxReferenceImages: 5,
    sizeMode: 'pixel',
    omitSizeWhenAuto: false,
    schema,
  }
}

/** OpenAI Images quality accepted by the GPT Image family. */
const GPT_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high']
const GPT_IMAGE_25_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

/** GPT Image 2.6 planning effort (separate from rendering quality). */
const GPT_IMAGE_COMPLEXITIES = ['auto', 'low', 'medium', 'high']

/** GPT Image 2.6 still-image and animated formats exposed by the panel. */
const GPT_IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'gif']

/** Per-frame size for an animated GIF: frames share one image budget. */
const GPT_IMAGE_GIF_SIZES = {
  '1:1': '512x512',
  '4:3': '592x448',
  '3:4': '448x592',
  '16:9': '896x512',
  '9:16': '512x896',
  '3:2': '768x512',
  '2:3': '512x768',
  '21:9': '1024x448',
}
/** Protocol schemas a compatible endpoint can speak. */
export const COMPAT_SCHEMAS = [
  ['openai', 'GPT Image'],
  ['minimax', 'MiniMax H3'],
]

/** Nano Banana can speak native Gemini or OpenAI Images protocol. */
export const NANOBANANA_SCHEMAS = [
  ['gemini', 'Gemini 原生'],
  ['openai', 'OpenAI 兼容'],
]

const GIF_MIN_FRAMES = 2
const GIF_MAX_FRAMES = 16
const GIF_MIN_FRAME_MS = 20
const GIF_MAX_FRAME_MS = 2000

export function isGptImage26(model) {
  return /^gpt-image-2\.6/i.test(String(model || ''))
}

export function complexitiesForProvider(preset, model) {
  if (preset === undefined || preset.kind !== 'openai' || !isGptImage26(model)) return []
  return GPT_IMAGE_COMPLEXITIES
}

export function outputFormatsForProvider(preset, model) {
  if (preset === undefined || preset.kind !== 'openai' || !isGptImage26(model)) return []
  return GPT_IMAGE_OUTPUT_FORMATS
}

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
    models: [
      'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare',
      'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2',
      'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'chatgpt-image-latest', 'dall-e-3',
    ],
    defaultModel: 'gpt-image-2.6-sunburst',
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
  seedream: {
    id: 'seedream',
    label: '豆包 Seedream',
    shortLabel: 'Seedream',
    description: '豆包 Seedream 5.5 / 5.0 Pro / 4.0：文生图 / 多参考图编辑',
    kind: 'seedream',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    endpointPath: '/api/v3/images/generations',
    models: ['doubao-seedream-5-5-261028', 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-4-0-250828', 'doubao-seedream-3-0-t2i-250415'],
    defaultModel: 'doubao-seedream-5-5-261028',
    sizes: ['1K', '1.5K', '2K', '4K'],
    defaultSize: '1.5K',
    sizeByModel: {
      'doubao-seedream-5-5-261028': ['1K', '1.5K', '2K'],
      'doubao-seedream-5-0-pro-260628': ['1K', '1.5K', '2K'],
      'doubao-seedream-4-0-250828': ['1K', '2K', '4K'],
      'doubao-seedream-3-0-t2i-250415': ['1K', '2K'],
    },
    ratios: AGNES_RATIOS,
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: [],
    defaultQuality: '',
    qualityByModel: {},
    supportsQuality: false,
    keyPlaceholder: 'ARK API Key',
    keyHint: '火山方舟 API Key（只用于本插件）',
    envKeys: ['DSH_IMAGE_STUDIO_SEEDREAM_API_KEY'],
    editableEndpoint: true,
    sizeMode: 'tier',
    maxReferenceImages: 14,
    maxReferenceByModel: {
      'doubao-seedream-5-5-261028': 10,
      'doubao-seedream-5-0-pro-260628': 10,
      'doubao-seedream-4-0-250828': 14,
      'doubao-seedream-3-0-t2i-250415': 14,
    },
  },
  nanobanana: {
    id: 'nanobanana',
    label: 'Gemini Nano Banana',
    shortLabel: 'Nano Banana',
    description: 'Gemini Nano Banana：原生 generateContent 或 OpenAI 兼容中转',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    endpointPath: '/v1beta/models/gemini-2.5-flash-image:generateContent',
    models: ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
    defaultModel: 'gemini-2.5-flash-image',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '1K',
    sizeByModel: {},
    ratios: AGNES_RATIOS,
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: [],
    defaultQuality: '',
    qualityByModel: {},
    supportsQuality: false,
    schema: 'gemini',
    schemas: NANOBANANA_SCHEMAS,
    keyPlaceholder: 'AIza...',
    keyHint: 'Google AI Studio API Key（只用于本插件）',
    envKeys: ['DSH_IMAGE_STUDIO_NANOBANANA_API_KEY'],
    editableEndpoint: true,
    sizeMode: 'tier',
    maxReferenceImages: 5,
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
    sizes: GPT_IMAGE_CUSTOM_SIZES,
    defaultSize: '1K',
    sizeByModel: {},
    ratios: AGNES_RATIOS,
    defaultRatio: '1:1',
    supportsRatio: true,
    qualities: GPT_IMAGE_QUALITIES,
    defaultQuality: 'auto',
    qualityByModel: {},
    supportsQuality: true,
    schema: 'openai',
    schemas: COMPAT_SCHEMAS,
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
  if (normalized === 'doubao' || normalized === 'doubao-seedream' || normalized === 'seedream') return 'seedream'
  if (normalized === 'nano-banana' || normalized === 'nanobanana' || normalized === 'gemini' || normalized === 'gemini-nano-banana') return 'nanobanana'
  if (normalized === 'compatible' || normalized === 'custom' || normalized === 'openai-compat') return 'openai-compatible'
  return getProvider(normalized) !== undefined ? normalized : undefined
}

/** Sizes available for one provider + model. */
export function sizesForProvider(preset, model) {
  if (preset === undefined) return []
  const mapped = preset.sizeByModel !== undefined && model !== undefined ? preset.sizeByModel[model] : undefined
  return Array.isArray(mapped) && mapped.length > 0 ? mapped : preset.sizes
}

/** Maximum reference images for one provider + model. */
export function maxReferenceImagesFor(preset, model) {
  if (preset === undefined) return MAX_REFERENCE_IMAGES
  const mapped = preset.maxReferenceByModel !== undefined && model !== undefined
    ? preset.maxReferenceByModel[model]
    : undefined
  return Number.isInteger(mapped) && mapped > 0 ? mapped : (preset.maxReferenceImages ?? MAX_REFERENCE_IMAGES)
}

/** Qualities available for one provider + model. */
export function qualitiesForProvider(preset, model) {
  if (preset === undefined || preset.supportsQuality !== true) return []
  if (preset.kind === 'openai' && typeof model === 'string' && /^gpt-image-2\.[56]/i.test(model)) {
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
  if (/^(1|1\.5|2|3|4)k$/i.test(raw)) return raw.toUpperCase()
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
  const schema = Array.isArray(preset.schemas)
    ? (preset.schemas.some(([id]) => id === source.schema) ? source.schema : preset.schema)
    : undefined
  const effective = effectivePreset(preset, { schema })
  const allowedSizes = sizesForProvider(effective, model)
  const requestedSize = normalizeSize(source.size)
  const size = requestedSize !== null && (allowedSizes.length === 0 || allowedSizes.includes(requestedSize))
    ? requestedSize
    : (allowedSizes.includes(effective.defaultSize) ? effective.defaultSize : (allowedSizes[0] || ''))
  const ratio = effective.supportsRatio
    ? normalizeRatio(source.ratio, effective)
    : ''
  const quality = normalizeQuality(source.quality, effective, model)
  const selectedModels = Array.isArray(source.models)
    ? [...new Set(source.models.filter(validModelId).map((item) => item.trim()))].slice(0, 50)
    : []
  const defaultEndpoint = preset.id === 'nanobanana' && schema === 'openai'
    ? '/v1/images/generations'
    : preset.endpointPath
  return {
    baseUrl: normalizeBaseUrl(source.baseUrl) ?? preset.baseUrl,
    endpointPath: typeof source.endpointPath === 'string' && source.endpointPath.startsWith('/')
      ? source.endpointPath.trim()
      : defaultEndpoint,
    model,
    size,
    ratio,
    quality,
    models: selectedModels,
    ...(schema === undefined ? {} : { schema }),
  }
}

/** Validate a setup patch and merge it over the current provider config. */
export function validateProviderPatch(preset, current, patch) {
  const body = patch !== null && typeof patch === 'object' ? patch : {}
  const next = { ...current }

  if (Object.prototype.hasOwnProperty.call(body, 'schema') && Array.isArray(preset.schemas)) {
    const schema = typeof body.schema === 'string' ? body.schema.trim() : ''
    if (!preset.schemas.some(([id]) => id === schema)) {
      throw new Error(`不支持的协议：${schema}。可选：${preset.schemas.map(([id]) => id).join(' / ')}`)
    }
    next.schema = schema
  }
  const effective = effectivePreset(preset, next)

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
    if (size === null) throw new Error('尺寸必须是 1K/1.5K/2K/3K/4K、auto 或 WxH。')
    next.size = size
  }
  if (Object.prototype.hasOwnProperty.call(body, 'ratio') && effective.supportsRatio) {
    if (typeof body.ratio !== 'string' || !effective.ratios.includes(body.ratio)) {
      throw new Error(`${preset.label} 不支持该比例。可选：${effective.ratios.join(' / ')}`)
    }
    next.ratio = body.ratio
  }
  if (Object.prototype.hasOwnProperty.call(body, 'quality') && effective.supportsQuality) {
    const allowed = qualitiesForProvider(effective, next.model || effective.defaultModel)
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

/** Official OpenAI host: it returns base64 already and rejects response_format. */
export function isOfficialOpenAi(baseUrl) {
  try {
    return /(^|\.)openai\.com$/i.test(new URL(String(baseUrl || '')).hostname)
  } catch {
    return false
  }
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
  // A compatible endpoint adopts the payload shape of its chosen schema.
  preset = effectivePreset(preset, config)
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
  const standardOpenAiModel = preset.kind === 'openai' && preset.sizeByModel[model] !== undefined
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
  const referenceImages = parseReferenceImages(body.referenceImages, maxReferenceImagesFor(preset, model))

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

  if (preset.kind === 'seedream') {
    // Seedream 4.0 takes OpenAI-like JSON, but references live in `image`
    // (data URL or public URL) and size is an explicit pixel size.
    const seedreamBody = {
      model,
      prompt: upstreamPrompt,
      response_format: 'b64_json',
      watermark: false,
    }
    const tier = /^(1|1\.5|2|3|4)K$/i.test(size) ? size.toUpperCase() : ''
    const tierPixels = /^doubao-seedream-5-/i.test(model) ? SEEDREAM_5_TIER_PIXELS : SEEDREAM_TIER_PIXELS
    const pixelSize = tier
      ? (tierPixels[tier]?.[ratio || '1:1'] || tierPixels[tier]?.['1:1'] || size)
      : size
    if (pixelSize !== '' && pixelSize !== 'auto') seedreamBody.size = pixelSize
    if (referenceImages.length > 0) {
      seedreamBody.image = referenceImages.map((item) => item.dataUrl)
    }
    return {
      body: seedreamBody,
      model,
      size: pixelSize,
      ratio,
      quality: '',
      referenceCount: referenceImages.length,
    }
  }

  if (preset.kind === 'gemini') {
    // Native Gemini generateContent: references are inlineData parts and the
    // output shape is controlled by generationConfig.imageConfig.
    const parts = [{ text: upstreamPrompt }]
    for (const image of referenceImages) {
      const comma = image.dataUrl.indexOf(',')
      parts.push({
        inlineData: {
          mimeType: image.mime,
          data: image.dataUrl.slice(comma + 1),
        },
      })
    }
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] }
    if (ratio !== '' || size !== '') {
      generationConfig.imageConfig = {}
      if (ratio !== '') generationConfig.imageConfig.aspectRatio = ratio
      if (/^[1-4]K$/i.test(size)) generationConfig.imageConfig.imageSize = size.toUpperCase()
    }
    const geminiBody = {
      contents: [{ role: 'user', parts }],
      generationConfig,
    }
    return {
      body: geminiBody,
      model,
      size,
      ratio,
      quality: '',
      endpointPath: `/v1beta/models/${model}:generateContent`,
      referenceCount: referenceImages.length,
    }
  }

  // OpenAI Images / OpenAI-compatible.
  const supportsGpt26Extras = preset.kind === 'openai' && isGptImage26(model)
  const requestedFormat = supportsGpt26Extras && typeof body.outputFormat === 'string'
    ? body.outputFormat.trim().toLowerCase()
    : ''
  const outputFormat = GPT_IMAGE_OUTPUT_FORMATS.includes(requestedFormat) ? requestedFormat : 'png'
  const gif = outputFormat === 'gif'
  const rawComplexity = supportsGpt26Extras && typeof body.complexity === 'string'
    ? body.complexity.trim().toLowerCase()
    : 'auto'
  const complexity = GPT_IMAGE_COMPLEXITIES.includes(rawComplexity) ? rawComplexity : 'auto'

  const openAiSize = preset.kind === 'openai'
    && preset.sizeByModel[model] === undefined
    && /^[1-4]K$/i.test(size)
    ? (OPENAI_TIER_PIXELS[size.toUpperCase()]?.[ratio || '1:1'] || size)
    : size

  if (gif && referenceImages.length > 0) {
    throw new Error('GIF 动图只支持文生图，请先移除参考图。')
  }
  const gifFrameSize = gif
    ? (GPT_IMAGE_GIF_SIZES[ratio || '1:1'] || GPT_IMAGE_GIF_SIZES['1:1'])
    : ''

  if (!gif && preset.kind === 'openai' && preset.sizeByModel[model] === undefined) {
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
          'gpt-image-2.5/2.6 尺寸 ' + openAiSize + ' 不合法：宽高需为 16 的倍数、最长边≤3840、长短边比≤3:1、总像素 655,360–8,294,400。',
        )
      }
    }
  }

  const openAiBody = { model, prompt: upstreamPrompt, n: 1 }
  const effectiveSize = gif ? gifFrameSize : openAiSize
  const omitSize = preset.omitSizeWhenAuto === true && effectiveSize === 'auto'
  if (effectiveSize !== '' && !omitSize) openAiBody.size = effectiveSize
  if (quality !== '' && quality !== 'auto') openAiBody.quality = quality
  // A relay's URL reply means a second download hop; ask for inline base64 so
  // the image arrives with the generation response. Official OpenAI and
  // gpt-image-2.6-* (which switches to output_format) reject response_format,
  // so only older relay models ask for it (with an automatic retry fallback).
  if (preset.kind === 'openai' && !isOfficialOpenAi(config.baseUrl) && !supportsGpt26Extras) {
    openAiBody.response_format = 'b64_json'
  }
  if (supportsGpt26Extras) {
    openAiBody.output_format = outputFormat
    if (complexity !== 'auto') openAiBody.complexity = complexity
    if (gif) {
      const rawFrames = Number(body.frameCount)
      const frames = Number.isFinite(rawFrames) && rawFrames >= GIF_MIN_FRAMES && rawFrames <= GIF_MAX_FRAMES
        ? Math.round(rawFrames)
        : 9
      const rawDuration = Number(body.frameDurationMs)
      const duration = Number.isFinite(rawDuration) && rawDuration >= GIF_MIN_FRAME_MS && rawDuration <= GIF_MAX_FRAME_MS
        ? Math.round(rawDuration)
        : 200
      openAiBody.frame_count = frames
      openAiBody.frame_duration_ms = duration
    }
  }

  if (referenceImages.length > 0) {
    if (preset.kind === 'openai' && /^dall-e-3$/i.test(model)) {
      throw new Error('DALL·E 3 不支持参考图编辑，请切换到 gpt-image 系列模型后再试。')
    }
    return {
      body: openAiBody,
      model,
      size: effectiveSize,
      ratio,
      quality,
      outputFormat,
      mode: 'multipart',
      endpointPath: buildEditEndpointPath(config),
      files: referenceImages,
      referenceCount: referenceImages.length,
    }
  }
  return { body: openAiBody, model, size: effectiveSize, ratio, quality, outputFormat, referenceCount: 0 }
}
