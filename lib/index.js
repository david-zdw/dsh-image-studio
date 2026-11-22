/**
 * dsh-image-studio — host half.
 *
 * One generation pipeline, four provider profiles:
 *   agnes              open-storyboard-canvas's Agnes contract (ported)
 *   openai             OpenAI Images (gpt-image / DALL·E)
 *   grok               xAI Grok Imagine (OpenAI-shaped Images route)
 *   openai-compatible  user-editable OpenAI Images proxy
 *
 * Each profile has its own key slot in $DSH_HOME/image-studio/credentials.json;
 * keys never cross providers, never fall back to dsh's model credentials, and
 * never return to the browser after save.
 *
 * Routes: /image-studio/status|setup|generate|history|files/<id>
 * Command: /image [--provider …] [--size …] [--ratio …] [--quality …] <prompt>
 *
 * @module dsh-image-studio
 */

import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { Blob } from 'node:buffer'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  PROVIDER_ORDER,
  DEFAULT_PROVIDER,
  MAX_REFERENCE_BYTES,
  getProvider,
  normalizeProviderId,
  normalizeBaseUrl,
  sizesForProvider,
  qualitiesForProvider,
  resolveProviderConfig,
  validateProviderPatch,
  buildRequestBody,
  effectivePreset,
  complexitiesForProvider,
  outputFormatsForProvider,
  buildEndpointUrl,
  buildModelsEndpointUrl,
} from './providers.js'

const PACKAGE_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const GITHUB_REPO = 'david-zdw/dsh-image-studio'
const UPDATE_TIMEOUT_MS = 120_000
const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
const execFileAsync = promisify(execFile)

/** Plugin row id (also the `main` slot key and sidebar entry id). */
export const name = 'image-studio'

/** The web carrier, tool registry, and prompt registry are this plugin's hard dependencies. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Single HTTP prefix owned by this plugin. */
const ROUTE_PREFIX = '/image-studio'

/** Injected by apply(); returns the advertised root or the primary Web carrier origin. */
let originResolver = null

const WILDCARD_HOSTNAMES = new Set(['0.0.0.0', '::', '[::]', '*'])

/** Return a usable http(s) origin, rejecting bind-any addresses that no browser can load. */
function usableOrigin(value) {
  const origin = String(value ?? '').trim().replace(/\/+$/, '')
  if (origin === '') return ''
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (WILDCARD_HOSTNAMES.has(url.hostname)) return ''
    return origin
  } catch {
    return ''
  }
}

/** Origin of the entry point that served this request (public domain, tailnet name, or IP). */
function requestOrigin(req) {
  const host = typeof req?.headers?.host === 'string' ? req.headers.host.trim() : ''
  if (host === '') return ''
  const forwarded = req.headers['x-forwarded-proto']
  const forwardedProto = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim().toLowerCase()
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : req.socket?.encrypted === true ? 'https' : 'http'
  return usableOrigin(`${protocol}://${host}`)
}

/**
 * Base URL for an image: the request entry point when known, then the
 * advertised root (webApp), then the primary carrier. A relative path is the
 * final fallback, so a bind-any origin can never leak into browser HTML.
 */
function browserAssetUrl(id, origin) {
  let base = usableOrigin(origin)
  if (base === '') {
    try {
      base = usableOrigin(originResolver ? originResolver() : '')
    } catch {
      base = ''
    }
  }
  return `${base}${ROUTE_PREFIX}${ENDPOINTS.files}${id}`
}

/** Browser-facing endpoint paths (relative to {@link ROUTE_PREFIX}). */
const ENDPOINTS = Object.freeze({
  status: '/status',
  setup: '/setup',
  models: '/models',
  generate: '/generate',
  jobs: '/jobs',
  history: '/history',
  files: '/files/',
  updateCheck: '/update/check',
  updateApply: '/update/apply',
  galleryCatalog: '/gallery/catalog',
  galleryImage: '/gallery/image',
  galleryReference: '/gallery/reference',
  galleryLibraries: '/gallery/libraries',
  promptSources: '/prompts/sources',
  promptCatalog: '/prompts/catalog',
  promptImage: '/prompts/image',
  offlinePacks: '/offline/packs',
  offlineImport: '/offline/import',
  offlineRemove: '/offline/remove',
  offlineFile: '/offline/file',
  cacheStatus: '/cache/status',
  cacheClear: '/cache/clear',
})

/** Local storage layout under $DSH_HOME/image-studio. */
const STORAGE_DIRNAME = 'image-studio'

/** Maximum accepted prompt characters; longer prompts are rejected, not truncated. */
const MAX_PROMPT_CHARS = 4000

/** Maximum accepted JSON body for /generate (reference images included). */
const MAX_GENERATE_BODY_BYTES = 64 * 1024 * 1024

/** Model sniffing timeout and request cap. */
const MODELS_TIMEOUT_MS = 15_000
const MAX_MODELS_BODY_BYTES = 8 * 1024

/** Heuristic for highlighting image-capable model ids in a provider model list. */
const IMAGE_MODEL_RE = /(image|imagine|dall[-_ ]?e|gpt-image|flux|stable[-_ ]?diffusion|sdxl|seedream|seededit|recraft|ideogram|midjourney|nano[-_ ]?banana|gemini[^ ]*image)/i

/** Maximum downloaded image bytes. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/** Keys shorter/longer than this are rejected before they reach a provider. */
const MIN_KEY_CHARS = 8
const MAX_KEY_CHARS = 512

/** Workbench palettes selectable in 生图设置. `auto` follows the DSH theme. */
const STUDIO_THEMES = Object.freeze(['auto', 'mist', 'cream', 'haze', 'lilac'])
const STUDIO_THEME_LABELS = Object.freeze({
  auto: '跟随外观',
  mist: '雾青',
  cream: '米杏',
  haze: '黛蓝',
  lilac: '藕荷',
})

function normalizeThemeId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return STUDIO_THEMES.includes(id) ? id : undefined
}

/** History depth kept on disk. */
const HISTORY_LIMIT = 80

/** Default request timeout when a provider has no explicit one. */
const DEFAULT_TIMEOUT_MS = 300_000
/** URL download gets its own budget after the generation response arrives. */
const DOWNLOAD_TIMEOUT_MS = 120_000

/** Default concurrency when no deployment cap is set. */
const DEFAULT_MAX_CONCURRENT = 2

/** Errors that map to a stable browser-facing code. */
class StudioError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'StudioError'
    this.code = code
    this.extra = extra
  }
}

/* ------------------------------------------------------------------ */
/* Paths and small filesystem helpers                                  */
/* ------------------------------------------------------------------ */

function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv.trim())
  return path.join(os.homedir(), '.dsh')
}

const DSH_HOME = resolveDshHome()
const STORAGE_DIR = path.join(DSH_HOME, STORAGE_DIRNAME)
const OUTPUT_DIR = path.join(STORAGE_DIR, 'outputs')
const CACHE_DIR = path.join(STORAGE_DIR, 'cache')
const CACHE_META_DIR = path.join(CACHE_DIR, 'meta')
const CACHE_BLOBS_DIR = path.join(CACHE_DIR, 'blobs')
const CACHE_INDEX_FILE = path.join(CACHE_DIR, 'index.json')
const CONFIG_FILE = path.join(STORAGE_DIR, 'config.json')
const CREDENTIALS_FILE = path.join(STORAGE_DIR, 'credentials.json')
const HISTORY_FILE = path.join(STORAGE_DIR, 'history.json')
const ERRORS_FILE = path.join(STORAGE_DIR, 'errors.json')
const ERRORS_LIMIT = 40

/** User-supplied offline libraries. Packs are indexes; image files stay where the user put them. */
const OFFLINE_DIR = path.join(STORAGE_DIR, 'offline')
const OFFLINE_PROMPTS_DIR = path.join(OFFLINE_DIR, 'prompts')
const OFFLINE_GALLERY_DIR = path.join(OFFLINE_DIR, 'gallery')
const OFFLINE_PACK_MAX_ITEMS = 20000
const OFFLINE_PACK_MAX_BYTES = 64 * 1024 * 1024
const OFFLINE_IMAGE_MAX_BYTES = 32 * 1024 * 1024

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.rename(tmp, file)
  } catch {
    await fs.rm(file, { force: true })
    await fs.rename(tmp, file)
  }
}

/* ------------------------------------------------------------------ */
/* Config and per-provider credentials                                 */
/* ------------------------------------------------------------------ */

function emptyConfigDoc() {
  return { version: 2, enabled: true, defaultProvider: DEFAULT_PROVIDER, theme: 'auto', providers: {} }
}

function emptyCredentialsDoc() {
  return { version: 2, keys: {} }
}

/** Migrate v1 `{baseUrl, model}` and v2 `{providers}` config documents. */
function migrateConfigDoc(raw) {
  const doc = emptyConfigDoc()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return doc

  doc.theme = normalizeThemeId(raw.theme) ?? 'auto'
  if (raw.providers !== null && typeof raw.providers === 'object' && !Array.isArray(raw.providers)) {
    doc.enabled = raw.enabled !== false
    doc.defaultProvider = normalizeProviderId(raw.defaultProvider) ?? DEFAULT_PROVIDER
    doc.providers = raw.providers
    return doc
  }

  // v1: flat Agnes config.
  const legacy = {}
  for (const field of ['baseUrl', 'endpointPath', 'model', 'size', 'ratio', 'quality', 'models']) {
    if (raw[field] !== undefined) legacy[field] = raw[field]
  }
  if (Object.keys(legacy).length > 0) doc.providers.agnes = legacy
  doc.enabled = raw.enabled !== false
  return doc
}

/** Migrate v1 `{apiKey}` and v2 `{keys}` credential documents. */
function migrateCredentialsDoc(raw) {
  const doc = emptyCredentialsDoc()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return doc
  if (raw.keys !== null && typeof raw.keys === 'object' && !Array.isArray(raw.keys)) {
    doc.keys = raw.keys
    return doc
  }
  if (typeof raw.apiKey === 'string' && raw.apiKey.trim() !== '') {
    doc.keys.agnes = raw.apiKey.trim()
  }
  return doc
}

async function readConfigDoc() {
  return migrateConfigDoc(await readJson(CONFIG_FILE, null))
}

async function readCredentialsDoc() {
  return migrateCredentialsDoc(await readJson(CREDENTIALS_FILE, null))
}

/** The provider's effective config (preset defaults + saved patch). */
function providerConfigFor(configDoc, preset) {
  return resolveProviderConfig(preset, configDoc.providers[preset.id])
}

/** Resolve a provider key: file first, then provider-specific env, then legacy env. */
function credentialFor(credentialsDoc, preset) {
  const fileKey = typeof credentialsDoc.keys[preset.id] === 'string'
    ? credentialsDoc.keys[preset.id].trim()
    : ''
  if (fileKey !== '') return { key: fileKey, source: 'file' }
  for (const envName of preset.envKeys ?? []) {
    const envKey = typeof process.env[envName] === 'string' ? process.env[envName].trim() : ''
    if (envKey !== '') return { key: envKey, source: 'env' }
  }
  return { key: '', source: 'none' }
}

function maskKey(key) {
  if (typeof key !== 'string' || key === '') return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/** Add the saved model to the preset's advertised list. */
function modelsFor(preset, model) {
  const list = Array.isArray(preset.models) ? [...preset.models] : []
  if (typeof model === 'string' && model !== '' && !list.includes(model)) list.unshift(model)
  return list
}

/** Browser-safe status: per-provider config, key presence, never the key. */
async function buildStatus(pluginConfig) {
  const configDoc = await readConfigDoc()
  const credentialsDoc = await readCredentialsDoc()
  const providers = PROVIDER_ORDER.map((id) => {
    const preset = getProvider(id)
    const config = providerConfigFor(configDoc, preset)
    const effective = effectivePreset(preset, config)
    const credential = credentialFor(credentialsDoc, preset)
    return {
      id: preset.id,
      label: preset.label,
      shortLabel: preset.shortLabel,
      description: preset.description,
      kind: effective.kind,
      schema: config.schema,
      schemas: preset.schemas,
      schemaLabel: Array.isArray(preset.schemas)
        ? (preset.schemas.find(([schemaId]) => schemaId === config.schema) || preset.schemas[0])[1]
        : undefined,
      configured: credential.key !== '',
      masked: maskKey(credential.key),
      keySource: credential.source,
      baseUrl: config.baseUrl,
      endpointPath: config.endpointPath,
      model: config.model,
      size: config.size,
      ratio: config.ratio,
      quality: config.quality,
      models: config.models.length > 0
        // A saved model list predates models added later; keep the newest
        // built-in default reachable instead of hiding it permanently.
        ? (config.models.includes(preset.defaultModel) ? config.models : [preset.defaultModel, ...config.models])
        : modelsFor(preset, config.model),
      sizes: sizesForProvider(effective, config.model),
      sizeByModel: effective.sizeByModel,
      ratios: effective.ratios,
      qualities: qualitiesForProvider(effective, config.model),
      qualityByModel: effective.qualityByModel,
      supportsRatio: effective.supportsRatio,
      supportsQuality: effective.supportsQuality,
      complexities: complexitiesForProvider(effective, config.model),
      outputFormats: outputFormatsForProvider(effective, config.model),
      maxReferenceImages: effective.maxReferenceImages ?? 5,
      sizeMode: effective.sizeMode,
      placeholder: preset.placeholder === true,
      keyPlaceholder: preset.keyPlaceholder,
      keyHint: preset.keyHint,
      baseUrlDefault: preset.baseUrl,
      endpointDefault: preset.endpointPath,
      modelDefault: preset.defaultModel,
      editableEndpoint: preset.editableEndpoint,
    }
  })
  return {
    enabled: configDoc.enabled !== false && pluginConfig.enabled !== false,
    version: PACKAGE_VERSION,
    defaultProvider: configDoc.defaultProvider,
    theme: configDoc.theme || 'auto',
    themeOptions: STUDIO_THEMES.map((id) => ({ id, label: STUDIO_THEME_LABELS[id] })),
    providers,
    storageDir: STORAGE_DIR,
    outputDir: OUTPUT_DIR,
  }
}

/** Whether a setup body carries provider config fields. */
function hasProviderFields(body) {
  return ['baseUrl', 'endpointPath', 'model', 'size', 'ratio', 'quality', 'models', 'schema']
    .some((field) => body[field] !== undefined)
}

/** Pull model ids out of the common OpenAI-shaped and vendor list payloads. */
function modelIdsFromPayload(payload) {
  const candidates = [
    payload?.data,
    payload?.models,
    payload?.result,
    payload?.items,
    payload?.available_models,
    payload?.data?.models,
  ]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    const ids = []
    for (const item of candidate) {
      const value = typeof item === 'string'
        ? item
        : (item?.id ?? item?.model ?? item?.name ?? item?.model_name ?? item?.modelId)
      if (typeof value === 'string' && value.trim() !== '') ids.push(value.trim())
    }
    if (ids.length > 0) return ids
  }
  return []
}

/**
 * Read the provider's model catalog with the already-saved key. The browser
 * never sends a key to this route; it only names the provider.
 */
async function sniffModels(input) {
  const requested = input !== null && typeof input === 'object' && !Array.isArray(input) ? input.provider : undefined
  const providerId = normalizeProviderId(requested === undefined || requested === null ? '' : String(requested))
  if (providerId === undefined) {
    throw new StudioError('bad-request', `未知的生图服务商：${String(requested ?? '')}`)
  }
  const preset = getProvider(providerId)
  if (preset === undefined) throw new StudioError('bad-request', '未知的生图服务商。')
  if (preset.placeholder === true) {
    throw new StudioError('unavailable', `${preset.label} 正在接入中，暂不支持嗅探模型。`, { provider: preset.id })
  }

  const configDoc = await readConfigDoc()
  const config = providerConfigFor(configDoc, preset)
  const credential = credentialFor(await readCredentialsDoc(), preset)
  if (credential.key === '') {
    throw new StudioError('unconfigured', `尚未配置 ${preset.label} 的 API Key，先保存 Key 再嗅探模型。`, { provider: providerId })
  }

  const url = buildModelsEndpointUrl(config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS)
  let response
  let text = ''
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.key}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    text = await response.text()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new StudioError('timeout', `模型嗅探超时（${Math.round(MODELS_TIMEOUT_MS / 1000)} 秒）。`, { provider: providerId })
    }
    throw new StudioError('network', `模型嗅探请求失败：${error instanceof Error ? error.message : String(error)}`, { provider: providerId })
  } finally {
    clearTimeout(timer)
  }

  const preview = text.replace(/\s+/g, ' ').slice(0, 200)
  if (response.status === 401 || response.status === 403) {
    throw new StudioError('auth', `${preset.label} 模型嗅探鉴权失败（HTTP ${response.status}），请检查 Key。`, { provider: providerId, status: response.status })
  }
  if (response.status === 429) {
    throw new StudioError('rate-limit', `${preset.label} 模型嗅探被限流（HTTP 429），稍后再试。`, { provider: providerId, status: response.status })
  }
  if (!response.ok) {
    throw new StudioError('upstream', `${preset.label} 模型嗅探失败（HTTP ${response.status}）${preview === '' ? '' : `：${preview}`}`, { provider: providerId, status: response.status })
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new StudioError('upstream', `${preset.label} 模型列表不是有效 JSON${preview === '' ? '' : `：${preview}`}`, { provider: providerId })
  }
  const ids = [...new Set(modelIdsFromPayload(payload))]
    .filter((id) => id.length <= 200)
    .slice(0, 500)
  if (ids.length === 0) {
    throw new StudioError('upstream', `${preset.label} 返回了空模型列表；该服务商可能不支持 GET /models。`, { provider: providerId })
  }
  const models = ids
    .map((id) => ({ id, imageLike: IMAGE_MODEL_RE.test(id) }))
    .sort((a, b) => (Number(b.imageLike) - Number(a.imageLike)) || a.id.localeCompare(b.id))
  return {
    provider: providerId,
    providerLabel: preset.label,
    endpoint: url,
    models,
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Apply one setup patch.  A blank `apiKey` keeps the stored key; `clearKey`
 * removes only that provider's key.  Provider config fields are validated
 * against the selected preset.
 */
async function saveSetup(pluginConfig, input) {
  const body = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const configDoc = await readConfigDoc()
  const credentialsDoc = await readCredentialsDoc()
  let configChanged = false
  let credentialsChanged = false

  if (body.theme !== undefined) {
    const requestedTheme = normalizeThemeId(body.theme)
    if (requestedTheme === undefined) {
      throw new StudioError('bad-request', `未知的工作台配色：${String(body.theme)}`)
    }
    if (configDoc.theme !== requestedTheme) {
      configDoc.theme = requestedTheme
      configChanged = true
    }
  }

  const requestedDefault = normalizeProviderId(body.defaultProvider)
  if (body.defaultProvider !== undefined) {
    if (requestedDefault === undefined) throw new StudioError('bad-request', '未知的默认服务商。')
    if (configDoc.defaultProvider !== requestedDefault) {
      configDoc.defaultProvider = requestedDefault
      configChanged = true
    }
  }

  let providerId
  if (body.providerId !== undefined && body.providerId !== null && String(body.providerId).trim() !== '') {
    providerId = normalizeProviderId(String(body.providerId))
    if (providerId === undefined) throw new StudioError('bad-request', `未知的生图服务商：${String(body.providerId)}`)
  } else {
    providerId = requestedDefault ?? configDoc.defaultProvider
  }
  const preset = getProvider(providerId)
  if (preset === undefined) throw new StudioError('bad-request', '未知的生图服务商。')

  const wantsProviderChange = body.providerId !== undefined
    || body.apiKey !== undefined
    || body.clearKey === true
    || hasProviderFields(body)

  if (wantsProviderChange) {
    if (hasProviderFields(body)) {
      const current = providerConfigFor(configDoc, preset)
      const patch = {}
      for (const field of ['baseUrl', 'endpointPath', 'model', 'size', 'ratio', 'quality', 'models', 'schema']) {
        if (body[field] !== undefined) patch[field] = body[field]
      }
      try {
        configDoc.providers[preset.id] = validateProviderPatch(preset, current, patch)
      } catch (error) {
        throw new StudioError('bad-request', error instanceof Error ? error.message : String(error), { provider: preset.id })
      }
      configChanged = true
    }

    if (body.clearKey === true) {
      if (credentialsDoc.keys[preset.id] !== undefined) {
        delete credentialsDoc.keys[preset.id]
        credentialsChanged = true
      }
    } else if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') {
      const apiKey = body.apiKey.trim()
      if (apiKey.length < MIN_KEY_CHARS || apiKey.length > MAX_KEY_CHARS) {
        throw new StudioError('bad-request', `API Key 长度应在 ${MIN_KEY_CHARS}–${MAX_KEY_CHARS} 个字符之间。`, { provider: preset.id })
      }
      if (/\s/.test(apiKey)) {
        throw new StudioError('bad-request', 'API Key 不能包含空白字符，请检查是否复制完整。', { provider: preset.id })
      }
      credentialsDoc.keys[preset.id] = apiKey
      credentialsChanged = true
    }
  }

  if (configChanged) await writeJson(CONFIG_FILE, configDoc)
  if (credentialsChanged) await writeJson(CREDENTIALS_FILE, credentialsDoc)
  return buildStatus(pluginConfig)
}

/* ------------------------------------------------------------------ */
/* Upstream call and response parsing                                  */
/* ------------------------------------------------------------------ */

function previewText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function extractUpstreamMessage(payload) {
  if (payload === null || payload === undefined) return ''
  if (typeof payload === 'string') return previewText(payload, 300)
  if (typeof payload !== 'object') return ''
  const record = payload
  const candidates = [
    record.message,
    record.msg,
    record.detail,
    record.error,
    record.error?.message,
    record.data?.message,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() !== '') return previewText(value, 300)
    if (value !== null && typeof value === 'object') {
      const nested = value.message ?? value.msg ?? value.detail
      if (typeof nested === 'string' && nested.trim() !== '') return previewText(nested, 300)
    }
  }
  return ''
}

/** Readable, provider-aware error for a non-2xx response. */
function mapHttpError(status, rawText, payload, preset, url) {
  const label = preset.label
  const upstream = extractUpstreamMessage(payload) || previewText(rawText, 300)
  const suffix = upstream ? `上游信息：${upstream}` : ''
  if (status === 401 || status === 403) {
    return new StudioError('auth', `${label} Key 无效或无权限（HTTP ${status}）。${suffix}`, { provider: preset.id })
  }
  if (status === 402) {
    return new StudioError('quota', `${label} 账户额度不足或需要付费（HTTP 402）。${suffix}`, { provider: preset.id })
  }
  const upstreamText = (upstream || '').toLowerCase()
  if (status === 404 && /parameter|upstream request failed|not support|channel/.test(upstreamText)) {
    return new StudioError('upstream', `${label} 上游中转拒绝了请求（HTTP 404）：${upstream}。这通常是中转的模型/渠道临时不可用，不是本地接口路径错误；请重试，或更换 Base URL/模型。当前请求：${url}`, { provider: preset.id })
  }
  if (status === 404) {
    return new StudioError('bad-request', `${label} 接口路径不存在（HTTP 404）。请检查 Base URL 和接口路径。当前请求：${url}${suffix ? `。${suffix}` : ''}`, { provider: preset.id })
  }
  if (status === 429) {
    return new StudioError('rate-limit', `${label} 请求过于频繁或并发已满（HTTP 429）。${suffix}`, { provider: preset.id })
  }
  if (status === 400 || status === 422) {
    if (/safety|moderation|sexual|violat/.test(upstreamText)) {
      return new StudioError('bad-request', `${label} 内容审核拒绝（HTTP ${status}）：${upstream}。请修改提示词后重试。`, { provider: preset.id })
    }
    if (/requires an image model|image model, got/i.test(upstreamText)) {
      return new StudioError('bad-request', `${label} 当前 Base URL 不支持该模型走 Images 接口：${upstream}。请换用官方 MiniMax 地址和 Key，或选择该中转实际支持的图像模型。`, { provider: preset.id })
    }
    return new StudioError('bad-request', `${label} 拒绝了请求参数（HTTP ${status}）。${suffix}`, { provider: preset.id })
  }
  if (status === 524 || status === 504) {
    return new StudioError(
      'timeout',
      `${label} 上游网关超时（HTTP ${status}），本次没有返回图片。不要自动重试；请先告诉用户超时，并询问是否重新生成。${suffix}`,
      { provider: preset.id },
    )
  }
  if (status >= 500) {
    return new StudioError('upstream', `${label} 服务暂不可用（HTTP ${status}）。${suffix}`, { provider: preset.id })
  }
  return new StudioError('upstream', `${label} 请求失败（HTTP ${status}）。${suffix}`, { provider: preset.id })
}

function isSuccessCode(code) {
  if (typeof code === 'number') return code === 0 || code === 200
  if (typeof code === 'string') {
    const normalized = code.trim().toLowerCase()
    if (normalized === '') return true
    const numeric = Number(normalized)
    if (Number.isFinite(numeric)) return numeric === 0 || numeric === 200
    return normalized === 'ok' || normalized === 'success' || normalized === 'succeeded'
  }
  return true
}

function unwrapPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const record = payload
  if (Object.prototype.hasOwnProperty.call(record, 'code') && !isSuccessCode(record.code)) {
    throw new StudioError('upstream', `上游返回错误码 ${String(record.code)}：${extractUpstreamMessage(record) || '未知错误'}`)
  }
  return Object.prototype.hasOwnProperty.call(record, 'data') ? record.data : payload
}

/** Find the first image source in an OpenAI/Agnes-style response. */
function extractImageSource(payload, depth = 0) {
  if (payload === null || payload === undefined || depth > 8) return null
  if (typeof payload === 'string') {
    const text = payload.trim()
    if (/^data:image\//i.test(text)) return text
    if (/^https?:\/\//i.test(text) && /(\.(png|jpe?g|webp|gif)(\?|#|$)|image)/i.test(text)) return text
    if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s/g, '').length > 512) {
      return text.replace(/\s/g, '')
    }
    return null
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractImageSource(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  if (typeof payload !== 'object') return null
  const record = payload
  for (const key of ['b64_json', 'base64', 'image_base64']) {
    if (typeof record[key] === 'string' && record[key].trim() !== '') return record[key].trim()
  }
  for (const key of ['url', 'image_url', 'imageUrl', 'output_url', 'outputUrl']) {
    if (typeof record[key] === 'string' && /^https?:\/\//i.test(record[key].trim())) return record[key].trim()
  }
  for (const key of ['image', 'images', 'data', 'result', 'results', 'output', 'outputs']) {
    if (record[key] !== undefined) {
      const found = extractImageSource(record[key], depth + 1)
      if (found !== null) return found
    }
  }
  for (const value of Object.values(record)) {
    const found = extractImageSource(value, depth + 1)
    if (found !== null) return found
  }
  return null
}

function decodeDataUrl(value) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i.exec(value.trim())
  if (match === null) return null
  const mime = (match[1] || 'image/png').toLowerCase()
  if (match[2]) return { buffer: Buffer.from(match[3], 'base64'), mime }
  return { buffer: Buffer.from(decodeURIComponent(match[3]), 'binary'), mime }
}

function detectMime(buffer, fallback = 'image/png') {
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return 'image/gif'
  }
  return fallback
}

function extensionFor(mime) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function isProviderHost(target, baseUrl) {
  try {
    const targetHost = new URL(target).hostname.toLowerCase()
    const providerHost = new URL(baseUrl).hostname.toLowerCase()
    if (targetHost === providerHost) return true
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(targetHost) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(providerHost)) {
      return false
    }
    const root = (host) => host.split('.').slice(-2).join('.')
    return targetHost.endsWith(`.${providerHost}`)
      || providerHost.endsWith(`.${targetHost}`)
      || root(targetHost) === root(providerHost)
  } catch {
    return false
  }
}

/**
 * Native GET fallback for multi-IP CDN hosts (e.g. Cloudflare dual-stack) where
 * undici's fetch may stall on an unreachable IPv6 route. `autoSelectFamily`
 * races IPv6 and IPv4 cleanly.
 */
function getNativeBytes(url, headers, signal, timeoutMs = 45_000, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'https:' ? https : http
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const request = transport.request(target, {
      method: 'GET',
      headers,
      autoSelectFamily: true,
      timeout: timeoutMs,
    }, (response) => {
      const status = response.statusCode || 0
      const location = response.headers.location
      if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308)
        && typeof location === 'string' && location !== '' && redirects < 4) {
        response.resume()
        const nextUrl = new URL(location, target).href
        getNativeBytes(nextUrl, headers, signal, timeoutMs, redirects + 1).then(
          (val) => finish(resolve, val),
          (err) => finish(reject, err),
        )
        return
      }
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        request.destroy(new Error('生成的图片超过 32MB，已拒绝保存。'))
        return
      }
      const chunks = []
      let total = 0
      let firstByteMs = 0
      const startedAt = Date.now()
      response.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (buf.length > 0) {
          if (!firstByteMs) firstByteMs = Date.now() - startedAt
          total += buf.length
          if (total > MAX_IMAGE_BYTES) {
            request.destroy(new Error('生成的图片超过 32MB，已拒绝保存。'))
            return
          }
          chunks.push(buf)
        }
      })
      response.on('end', () => {
        const buffer = Buffer.concat(chunks, total)
        finish(resolve, {
          status,
          headers: response.headers,
          buffer,
          firstByteMs,
          bodyMs: Date.now() - startedAt,
        })
      })
      response.on('error', (error) => finish(reject, error))
    })
    const timer = setTimeout(() => {
      request.destroy(new Error(`下载 ${target.host} 超时（${Math.round(timeoutMs / 1000)} 秒）。`))
    }, timeoutMs)
    const abort = () => request.destroy(new Error('下载已取消。'))
    if (signal) signal.addEventListener('abort', abort, { once: true })
    request.on('error', (error) => finish(reject, error))
    request.on('close', () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', abort)
    })
    request.end()
  })
}

async function fetchImageBytes(url, headers, signal) {
  let response
  try {
    response = await fetch(url, { method: 'GET', headers, signal })
  } catch (error) {
    if (isConnectFailure(error) && (!signal || !signal.aborted)) {
      try {
        const native = await getNativeBytes(url, headers, signal)
        const headerMap = {
          get(key) {
            const raw = native.headers[String(key).toLowerCase()]
            return Array.isArray(raw) ? raw[0] : (raw ?? null)
          },
        }
        const synthetic = {
          ok: native.status >= 200 && native.status < 300,
          status: native.status,
          headers: headerMap,
          body: null,
          async arrayBuffer() {
            return native.buffer.buffer.slice(native.buffer.byteOffset, native.buffer.byteOffset + native.buffer.byteLength)
          },
          async text() {
            return native.buffer.toString('utf8')
          },
        }
        if (synthetic.ok) return { response: synthetic, nativeFirstByteMs: native.firstByteMs, nativeBodyMs: native.bodyMs }
        return { response: synthetic, status: native.status, detail: native.buffer.toString('utf8').replace(/\s+/g, ' ').slice(0, 240) }
      } catch (nativeError) {
        return { error: nativeError }
      }
    }
    return { error }
  }
  if (response.ok) return { response }
  let detail = ''
  try {
    detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240)
  } catch {
    detail = ''
  }
  return { response, status: response.status, detail }
}

const RANGE_PROBE_END = 262_143
const RANGE_MIN_BYTES = 1_200_000
const RANGE_CHUNKS = 6

function contentRangeTotal(header) {
  const text = String(header || '')
  const slash = text.lastIndexOf('/')
  if (slash < 0) return 0
  const total = Number(text.slice(slash + 1))
  return Number.isFinite(total) && total > 0 ? total : 0
}

function imageMimeOf(response, buffer) {
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  let mime = contentType.startsWith('image/') ? contentType : detectMime(buffer)
  if (mime === 'image/jpg') mime = 'image/jpeg'
  return mime
}

async function readImageBody(response, record) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new StudioError('upstream', '生成的图片超过 32MB，已拒绝保存。')
  }
  const startedAt = Date.now()
  let buffer
  if (!response.body) {
    buffer = Buffer.from(await response.arrayBuffer())
    record.bodyMs = Date.now() - startedAt
  } else {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    let firstByteMs = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.byteLength > 0) {
        if (!firstByteMs) firstByteMs = Date.now() - startedAt
        total += value.byteLength
        if (total > MAX_IMAGE_BYTES) {
          try {
            await reader.cancel()
          } catch {
            // ignore
          }
          throw new StudioError('upstream', '生成的图片超过 32MB，已拒绝保存。')
        }
        chunks.push(Buffer.from(value))
      }
    }
    buffer = Buffer.concat(chunks, total)
    record.firstByteMs = firstByteMs
    record.bodyMs = Date.now() - startedAt
  }
  if (buffer.length === 0) throw new StudioError('upstream', '下载到的图片为空。')
  if (buffer.length > MAX_IMAGE_BYTES) throw new StudioError('upstream', '生成的图片超过 32MB，已拒绝保存。')
  return { buffer, mime: imageMimeOf(response, buffer) }
}

async function fetchSingleRangeChunk(url, headers, signal, start, end) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await fetchImageBytes(url, { ...headers, Range: `bytes=${start}-${end}` }, signal)
    if (!result.error && result.response && result.response.status === 206) {
      try {
        const chunk = Buffer.from(await result.response.arrayBuffer())
        if (chunk.length === end - start + 1) return chunk
      } catch {
        // retry once below
      }
    }
    if (signal && signal.aborted) return null
  }
  return null
}

/**
 * Split a large image download across parallel connections, reusing any initial
 * prefix bytes already fetched by the probe request. Each chunk gets one retry
 * so a transient CDN glitch does not discard the whole multi-part transfer.
 */
async function fetchImageRanges(url, headers, signal, total, prefixBuffer = null) {
  const offset = prefixBuffer ? prefixBuffer.length : 0
  if (offset >= total) return prefixBuffer.subarray(0, total)
  const remaining = total - offset
  const parts = Math.min(RANGE_CHUNKS, Math.max(1, Math.ceil(remaining / 262_144)))
  const size = Math.ceil(remaining / parts)
  const jobs = []
  for (let index = 0; index < parts; index += 1) {
    const start = offset + index * size
    const end = Math.min(total - 1, start + size - 1)
    if (start > end) break
    jobs.push(fetchSingleRangeChunk(url, headers, signal, start, end))
  }
  const chunks = await Promise.all(jobs)
  if (chunks.some((chunk) => chunk === null)) return null
  const buffers = prefixBuffer && prefixBuffer.length > 0 ? [prefixBuffer, ...chunks] : chunks
  const buffer = Buffer.concat(buffers)
  return buffer.length === total ? buffer : null
}

async function downloadFullSingleStream(url, headers, signal, record) {
  const full = await fetchImageBytes(url, headers, signal)
  if (full.error) {
    const message = full.error instanceof Error ? full.error.message : String(full.error)
    record.error = message
    throw new StudioError('network', `${record.label} 已返回图片地址，但下载失败：${message}`)
  }
  if (!full.response || !full.response.ok) {
    record.status = full.response ? full.response.status : 0
    record.detail = full.detail || ''
    return null
  }
  record.mode = 'single'
  const read = await readImageBody(full.response, record)
  record.bytes = read.buffer.length
  return read
}

async function downloadWithHeaders(url, headers, signal, record) {
  const probe = await fetchImageBytes(url, { ...headers, Range: `bytes=0-${RANGE_PROBE_END}` }, signal)
  if (probe.error) {
    const message = probe.error instanceof Error ? probe.error.message : String(probe.error)
    record.error = message
    throw new StudioError('network', `${record.label} 已返回图片地址，但下载失败：${message}`)
  }
  const response = probe.response
  record.status = response.status
  record.probeMs = Date.now() - record.startedAt
  if (response.status === 206) {
    const total = contentRangeTotal(response.headers.get('content-range'))
    if (total > MAX_IMAGE_BYTES) {
      try {
        if (response.body) await response.body.cancel()
      } catch {
        // ignore
      }
      throw new StudioError('upstream', '生成的图片超过 32MB，已拒绝保存。')
    }
    let prefix = null
    try {
      prefix = Buffer.from(await response.arrayBuffer())
    } catch {
      prefix = null
    }
    if (prefix && total > 0 && prefix.length === total) {
      record.mode = 'single'
      record.firstByteMs = record.probeMs
      record.bodyMs = Date.now() - record.startedAt
      record.bytes = prefix.length
      return { buffer: prefix, mime: imageMimeOf(response, prefix) }
    }
    if (total >= RANGE_MIN_BYTES && total <= MAX_IMAGE_BYTES) {
      const startedAt = Date.now()
      const buffer = await fetchImageRanges(url, headers, signal, total, prefix && prefix.length > 0 ? prefix : null)
      if (buffer) {
        record.mode = 'range'
        record.firstByteMs = record.probeMs
        record.bodyMs = Date.now() - startedAt
        record.bytes = buffer.length
        return { buffer, mime: imageMimeOf(response, buffer) }
      }
      record.rangeFallback = true
    } else if (prefix && prefix.length > 0 && total > prefix.length && total < RANGE_MIN_BYTES) {
      const startedAt = Date.now()
      const tail = await fetchSingleRangeChunk(url, headers, signal, prefix.length, total - 1)
      if (tail) {
        const merged = Buffer.concat([prefix, tail])
        record.mode = 'single'
        record.firstByteMs = record.probeMs
        record.bodyMs = Date.now() - startedAt
        record.bytes = merged.length
        return { buffer: merged, mime: imageMimeOf(response, merged) }
      }
    }
    return downloadFullSingleStream(url, headers, signal, record)
  }
  // Signed object-storage URLs (S3/R2/OSS) occasionally reject Range headers
  // with 400/403/405/416/501 even when a plain GET succeeds.
  if (response.status === 400 || response.status === 403 || response.status === 405 || response.status === 416 || response.status === 501) {
    record.rangeRejected = response.status
    const fallback = await downloadFullSingleStream(url, headers, signal, record)
    if (fallback) return fallback
  }
  if (!response.ok) {
    record.detail = probe.detail || ''
    return null
  }
  record.mode = 'single'
  const read = await readImageBody(response, record)
  record.bytes = read.buffer.length
  return read
}

async function downloadImage(url, config, key, signal, label, detail) {
  const sameSite = isProviderHost(url, config.baseUrl)
  const attempts = sameSite
    ? [{ Authorization: `Bearer ${key}`, Accept: 'image/*' }, { Accept: 'image/*' }]
    : [{ Accept: 'image/*' }]
  let last = null
  for (const headers of attempts) {
    const record = {
      label,
      auth: Boolean(headers.Authorization),
      startedAt: Date.now(),
      status: 0,
      mode: '',
      bytes: 0,
      bodyMs: 0,
    }
    const result = await downloadWithHeaders(url, headers, signal, record)
    record.ms = Date.now() - record.startedAt
    if (detail && Array.isArray(detail.attempts)) detail.attempts.push(record)
    if (result) {
      if (detail) {
        detail.mode = record.mode
        detail.host = (() => {
          try {
            return new URL(url).host
          } catch {
            return ''
          }
        })()
        detail.bytes = record.bytes
        detail.firstByteMs = Number.isFinite(record.firstByteMs) ? record.firstByteMs : record.ms
        detail.bodyMs = record.bodyMs
        detail.auth = record.auth
      }
      return result
    }
    last = record
  }
  const status = last && last.status ? ` HTTP ${last.status}` : ''
  const detailText = last && last.detail ? `：${last.detail}` : '。'
  throw new StudioError('upstream', `${label} 已返回图片地址，但下载返回${status}${detailText}`)
}

async function materializeImage(source, config, key, signal, label, detail) {
  const text = source.trim()
  if (/^data:image\//i.test(text)) {
    const decoded = decodeDataUrl(text)
    if (decoded === null || decoded.buffer.length === 0) {
      throw new StudioError('upstream', '上游返回的 data URL 无法解码。')
    }
    return { buffer: decoded.buffer, mime: detectMime(decoded.buffer, decoded.mime) }
  }
  if (/^https?:\/\//i.test(text)) {
    return downloadImage(text, config, key, signal, label, detail)
  }
  const base64 = text.replace(/\s/g, '')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) throw new StudioError('upstream', '上游返回的 base64 图片无法解码。')
  return { buffer, mime: detectMime(buffer) }
}

/**
 * Read a JSON response body without waiting for the server to half-close the
 * chunked connection. Some relays send a complete JSON object and then keep
 * the socket open; `response.text()` can block for minutes in that case.
 */
async function readJsonBodyEarly(response) {
  if (!response.body) return await response.text()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        text += decoder.decode()
        return text
      }
      text += decoder.decode(value, { stream: true })
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new StudioError('upstream', '上游响应体超过 64MB，已拒绝读取。')
      }
      const tail = text.slice(-16).trimEnd()
      if (tail.endsWith('}') || tail.endsWith(']')) {
        try {
          JSON.parse(text)
          return text
        } catch {
          // Not a complete JSON document yet; keep reading.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

function isConnectFailure(error) {
  const raw = [
    error instanceof Error ? error.message : String(error),
    error && error.cause instanceof Error ? error.cause.message : '',
    error && typeof error.code === 'string' ? error.code : '',
    error && error.cause && typeof error.cause.code === 'string' ? error.cause.code : '',
  ].filter(Boolean).join(' ')
  return /connect timeout|und_err_connect_timeout|econnrefused|ehostunreach|enetunreach|eai_again/i.test(raw)
}

function buildNativeMultipart(built, decodedFiles = null) {
  const boundary = `----dsh-image-${randomUUID()}`
  const chunks = []
  const push = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'))
  for (const [field, value] of Object.entries(built.body || {})) {
    if (value === undefined || value === null || value === '') continue
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${String(value)}\r\n`)
  }
  const files = decodedFiles || (built.files || []).map((image) => {
    const comma = image.dataUrl.indexOf(',')
    return { ...image, bytes: Buffer.from(image.dataUrl.slice(comma + 1), 'base64') }
  })
  for (const image of files) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${image.filename}"\r\nContent-Type: ${image.mime}\r\n\r\n`)
    chunks.push(image.bytes)
    push('\r\n')
  }
  push(`--${boundary}--\r\n`)
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

/**
 * Native fallback for multi-IP hosts where undici's fixed 10s connect budget
 * gives up on the first address. `autoSelectFamily` tries the other addresses.
 */
export function postNative(url, headers, body, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'https:' ? https : http
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const request = transport.request(target, {
      method: 'POST',
      headers,
      autoSelectFamily: true,
      timeout: timeoutMs,
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        text += chunk
        if (text.length > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('上游响应体超过 64MB，已拒绝读取。'))
          return
        }
        const tail = text.slice(-16).trimEnd()
        if (tail.endsWith('}') || tail.endsWith(']')) {
          try {
            JSON.parse(text)
            response.destroy()
            finish(resolve, { statusCode: response.statusCode || 0, text })
          } catch {
            // incomplete JSON
          }
        }
      })
      response.on('end', () => finish(resolve, { statusCode: response.statusCode || 0, text }))
      response.on('error', (error) => finish(reject, error))
    })
    const timer = setTimeout(() => {
      request.destroy(new Error(`连接 ${target.host} 超时（${Math.round(timeoutMs / 1000)} 秒）。`))
    }, timeoutMs)
    const abort = () => request.destroy(new Error('请求已取消。'))
    if (signal) signal.addEventListener('abort', abort, { once: true })
    request.on('error', (error) => finish(reject, error))
    request.on('close', () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', abort)
    })
    request.end(body)
  })
}

async function requestGeneration(preset, config, key, built, timeoutMs) {
  const requestStartedAt = Date.now()
  const url = buildEndpointUrl(config, built.endpointPath)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  let requestPayload
  let makeNativePayload = null
  try {
    if (built.mode === 'multipart') {
      const form = new FormData()
      for (const [field, value] of Object.entries(built.body || {})) {
        if (value !== undefined && value !== null && value !== '') {
          form.append(field, String(value))
        }
      }
      const decodedFiles = []
      for (const image of built.files || []) {
        const comma = image.dataUrl.indexOf(',')
        const bytes = Buffer.from(image.dataUrl.slice(comma + 1), 'base64')
        decodedFiles.push({ ...image, bytes })
        form.append('image', new Blob([bytes], { type: image.mime }), image.filename)
      }
      requestPayload = form
      makeNativePayload = () => buildNativeMultipart(built, decodedFiles)
    } else {
      headers['Content-Type'] = 'application/json'
      requestPayload = JSON.stringify(built.body)
      makeNativePayload = () => ({ body: Buffer.from(requestPayload, 'utf8'), contentType: 'application/json' })
    }
  } catch (error) {
    clearTimeout(timer)
    throw new StudioError('bad-request', `参考图处理失败：${error instanceof Error ? error.message : String(error)}`, { provider: preset.id })
  }

  let responseStatus = 0
  let rawText = ''
  let postMs = 0
  let headersMs = 0
  let bodyMs = 0
  try {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestPayload,
        signal: controller.signal,
      })
      responseStatus = response.status
      headersMs = Date.now() - requestStartedAt
      rawText = await readJsonBodyEarly(response)
      bodyMs = Date.now() - requestStartedAt - headersMs
      postMs = Date.now() - requestStartedAt
    } catch (error) {
      if (controller.signal.aborted) {
        throw new StudioError('timeout', `${preset.label} 生图超时（${Math.round(timeoutMs / 1000)} 秒）。可以调高设置里的超时时间后重试。`, { provider: preset.id })
      }
      const cause = error instanceof Error
        ? (error.cause instanceof Error ? `${error.message}（${error.cause.message}）` : error.message)
        : String(error)
      if (isConnectFailure(error) && makeNativePayload) {
        try {
          const nativePayload = makeNativePayload()
          const native = await postNative(
            url,
            { ...headers, 'Content-Type': nativePayload.contentType },
            nativePayload.body,
            controller.signal,
            timeoutMs,
          )
          responseStatus = native.statusCode
          rawText = native.text
          postMs = Date.now() - requestStartedAt
          headersMs = postMs
          bodyMs = 0
        } catch (nativeError) {
          const nativeCause = nativeError instanceof Error ? nativeError.message : String(nativeError)
          throw new StudioError('network', `无法连接 ${preset.label} 服务 ${config.baseUrl}：${cause}；原生重试失败：${nativeCause}`, { provider: preset.id })
        }
      } else {
        throw new StudioError('network', `无法连接 ${preset.label} 服务 ${config.baseUrl}：${cause}`, { provider: preset.id })
      }
    }

    let responsePayload = null
    try {
      responsePayload = rawText === '' ? null : JSON.parse(rawText)
    } catch {
      responsePayload = null
    }

    if ((responseStatus === 400 || responseStatus === 422)
      && built.retryWithoutB64 !== true
      && built.body
      && built.body.response_format === 'b64_json'
      && /response_format|b64_json|base64|unknown (parameter|field|argument)|unrecognized|not supported|unsupported|不支持|未知/i.test(rawText)) {
      // Some relays reject response_format; fall back to their default URL
      // reply instead of failing the whole generation.
      const retryMs = Date.now() - requestStartedAt
      const retryBuilt = { ...built, body: { ...built.body }, retryWithoutB64: true, b64RetryMs: retryMs }
      delete retryBuilt.body.response_format
      clearTimeout(timer)
      const remaining = Math.max(15_000, timeoutMs - retryMs)
      return requestGeneration(preset, config, key, retryBuilt, remaining)
    }

    if (responseStatus < 200 || responseStatus >= 300) throw mapHttpError(responseStatus, rawText, responsePayload, preset, url)

    let source
    try {
      const unwrapped = unwrapPayload(responsePayload)
      source = extractImageSource(unwrapped)
      if (source === null && unwrapped !== responsePayload) source = extractImageSource(responsePayload)
    } catch (error) {
      if (error instanceof StudioError) throw error
      throw new StudioError('upstream', `解析 ${preset.label} 响应失败：${error instanceof Error ? error.message : String(error)}`, { provider: preset.id })
    }
    if (source === null) {
      throw new StudioError(
        'no-image',
        `${preset.label} 接口返回成功，但响应里没有识别到图片。响应片段：${previewText(rawText, 400) || '（空响应）'}`,
        { provider: preset.id },
      )
    }

    // Generation and download have separate budgets. A URL result must not
    // consume the remaining generation deadline and then fail at the last
    // second while saving an otherwise successful image.
    clearTimeout(timer)
    const downloadController = new AbortController()
    const downloadTimer = setTimeout(() => downloadController.abort(), DOWNLOAD_TIMEOUT_MS)
    const downloadStartedAt = Date.now()
    const sourceKind = /^data:image\//i.test(source) ? 'data' : (/^https?:\/\//i.test(source) ? 'url' : 'base64')
    const downloadDetail = { attempts: [], mode: '', host: '', bytes: 0 }
    try {
      const materialized = await materializeImage(source, config, key, downloadController.signal, preset.label, downloadDetail)
      return {
        ...materialized,
        timings: {
          postMs,
          headersMs,
          bodyMs,
          requestStartedAt,
          downloadMs: Date.now() - downloadStartedAt,
          sourceKind,
          downloadMode: downloadDetail.mode,
          downloadHost: downloadDetail.host,
          downloadTries: downloadDetail.attempts.length,
          downloadAuth: downloadDetail.auth === true,
          downloadFirstByteMs: downloadDetail.firstByteMs,
          downloadBodyMs: downloadDetail.bodyMs,
          downloadRangeFallback: downloadDetail.attempts.some((item) => item && item.rangeFallback === true),
          b64Retry: built.retryWithoutB64 === true,
          b64RetryMs: Number.isFinite(built.b64RetryMs) ? built.b64RetryMs : undefined,
          status: responseStatus,
        },
      }
    } catch (error) {
      if (downloadController.signal.aborted) {
        throw new StudioError(
          'timeout',
          `${preset.label} 图片已生成，但回传下载超时（${Math.round(DOWNLOAD_TIMEOUT_MS / 1000)} 秒）。`,
          { provider: preset.id },
        )
      }
      throw error
    } finally {
      clearTimeout(downloadTimer)
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* Generation, history, and file serving                               */
/* ------------------------------------------------------------------ */

let activeGenerations = 0
let historyQueue = Promise.resolve()
let errorsQueue = Promise.resolve()

async function appendErrorLog(entry) {
  const next = errorsQueue.then(async () => {
    const current = await readJson(ERRORS_FILE, [])
    const list = Array.isArray(current) ? current : []
    await writeJson(ERRORS_FILE, [entry, ...list].slice(0, ERRORS_LIMIT))
  })
  errorsQueue = next.catch(() => {})
  return next
}

async function readHistory(origin) {
  const items = await readJson(HISTORY_FILE, [])
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string')
    .slice(0, HISTORY_LIMIT)
    .map((item) => ({
      ...item,
      url: browserAssetUrl(item.id, origin),
      filePath: path.join(OUTPUT_DIR, item.id),
    }))
}

async function appendHistory(record) {
  const next = historyQueue.then(async () => {
    const current = await readJson(HISTORY_FILE, [])
    const list = Array.isArray(current) ? current : []
    const updated = [record, ...list.filter((item) => item?.id !== record.id)].slice(0, HISTORY_LIMIT)
    await writeJson(HISTORY_FILE, updated)
  })
  historyQueue = next.catch(() => {})
  return next
}

/**
 * Delete one generated image from history and disk. The id is validated by the
 * route, and the path is built only from a whitelisted id plus OUTPUT_DIR.
 */
async function deleteHistoryItem(id) {
  const next = historyQueue.then(async () => {
    const current = await readJson(HISTORY_FILE, [])
    const list = Array.isArray(current) ? current : []
    const item = list.find((entry) => entry?.id === id)
    if (!item) throw new StudioError('not-found', '图片不存在或已删除。')
    await writeJson(HISTORY_FILE, list.filter((entry) => entry?.id !== id))
    await fs.rm(path.join(OUTPUT_DIR, id), { force: true }).catch(() => {})
    return { id, deleted: true }
  })
  historyQueue = next.catch(() => {})
  return next
}

/**
 * Generate one image for the selected provider, save it, and return its
 * browser-facing URL plus the effective provider/params.
 */
async function generateImage(pluginConfig, input, origin) {
  const configDoc = await readConfigDoc()
  if (configDoc.enabled === false || pluginConfig.enabled === false) {
    throw new StudioError('disabled', '生图工作台已在插件配置中停用。')
  }

  const body = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}
  let providerId
  if (body.provider !== undefined && body.provider !== null && String(body.provider).trim() !== '') {
    providerId = normalizeProviderId(String(body.provider))
    if (providerId === undefined) throw new StudioError('bad-request', `未知的生图服务商：${String(body.provider)}`)
  } else {
    providerId = configDoc.defaultProvider
  }
  const preset = getProvider(providerId)
  if (preset === undefined) throw new StudioError('bad-request', '未知的生图服务商。')
  if (preset.placeholder === true) {
    throw new StudioError('unavailable', `${preset.label} 正在接入中，先选择其他服务商。`, { provider: preset.id })
  }

  const config = providerConfigFor(configDoc, preset)
  const credential = credentialFor(await readCredentialsDoc(), preset)
  if (credential.key === '') {
    throw new StudioError(
      'unconfigured',
      `尚未配置 ${preset.label} 的 API Key。打开「生图工作台」→「配置」→「${preset.label}」填入后再试。`,
      { provider: preset.id },
    )
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt === '') throw new StudioError('bad-request', '请先填写提示词。', { provider: preset.id })
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new StudioError('bad-request', `提示词最多 ${MAX_PROMPT_CHARS} 个字符（当前 ${prompt.length}）。`, { provider: preset.id })
  }

  let built
  try {
    built = buildRequestBody(preset, config, { ...body, prompt })
  } catch (error) {
    throw new StudioError('bad-request', error instanceof Error ? error.message : String(error), { provider: preset.id })
  }

  const timeoutMs = Number.isFinite(pluginConfig.timeoutMs) ? pluginConfig.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxConcurrent = Number.isFinite(pluginConfig.maxConcurrent) ? pluginConfig.maxConcurrent : DEFAULT_MAX_CONCURRENT
  if (activeGenerations >= maxConcurrent) {
    throw new StudioError('busy', `同时生成数量已达上限（${maxConcurrent}），请等当前任务完成。`, { provider: preset.id })
  }

  activeGenerations += 1
  try {
    const startedAt = Date.now()
    const { buffer, mime, timings } = await requestGeneration(preset, config, credential.key, built, timeoutMs)
    const elapsedMs = Date.now() - startedAt
    const id = `img-${Date.now().toString(36)}-${randomUUID().replace(/-/g, '').slice(0, 10)}.${extensionFor(mime)}`
    await fs.mkdir(OUTPUT_DIR, { recursive: true })
    const filePath = path.join(OUTPUT_DIR, id)
    await fs.writeFile(filePath, buffer, { mode: 0o600 })

    const record = {
      id,
      provider: preset.id,
      providerLabel: preset.label,
      prompt,
      model: built.model,
      size: built.size,
      ratio: built.ratio,
      quality: built.quality,
      referenceCount: built.referenceCount || 0,
      outputFormat: typeof built.outputFormat === 'string' ? built.outputFormat : undefined,
      complexity: typeof built.body?.complexity === 'string' ? built.body.complexity : undefined,
      mime,
      bytes: buffer.length,
      elapsedMs,
      postMs: timings && Number.isFinite(timings.postMs) ? timings.postMs : undefined,
      headersMs: timings && Number.isFinite(timings.headersMs) ? timings.headersMs : undefined,
      bodyMs: timings && Number.isFinite(timings.bodyMs) ? timings.bodyMs : undefined,
      preMs: timings && Number.isFinite(timings.requestStartedAt)
        ? Math.max(0, timings.requestStartedAt - startedAt)
        : undefined,
      downloadMs: timings && Number.isFinite(timings.downloadMs) ? timings.downloadMs : undefined,
      sourceKind: timings && typeof timings.sourceKind === 'string' ? timings.sourceKind : undefined,
      downloadMode: timings && typeof timings.downloadMode === 'string' && timings.downloadMode !== ''
        ? timings.downloadMode
        : undefined,
      downloadHost: timings && typeof timings.downloadHost === 'string' && timings.downloadHost !== ''
        ? timings.downloadHost
        : undefined,
      downloadTries: timings && Number.isFinite(timings.downloadTries) ? timings.downloadTries : undefined,
      downloadAuth: timings && typeof timings.downloadAuth === 'boolean' ? timings.downloadAuth : undefined,
      downloadFirstByteMs: timings && Number.isFinite(timings.downloadFirstByteMs)
        ? timings.downloadFirstByteMs
        : undefined,
      downloadBodyMs: timings && Number.isFinite(timings.downloadBodyMs) ? timings.downloadBodyMs : undefined,
      b64Retry: (timings && timings.b64Retry === true) || (built && built.retryWithoutB64 === true) ? true : undefined,
      b64RetryMs: timings && Number.isFinite(timings.b64RetryMs) ? timings.b64RetryMs : undefined,
      createdAt: new Date().toISOString(),
    }
    await appendHistory(record).catch(() => {})
    return {
      ...record,
      url: browserAssetUrl(id, origin),
      filePath,
    }
  } catch (error) {
    await appendErrorLog({
      provider: preset.id,
      model: built.model,
      referenceCount: built.referenceCount || 0,
      code: error && typeof error.code === 'string' ? error.code : 'internal',
      message: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
      createdAt: new Date().toISOString(),
    }).catch(() => {})
    throw error
  } finally {
    activeGenerations -= 1
  }
}

/* ------------------------------------------------------------------ */
/* Generation jobs                                                     */
/*                                                                     */
/* A generation outlives the browser request that started it: the      */
/* client may navigate to another session mid-flight, so the host      */
/* remembers the job and the client resumes it by id from /jobs/<id>.  */
/* ------------------------------------------------------------------ */

const JOBS = new Map()
const JOB_TTL_MS = 30 * 60_000

function pruneJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of JOBS) {
    if (job.finishedAt && job.finishedAt < cutoff) JOBS.delete(id)
  }
}

function publicJob(job, origin) {
  const value = {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    elapsedMs: Math.max(0, (job.finishedAt || Date.now()) - job.startedAt),
    prompt: job.prompt,
    provider: job.provider,
  }
  if (job.status === 'done' && job.result) {
    value.result = { ...job.result, url: browserAssetUrl(job.result.id, origin) }
  }
  if (job.status === 'error') value.error = job.error
  return value
}

function startJob(pluginConfig, body, origin) {
  pruneJobs()
  const id = `job-${Date.now().toString(36)}-${randomUUID().replace(/-/g, '').slice(0, 8)}`
  const job = {
    id,
    status: 'running',
    startedAt: Date.now(),
    prompt: typeof body.prompt === 'string' ? body.prompt.slice(0, 400) : '',
    provider: typeof body.provider === 'string' ? body.provider : '',
  }
  JOBS.set(id, job)
  generateImage(pluginConfig, body, origin)
    .then((result) => {
      job.status = 'done'
      job.result = result
      job.finishedAt = Date.now()
    })
    .catch((error) => {
      job.status = 'error'
      job.error = error && error.code
        ? { code: error.code, message: error.message, provider: error.provider }
        : { code: 'internal', message: error instanceof Error ? error.message : String(error) }
      job.finishedAt = Date.now()
    })
  return publicJob(job, origin)
}

/* ------------------------------------------------------------------ */
/* HTTP routes                                                         */
/* ------------------------------------------------------------------ */

const TRUSTED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function hostnameOf(hostHeader) {
  const trimmed = hostHeader.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(1, end)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/** Lowercase one allowlist entry and drop a port, so example.com:443 matches any port. */
function allowlistName(value) {
  const trimmed = String(value).trim().toLowerCase()
  if (trimmed === '') return ''
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(1, end)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.indexOf(':') === colon ? trimmed.slice(0, colon) : trimmed
}

function trustedHostnames(pluginConfig) {
  const names = new Set(TRUSTED_HOSTNAMES)
  const configured = pluginConfig.allowedHostnames
  const list = Array.isArray(configured)
    ? configured
    : typeof configured === 'string' ? configured.split(',') : []
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    const name = allowlistName(entry)
    if (name !== '') names.add(name)
  }
  return names
}

function isTrustedOrigin(origin, hostnames = TRUSTED_HOSTNAMES) {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && hostnames.has(url.hostname)
  } catch {
    return false
  }
}

/** Loopback-only gate: the original behaviour, still the default. */
function localGateRejection(req, gate) {
  if (req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined) return 403
  if (!isLoopbackRequest(req)) return 403
  const host = req.headers.host
  if (typeof host !== 'string' || host.trim() === '') return undefined
  if (!gate.hostnames.has(hostnameOf(host))) return 403
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.trim() !== '' && !isTrustedOrigin(origin, gate.hostnames)) return 403
  return undefined
}

/**
 * Request gate for one route registration. Remote access is opt-in and, when
 * enabled, delegated to dsh's own connection service (Host/Origin fence plus
 * browser login). Without that service the configured host allowlist is used.
 */
function createRequestGate(ctx, pluginConfig) {
  return {
    allowRemoteAccess: pluginConfig.allowRemoteAccess === true,
    hostnames: trustedHostnames(pluginConfig),
    connection: () => ctx.get('connection'),
  }
}

/** @returns 401/403 when refused, undefined when the route may serve. */
function gateRejection(req, gate) {
  if (gate.allowRemoteAccess) {
    let connection
    try {
      connection = gate.connection()
    } catch {
      connection = undefined
    }
    if (connection && typeof connection.requestRejection === 'function') {
      const rejection = connection.requestRejection(req)
      if (rejection === 401 || rejection === 403) return rejection
      return undefined
    }
  }
  return localGateRejection(req, gate)
}

function writeHttpJson(res, status, value) {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function statusFor(code) {
  switch (code) {
    case 'unconfigured':
    case 'disabled':
      return 409
    case 'bad-request':
      return 422
    case 'not-found':
      return 404
    case 'auth':
      return 401
    case 'quota':
    case 'rate-limit':
    case 'busy':
      return 429
    case 'unavailable':
      return 503
    case 'timeout':
      return 504
    case 'network':
    case 'upstream':
    case 'no-image':
      return 502
    default:
      return 500
  }
}

function toWireError(error) {
  if (error instanceof StudioError) {
    return { code: error.code, message: error.message, ...error.extra }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'internal', message: `生图工作台内部错误：${message}` }
}

async function readJsonBody(req, cap) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > cap) {
      const error = new Error('body too large')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('bad json')
    error.code = 'BAD_JSON'
    throw error
  }
}

async function serveFile(req, res, requestUrl) {
  let rawName
  try {
    rawName = decodeURIComponent(requestUrl.pathname.slice(`${ROUTE_PREFIX}${ENDPOINTS.files}`.length))
  } catch {
    writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '图片不存在。' } })
    return
  }
  if (!/^[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i.test(rawName)) {
    writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '图片不存在。' } })
    return
  }
  const filePath = path.join(OUTPUT_DIR, rawName)
  if (path.dirname(path.resolve(filePath)) !== path.resolve(OUTPUT_DIR)) {
    writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '图片不存在。' } })
    return
  }
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    stat = null
  }
  if (stat === null || !stat.isFile()) {
    writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '图片不存在或已被清理。' } })
    return
  }
  const mime = detectMimeFromName(rawName)
  const disposition = requestUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `${disposition}; filename="${rawName}"`,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

function detectMimeFromName(fileName) {
  if (/\.jpe?g$/i.test(fileName)) return 'image/jpeg'
  if (/\.webp$/i.test(fileName)) return 'image/webp'
  if (/\.gif$/i.test(fileName)) return 'image/gif'
  return 'image/png'
}

/* ------------------------------------------------------------------ */
/* Tiered persistent cache for gallery & prompt libraries              */
/*                                                                     */
/* Layout under $DSH_HOME/image-studio/cache/:                         */
/*   meta/gallery-<lib>.json        SWR + ETag catalog snapshots       */
/*   meta/prompts-canghe.json       SWR + ETag cases snapshot          */
/*   meta/navxd/pages/<sha1>.json   visited page cache + page-1 probe  */
/*   meta/navxd/seen-items.json     rolling local index for search     */
/*   blobs/thumb/<xx>/<sha256>.ext  browsed thumbnails (protected pool)*/
/*   blobs/full/<xx>/<sha256>.ext   opened/imported full images (LRU)  */
/*   index.json                     LRU ledger                         */
/* ------------------------------------------------------------------ */

const CACHE_REVALIDATE_MS = 15 * 60 * 1000
const DEFAULT_CACHE_MAX_BYTES = 250 * 1024 * 1024
const MIN_THUMB_RESERVE_BYTES = 60 * 1024 * 1024
const NAVXD_SEEN_LIMIT = 3000

let cacheLedger = null
let cacheLedgerLoadPromise = null
let cacheFlushTimer = null
let cacheEvictTimer = null
let cacheDirtyCount = 0
const inflightBlobs = new Map()
const inflightMetaRevalidations = new Map()

function cacheMaxBytesOf(pluginConfig) {
  const configuredMb = Number(pluginConfig?.cacheMaxMB)
  if (Number.isFinite(configuredMb) && configuredMb >= 32 && configuredMb <= 4096) {
    return Math.round(configuredMb * 1024 * 1024)
  }
  return DEFAULT_CACHE_MAX_BYTES
}

function sha256Hex(input) {
  return createHash('sha256').update(String(input)).digest('hex')
}

function sha1Hex(input) {
  return createHash('sha1').update(String(input)).digest('hex')
}

function cacheBlobPath(tier, hash, ext) {
  const safeTier = tier === 'thumb' ? 'thumb' : 'full'
  const prefix = hash.slice(0, 2)
  return path.join(CACHE_BLOBS_DIR, safeTier, prefix, `${hash}.${ext}`)
}

async function loadCacheLedger() {
  if (cacheLedger !== null) return cacheLedger
  if (cacheLedgerLoadPromise !== null) return cacheLedgerLoadPromise
  cacheLedgerLoadPromise = (async () => {
    const raw = await readJson(CACHE_INDEX_FILE, null)
    const entries = {}
    let totalBytes = 0
    if (raw && raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) {
      for (const [key, item] of Object.entries(raw.entries)) {
        if (!item || typeof item !== 'object') continue
        const size = Number(item.size)
        const tier = item.tier === 'thumb' ? 'thumb' : 'full'
        const ext = typeof item.ext === 'string' && /^[a-z0-9]{2,5}$/.test(item.ext) ? item.ext : 'bin'
        const mime = typeof item.mime === 'string' && item.mime.startsWith('image/') ? item.mime : 'image/jpeg'
        const at = Number.isFinite(Number(item.at)) ? Number(item.at) : Date.now()
        if (!/^[a-f0-9]{64}$/.test(key) || !Number.isFinite(size) || size <= 0) continue
        entries[key] = { size, tier, ext, mime, at }
        totalBytes += size
      }
    }
    cacheLedger = { version: 1, totalBytes, entries }
    cacheLedgerLoadPromise = null
    return cacheLedger
  })()
  return cacheLedgerLoadPromise
}

function scheduleCacheLedgerFlush(immediate = false) {
  cacheDirtyCount += 1
  if (!immediate && cacheDirtyCount < 20) {
    if (cacheFlushTimer === null) {
      cacheFlushTimer = setTimeout(() => {
        cacheFlushTimer = null
        cacheDirtyCount = 0
        if (cacheLedger) writeJson(CACHE_INDEX_FILE, cacheLedger).catch(() => {})
      }, 15_000)
      if (typeof cacheFlushTimer.unref === 'function') cacheFlushTimer.unref()
    }
    return
  }
  if (cacheFlushTimer !== null) {
    clearTimeout(cacheFlushTimer)
    cacheFlushTimer = null
  }
  cacheDirtyCount = 0
  if (cacheLedger) writeJson(CACHE_INDEX_FILE, cacheLedger).catch(() => {})
}

async function evictCacheIfNeeded(maxBytes) {
  const ledger = await loadCacheLedger()
  if (ledger.totalBytes <= maxBytes) return
  const lowWatermark = Math.floor(maxBytes * 0.85)
  let thumbBytes = 0
  const thumbList = []
  const fullList = []
  for (const [key, entry] of Object.entries(ledger.entries)) {
    if (entry.tier === 'thumb') {
      thumbBytes += entry.size
      thumbList.push([key, entry])
    } else {
      fullList.push([key, entry])
    }
  }
  fullList.sort((a, b) => a[1].at - b[1].at)
  thumbList.sort((a, b) => a[1].at - b[1].at)
  const thumbReserve = Math.min(MIN_THUMB_RESERVE_BYTES, Math.floor(maxBytes * 0.35))
  const removeEntry = async (key, entry) => {
    delete ledger.entries[key]
    ledger.totalBytes = Math.max(0, ledger.totalBytes - entry.size)
    if (entry.tier === 'thumb') thumbBytes = Math.max(0, thumbBytes - entry.size)
    await fs.rm(cacheBlobPath(entry.tier, key, entry.ext), { force: true }).catch(() => {})
  }
  for (const [key, entry] of fullList) {
    if (ledger.totalBytes <= lowWatermark) break
    await removeEntry(key, entry)
  }
  for (const [key, entry] of thumbList) {
    if (ledger.totalBytes <= lowWatermark) break
    if (thumbBytes <= thumbReserve && fullList.length > 0 && ledger.totalBytes <= maxBytes) break
    await removeEntry(key, entry)
  }
  scheduleCacheLedgerFlush(true)
}

function scheduleCacheEviction(maxBytes) {
  if (cacheEvictTimer !== null) return
  cacheEvictTimer = setTimeout(() => {
    cacheEvictTimer = null
    evictCacheIfNeeded(maxBytes).catch(() => {})
  }, 2_500)
  if (typeof cacheEvictTimer.unref === 'function') cacheEvictTimer.unref()
}

async function readCachedBlob(hash) {
  const ledger = await loadCacheLedger()
  const entry = ledger.entries[hash]
  if (!entry) return null
  const filePath = cacheBlobPath(entry.tier, hash, entry.ext)
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size <= 0) throw new Error('missing')
    entry.at = Date.now()
    scheduleCacheLedgerFlush(false)
    return { filePath, size: stat.size, mime: entry.mime, tier: entry.tier, hash }
  } catch {
    ledger.totalBytes = Math.max(0, ledger.totalBytes - entry.size)
    delete ledger.entries[hash]
    scheduleCacheLedgerFlush(false)
    return null
  }
}

async function writeCachedBlob(hash, tier, buffer, mime, maxBytes) {
  const ext = extensionFor(mime)
  const safeTier = tier === 'thumb' ? 'thumb' : 'full'
  const filePath = cacheBlobPath(safeTier, hash, ext)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, buffer, { mode: 0o600 })
  try {
    await fs.rename(tmp, filePath)
  } catch {
    await fs.rm(filePath, { force: true }).catch(() => {})
    await fs.rename(tmp, filePath)
  }
  const ledger = await loadCacheLedger()
  const prev = ledger.entries[hash]
  if (prev) {
    ledger.totalBytes = Math.max(0, ledger.totalBytes - prev.size)
    if (prev.tier !== safeTier || prev.ext !== ext) {
      await fs.rm(cacheBlobPath(prev.tier, hash, prev.ext), { force: true }).catch(() => {})
    }
  }
  ledger.entries[hash] = { size: buffer.length, tier: safeTier, ext, mime, at: Date.now() }
  ledger.totalBytes += buffer.length
  scheduleCacheLedgerFlush(false)
  if (ledger.totalBytes > maxBytes) scheduleCacheEviction(maxBytes)
  return { filePath, size: buffer.length, mime, tier: safeTier, hash }
}

async function getOrFetchCachedBlob({ key, tier, maxBytes, fetchUpstream }) {
  const hash = sha256Hex(key)
  const hit = await readCachedBlob(hash)
  if (hit) return { ...hit, fromCache: true, buffer: null }
  const inflight = inflightBlobs.get(hash)
  if (inflight) return inflight
  const pending = (async () => {
    try {
      const fetched = await fetchUpstream()
      const saved = await writeCachedBlob(hash, tier, fetched.buffer, fetched.mime, maxBytes)
      return { ...saved, fromCache: false, buffer: fetched.buffer }
    } finally {
      inflightBlobs.delete(hash)
    }
  })()
  inflightBlobs.set(hash, pending)
  return pending
}

function respondCachedBlob(req, res, blob) {
  const etag = `"${blob.hash.slice(0, 20)}"`
  const inm = req.headers['if-none-match']
  if (typeof inm === 'string' && inm.includes(etag)) {
    res.writeHead(304, {
      ETag: etag,
      'Cache-Control': 'private, max-age=2592000, immutable',
    })
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': blob.mime,
    'Content-Length': blob.size,
    ETag: etag,
    'Cache-Control': 'private, max-age=2592000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'X-Image-Studio-Cache': blob.fromCache ? 'hit' : 'miss',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  if (blob.buffer) {
    res.end(blob.buffer)
    return
  }
  const stream = createReadStream(blob.filePath)
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(404)
    res.end()
  })
  stream.pipe(res)
}

async function measureDirBytes(dirPath) {
  let total = 0
  let files = 0
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        const sub = await measureDirBytes(full)
        total += sub.bytes
        files += sub.files
      } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
        const st = await fs.stat(full).catch(() => null)
        if (st) {
          total += st.size
          files += 1
        }
      }
    }
  } catch {
    // directory may not exist yet
  }
  return { bytes: total, files }
}

async function getCacheStatus(pluginConfig) {
  const ledger = await loadCacheLedger()
  let thumbBytes = 0
  let fullBytes = 0
  let thumbCount = 0
  let fullCount = 0
  for (const entry of Object.values(ledger.entries)) {
    if (entry.tier === 'thumb') {
      thumbBytes += entry.size
      thumbCount += 1
    } else {
      fullBytes += entry.size
      fullCount += 1
    }
  }
  const meta = await measureDirBytes(CACHE_META_DIR)
  return {
    blobBytes: ledger.totalBytes,
    thumbBytes,
    fullBytes,
    thumbCount,
    fullCount,
    metaBytes: meta.bytes,
    metaFiles: meta.files,
    totalBytes: ledger.totalBytes + meta.bytes,
    maxBytes: cacheMaxBytesOf(pluginConfig),
  }
}

async function clearStudioCache(pluginConfig, scope = 'images') {
  if (cacheFlushTimer !== null) {
    clearTimeout(cacheFlushTimer)
    cacheFlushTimer = null
  }
  if (cacheEvictTimer !== null) {
    clearTimeout(cacheEvictTimer)
    cacheEvictTimer = null
  }
  await fs.rm(CACHE_BLOBS_DIR, { recursive: true, force: true }).catch(() => {})
  await fs.rm(CACHE_INDEX_FILE, { force: true }).catch(() => {})
  cacheLedger = { version: 1, totalBytes: 0, entries: {} }
  cacheDirtyCount = 0
  if (scope === 'all') {
    await fs.rm(CACHE_META_DIR, { recursive: true, force: true }).catch(() => {})
    galleryCatalogCache.clear()
    promptCache.clear()
  }
  return getCacheStatus(pluginConfig)
}


/** Reference galleries published by anhao/ai-pose-gallery-zh (linked, never bundled). */
const GALLERY_LIBRARIES = Object.freeze({
  pose: { path: 'data/pose-zh.json', label: '姿势' },
  costume: { path: 'data/costume-zh.json', label: '服装' },
  portrait: { path: 'data/portrait-zh.json', label: '人像' },
})
const GALLERY_DEFAULT_BASE = 'https://ai-pose-gallery.anhao.app'
const GALLERY_CACHE_MS = 10 * 60 * 1000
const GALLERY_IMAGE_MAX_BYTES = 32 * 1024 * 1024
const galleryCatalogCache = new Map()

function galleryBaseUrl(pluginConfig) {
  const configured = typeof pluginConfig.galleryBaseUrl === 'string' ? pluginConfig.galleryBaseUrl.trim() : ''
  return (configured === '' ? GALLERY_DEFAULT_BASE : configured).replace(/\/+$/, '')
}

/** Accept only relative paths inside the two published image folders. */
function sanitizeGalleryPath(value) {
  const raw = typeof value === 'string' ? value.trim().replace(/^\.?\//, '') : ''
  if (raw === '' || raw.includes('..')) return ''
  if (!/^(thumbs|img)\/[A-Za-z0-9_./-]+$/.test(raw)) return ''
  if (!/\.(png|jpe?g|webp)$/i.test(raw)) return ''
  return raw
}

/** Map one gallery record (Chinese fields) to the shape the picker renders. */
function normalizeGalleryItem(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') return null
  const thumb = sanitizeGalleryPath(raw['缩略图'])
  const full = sanitizeGalleryPath(raw['原图']) || sanitizeGalleryPath(raw['预览图']) || thumb
  if (thumb === '' && full === '') return null
  const title = raw['姿势名称'] || raw['服装名称'] || raw['标题'] || id
  const category = raw['分类'] || raw['分区'] || ''
  const group = raw['体系'] || raw['发长'] || ''
  const tags = Array.isArray(raw['标签'])
    ? raw['标签'].filter((tag) => typeof tag === 'string' && tag.trim() !== '').slice(0, 8)
    : []
  const search = typeof raw['检索'] === 'string' ? raw['检索'] : ''
  const code = typeof raw['姿势编号'] === 'string' ? raw['姿势编号'].trim() : ''
  const angle = typeof raw['角度'] === 'string' ? raw['角度'].trim() : ''
  return {
    id,
    title: String(title),
    category: String(category),
    group: String(group),
    tags,
    search: `${title} ${category} ${group} ${tags.join(' ')} ${search}`.slice(0, 400),
    thumb: thumb || full,
    full: full || thumb,
    code,
    angle,
  }
}

/** One pose has several angles: group them so the picker matches the source site. */
const GALLERY_ANGLE_ORDER = ['正面', '斜前', '侧面', '斜后', '背面', '俯视', '仰视']

function groupPoseVariants(items) {
  const groups = new Map()
  for (const item of items) {
    const key = `${item.group}|${item.code === '' ? item.id : item.code}`
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        id: key,
        title: item.title,
        category: item.category,
        group: item.group,
        code: item.code,
        tags: item.tags,
        search: item.search,
        thumb: item.thumb,
        full: item.full,
        variants: [],
      }
      groups.set(key, group)
    }
    group.variants.push({ id: item.id, angle: item.angle, thumb: item.thumb, full: item.full })
  }
  return [...groups.values()].map((group) => {
    group.variants.sort((left, right) => {
      const a = GALLERY_ANGLE_ORDER.indexOf(left.angle)
      const b = GALLERY_ANGLE_ORDER.indexOf(right.angle)
      return (a === -1 ? 99 : a) - (b === -1 ? 99 : b)
    })
    group.thumb = group.variants[0].thumb
    group.full = group.variants[0].full
    return group
  })
}

function galleryMetaFile(baseUrl, library) {
  const suffix = baseUrl === GALLERY_DEFAULT_BASE ? library : `${library}-${sha1Hex(baseUrl).slice(0, 10)}`
  return path.join(CACHE_META_DIR, `gallery-${suffix}.json`)
}

async function fetchGalleryUpstream(pluginConfig, library, prevDoc = null) {
  const entry = GALLERY_LIBRARIES[library]
  const baseUrl = galleryBaseUrl(pluginConfig)
  const url = `${baseUrl}/${entry.path}`
  const metaFile = galleryMetaFile(baseUrl, library)
  const cacheKey = `${baseUrl}|${library}`
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const headers = { Accept: 'application/json', 'User-Agent': 'dsh-image-studio' }
      if (prevDoc && typeof prevDoc.etag === 'string' && prevDoc.etag !== '') {
        headers['If-None-Match'] = prevDoc.etag
      } else if (prevDoc && typeof prevDoc.lastModified === 'string' && prevDoc.lastModified !== '') {
        headers['If-Modified-Since'] = prevDoc.lastModified
      }
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) })
      if (response.status === 304 && prevDoc && Array.isArray(prevDoc.items) && prevDoc.items.length > 0) {
        const nextDoc = { ...prevDoc, checkedAt: Date.now() }
        galleryCatalogCache.set(cacheKey, nextDoc)
        await writeJson(metaFile, nextDoc).catch(() => {})
        return nextDoc
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.items) ? payload.items : [])
      const items = list.map(normalizeGalleryItem).filter((item) => item !== null)
      if (items.length === 0) throw new StudioError('upstream', '图库索引为空或格式已变化。')
      const now = Date.now()
      const nextDoc = {
        version: 1,
        library,
        baseUrl,
        etag: response.headers.get('etag') || '',
        lastModified: response.headers.get('last-modified') || '',
        updatedAt: now,
        checkedAt: now,
        items,
      }
      galleryCatalogCache.set(cacheKey, nextDoc)
      await writeJson(metaFile, nextDoc).catch(() => {})
      return nextDoc
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
  throw new StudioError('network', `读取图库失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function triggerMetaRevalidation(inflightKey, runner) {
  if (inflightMetaRevalidations.has(inflightKey)) return inflightMetaRevalidations.get(inflightKey)
  const job = Promise.resolve()
    .then(runner)
    .catch(() => null)
    .finally(() => inflightMetaRevalidations.delete(inflightKey))
  inflightMetaRevalidations.set(inflightKey, job)
  return job
}

async function readGalleryCatalog(pluginConfig, library, forceRefresh = false) {
  const entry = GALLERY_LIBRARIES[library]
  if (entry === undefined) throw new StudioError('bad-request', `未知的图库：${library}`)
  const baseUrl = galleryBaseUrl(pluginConfig)
  const cacheKey = `${baseUrl}|${library}`
  const metaFile = galleryMetaFile(baseUrl, library)
  let doc = galleryCatalogCache.get(cacheKey)
  if (!doc) {
    const disk = await readJson(metaFile, null)
    if (disk && Array.isArray(disk.items) && disk.items.length > 0) {
      doc = disk
      galleryCatalogCache.set(cacheKey, doc)
    }
  }
  if (forceRefresh) {
    try {
      const fresh = await fetchGalleryUpstream(pluginConfig, library, doc || null)
      return { items: fresh.items, cached: false, updatedAt: fresh.updatedAt }
    } catch (error) {
      if (doc && Array.isArray(doc.items) && doc.items.length > 0) {
        return { items: doc.items, cached: true, stale: true, updatedAt: doc.updatedAt }
      }
      throw error
    }
  }
  if (doc && Array.isArray(doc.items) && doc.items.length > 0) {
    const age = Date.now() - (Number(doc.checkedAt) || Number(doc.updatedAt) || 0)
    if (age >= CACHE_REVALIDATE_MS) {
      triggerMetaRevalidation(`gallery:${cacheKey}`, () => fetchGalleryUpstream(pluginConfig, library, doc))
    }
    return { items: doc.items, cached: true, updatedAt: doc.updatedAt }
  }
  const fresh = await fetchGalleryUpstream(pluginConfig, library, null)
  return { items: fresh.items, cached: false, updatedAt: fresh.updatedAt }
}


/** Prompt galleries. Only public indexes are read at runtime; nothing is bundled. */
const PROMPT_SOURCES = Object.freeze({
  navxd: {
    label: 'NavXD 提示词库',
    home: 'https://navxd.com/prompt-template-library?cat=image',
    styles: [
      ['', '全部'], ['cinematic', '电影感'], ['portrait', '肖像'], ['poster', '海报'],
      ['photography', '摄影'], ['fashion', '时尚摄影'], ['minimal', '极简主义'], ['guofeng', '国风'],
      ['cyberpunk', '赛博朋克'], ['cg3d', '3D 渲染'], ['illustration', '插画'], ['anime', '二次元'],
      ['product', '产品图'], ['handdrawn', '手绘'], ['retro', '复古'], ['flat', '扁平'], ['surreal', '超现实'],
    ],
    types: [['', '全部'], ['t2i', '文生图'], ['i2i', '图生图']],
    models: [
      ['', '全部'], ['gpt-image-2', 'GPT Image 2'], ['gpt-image-2-5', 'GPT Image 2.5'],
      ['midjourney', 'Midjourney'], ['nano-banana-pro', 'Nano Banana Pro'], ['seedream-4-5', 'Seedream 4.5'],
    ],
  },
  canghe: {
    label: 'GPT-Image2 Gallery',
    home: 'https://gpt-image2.canghe.ai/#gallery',
    styles: [],
    types: [],
    models: [],
    categories: [],
  },
  upma: {
    label: 'UPMA Prompt Atlas',
    home: 'https://www.upma.cn/image-prompts',
    styles: [],
    types: [],
    models: [],
    categories: [],
    scenes: [],
  },
})
const PROMPT_CACHE_MS = 10 * 60 * 1000
const promptCache = new Map()
const UPMA_META_FILE = path.join(CACHE_META_DIR, 'prompts-upma.json')
const UPMA_CACHE_MS = 15 * 60 * 1000

/* ------------------------------------------------------------------ */
/* Offline resource packs                                             */
/*                                                                    */
/* Users who scrape a prompt/gallery site can drop a manifest here.    */
/* A pack only stores an index; image files stay in the user's folder. */
/* ------------------------------------------------------------------ */

function offlineDirOf(kind) {
  return kind === 'gallery' ? OFFLINE_GALLERY_DIR : OFFLINE_PROMPTS_DIR
}

function normalizeOfflineKind(value) {
  return value === 'gallery' ? 'gallery' : value === 'prompts' || value === 'prompt' ? 'prompts' : null
}

function sanitizePackId(value) {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return id
}

function offlinePackFile(kind, id) {
  const safe = sanitizePackId(id)
  if (safe === '') return ''
  return path.join(offlineDirOf(kind), `${safe}.json`)
}

function cleanOfflineAssetRef(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^offline:\/\/[^/]+\//, '')
}

/**
 * Resolve a manifest image path inside the pack root. Absolute paths are allowed
 * only when they still live under the root, so a pack cannot read arbitrary disks.
 */
function resolveOfflineAsset(baseDir, value) {
  const raw = cleanOfflineAssetRef(value)
  if (raw === '' || raw.includes('\0')) return null
  const root = path.resolve(String(baseDir ?? ''))
  if (root === '') return null
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  if (!/\.(png|jpe?g|webp|gif)$/i.test(resolved)) return null
  return {
    absolute: resolved,
    relative: path.relative(root, resolved).split(path.sep).join('/'),
  }
}

function offlineItemImageRef(packId, relative) {
  return `offline://${packId}/${relative}`
}

function parseOfflineRef(value) {
  const raw = String(value ?? '')
  const match = /^offline:\/\/([a-z0-9_-]+)\/(.+)$/i.exec(raw)
  if (match === null) return null
  const relative = match[2].replace(/\\/g, '/')
  if (relative === '' || relative.includes('..') || relative.startsWith('/')) return null
  if (!/\.(png|jpe?g|webp|gif)$/i.test(relative)) return null
  return { packId: match[1], relative }
}

function stringList(value, limit = 24) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry !== '')
    .slice(0, limit)
}

function normalizeOfflinePromptItem(raw, doc) {
  if (raw === null || typeof raw !== 'object') return null
  const id = String(raw.id ?? raw.key ?? '').trim()
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  if (id === '' || prompt === '') return null
  const asset = resolveOfflineAsset(doc.baseDir, raw.image ?? raw.imageUrl ?? raw['图片'] ?? raw['图片地址'])
  if (asset === null) return null
  const category = String(raw.category ?? raw['分类'] ?? '')
  const styles = stringList(raw.styles ?? raw['风格'])
  const scenes = stringList(raw.scenes ?? raw['场景'])
  return {
    id,
    title: String(raw.title ?? raw.name ?? raw['标题'] ?? raw.imageAlt ?? id),
    description: String(raw.description ?? raw.promptPreview ?? raw['描述'] ?? category),
    prompt,
    image: offlineItemImageRef(doc.id, asset.relative),
    pageUrl: String(raw.pageUrl ?? raw.sourceUrl ?? raw['原页'] ?? doc.home ?? ''),
    category,
    styles,
    scenes,
  }
}

function normalizeOfflineGalleryItem(raw, doc) {
  if (raw === null || typeof raw !== 'object') return null
  const id = String(raw.id ?? raw.key ?? raw['姿势编号'] ?? '').trim()
  if (id === '') return null
  const thumbAsset = resolveOfflineAsset(doc.baseDir, raw.thumb ?? raw['缩略图'] ?? raw['预览图'] ?? raw.preview)
  const fullAsset = resolveOfflineAsset(doc.baseDir, raw.full ?? raw['原图'] ?? raw['预览图'] ?? raw.preview ?? raw.thumb ?? raw['缩略图'])
  if (thumbAsset === null && fullAsset === null) return null
  const thumb = thumbAsset || fullAsset
  const full = fullAsset || thumbAsset
  const title = String(raw.title ?? raw.name ?? raw['姿势名称'] ?? raw['服装名称'] ?? raw['标题'] ?? id)
  const category = String(raw.category ?? raw['分类'] ?? raw['分区'] ?? '')
  const group = String(raw.group ?? raw['体系'] ?? raw['发长'] ?? '')
  const tags = stringList(raw.tags ?? raw['标签'], 12)
  const search = String(raw.search ?? raw['检索'] ?? `${title} ${category} ${group} ${tags.join(' ')}`).slice(0, 400)
  return {
    id,
    title,
    category,
    group,
    tags,
    search,
    thumb: offlineItemImageRef(doc.id, thumb.relative),
    full: offlineItemImageRef(doc.id, full.relative),
    code: String(raw.code ?? raw['姿势编号'] ?? ''),
    angle: String(raw.angle ?? raw['角度'] ?? ''),
  }
}

async function readOfflinePackRaw(kind, id) {
  const file = offlinePackFile(kind, id)
  if (file === '') return null
  const doc = await readJson(file, null)
  if (doc === null || typeof doc !== 'object' || !Array.isArray(doc.items)) return null
  return doc
}

async function listOfflinePacks(kind) {
  const dir = offlineDirOf(kind)
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const packs = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const doc = await readJson(path.join(dir, name), null)
    if (doc === null || typeof doc !== 'object' || !Array.isArray(doc.items)) continue
    packs.push({
      id: String(doc.id ?? name.slice(0, -5)),
      kind,
      label: String(doc.label ?? doc.id ?? name.slice(0, -5)),
      home: String(doc.home ?? ''),
      itemCount: doc.items.length,
      updatedAt: Number(doc.updatedAt) || 0,
    })
  }
  return packs.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

function offlineFilterOptions(items, field) {
  const values = new Map()
  for (const item of items) {
    const list = field === 'styles' ? item.styles : field === 'scenes' ? item.scenes : [item[field]]
    for (const value of Array.isArray(list) ? list : []) {
      const text = String(value ?? '').trim()
      if (text !== '') values.set(text, text)
    }
  }
  return [['', '全部'], ...[...values.keys()].map((value) => [value, value])]
}

async function readOfflinePromptCatalog(packId, params) {
  const doc = await readOfflinePackRaw('prompts', packId)
  if (doc === null) throw new StudioError('not-found', '离线提示词包不存在。')
  const query = String(params.q ?? '').trim().toLowerCase()
  const category = String(params.category ?? '')
  const style = String(params.style ?? '')
  const scene = String(params.scene ?? '')
  const filtered = doc.items.filter((item) => {
    if (category !== '' && item.category !== category) return false
    if (style !== '' && !(Array.isArray(item.styles) && item.styles.includes(style))) return false
    if (scene !== '' && !(Array.isArray(item.scenes) && item.scenes.includes(scene))) return false
    if (query !== '') {
      const haystack = `${item.title} ${item.description} ${item.prompt} ${item.category}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
  const page = Math.max(1, Number(params.page) || 1)
  const pageSize = 24
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    page,
    totalPages,
    total: filtered.length,
    cached: true,
    updatedAt: Number(doc.updatedAt) || 0,
    filters: {
      styles: offlineFilterOptions(doc.items, 'styles'),
      types: [],
      models: [],
      categories: offlineFilterOptions(doc.items, 'category'),
      scenes: offlineFilterOptions(doc.items, 'scenes'),
    },
  }
}

async function readOfflineGalleryCatalog(packId) {
  const doc = await readOfflinePackRaw('gallery', packId)
  if (doc === null) throw new StudioError('not-found', '离线图库包不存在。')
  return {
    items: doc.items,
    cached: true,
    updatedAt: Number(doc.updatedAt) || 0,
  }
}

async function listOfflinePromptSources() {
  const packs = await listOfflinePacks('prompts')
  const sources = []
  for (const pack of packs) {
    const doc = await readOfflinePackRaw('prompts', pack.id)
    sources.push({
      id: `offline:${pack.id}`,
      label: `离线 · ${pack.label}`,
      home: pack.home,
      offline: true,
      packId: pack.id,
      itemCount: pack.itemCount,
      filters: {
        styles: offlineFilterOptions(doc ? doc.items : [], 'styles'),
        types: [],
        models: [],
        categories: offlineFilterOptions(doc ? doc.items : [], 'category'),
        scenes: offlineFilterOptions(doc ? doc.items : [], 'scenes'),
      },
    })
  }
  return sources
}

async function listGalleryLibraries() {
  const libraries = Object.entries(GALLERY_LIBRARIES).map(([id, entry]) => ({
    id,
    label: entry.label,
    offline: false,
    itemCount: null,
  }))
  for (const pack of await listOfflinePacks('gallery')) {
    libraries.push({
      id: `offline:${pack.id}`,
      label: `离线 · ${pack.label}`,
      offline: true,
      packId: pack.id,
      itemCount: pack.itemCount,
    })
  }
  return libraries
}

async function importOfflinePack(input) {
  const body = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const kind = normalizeOfflineKind(body.kind)
  if (kind === null) throw new StudioError('bad-request', '导入类型必须是 prompts 或 gallery。')
  let manifest = body.manifest
  let baseDir = typeof body.baseDir === 'string' && body.baseDir.trim() !== '' ? path.resolve(body.baseDir.trim()) : ''
  const manifestPath = typeof body.manifestPath === 'string' ? body.manifestPath.trim() : ''
  if (manifest === undefined && manifestPath !== '') {
    let target = path.resolve(manifestPath)
    let stat = await fs.stat(target).catch(() => null)
    if (stat && stat.isDirectory()) {
      const candidates = ['manifest.json', 'index.json', 'pack.json']
      let found = ''
      for (const name of candidates) {
        const candidate = path.join(target, name)
        if (await fs.stat(candidate).then((item) => item.isFile()).catch(() => false)) {
          found = candidate
          break
        }
      }
      if (found === '') throw new StudioError('bad-request', '这个目录里没有 manifest.json / index.json / pack.json。')
      target = found
      stat = await fs.stat(target).catch(() => null)
    }
    if (!stat || !stat.isFile()) throw new StudioError('bad-request', `找不到离线资源清单：${target}`)
    if (stat.size > OFFLINE_PACK_MAX_BYTES) throw new StudioError('bad-request', '离线资源清单超过 64MB。')
    try {
      manifest = JSON.parse(await fs.readFile(target, 'utf8'))
    } catch {
      throw new StudioError('bad-request', '离线资源清单不是有效 JSON。')
    }
    if (baseDir === '') baseDir = path.dirname(target)
  }
  if (manifest === undefined && Array.isArray(body.items)) manifest = body
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new StudioError('bad-request', '缺少 manifest 或 manifestPath。')
  }
  if (baseDir === '') {
    baseDir = process.cwd()
    if (body.baseDir === undefined) {
      throw new StudioError('bad-request', '直接提交 manifest 时需要 baseDir，用于解析图片相对路径。')
    }
  }
  const items = Array.isArray(manifest.items) ? manifest.items : []
  if (items.length === 0) throw new StudioError('bad-request', '清单里没有 items。')
  if (items.length > OFFLINE_PACK_MAX_ITEMS) throw new StudioError('bad-request', `单个离线包最多 ${OFFLINE_PACK_MAX_ITEMS} 条。`)
  const id = sanitizePackId(manifest.id ?? manifest.packId ?? manifest.name ?? manifest.label)
  if (id === '') throw new StudioError('bad-request', '清单缺少合法的 id（只允许字母、数字、-、_）。')
  const doc = {
    version: 1,
    kind,
    id,
    label: String(manifest.label ?? manifest.name ?? id),
    home: String(manifest.home ?? ''),
    baseDir,
    updatedAt: Date.now(),
    items: [],
  }
  const seen = new Set()
  for (const raw of items) {
    const item = kind === 'prompts'
      ? normalizeOfflinePromptItem(raw, doc)
      : normalizeOfflineGalleryItem(raw, doc)
    if (item === null || seen.has(item.id)) continue
    seen.add(item.id)
    doc.items.push(item)
  }
  if (doc.items.length === 0) {
    throw new StudioError('bad-request', '没有可用的条目；请检查 id、prompt 和图片路径是否都在 baseDir 内。')
  }
  await fs.mkdir(offlineDirOf(kind), { recursive: true })
  await writeJson(offlinePackFile(kind, id), doc)
  return {
    pack: {
      id,
      kind,
      label: doc.label,
      home: doc.home,
      itemCount: doc.items.length,
      skipped: items.length - doc.items.length,
      updatedAt: doc.updatedAt,
    },
  }
}

async function removeOfflinePack(kind, id) {
  const file = offlinePackFile(kind, id)
  if (file === '') throw new StudioError('bad-request', '离线包 id 不合法。')
  const existed = await fs.stat(file).then((stat) => stat.isFile()).catch(() => false)
  if (!existed) throw new StudioError('not-found', '离线包不存在。')
  await fs.rm(file, { force: true })
  return { removed: true, id: sanitizePackId(id) }
}

/** Read a local offline image into the same shape getOrFetchCachedBlob expects. */
async function readOfflineAssetBuffer(kind, packId, relative) {
  const doc = await readOfflinePackRaw(kind, packId)
  if (doc === null) throw new StudioError('not-found', '离线资源包不存在。')
  const allowed = doc.items.some((item) => {
    if (kind === 'prompts') return item.image === offlineItemImageRef(doc.id, relative)
    return item.thumb === offlineItemImageRef(doc.id, relative) || item.full === offlineItemImageRef(doc.id, relative)
  })
  if (!allowed) throw new StudioError('not-found', '离线图片不存在。')
  const asset = resolveOfflineAsset(doc.baseDir, relative)
  if (asset === null) throw new StudioError('not-found', '离线图片路径不合法。')
  const stat = await fs.stat(asset.absolute).catch(() => null)
  if (!stat || !stat.isFile()) throw new StudioError('not-found', '离线图片文件已丢失。')
  if (stat.size > OFFLINE_IMAGE_MAX_BYTES) throw new StudioError('bad-request', '离线图片超过 32MB。')
  const buffer = await fs.readFile(asset.absolute)
  return { buffer, mime: detectMime(buffer, detectMimeFromName(asset.absolute)) }
}

/* ------------------------------------------------------------------ */
/* UPMA prompt atlas (Next.js RSC payload)                            */
/* ------------------------------------------------------------------ */

function upmaFlightText(html) {
  const parts = []
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let match
  while ((match = re.exec(html)) !== null) {
    try {
      parts.push(JSON.parse(match[1]))
    } catch {
      // Skip a malformed chunk; the page usually has enough remaining payload.
    }
  }
  return parts.join('')
}

function sliceJsonArray(text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function resolveUpmaChunk(flight, value) {
  if (typeof value !== 'string' || !/^\$[0-9a-f]+$/i.test(value)) return value
  const id = value.slice(1)
  const needle = `${id}:T`
  let at = flight.indexOf(needle)
  while (at !== -1) {
    const comma = flight.indexOf(',', at + needle.length)
    if (comma !== -1) {
      const hex = flight.slice(at + needle.length, comma)
      if (/^[0-9a-f]+$/i.test(hex)) {
        const length = Number.parseInt(hex, 16)
        if (Number.isFinite(length) && length > 0 && comma + 1 + length <= flight.length) {
          return flight.slice(comma + 1, comma + 1 + length)
        }
      }
    }
    at = flight.indexOf(needle, at + 1)
  }
  return value
}

function parseUpmaCases(html) {
  const flight = upmaFlightText(html)
  const marker = '"cases":'
  const markerAt = flight.indexOf(marker)
  if (markerAt === -1) throw new StudioError('upstream', 'UPMA 页面结构已变化：找不到 cases 数据。')
  let start = markerAt + marker.length
  while (start < flight.length && /\s/.test(flight[start])) start += 1
  if (flight[start] !== '[') throw new StudioError('upstream', 'UPMA 页面结构已变化：cases 不是数组。')
  const arrayText = sliceJsonArray(flight, start)
  if (arrayText === null) throw new StudioError('upstream', 'UPMA 页面结构已变化：cases 数组不完整。')
  let rawCases
  try {
    rawCases = JSON.parse(arrayText)
  } catch {
    throw new StudioError('upstream', 'UPMA 页面数据解析失败。')
  }
  if (!Array.isArray(rawCases)) throw new StudioError('upstream', 'UPMA 页面数据格式不正确。')
  const items = []
  for (const raw of rawCases) {
    if (raw === null || typeof raw !== 'object') continue
    const id = Number(raw.id)
    if (!Number.isFinite(id)) continue
    const prompt = String(resolveUpmaChunk(flight, raw.prompt) ?? raw.promptPreview ?? '').trim()
    if (prompt === '') continue
    const imagePath = typeof raw.image === 'string' ? raw.image.trim() : ''
    let image = ''
    if (imagePath !== '') {
      try {
        image = /^https?:\/\//i.test(imagePath)
          ? imagePath
          : new URL(`.${imagePath.startsWith('/') ? imagePath : `/${imagePath}`}`, 'https://assets.upma.cn/website-assets/image-prompts/').href
      } catch {
        image = ''
      }
    }
    if (image === '') continue
    items.push({
      id: String(id),
      title: String(raw.title ?? raw.imageAlt ?? `UPMA #${id}`),
      description: String(raw.promptPreview ?? raw.category ?? ''),
      prompt,
      image,
      pageUrl: String(raw.sourceUrl ?? 'https://www.upma.cn/image-prompts'),
      category: String(raw.category ?? ''),
      styles: stringList(raw.styles),
      scenes: stringList(raw.scenes),
    })
  }
  return items
}

function applyUpmaFilters(items) {
  const collect = (field) => {
    const values = new Set()
    for (const item of items) {
      const list = field === 'styles' ? item.styles : field === 'scenes' ? item.scenes : [item[field]]
      for (const value of Array.isArray(list) ? list : []) {
        const text = String(value ?? '').trim()
        if (text !== '') values.add(text)
      }
    }
    return [['', '全部'], ...[...values].sort((left, right) => left.localeCompare(right, 'zh-CN')).map((value) => [value, value])]
  }
  PROMPT_SOURCES.upma.styles = collect('styles')
  PROMPT_SOURCES.upma.categories = collect('category')
  PROMPT_SOURCES.upma.scenes = collect('scenes')
}

async function fetchUpmaUpstream(prevDoc = null) {
  const headers = {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': 'Mozilla/5.0 (compatible; dsh-image-studio)',
  }
  if (prevDoc && typeof prevDoc.etag === 'string' && prevDoc.etag !== '') headers['If-None-Match'] = prevDoc.etag
  let response
  try {
    response = await fetch('https://www.upma.cn/image-prompts', { headers, signal: AbortSignal.timeout(45_000) })
  } catch (error) {
    throw new StudioError('network', `读取 UPMA 提示词库失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (response.status === 304 && prevDoc && Array.isArray(prevDoc.items) && prevDoc.items.length > 0) {
    const next = { ...prevDoc, checkedAt: Date.now() }
    promptCache.set('upma', next)
    await writeJson(UPMA_META_FILE, next).catch(() => {})
    applyUpmaFilters(next.items)
    return next
  }
  if (!response.ok) throw new StudioError('network', `读取 UPMA 提示词库失败：HTTP ${response.status}`)
  const html = await response.text()
  const items = parseUpmaCases(html)
  if (items.length === 0) throw new StudioError('upstream', 'UPMA 提示词库为空或页面结构已变化。')
  const now = Date.now()
  const nextDoc = {
    version: 1,
    etag: response.headers.get('etag') || '',
    lastModified: response.headers.get('last-modified') || '',
    updatedAt: now,
    checkedAt: now,
    items,
  }
  promptCache.set('upma', nextDoc)
  await writeJson(UPMA_META_FILE, nextDoc).catch(() => {})
  applyUpmaFilters(items)
  return nextDoc
}

async function readUpmaPrompts(params) {
  const forceRefresh = params.refresh === '1' || params.refresh === 'true'
  let doc = promptCache.get('upma')
  if (!doc) {
    const disk = await readJson(UPMA_META_FILE, null)
    if (disk && Array.isArray(disk.items) && disk.items.length > 0) {
      doc = disk
      promptCache.set('upma', doc)
    }
  }
  let cached = false
  if (forceRefresh) {
    try {
      doc = await fetchUpmaUpstream(doc || null)
    } catch (error) {
      if (!doc) throw error
      cached = true
    }
  } else if (doc && Array.isArray(doc.items) && doc.items.length > 0) {
    cached = true
    const age = Date.now() - (Number(doc.checkedAt) || Number(doc.updatedAt) || 0)
    if (age >= UPMA_CACHE_MS) triggerMetaRevalidation('prompts:upma', () => fetchUpmaUpstream(doc))
  } else {
    doc = await fetchUpmaUpstream(null)
  }
  applyUpmaFilters(doc.items)
  const query = String(params.q ?? '').trim().toLowerCase()
  const category = String(params.category ?? '')
  const style = String(params.style ?? '')
  const scene = String(params.scene ?? '')
  const filtered = doc.items.filter((item) => {
    if (category !== '' && item.category !== category) return false
    if (style !== '' && !(Array.isArray(item.styles) && item.styles.includes(style))) return false
    if (scene !== '' && !(Array.isArray(item.scenes) && item.scenes.includes(scene))) return false
    if (query !== '') {
      const haystack = `${item.title} ${item.description} ${item.prompt} ${item.category}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
  const page = Math.max(1, Number(params.page) || 1)
  const pageSize = 24
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    page,
    totalPages,
    total: filtered.length,
    cached,
    updatedAt: doc.updatedAt,
  }
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse one navxd listing page (WordPress HTML) into prompt cards. */
function parseNavxdPage(html) {
  const items = []
  const cardRe = /<article class="plg-card">([\s\S]*?)<\/article>/g
  let match
  while ((match = cardRe.exec(html)) !== null) {
    const block = match[1]
    const image = /<img[^>]+src="([^"]+)"/.exec(block)
    const title = /class="plg-vtitle">([\s\S]*?)<\/div>/.exec(block)
    const desc = /class="plg-vdesc">([\s\S]*?)<\/p>/.exec(block)
    const prompt = /data-prompt="([\s\S]*?)"/.exec(block)
    const link = /<a[^>]*class="[^"]*\bplg-imglink\b[^"]*"[^>]*href="([^"]+)"/.exec(block)
    if (prompt === null || image === null) continue
    const href = link === null ? '' : link[1]
    const id = /\/prompt\/([A-Za-z0-9-]+)$/.exec(href)
    items.push({
      id: id === null ? (href || image[1]) : id[1],
      title: title === null ? '' : decodeHtml(title[1]),
      description: desc === null ? '' : decodeHtml(desc[1]),
      prompt: decodeHtml(prompt[1]),
      image: new URL(image[1], 'https://navxd.com').href,
      pageUrl: href,
    })
  }
  const pages = [...html.matchAll(/pg=(\d+)/g)].map((entry) => Number(entry[1])).filter(Number.isFinite)
  return { items, totalPages: pages.length === 0 ? 1 : Math.max(...pages) }
}

function promptImageAllowed(source, url) {
  if (source.startsWith('offline:')) {
    const ref = parseOfflineRef(url)
    return ref !== null && `offline:${ref.packId}` === source
  }
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (source === 'navxd') {
    return /(^|\.)navxd\.com$/.test(parsed.hostname) && parsed.pathname.startsWith('/wp-content/uploads/')
  }
  if (source === 'upma') {
    return (parsed.hostname === 'upma.cn' || parsed.hostname.endsWith('.upma.cn')) && parsed.pathname.startsWith('/website-assets/image-prompts/')
  }
  if (source === 'canghe') {
    return /(^|\.)canghe\.ai$/.test(parsed.hostname) && parsed.pathname.startsWith('/images/')
  }
  return false
}

const NAVXD_META_DIR = path.join(CACHE_META_DIR, 'navxd')
const NAVXD_PAGES_DIR = path.join(NAVXD_META_DIR, 'pages')
const NAVXD_SEEN_FILE = path.join(NAVXD_META_DIR, 'seen-items.json')
let navxdSeenItemsCache = null

async function loadNavxdSeenItems() {
  if (navxdSeenItemsCache !== null) return navxdSeenItemsCache
  const raw = await readJson(NAVXD_SEEN_FILE, null)
  navxdSeenItemsCache = Array.isArray(raw?.items) ? raw.items : []
  return navxdSeenItemsCache
}

async function mergeNavxdSeenItems(newItems) {
  if (!Array.isArray(newItems) || newItems.length === 0) return
  const current = await loadNavxdSeenItems()
  const byId = new Map()
  for (const item of newItems) {
    if (item && typeof item.id === 'string' && item.id !== '') byId.set(item.id, item)
  }
  for (const item of current) {
    if (item && typeof item.id === 'string' && item.id !== '' && !byId.has(item.id)) {
      byId.set(item.id, item)
    }
    if (byId.size >= NAVXD_SEEN_LIMIT) break
  }
  const merged = [...byId.values()].slice(0, NAVXD_SEEN_LIMIT)
  navxdSeenItemsCache = merged
  await writeJson(NAVXD_SEEN_FILE, { version: 1, updatedAt: Date.now(), items: merged }).catch(() => {})
}

function navxdPageMetaFile(filterKey, page) {
  return path.join(NAVXD_PAGES_DIR, `${sha1Hex(`${filterKey}|pg=${page}`)}.json`)
}

async function invalidateNavxdFilterPages(filterKey, keepPage1Doc = null) {
  for (const key of promptCache.keys()) {
    if (key.startsWith(`navxd:${filterKey}|`)) promptCache.delete(key)
  }
  try {
    const files = await fs.readdir(NAVXD_PAGES_DIR)
    await Promise.all(files.map(async (name) => {
      if (!name.endsWith('.json')) return
      const full = path.join(NAVXD_PAGES_DIR, name)
      const doc = await readJson(full, null)
      if (doc && doc.filterKey === filterKey && doc.page !== 1) {
        await fs.rm(full, { force: true }).catch(() => {})
      }
    }))
  } catch {
    // ignore missing dir
  }
  if (keepPage1Doc) {
    promptCache.set(`navxd:${filterKey}|1`, keepPage1Doc)
    await writeJson(navxdPageMetaFile(filterKey, 1), keepPage1Doc).catch(() => {})
  }
}

async function fetchNavxdPageUpstream(url, filterKey, page, prevPage1Ids = null) {
  let html = ''
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dsh-image-studio)', Accept: 'text/html' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    html = await response.text()
  } catch (error) {
    throw new StudioError('network', `读取提示词库失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = parseNavxdPage(html)
  const now = Date.now()
  const doc = {
    version: 1,
    filterKey,
    page,
    url,
    updatedAt: now,
    checkedAt: now,
    totalPages: parsed.totalPages,
    items: parsed.items,
  }
  promptCache.set(`navxd:${filterKey}|${page}`, doc)
  await writeJson(navxdPageMetaFile(filterKey, page), doc).catch(() => {})
  await mergeNavxdSeenItems(parsed.items)
  if (page === 1 && Array.isArray(prevPage1Ids) && prevPage1Ids.length > 0) {
    const nextIds = parsed.items.map((item) => item.id).join('|')
    if (nextIds !== prevPage1Ids.join('|')) {
      await invalidateNavxdFilterPages(filterKey, doc)
    }
  }
  return doc
}

/** Read one navxd page (style/type/model are navxd's own filters) with persistent incremental cache. */
async function readNavxdPrompts(params) {
  const page = Math.max(1, Math.min(300, Number(params.page) || 1))
  const model = PROMPT_SOURCES.navxd.models.some(([id]) => id === params.model) ? params.model : ''
  const style = PROMPT_SOURCES.navxd.styles.some(([id]) => id === params.style) ? params.style : ''
  const type = PROMPT_SOURCES.navxd.types.some(([id]) => id === params.type) ? params.type : ''
  const query = String(params.q ?? '').trim().toLowerCase()
  const forceRefresh = params.refresh === '1' || params.refresh === 'true'
  const urlPath = model === '' ? '/prompt-template-library' : `/prompt-template-library/${model}`
  const search = new URLSearchParams({ cat: 'image', pg: String(page) })
  if (style !== '') search.set('style', style)
  if (type !== '') search.set('type', type)
  const url = `https://navxd.com${urlPath}?${search.toString()}`
  const filterKey = `${model}|${style}|${type}`
  const memKey = `navxd:${filterKey}|${page}`
  const metaFile = navxdPageMetaFile(filterKey, page)

  let doc = promptCache.get(memKey)
  if (!doc) {
    const disk = await readJson(metaFile, null)
    if (disk && Array.isArray(disk.items)) {
      doc = disk
      promptCache.set(memKey, doc)
    }
  }

  let cached = false
  if (forceRefresh) {
    const prevIds = page === 1 && doc ? doc.items.map((item) => item.id) : null
    try {
      doc = await fetchNavxdPageUpstream(url, filterKey, page, prevIds)
    } catch (error) {
      if (!doc) throw error
      cached = true
    }
  } else if (doc && Array.isArray(doc.items) && doc.items.length > 0) {
    cached = true
    const age = Date.now() - (Number(doc.checkedAt) || Number(doc.updatedAt) || 0)
    if (age >= CACHE_REVALIDATE_MS) {
      const prevIds = page === 1 ? doc.items.map((item) => item.id) : null
      triggerMetaRevalidation(memKey, () => fetchNavxdPageUpstream(url, filterKey, page, prevIds))
    }
  } else {
    try {
      doc = await fetchNavxdPageUpstream(url, filterKey, page, null)
    } catch (error) {
      if (query !== '') {
        const seen = await loadNavxdSeenItems()
        const matched = seen.filter((item) => `${item.title} ${item.description} ${item.prompt}`.toLowerCase().includes(query))
        if (matched.length > 0) {
          return { items: matched.slice(0, 48), page: 1, totalPages: 1, cached: true, stale: true }
        }
      }
      throw error
    }
  }

  let items = doc.items
  let totalPages = doc.totalPages
  if (query !== '') {
    const seen = await loadNavxdSeenItems()
    const poolById = new Map()
    for (const item of doc.items) poolById.set(item.id, item)
    if (model === '' && style === '' && type === '') {
      for (const item of seen) {
        if (!poolById.has(item.id)) poolById.set(item.id, item)
      }
    }
    const matched = [...poolById.values()].filter((item) =>
      `${item.title} ${item.description} ${item.prompt}`.toLowerCase().includes(query),
    )
    const pageSize = 24
    totalPages = Math.max(1, Math.ceil(matched.length / pageSize))
    items = matched.slice((page - 1) * pageSize, page * pageSize)
  }

  return { items, page, totalPages, cached, updatedAt: doc.updatedAt }
}

const CANGHE_META_FILE = path.join(CACHE_META_DIR, 'prompts-canghe.json')

async function fetchCangheUpstream(prevDoc = null) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; dsh-image-studio)', Accept: 'application/json' }
  if (prevDoc && typeof prevDoc.etag === 'string' && prevDoc.etag !== '') {
    headers['If-None-Match'] = prevDoc.etag
  } else if (prevDoc && typeof prevDoc.lastModified === 'string' && prevDoc.lastModified !== '') {
    headers['If-Modified-Since'] = prevDoc.lastModified
  }
  let response
  try {
    response = await fetch('https://gpt-image2.canghe.ai/cases.json', {
      headers,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    throw new StudioError('network', `读取提示词库失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (response.status === 304 && prevDoc && prevDoc.value && Array.isArray(prevDoc.value.cases)) {
    const nextDoc = { ...prevDoc, checkedAt: Date.now() }
    promptCache.set('canghe', nextDoc)
    await writeJson(CANGHE_META_FILE, nextDoc).catch(() => {})
    return nextDoc
  }
  if (!response.ok) {
    throw new StudioError('network', `读取提示词库失败：HTTP ${response.status}`)
  }
  const raw = await response.json()
  const rawCases = Array.isArray(raw?.cases) ? raw.cases : []
  const compactCases = rawCases.map((item) => ({
    id: item.id,
    title: item.title ?? '',
    category: item.category ?? '',
    prompt: item.prompt ?? '',
    image: item.image ?? '',
    githubUrl: typeof item.githubUrl === 'string' ? item.githubUrl : '',
    styles: Array.isArray(item.styles) ? item.styles : [],
    scenes: Array.isArray(item.scenes) ? item.scenes : [],
  }))
  const now = Date.now()
  const nextDoc = {
    version: 1,
    etag: response.headers.get('etag') || '',
    lastModified: response.headers.get('last-modified') || '',
    updatedAt: now,
    checkedAt: now,
    value: {
      cases: compactCases,
      styles: Array.isArray(raw?.styles) ? raw.styles : [],
      categories: Array.isArray(raw?.categories) ? raw.categories : [],
      scenes: Array.isArray(raw?.scenes) ? raw.scenes : [],
    },
  }
  promptCache.set('canghe', nextDoc)
  await writeJson(CANGHE_META_FILE, nextDoc).catch(() => {})
  return nextDoc
}

/** Read the static GPT-Image2 case library with disk SWR + ETag incremental revalidation. */
async function readCanghePrompts(params) {
  const forceRefresh = params.refresh === '1' || params.refresh === 'true'
  let doc = promptCache.get('canghe')
  if (!doc) {
    const disk = await readJson(CANGHE_META_FILE, null)
    if (disk && disk.value && Array.isArray(disk.value.cases) && disk.value.cases.length > 0) {
      doc = disk
      promptCache.set('canghe', doc)
    }
  }
  let cached = false
  if (forceRefresh) {
    try {
      doc = await fetchCangheUpstream(doc || null)
    } catch (error) {
      if (!doc) throw error
      cached = true
    }
  } else if (doc && doc.value && Array.isArray(doc.value.cases) && doc.value.cases.length > 0) {
    cached = true
    const age = Date.now() - (Number(doc.checkedAt) || Number(doc.updatedAt) || 0)
    if (age >= CACHE_REVALIDATE_MS) {
      triggerMetaRevalidation('prompts:canghe', () => fetchCangheUpstream(doc))
    }
  } else {
    doc = await fetchCangheUpstream(null)
  }

  const payload = doc.value
  const cases = Array.isArray(payload?.cases) ? payload.cases : []
  const styles = Array.isArray(payload?.styles) ? payload.styles : []
  const categories = Array.isArray(payload?.categories) ? payload.categories : []
  const scenes = Array.isArray(payload?.scenes) ? payload.scenes : []
  PROMPT_SOURCES.canghe.categories = categories
  PROMPT_SOURCES.canghe.styles = [['', '全部'], ...styles.map((name) => [name, name])]
  PROMPT_SOURCES.canghe.scenes = [['', '全部'], ...scenes.map((name) => [name, name])]
  const category = categories.includes(params.category) ? params.category : ''
  const style = styles.includes(params.style) ? params.style : ''
  const scene = scenes.includes(params.scene) ? params.scene : ''
  const query = String(params.q ?? '').trim().toLowerCase()
  const filtered = cases.filter((item) => {
    if (category !== '' && item.category !== category) return false
    if (style !== '' && !(Array.isArray(item.styles) && item.styles.includes(style))) return false
    if (scene !== '' && !(Array.isArray(item.scenes) && item.scenes.includes(scene))) return false
    if (query !== '') {
      const haystack = `${item.title ?? ''} ${item.prompt ?? ''} ${item.category ?? ''}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
  const page = Math.max(1, Number(params.page) || 1)
  const pageSize = 36
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((item) => ({
    id: String(item.id),
    title: String(item.title ?? ''),
    description: String(item.category ?? ''),
    prompt: String(item.prompt ?? ''),
    image: new URL(item.image, 'https://gpt-image2.canghe.ai').href,
    pageUrl: typeof item.githubUrl === 'string' ? item.githubUrl : '',
  }))
  return { items, page, totalPages, total: filtered.length, cached, updatedAt: doc.updatedAt }
}

function versionTuple(value) {
  const core = String(value || '').replace(/^v/i, '').split('-')[0]
  const parts = core.split('.').map((part) => Number.parseInt(part, 10))
  while (parts.length < 3) parts.push(0)
  return parts.map((part) => (Number.isFinite(part) ? part : 0))
}

export function compareVersions(left, right) {
  const a = versionTuple(left)
  const b = versionTuple(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0)
    if (delta !== 0) return delta
  }
  return 0
}

async function readPackageVersion() {
  try {
    const document = JSON.parse(await fs.readFile(path.join(PACKAGE_DIR, 'package.json'), 'utf8'))
    return typeof document.version === 'string' ? document.version : PACKAGE_VERSION
  } catch {
    return PACKAGE_VERSION
  }
}

async function fetchLatestRelease() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-image-studio' }
  let release = null
  let branch = null
  let failure = null
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (response.ok) {
      const payload = await response.json()
      const tag = typeof payload.tag_name === 'string' ? payload.tag_name : ''
      if (tag.replace(/^v/i, '') !== '') {
        release = { version: tag.replace(/^v/i, ''), url: payload.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${tag}` }
      }
    }
  } catch (error) {
    failure = error
  }
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`, {
      headers: { 'User-Agent': 'dsh-image-studio' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`)
    const payload = await response.json()
    if (typeof payload.version !== 'string' || payload.version === '') throw new Error('package.json 没有 version')
    branch = { version: payload.version, url: `https://github.com/${GITHUB_REPO}` }
  } catch (error) {
    failure = error
  }
  if (release && branch) return compareVersions(branch.version, release.version) > 0 ? branch : release
  if (release) return release
  if (branch) return branch
  throw new StudioError('network', `检查更新失败：${failure instanceof Error ? failure.message : String(failure || 'GitHub 不可达')}`)
}

export async function getUpdateInfo() {
  const latest = await fetchLatestRelease()
  const current = await readPackageVersion()
  let gitReady = false
  try {
    await fs.access(path.join(PACKAGE_DIR, '.git'))
    gitReady = true
  } catch {
    gitReady = false
  }
  return {
    currentVersion: current,
    latestVersion: latest.version,
    hasUpdate: compareVersions(latest.version, current) > 0,
    canUpdate: gitReady,
    updateKind: gitReady ? 'git' : 'manual',
    releaseUrl: latest.url,
  }
}

async function applyUpdate() {
  const info = await getUpdateInfo()
  if (!info.hasUpdate) return { ...info, updated: false, message: `已是最新版本 v${info.currentVersion}` }
  if (!info.canUpdate) {
    throw new StudioError('bad-request', '当前插件不是从 Git 仓库安装的，无法自动更新。请从插件市场或 GitHub 重新安装。')
  }
  try {
    const status = await execFileAsync('git', ['-C', PACKAGE_DIR, 'status', '--porcelain'], { timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    if (String(status.stdout || '').trim() !== '') {
      throw new StudioError('bad-request', '本地插件仓库有未提交改动，已停止自动更新。请先提交或备份这些改动。')
    }
    await execFileAsync('git', ['-C', PACKAGE_DIR, 'pull', '--ff-only'], { timeout: UPDATE_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    if (error instanceof StudioError) throw error
    const detail = error && error.stderr ? String(error.stderr).trim().slice(0, 500) : (error instanceof Error ? error.message : String(error))
    throw new StudioError('upstream', `自动更新失败：${detail || 'git pull 失败'}。请稍后重试或手动 git pull。`)
  }
  const updatedVersion = await readPackageVersion()
  return {
    ...info,
    currentVersion: updatedVersion,
    updated: true,
    message: updatedVersion === info.currentVersion
      ? '代码已更新，但版本号未变化；请重启 DSH。'
      : `已从 v${info.currentVersion} 更新到 v${updatedVersion}，重启 DSH 后生效。`,
    restartRequired: true,
  }
}

function createRouteHandler(pluginConfig, gate) {
  return async (req, res) => {
    const rejection = gateRejection(req, gate)
    if (rejection !== undefined) {
      writeHttpJson(res, rejection, rejection === 401
        ? { ok: false, error: { code: 'unauthorized', message: '需要先登录 dsh 才能使用生图工作台。' } }
        : { ok: false, error: { code: 'forbidden', message: '只允许本机页面访问。' } })
      return
    }

    const requestUrl = new URL(req.url ?? '/', 'http://localhost')
    const pathname = requestUrl.pathname

    try {
      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.status}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await buildStatus(pluginConfig) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.updateCheck}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await getUpdateInfo() })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.updateApply}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await applyUpdate() })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.history}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: { items: await readHistory(requestOrigin(req)) } })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.setup}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        let body
        try {
          body = await readJsonBody(req, 64 * 1024)
        } catch (error) {
          writeHttpJson(res, error.code === 'BODY_TOO_LARGE' ? 413 : 422, {
            ok: false,
            error: { code: 'bad-request', message: error.code === 'BODY_TOO_LARGE' ? '请求体过大。' : '请求体不是有效 JSON。' },
          })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await saveSetup(pluginConfig, body) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.models}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        let body
        try {
          body = await readJsonBody(req, MAX_MODELS_BODY_BYTES)
        } catch (error) {
          writeHttpJson(res, error.code === 'BODY_TOO_LARGE' ? 413 : 422, {
            ok: false,
            error: { code: 'bad-request', message: error.code === 'BODY_TOO_LARGE' ? '请求体过大。' : '请求体不是有效 JSON。' },
          })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await sniffModels(body) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.generate}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        let body
        try {
          body = await readJsonBody(req, MAX_GENERATE_BODY_BYTES)
        } catch (error) {
          writeHttpJson(res, error.code === 'BODY_TOO_LARGE' ? 413 : 422, {
            ok: false,
            error: { code: 'bad-request', message: error.code === 'BODY_TOO_LARGE' ? '参考图或请求体过大。' : '请求体不是有效 JSON。' },
          })
          return
        }
        if (body !== null && typeof body === 'object' && body.async === true) {
          writeHttpJson(res, 200, { ok: true, value: startJob(pluginConfig, body, requestOrigin(req)) })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await generateImage(pluginConfig, body, requestOrigin(req)) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.jobs}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        pruneJobs()
        const active = []
        for (const job of JOBS.values()) {
          if (job.status === 'running') active.push(publicJob(job, requestOrigin(req)))
        }
        writeHttpJson(res, 200, { ok: true, value: { active } })
        return
      }

      if (pathname.startsWith(`${ROUTE_PREFIX}${ENDPOINTS.jobs}/`)) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        let jobId = ''
        try {
          jobId = decodeURIComponent(pathname.slice(`${ROUTE_PREFIX}${ENDPOINTS.jobs}/`.length))
        } catch {
          jobId = ''
        }
        const job = JOBS.get(jobId)
        if (job === undefined) {
          writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '任务不存在或已过期。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: publicJob(job, requestOrigin(req)) })
        return
      }

      if (pathname.startsWith(`${ROUTE_PREFIX}${ENDPOINTS.history}/`) && req.method === 'DELETE') {
        let id
        try {
          id = decodeURIComponent(pathname.slice(`${ROUTE_PREFIX}${ENDPOINTS.history}/`.length))
        } catch {
          id = ''
        }
        if (!/^img-[A-Za-z0-9-]+\.(?:png|jpe?g|webp|gif)$/.test(id)) {
          writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '图片不存在。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await deleteHistoryItem(id) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.cacheStatus}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await getCacheStatus(pluginConfig) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.cacheClear}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        let body = {}
        try {
          body = await readJsonBody(req, 4 * 1024)
        } catch {
          body = {}
        }
        const scope = body && body.scope === 'all' ? 'all' : 'images'
        if (scope === 'all') navxdSeenItemsCache = null
        writeHttpJson(res, 200, { ok: true, value: await clearStudioCache(pluginConfig, scope) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.galleryReference}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        let body
        try {
          body = await readJsonBody(req, 8 * 1024)
        } catch {
          writeHttpJson(res, 422, { ok: false, error: { code: 'bad-request', message: '请求体不是有效 JSON。' } })
          return
        }
        const rawPaths = [body && body.path, body && body.fallbackPath]
          .filter((value) => typeof value === 'string' && value !== '')
        for (const rawPath of rawPaths) {
          const ref = parseOfflineRef(rawPath)
          if (ref === null) continue
          try {
            const asset = await readOfflineAssetBuffer('gallery', ref.packId, ref.relative)
            const mime = asset.mime
            writeHttpJson(res, 200, {
              ok: true,
              value: {
                dataUrl: `data:${mime};base64,${asset.buffer.toString('base64')}`,
                name: `${path.basename(ref.relative).replace(/\\.[^.]+$/, '')}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`,
                bytes: asset.buffer.length,
                mime,
                path: ref.relative,
                cacheHit: true,
              },
            })
            return
          } catch {
            // Try the next candidate, then the online gallery path.
          }
        }
        const requested = rawPaths
          .map((value) => sanitizeGalleryPath(value))
          .filter((value) => value !== '')
        if (requested.length === 0) {
          writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '图库图片不存在。' } })
          return
        }
        const base = galleryBaseUrl(pluginConfig)
        const maxBytes = cacheMaxBytesOf(pluginConfig)
        let buffer = null
        let relative = ''
        let mime = ''
        let cacheHit = false
        let lastStatus = 0
        for (const candidate of requested) {
          const tier = candidate.startsWith('thumbs/') ? 'thumb' : 'full'
          try {
            const blob = await getOrFetchCachedBlob({
              key: `gallery:${base}/${candidate}`,
              tier,
              maxBytes,
              fetchUpstream: async () => {
                const upstream = await fetch(`${base}/${candidate}`, {
                  headers: { Accept: 'image/*', 'User-Agent': 'dsh-image-studio' },
                  signal: AbortSignal.timeout(20_000),
                })
                if (!upstream.ok) {
                  const err = new Error(`HTTP ${upstream.status}`)
                  err.httpStatus = upstream.status
                  throw err
                }
                const bytes = Buffer.from(await upstream.arrayBuffer())
                if (bytes.length === 0) throw new Error('empty')
                if (bytes.length > 12 * 1024 * 1024) {
                  const err = new Error('too-large')
                  err.httpStatus = 413
                  throw err
                }
                return {
                  buffer: bytes,
                  mime: detectMime(bytes, upstream.headers.get('content-type') || detectMimeFromName(candidate)),
                }
              },
            })
            buffer = blob.buffer || await fs.readFile(blob.filePath)
            relative = candidate
            mime = blob.mime
            cacheHit = Boolean(blob.fromCache)
            break
          } catch (error) {
            lastStatus = error && typeof error.httpStatus === 'number' ? error.httpStatus : 0
          }
        }
        if (buffer === null) {
          writeHttpJson(res, 502, { ok: false, error: { code: 'upstream', message: `图库图片读取失败（HTTP ${lastStatus || 502}）。` } })
          return
        }
        writeHttpJson(res, 200, {
          ok: true,
          value: {
            dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
            name: `${path.basename(relative).replace(/\.[^.]+$/, '')}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`,
            bytes: buffer.length,
            mime,
            path: relative,
            cacheHit,
          },
        })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.promptSources}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        writeHttpJson(res, 200, {
          ok: true,
          value: [
            ...Object.entries(PROMPT_SOURCES).map(([id, entry]) => ({
              id,
              label: entry.label,
              home: entry.home,
              offline: false,
              filters: {
                styles: entry.styles ?? [],
                types: entry.types ?? [],
                models: entry.models ?? [],
                categories: entry.categories ?? [],
                scenes: entry.scenes ?? [],
              },
            })),
            ...await listOfflinePromptSources(),
          ],
        })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.promptCatalog}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        const source = String(requestUrl.searchParams.get('source') || 'navxd')
        const offlinePackId = source.startsWith('offline:') ? source.slice('offline:'.length) : ''
        if (offlinePackId === '' && PROMPT_SOURCES[source] === undefined) {
          throw new StudioError('bad-request', `未知的提示词来源：${source}`)
        }
        const params = Object.fromEntries(requestUrl.searchParams.entries())
        let value
        if (offlinePackId !== '') value = await readOfflinePromptCatalog(offlinePackId, params)
        else if (source === 'upma') value = await readUpmaPrompts(params)
        else if (source === 'navxd') value = await readNavxdPrompts(params)
        else value = await readCanghePrompts(params)
        writeHttpJson(res, 200, {
          ok: true,
          value: {
            ...value,
            source,
            filters: value.filters ?? {
              styles: PROMPT_SOURCES[source].styles ?? [],
              types: PROMPT_SOURCES[source].types ?? [],
              models: PROMPT_SOURCES[source].models ?? [],
              categories: PROMPT_SOURCES[source].categories ?? [],
              scenes: PROMPT_SOURCES[source].scenes ?? [],
            },
          },
        })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.promptImage}`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        const source = String(requestUrl.searchParams.get('source') || '')
        const target = String(requestUrl.searchParams.get('url') || '')
        const explicitTier = requestUrl.searchParams.get('tier')
        const offlinePackId = source.startsWith('offline:') ? source.slice('offline:'.length) : ''
        if ((offlinePackId === '' && PROMPT_SOURCES[source] === undefined) || !promptImageAllowed(source, target)) {
          writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '提示词图片不存在。' } })
          return
        }
        if (offlinePackId !== '') {
          const ref = parseOfflineRef(target)
          try {
            const asset = await readOfflineAssetBuffer('prompts', offlinePackId, ref.relative)
            respondCachedBlob(req, res, {
              buffer: asset.buffer,
              mime: asset.mime,
              size: asset.buffer.length,
              hash: sha256Hex(`offline-prompt:${offlinePackId}:${ref.relative}`),
              fromCache: true,
            })
          } catch (error) {
            const status = error instanceof StudioError && error.code === 'bad-request' ? 413 : 404
            writeHttpJson(res, status, { ok: false, error: { code: status === 413 ? 'bad-request' : 'not-found', message: '离线提示词图片不存在。' } })
          }
          return
        }
        const tier = explicitTier === 'thumb'
          ? 'thumb'
          : explicitTier === 'full'
            ? 'full'
            : (/-w\d+\.(?:webp|jpe?g|png)$/i.test(target) ? 'thumb' : 'full')
        let blob
        try {
          blob = await getOrFetchCachedBlob({
            key: `prompt:${source}:${target}`,
            tier,
            maxBytes: cacheMaxBytesOf(pluginConfig),
            fetchUpstream: async () => {
              let upstream = null
              try {
                upstream = await fetch(target, {
                  headers: source === 'navxd'
                    ? {
                      Accept: 'image/*',
                      Referer: 'https://navxd.com/prompt-template-library?cat=image',
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
                    }
                    : { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (compatible; dsh-image-studio)' },
                  signal: AbortSignal.timeout(25_000),
                })
              } catch (error) {
                throw new StudioError('network', `读取提示词图片失败：${error instanceof Error ? error.message : String(error)}`)
              }
              if (!upstream.ok) {
                const err = new Error(`HTTP ${upstream.status}`)
                err.httpStatus = upstream.status
                throw err
              }
              const buffer = Buffer.from(await upstream.arrayBuffer())
              if (buffer.length === 0 || buffer.length > 12 * 1024 * 1024) {
                const err = new Error('empty-or-too-large')
                err.httpStatus = 502
                throw err
              }
              return {
                buffer,
                mime: detectMime(buffer, upstream.headers.get('content-type') || 'image/jpeg'),
              }
            },
          })
        } catch (error) {
          if (error instanceof StudioError) throw error
          const code = error && typeof error.httpStatus === 'number' ? error.httpStatus : 502
          writeHttpJson(res, 502, {
            ok: false,
            error: {
              code: 'upstream',
              message: code === 502 ? '提示词图片为空或超过 12MB。' : `提示词图片返回 HTTP ${code}。`,
            },
          })
          return
        }
        respondCachedBlob(req, res, blob)
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.offlinePacks}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        const kind = normalizeOfflineKind(requestUrl.searchParams.get('kind'))
        const value = {
          prompts: kind === null || kind === 'prompts' ? await listOfflinePacks('prompts') : [],
          gallery: kind === null || kind === 'gallery' ? await listOfflinePacks('gallery') : [],
        }
        writeHttpJson(res, 200, { ok: true, value })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.offlineImport}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        let body
        try {
          body = await readJsonBody(req, OFFLINE_PACK_MAX_BYTES)
        } catch {
          writeHttpJson(res, 422, { ok: false, error: { code: 'bad-request', message: '请求体不是有效 JSON，或清单超过 64MB。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await importOfflinePack(body) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.offlineRemove}`) {
        if (req.method !== 'POST') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST。' } })
          return
        }
        let body = {}
        try {
          body = await readJsonBody(req, 8 * 1024)
        } catch {
          body = {}
        }
        const kind = normalizeOfflineKind(body.kind)
        if (kind === null) throw new StudioError('bad-request', '删除类型必须是 prompts 或 gallery。')
        writeHttpJson(res, 200, { ok: true, value: await removeOfflinePack(kind, body.id) })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.offlineFile}`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        const kind = normalizeOfflineKind(requestUrl.searchParams.get('kind'))
        const packId = String(requestUrl.searchParams.get('pack') || '')
        const relative = cleanOfflineAssetRef(requestUrl.searchParams.get('path'))
        if (kind === null || packId === '' || relative === '') {
          writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '离线文件不存在。' } })
          return
        }
        try {
          const asset = await readOfflineAssetBuffer(kind, packId, relative)
          respondCachedBlob(req, res, {
            buffer: asset.buffer,
            mime: asset.mime,
            size: asset.buffer.length,
            hash: sha256Hex(`offline:${kind}:${packId}:${relative}`),
            fromCache: true,
          })
        } catch {
          writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '离线文件不存在。' } })
        }
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.galleryLibraries}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: await listGalleryLibraries() })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.galleryCatalog}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        const library = typeof requestUrl.searchParams.get('library') === 'string'
          ? String(requestUrl.searchParams.get('library'))
          : 'pose'
        const refresh = requestUrl.searchParams.get('refresh') === '1' || requestUrl.searchParams.get('refresh') === 'true'
        if (library.startsWith('offline:')) {
          const packId = library.slice('offline:'.length)
          const catalog = await readOfflineGalleryCatalog(packId)
          writeHttpJson(res, 200, {
            ok: true,
            value: {
              library,
              base: '',
              items: catalog.items,
              cached: true,
              stale: false,
              updatedAt: catalog.updatedAt || null,
            },
          })
          return
        }
        const catalog = await readGalleryCatalog(pluginConfig, library, refresh)
        const items = library === 'pose' ? groupPoseVariants(catalog.items) : catalog.items
        writeHttpJson(res, 200, {
          ok: true,
          value: {
            library,
            base: galleryBaseUrl(pluginConfig),
            items,
            cached: catalog.cached === true,
            stale: catalog.stale === true,
            updatedAt: catalog.updatedAt || null,
          },
        })
        return
      }

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.galleryImage}`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        const rawPath = String(requestUrl.searchParams.get('path') || '')
        if (rawPath.startsWith('offline://')) {
          const ref = parseOfflineRef(rawPath)
          if (ref === null) {
            writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '离线图库图片不存在。' } })
            return
          }
          try {
            const asset = await readOfflineAssetBuffer('gallery', ref.packId, ref.relative)
            respondCachedBlob(req, res, {
              buffer: asset.buffer,
              mime: asset.mime,
              size: asset.buffer.length,
              hash: sha256Hex(`offline-gallery:${ref.packId}:${ref.relative}`),
              fromCache: true,
            })
          } catch {
            writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '离线图库图片不存在。' } })
          }
          return
        }
        const relative = sanitizeGalleryPath(requestUrl.searchParams.get('path'))
        if (relative === '') {
          writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '图库图片不存在。' } })
          return
        }
        const tier = relative.startsWith('thumbs/') ? 'thumb' : 'full'
        const base = galleryBaseUrl(pluginConfig)
        let blob
        try {
          blob = await getOrFetchCachedBlob({
            key: `gallery:${base}/${relative}`,
            tier,
            maxBytes: cacheMaxBytesOf(pluginConfig),
            fetchUpstream: async () => {
              let upstream = null
              try {
                upstream = await fetch(`${base}/${relative}`, {
                  headers: { Accept: 'image/*', 'User-Agent': 'dsh-image-studio' },
                  signal: AbortSignal.timeout(25_000),
                })
              } catch (error) {
                throw new StudioError('network', `读取图库图片失败：${error instanceof Error ? error.message : String(error)}`)
              }
              if (!upstream.ok) {
                const err = new Error(`HTTP ${upstream.status}`)
                err.httpStatus = upstream.status
                throw err
              }
              const buffer = Buffer.from(await upstream.arrayBuffer())
              if (buffer.length === 0) {
                const err = new Error('empty')
                err.httpStatus = 502
                throw err
              }
              if (buffer.length > GALLERY_IMAGE_MAX_BYTES) {
                const err = new Error('too-large')
                err.httpStatus = 413
                throw err
              }
              return {
                buffer,
                mime: detectMime(buffer, upstream.headers.get('content-type') || detectMimeFromName(relative)),
              }
            },
          })
        } catch (error) {
          if (error instanceof StudioError) throw error
          if (error && error.httpStatus === 413) {
            writeHttpJson(res, 413, { ok: false, error: { code: 'bad-request', message: '图库图片超过 32MB。' } })
            return
          }
          const status = error && typeof error.httpStatus === 'number' ? error.httpStatus : 502
          writeHttpJson(res, 502, {
            ok: false,
            error: {
              code: 'upstream',
              message: error && error.message === 'empty' ? '图库图片为空。' : `图库图片返回 HTTP ${status}。`,
            },
          })
          return
        }
        respondCachedBlob(req, res, blob)
        return
      }

      if (pathname.startsWith(`${ROUTE_PREFIX}${ENDPOINTS.files}`)) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        await serveFile(req, res, requestUrl)
        return
      }

      writeHttpJson(res, 404, { ok: false, error: { code: 'not-found', message: '未知的 image-studio 路径。' } })
    } catch (error) {
      const wire = toWireError(error)
      writeHttpJson(res, statusFor(wire.code), { ok: false, error: wire })
    }
  }
}

/* ------------------------------------------------------------------ */
/* /image slash command                                                */
/* ------------------------------------------------------------------ */

/** Parse `/image [--provider …] [--size …] [--ratio …] [--quality …] <prompt>`. */
function parseImageCommand(rawInput) {
  const tokens = typeof rawInput === 'string'
    ? (rawInput.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [])
    : []
  const flags = {
    provider: undefined, size: undefined, ratio: undefined, quality: undefined, model: undefined,
    outputFormat: undefined, complexity: undefined, frameCount: undefined, frameDurationMs: undefined, fresh: false,
  }
  const promptParts = []
  const ratioSet = new Set(['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9', '5:2'])
  let prefix = true

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const next = tokens[index + 1]
    if (token === '--new' || token === '-n') {
      flags.fresh = true
      continue
    }
    if (token === '--provider' || token === '-p') {
      flags.provider = normalizeProviderId(next) ?? next
      index += 1
      continue
    }
    if (token === '--size' || token === '-s') {
      flags.size = next
      index += 1
      continue
    }
    if (token === '--ratio' || token === '-r') {
      flags.ratio = next
      index += 1
      continue
    }
    if (token === '--quality' || token === '-q') {
      flags.quality = next
      index += 1
      continue
    }
    if (token === '--model' || token === '-m') {
      flags.model = next
      index += 1
      continue
    }
    if (token === '--format' || token === '-f') {
      flags.outputFormat = next
      index += 1
      continue
    }
    if (token === '--complexity' || token === '-c') {
      flags.complexity = next
      index += 1
      continue
    }
    if (token === '--frames') {
      flags.frameCount = Number(next)
      index += 1
      continue
    }
    if (token === '--frame-ms') {
      flags.frameDurationMs = Number(next)
      index += 1
      continue
    }

    // Friendly positional prefix: /image gpt 2k 16:9 <prompt>
    if (prefix) {
      if (flags.provider === undefined) {
        const provider = normalizeProviderId(token)
        if (provider !== undefined) {
          flags.provider = provider
          continue
        }
      }
      if (flags.size === undefined
        && (/^[1-4]k$/i.test(token) || /^\d{3,5}x\d{3,5}$/i.test(token) || /^auto$/i.test(token))) {
        flags.size = /^[1-4]k$/i.test(token) ? token.toUpperCase() : token.toLowerCase()
        continue
      }
      if (flags.ratio === undefined && ratioSet.has(token)) {
        flags.ratio = token
        continue
      }
      prefix = false
    }

    promptParts.push(token.replace(/^"|"$/g, ''))
  }
  return { ...flags, prompt: promptParts.join(' ').trim() }
}

/** Last generated image per command session, for follow-up /image edits. */
const commandSessionImages = new Map()
const commandAgentImages = new WeakMap()
const MAX_COMMAND_SESSIONS = 200

function commandImageStore(invocation) {
  const session = invocation && invocation.agent && invocation.agent.session
  const id = session && (session.id || session.sessionId || session.key)
  if (id !== undefined && id !== null) {
    return {
      get: () => commandSessionImages.get(id),
      set: (value) => {
        commandSessionImages.set(id, value)
        if (commandSessionImages.size > MAX_COMMAND_SESSIONS) {
          const oldest = commandSessionImages.keys().next().value
          commandSessionImages.delete(oldest)
        }
      },
    }
  }
  const agent = invocation && invocation.agent
  if (agent && typeof agent === 'object') {
    return {
      get: () => commandAgentImages.get(agent),
      set: (value) => commandAgentImages.set(agent, value),
    }
  }
  return null
}

async function readCommandReference(entry) {
  if (!entry || typeof entry.filePath !== 'string') return null
  try {
    const buffer = await fs.readFile(entry.filePath)
    if (buffer.length === 0 || buffer.length > MAX_REFERENCE_BYTES) return null
    return `data:${entry.mime || 'image/png'};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

const IMAGE_TOOL_NAME = 'image_studio_generate'

const IMAGE_TOOL_DESCRIPTION = [
  'Generate or edit an image with the DSH Image Studio.',
  'Call this whenever a user message begins with "/image" (shorthand: /image [agnes|gpt|grok|minimax|compatible] [1K|2K|4K] [16:9] [--format gif] <prompt>),',
  'or when the user asks to create or edit an image with the image studio.',
  'Pass the user\'s exact message as `request`; do not strip or rewrite it. The tool parses the shorthand and returns a markdown image.',
  'gpt-image-2.6 models additionally accept `outputFormat` (png/jpeg/webp/gif), `complexity` (low/medium/high), and — for gif — `frameCount` (2-16) and `frameDurationMs` (20-2000); GIF is generation-only and cannot carry reference images.',
  'If this conversation already has a generated image, omit `fresh` to modify that image; set `fresh: true` only for a brand-new image.',
  'After the tool returns, include its markdown image in your final reply so it renders inline, add a short summary and the local path, and tell the user the image can also be opened from the tool card.',
  'After a successful result, do not call any other tool, do not read/measure/verify the image, do not curl or copy the file, and do not retry; reply immediately with the markdown image and at most three sentences.',
  'If the tool returns an error, do not call it again automatically; report the error briefly and ask the user whether to retry.',
].join(' ')

const IMAGE_TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    request: {
      type: 'string',
      description: 'The user\'s exact /image message, including /image and all flags, e.g. "/image agnes 2k 16:9 一只猫".',
    },
    prompt: {
      type: 'string',
      description: 'Natural-language image description when the user did not use /image shorthand.',
    },
    provider: {
      type: 'string',
      enum: ['agnes', 'openai', 'grok', 'minimax', 'openai-compatible'],
      description: 'Optional image provider override.',
    },
    size: { type: 'string', description: 'Optional size override, e.g. 2K or 1536x1024.' },
    ratio: { type: 'string', description: 'Optional aspect ratio override, e.g. 16:9.' },
    quality: { type: 'string', description: 'Optional quality override, e.g. high or medium.' },
    model: { type: 'string', description: 'Optional model override.' },
    outputFormat: {
      type: 'string',
      enum: ['png', 'jpeg', 'webp', 'gif'],
      description: 'gpt-image-2.6 only. gif produces an animated GIF (generation only, no reference images).',
    },
    complexity: {
      type: 'string',
      enum: ['auto', 'low', 'medium', 'high'],
      description: 'gpt-image-2.6 only. Planning effort; separate from rendering quality.',
    },
    frameCount: { type: 'integer', description: 'gpt-image-2.6 GIF frames, 2-16 (default 9).' },
    frameDurationMs: { type: 'integer', description: 'gpt-image-2.6 GIF frame delay in ms, 20-2000 (default 200).' },
    fresh: { type: 'boolean', description: 'True to start a new image instead of editing the previous image in this conversation.' },
  },
}

const IMAGE_TOOL_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string' },
    filePath: { type: 'string' },
    markdown: { type: 'string' },
    providerLabel: { type: 'string' },
    model: { type: 'string' },
    size: { type: 'string' },
    ratio: { type: 'string' },
    quality: { type: 'string' },
    outputFormat: { type: 'string' },
    prompt: { type: 'string' },
    elapsedMs: { type: 'number' },
    referenceCount: { type: 'number' },
  },
  required: ['url', 'filePath', 'markdown'],
}

export async function executeImageTool(pluginConfig, args = {}, exec = {}) {
  const request = typeof args.request === 'string' ? args.request.trim() : ''
  const promptArg = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  const source = request !== '' ? request : promptArg
  const parsed = parseImageCommand(source.replace(/^\/image(?:\s+|$)/i, ''))
  const prompt = parsed.prompt || promptArg
  if (prompt === '') throw new StudioError('bad-request', '请描述要生成的画面，例如 /image agnes 2k 16:9 一只猫。')

  const input = { prompt }
  const provider = args.provider !== undefined ? args.provider : parsed.provider
  const size = args.size !== undefined ? args.size : parsed.size
  const ratio = args.ratio !== undefined ? args.ratio : parsed.ratio
  const quality = args.quality !== undefined ? args.quality : parsed.quality
  const model = args.model !== undefined ? args.model : parsed.model
  if (provider !== undefined) input.provider = provider
  if (size !== undefined) input.size = size
  if (ratio !== undefined) input.ratio = ratio
  if (quality !== undefined) input.quality = quality
  if (model !== undefined) input.model = model
  const outputFormat = args.outputFormat !== undefined ? args.outputFormat : parsed.outputFormat
  const complexity = args.complexity !== undefined ? args.complexity : parsed.complexity
  const frameCount = args.frameCount !== undefined ? args.frameCount : parsed.frameCount
  const frameDurationMs = args.frameDurationMs !== undefined ? args.frameDurationMs : parsed.frameDurationMs
  if (outputFormat !== undefined) input.outputFormat = outputFormat
  if (complexity !== undefined) input.complexity = complexity
  if (Number.isFinite(frameCount)) input.frameCount = frameCount
  if (Number.isFinite(frameDurationMs)) input.frameDurationMs = frameDurationMs

  const store = commandImageStore({ agent: exec.agent })
  const previous = store ? store.get() : null
  const fresh = args.fresh === true || parsed.fresh === true
  if (!fresh && previous !== undefined && previous !== null) {
    const reference = await readCommandReference(previous)
    if (reference === null) {
      throw new StudioError('bad-request', '上一张图已不存在或超过 12MB，无法继续修改；请用 fresh=true 或 /image --new 重新生成。')
    }
    input.referenceImages = [reference]
  }

  const value = await generateImage(pluginConfig, input, requestOrigin(exec?.request)).catch((error) => {
    if (error instanceof StudioError) {
      const suffix = error.message.includes('不要自动重试') ? '' : '（不要自动重试；请先让用户确认是否重新生成。）'
      throw new StudioError(error.code || 'upstream', `${error.message}${suffix}`, { ...error.extra, retryable: false })
    }
    throw error
  })
  if (store) store.set({ filePath: value.filePath, mime: value.mime, id: value.id })

  const extras = [value.model, value.size, value.ratio, value.quality, value.outputFormat && value.outputFormat !== 'png' ? value.outputFormat.toUpperCase() : ''].filter(Boolean).join(' · ')
  const reference = value.referenceCount > 0 ? ` · 基于 ${value.referenceCount} 张参考图` : ''
  const timing = Number.isFinite(value.postMs) && Number.isFinite(value.downloadMs)
    ? ` · 请求 ${(value.postMs / 1000).toFixed(1)}s`
      + (Number.isFinite(value.headersMs) && Number.isFinite(value.bodyMs)
        ? `（头 ${(value.headersMs / 1000).toFixed(1)}s / 体 ${(value.bodyMs / 1000).toFixed(1)}s）`
        : '')
      + ` / 回传 ${(value.downloadMs / 1000).toFixed(1)}s`
      + (value.sourceKind === 'url' && Number.isFinite(value.bytes) && value.downloadMs > 5000
        ? `（${(value.bytes / 1048576).toFixed(1)}MB · ${Math.round(value.bytes / 1024 / Math.max(1, value.downloadMs / 1000))}KB/s${value.downloadMode === 'range' ? ' · 分段并发' : ''}）`
        : '')
    : ''
  const formatLabel = value.outputFormat === 'gif'
    ? ' · GIF 动图'
    : (value.outputFormat && value.outputFormat !== 'png' ? ` · ${String(value.outputFormat).toUpperCase()}` : '')
  const markdown = [
    `已生成图片 · ${value.providerLabel} · ${extras}${reference}${formatLabel} · ${(value.elapsedMs / 1000).toFixed(1)}s${timing}`,
    '',
    `![生图结果](${value.url})`,
    '',
    `本地文件：${value.filePath}`,
    '继续描述修改会基于这张图；要重新生成一张可以说“新图”。',
  ].join('\n')

  const output = {
    url: value.url,
    filePath: value.filePath,
    markdown,
    providerLabel: value.providerLabel,
    model: value.model,
    prompt,
    elapsedMs: value.elapsedMs,
    referenceCount: value.referenceCount || 0,
  }
  if (value.size) output.size = value.size
  if (value.ratio) output.ratio = value.ratio
  if (value.quality) output.quality = value.quality
  if (value.outputFormat) output.outputFormat = value.outputFormat
  return output
}

function registerImageTool(ctx, pluginConfig) {
  ctx.effect(
    () => ctx.tools.register({
      name: IMAGE_TOOL_NAME,
      description: IMAGE_TOOL_DESCRIPTION,
      parameters: IMAGE_TOOL_PARAMETERS,
      output: {
        schema: IMAGE_TOOL_OUTPUT,
        render: (_args, value) => [{ type: 'text', text: value.markdown }],
      },
      async execute(args, exec) {
        return executeImageTool(pluginConfig, args, exec)
      },
    }),
    'image-studio: image tool',
  )
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: 'tool:image-studio',
      order: 120,
      text: [
        'When a user message begins with /image, treat it as a request to the image_studio_generate tool.',
        'Call image_studio_generate and pass the user\'s exact message as the request argument; do not answer with text alone and do not treat it as a slash command.',
        'After the tool returns, include its markdown image in your final reply so it renders inline, add a short summary and the local path, and tell the user the image can also be opened from the tool card.',
        'After a successful result, do not call any other tool, do not read/measure/verify the image, do not curl or copy the file, and do not retry; reply immediately with the markdown image and at most three sentences.',
        'If the tool returns an error, do not call it again automatically; report the error briefly and ask the user whether to retry.',
      ].join(' '),
    }),
    'image-studio: prompt',
  )
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const pluginConfig = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {}
  originResolver = () => {
    let advertised = ''
    try {
      const webApp = ctx.get('webApp')
      advertised = webApp && typeof webApp.getAdvertisedUrl === 'function' ? usableOrigin(webApp.getAdvertisedUrl()) : ''
    } catch {
      advertised = ''
    }
    return advertised !== '' ? advertised : ctx.webServer.getOrigin()
  }
  const gate = createRequestGate(ctx, pluginConfig)
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createRouteHandler(pluginConfig, gate),
    }),
    'image-studio: HTTP routes',
  )
  registerImageTool(ctx, pluginConfig)
}
