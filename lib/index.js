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

import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Blob } from 'node:buffer'
import os from 'node:os'
import path from 'node:path'
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
  buildEndpointUrl,
} from './providers.js'

const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

/** Plugin row id (also the `main` slot key and sidebar entry id). */
export const name = 'image-studio'

/** The web carrier, tool registry, and prompt registry are this plugin's hard dependencies. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Single HTTP prefix owned by this plugin. */
const ROUTE_PREFIX = '/image-studio'

/** Browser-facing endpoint paths (relative to {@link ROUTE_PREFIX}). */
const ENDPOINTS = Object.freeze({
  status: '/status',
  setup: '/setup',
  generate: '/generate',
  history: '/history',
  files: '/files/',
})

/** Local storage layout under $DSH_HOME/image-studio. */
const STORAGE_DIRNAME = 'image-studio'

/** Maximum accepted prompt characters; longer prompts are rejected, not truncated. */
const MAX_PROMPT_CHARS = 4000

/** Maximum accepted JSON body for /generate (reference images included). */
const MAX_GENERATE_BODY_BYTES = 24 * 1024 * 1024

/** Maximum downloaded image bytes. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024

/** Keys shorter/longer than this are rejected before they reach a provider. */
const MIN_KEY_CHARS = 8
const MAX_KEY_CHARS = 512

/** History depth kept on disk. */
const HISTORY_LIMIT = 80

/** Default request timeout when a provider has no explicit one. */
const DEFAULT_TIMEOUT_MS = 180000

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
const CONFIG_FILE = path.join(STORAGE_DIR, 'config.json')
const CREDENTIALS_FILE = path.join(STORAGE_DIR, 'credentials.json')
const HISTORY_FILE = path.join(STORAGE_DIR, 'history.json')

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
  return { version: 2, enabled: true, defaultProvider: DEFAULT_PROVIDER, providers: {} }
}

function emptyCredentialsDoc() {
  return { version: 2, keys: {} }
}

/** Migrate v1 `{baseUrl, model}` and v2 `{providers}` config documents. */
function migrateConfigDoc(raw) {
  const doc = emptyConfigDoc()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return doc

  if (raw.providers !== null && typeof raw.providers === 'object' && !Array.isArray(raw.providers)) {
    doc.enabled = raw.enabled !== false
    doc.defaultProvider = normalizeProviderId(raw.defaultProvider) ?? DEFAULT_PROVIDER
    doc.providers = raw.providers
    return doc
  }

  // v1: flat Agnes config.
  const legacy = {}
  for (const field of ['baseUrl', 'endpointPath', 'model', 'size', 'ratio', 'quality']) {
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
    const credential = credentialFor(credentialsDoc, preset)
    return {
      id: preset.id,
      label: preset.label,
      shortLabel: preset.shortLabel,
      description: preset.description,
      kind: preset.kind,
      configured: credential.key !== '',
      masked: maskKey(credential.key),
      keySource: credential.source,
      baseUrl: config.baseUrl,
      endpointPath: config.endpointPath,
      model: config.model,
      size: config.size,
      ratio: config.ratio,
      quality: config.quality,
      models: modelsFor(preset, config.model),
      sizes: sizesForProvider(preset, config.model),
      sizeByModel: preset.sizeByModel,
      ratios: preset.ratios,
      qualities: qualitiesForProvider(preset, config.model),
      qualityByModel: preset.qualityByModel,
      supportsRatio: preset.supportsRatio,
      supportsQuality: preset.supportsQuality,
      sizeMode: preset.sizeMode,
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
    providers,
    storageDir: STORAGE_DIR,
    outputDir: OUTPUT_DIR,
  }
}

/** Whether a setup body carries provider config fields. */
function hasProviderFields(body) {
  return ['baseUrl', 'endpointPath', 'model', 'size', 'ratio', 'quality']
    .some((field) => body[field] !== undefined)
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
      for (const field of ['baseUrl', 'endpointPath', 'model', 'size', 'ratio', 'quality']) {
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
  if (status === 404) {
    return new StudioError('bad-request', `${label} 接口路径不存在（HTTP 404）。请检查 Base URL 和接口路径。当前请求：${url}${suffix ? `。${suffix}` : ''}`, { provider: preset.id })
  }
  if (status === 429) {
    return new StudioError('rate-limit', `${label} 请求过于频繁或并发已满（HTTP 429）。${suffix}`, { provider: preset.id })
  }
  if (status === 400 || status === 422) {
    return new StudioError('bad-request', `${label} 拒绝了请求参数（HTTP ${status}）。${suffix}`, { provider: preset.id })
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
    return targetHost === providerHost
      || targetHost.endsWith(`.${providerHost}`)
      || providerHost.endsWith(`.${targetHost}`)
  } catch {
    return false
  }
}

async function downloadImage(url, config, key, signal, label) {
  const headers = {}
  if (isProviderHost(url, config.baseUrl)) headers.Authorization = `Bearer ${key}`
  let response
  try {
    response = await fetch(url, { method: 'GET', headers, signal })
  } catch (error) {
    throw new StudioError('network', `${label} 已返回图片地址，但下载失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new StudioError('upstream', `${label} 已返回图片地址，但下载返回 HTTP ${response.status}。`)
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new StudioError('upstream', '生成的图片超过 32MB，已拒绝保存。')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new StudioError('upstream', '下载到的图片为空。')
  if (buffer.length > MAX_IMAGE_BYTES) throw new StudioError('upstream', '生成的图片超过 32MB，已拒绝保存。')
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  let mime = contentType.startsWith('image/') ? contentType : detectMime(buffer)
  if (mime === 'image/jpg') mime = 'image/jpeg'
  return { buffer, mime }
}

async function materializeImage(source, config, key, signal, label) {
  const text = source.trim()
  if (/^data:image\//i.test(text)) {
    const decoded = decodeDataUrl(text)
    if (decoded === null || decoded.buffer.length === 0) {
      throw new StudioError('upstream', '上游返回的 data URL 无法解码。')
    }
    return { buffer: decoded.buffer, mime: detectMime(decoded.buffer, decoded.mime) }
  }
  if (/^https?:\/\//i.test(text)) {
    return downloadImage(text, config, key, signal, label)
  }
  const base64 = text.replace(/\s/g, '')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) throw new StudioError('upstream', '上游返回的 base64 图片无法解码。')
  return { buffer, mime: detectMime(buffer) }
}

/**
 * POST one image generation request and return local image bytes.
 * The deadline covers submit + body read + remote download.
 */
async function requestGeneration(preset, config, key, built, timeoutMs) {
  const url = buildEndpointUrl(config, built.endpointPath)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  let requestPayload
  try {
    if (built.mode === 'multipart') {
      const form = new FormData()
      for (const [field, value] of Object.entries(built.body || {})) {
        if (value !== undefined && value !== null && value !== '') {
          form.append(field, String(value))
        }
      }
      for (const image of built.files || []) {
        const comma = image.dataUrl.indexOf(',')
        const bytes = Buffer.from(image.dataUrl.slice(comma + 1), 'base64')
        form.append('image', new Blob([bytes], { type: image.mime }), image.filename)
      }
      requestPayload = form
    } else {
      headers['Content-Type'] = 'application/json'
      requestPayload = JSON.stringify(built.body)
    }
  } catch (error) {
    clearTimeout(timer)
    throw new StudioError('bad-request', `参考图处理失败：${error instanceof Error ? error.message : String(error)}`, { provider: preset.id })
  }

  let response
  let rawText = ''
  try {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestPayload,
        signal: controller.signal,
      })
      rawText = await response.text()
    } catch (error) {
      if (controller.signal.aborted) {
        throw new StudioError('timeout', `${preset.label} 生图超时（${Math.round(timeoutMs / 1000)} 秒）。可以调高设置里的超时时间后重试。`, { provider: preset.id })
      }
      const cause = error instanceof Error
        ? (error.cause instanceof Error ? `${error.message}（${error.cause.message}）` : error.message)
        : String(error)
      throw new StudioError('network', `无法连接 ${preset.label} 服务 ${config.baseUrl}：${cause}`, { provider: preset.id })
    }

    let responsePayload = null
    try {
      responsePayload = rawText === '' ? null : JSON.parse(rawText)
    } catch {
      responsePayload = null
    }

    if (!response.ok) throw mapHttpError(response.status, rawText, responsePayload, preset, url)

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

    return await materializeImage(source, config, key, controller.signal, preset.label)
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* Generation, history, and file serving                               */
/* ------------------------------------------------------------------ */

let activeGenerations = 0
let historyQueue = Promise.resolve()

async function readHistory() {
  const items = await readJson(HISTORY_FILE, [])
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string')
    .slice(0, HISTORY_LIMIT)
    .map((item) => ({ ...item, url: `${ROUTE_PREFIX}${ENDPOINTS.files}${item.id}` }))
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
 * Generate one image for the selected provider, save it, and return its
 * browser-facing URL plus the effective provider/params.
 */
async function generateImage(pluginConfig, input) {
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
    const { buffer, mime } = await requestGeneration(preset, config, credential.key, built, timeoutMs)
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
      mime,
      bytes: buffer.length,
      elapsedMs,
      createdAt: new Date().toISOString(),
    }
    await appendHistory(record).catch(() => {})
    return {
      ...record,
      url: `${ROUTE_PREFIX}${ENDPOINTS.files}${id}`,
      filePath,
    }
  } finally {
    activeGenerations -= 1
  }
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

function isTrustedOrigin(origin) {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && TRUSTED_HOSTNAMES.has(url.hostname)
  } catch {
    return false
  }
}

function isTrustedRequest(req) {
  if (req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined) return false
  if (!isLoopbackRequest(req)) return false
  const host = req.headers.host
  if (typeof host !== 'string' || host.trim() === '') return true
  if (!TRUSTED_HOSTNAMES.has(hostnameOf(host))) return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.trim() !== '' && !isTrustedOrigin(origin)) return false
  return true
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
    case 'auth':
      return 401
    case 'quota':
    case 'rate-limit':
    case 'busy':
      return 429
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

function createRouteHandler(pluginConfig) {
  return async (req, res) => {
    if (!isTrustedRequest(req)) {
      writeHttpJson(res, 403, { ok: false, error: { code: 'forbidden', message: '只允许本机页面访问。' } })
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

      if (pathname === `${ROUTE_PREFIX}${ENDPOINTS.history}`) {
        if (req.method !== 'GET') {
          writeHttpJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 GET。' } })
          return
        }
        writeHttpJson(res, 200, { ok: true, value: { items: await readHistory() } })
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
        writeHttpJson(res, 200, { ok: true, value: await generateImage(pluginConfig, body) })
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
  const flags = { provider: undefined, size: undefined, ratio: undefined, quality: undefined, model: undefined, fresh: false }
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

function formatCommandResult(value) {
  const extras = [value.model, value.size, value.ratio, value.quality].filter(Boolean).join(' · ')
  const reference = value.referenceCount > 0 ? ` · 基于参考图 ${value.referenceCount}` : ''
  return [
    `已生成图片 · ${value.providerLabel} · ${extras}${reference} · ${(value.elapsedMs / 1000).toFixed(1)}s`,
    `图片地址：${value.url}`,
    `本地文件：${value.filePath}`,
  ].join('\n')
}

function formatCommandError(error) {
  if (error instanceof StudioError) return error.message
  return `生图失败：${error instanceof Error ? error.message : String(error)}`
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

/**
 * A direct command in a brand-new conversation runs before any user message is
 * committed, so the chat surface can stay on the empty hero page. Seed one
 * user message for that case; existing conversations already have one.
 */
function ensureCommandUserMessage(invocation) {
  const session = invocation && invocation.agent && invocation.agent.session
  if (!session || typeof session.append !== 'function') return
  let messages = null
  try {
    messages = typeof session.deriveMessages === 'function' ? session.deriveMessages() : null
  } catch {
    messages = null
  }
  if (Array.isArray(messages) && messages.some((message) => message && (message.role === 'user' || message.role === 'assistant'))) return
  const seq = typeof session.seq === 'number' ? session.seq : 0
  if (seq > 20) return
  const raw = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
  if (raw === '') return
  try {
    session.append('user/message', {
      role: 'user',
      content: [{ type: 'text', text: `/image ${raw}` }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
  } catch (error) {
    console.warn('[image-studio] could not seed the new-conversation user message:', error instanceof Error ? error.message : String(error))
  }
}

const IMAGE_TOOL_NAME = 'image_studio_generate'

const IMAGE_TOOL_DESCRIPTION = [
  'Generate or edit an image with the DSH Image Studio.',
  'Call this whenever a user message begins with "/image" (shorthand: /image [agnes|gpt|grok|compatible] [1K|2K|4K] [16:9] <prompt>),',
  'or when the user asks to create or edit an image with the image studio.',
  'Pass the user\'s exact message as `request`; do not strip or rewrite it. The tool parses the shorthand and returns a markdown image.',
  'If this conversation already has a generated image, omit `fresh` to modify that image; set `fresh: true` only for a brand-new image.',
  'The tool result card displays the image; briefly summarize it and mention the local path instead of repeating the image markdown.',
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
      enum: ['agnes', 'openai', 'grok', 'openai-compatible'],
      description: 'Optional image provider override.',
    },
    size: { type: 'string', description: 'Optional size override, e.g. 2K or 1536x1024.' },
    ratio: { type: 'string', description: 'Optional aspect ratio override, e.g. 16:9.' },
    quality: { type: 'string', description: 'Optional quality override, e.g. high or medium.' },
    model: { type: 'string', description: 'Optional model override.' },
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

  const value = await generateImage(pluginConfig, input)
  if (store) store.set({ filePath: value.filePath, mime: value.mime, id: value.id })

  const extras = [value.model, value.size, value.ratio, value.quality].filter(Boolean).join(' · ')
  const reference = value.referenceCount > 0 ? ` · 基于 ${value.referenceCount} 张参考图` : ''
  const markdown = [
    `已生成图片 · ${value.providerLabel} · ${extras}${reference} · ${(value.elapsedMs / 1000).toFixed(1)}s`,
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
        'The tool result card displays the image; briefly summarize it and mention the local path instead of repeating the image markdown.',
      ].join(' '),
    }),
    'image-studio: prompt',
  )
}

function registerCommand(ctx, pluginConfig) {  ctx.inject(['commands'], (commandsCtx) => {
    commandsCtx.effect(() => {
      try {
        return commandsCtx.commands.register({
          name: 'image',
          description: '用生图工作台生成/修改图片：/image [gpt|grok|agnes] [2k] [16:9] <提示词>；同一对话后续默认修改上一张，--new 重新生成',
          input: { hint: '例如：/image gpt 2k 16:9 一只猫；同一对话再发 /image 会基于上一张修改，--new 重新生成' },
          async handler(invocation) {
            const parsed = parseImageCommand(invocation.rawInput ?? '')
            if (parsed.prompt === '') {
              return { kind: 'error', text: '用法：/image [--new] [--provider agnes|openai|grok|openai-compatible] [--size …] [--ratio …] <提示词>' }
            }
            ensureCommandUserMessage(invocation)
            const store = commandImageStore(invocation)
            const previous = store ? store.get() : null
            const usePrevious = parsed.fresh !== true && previous !== undefined && previous !== null
            if (usePrevious) {
              const reference = await readCommandReference(previous)
              if (reference === null) {
                return { kind: 'error', text: '上一张图已不存在或超过 12MB，无法继续修改；用 /image --new <提示词> 重新生成。' }
              }
              parsed.referenceImages = [reference]
            }
            try {
              const value = await generateImage(pluginConfig, parsed)
              if (store) {
                store.set({ filePath: value.filePath, mime: value.mime, id: value.id })
              }
              return { kind: 'success', text: formatCommandResult(value) }
            } catch (error) {
              return { kind: 'error', text: formatCommandError(error) }
            }
          },
        })
      } catch (error) {
        console.warn('[image-studio] /image command not registered:', error instanceof Error ? error.message : String(error))
        return () => {}
      }
    }, 'image-studio: /image command')
  })
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const pluginConfig = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {}
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createRouteHandler(pluginConfig),
    }),
    'image-studio: HTTP routes',
  )
  registerImageTool(ctx, pluginConfig)
}
