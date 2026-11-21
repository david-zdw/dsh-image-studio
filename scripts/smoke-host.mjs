/**
 * Multi-provider host smoke test: mock Agnes, OpenAI, Grok, and a custom
 * OpenAI-compatible endpoint. Exercises per-provider keys, request bodies,
 * status, generation, history, files, and /image.
 *
 * Run with DSH_HOME pointed at a temp directory:
 *   DSH_HOME=... node scripts/smoke-host.mjs
 */
import http from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The suite creates and deletes an isolated image-studio storage folder.
// Never let it point at the real profile: prefer an explicit temp DSH_HOME,
// otherwise create one, and redirect any attempt to use the live ~/.dsh.
const realDshHome = path.resolve(os.homedir(), '.dsh')
const requestedHome = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : ''
const samePath = (a, b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase()
  : a === b
const ownsSandbox = !requestedHome || samePath(requestedHome, realDshHome)
const sandboxHome = ownsSandbox
  ? await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-image-studio-smoke-'))
  : requestedHome
process.env.DSH_HOME = sandboxHome
console.log(`smoke: DSH_HOME=${sandboxHome}`)
const { apply, executeImageTool } = await import('../lib/index.js')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
// Big enough to trigger the parallel range download path (> 1.2MB).
const BIG_PNG = Buffer.concat([PNG, Buffer.alloc(1_500_000, 0x5a)])
let upstreamPort = 0

const requests = []
const upstream = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/gallery/data/pose-zh.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify([
      { id: 'pose-1', '姿势名称': '测试站姿', '体系': '全身单人・标准系', '分类': '站姿', '缩略图': 'thumbs/pose-1.png', '原图': 'img/pose-1.png', '检索': 'pose-1 测试站姿' },
      { id: 'bad', '姿势名称': '坏数据', '缩略图': '../secret.png' },
    ]))
    return
  }
  if (req.method === 'GET' && (req.url === '/gallery/thumbs/pose-1.png' || req.url === '/gallery/img/pose-1.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length })
    res.end(PNG)
    return
  }
  if (req.method === 'GET' && req.url === '/download.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length })
    res.end(PNG)
    return
  }
  if (req.method === 'GET' && req.url === '/big.png') {
    const range = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range || ''))
    if (range) {
      const start = Number(range[1])
      const end = Math.min(Number(range[2]), BIG_PNG.length - 1)
      const chunk = BIG_PNG.subarray(start, end + 1)
      res.writeHead(206, {
        'Content-Type': 'image/png',
        'Content-Length': chunk.length,
        'Content-Range': `bytes ${start}-${end}/${BIG_PNG.length}`,
        'Accept-Ranges': 'bytes',
      })
      res.end(chunk)
      return
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': BIG_PNG.length,
      'Accept-Ranges': 'bytes',
    })
    res.end(BIG_PNG)
    return
  }
  const modelsMatch = /^\/(agnes|openai|grok|custom)\/v1\/models$/.exec(req.url || '')
  if (req.method === 'GET' && modelsMatch) {
    const catalog = {
      agnes: ['agnes-image-2.5-flash', 'agnes-image-2.0-flash', 'agnes-chat-pro'],
      openai: ['gpt-image-1.5', 'gpt-image-1', 'text-embedding-3-small'],
      grok: ['grok-imagine-image-2.0', 'grok-2-image-1212'],
      custom: ['my-image-model', 'my-chat-model'],
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: catalog[modelsMatch[1]].map((id) => ({ id })) }))
    return
  }
  const match = /^\/(agnes|openai|grok|custom)\/v1\/images\/(generations|edits)$/.exec(req.url || '')
  if (req.method === 'POST' && match) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const contentType = req.headers['content-type'] || ''
    let body = null
    if (!/multipart\/form-data/i.test(contentType)) {
      try { body = JSON.parse(raw) } catch { body = null }
    }
    if (body && body.prompt === 'force-open') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
      setTimeout(() => res.end(), 3000)
      return
    }
    if (body && body.prompt === 'force-404-param') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Parameter error.Plase check your request parameters.' } }))
      return
    }
    if (body && body.prompt === 'force-safety') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'rejected by the safety system', safety_violations: ['sexual'] } }))
      return
    }
    if (body && body.prompt === 'force-524') {
      res.writeHead(524, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'proxy read timeout' } }))
      return
    }
    if (body && body.prompt === 'return-url') {
      requests.push({ provider: match[1], auth: req.headers.authorization, body, raw, contentType, path: req.url })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${upstreamPort}/big.png` }] }))
      return
    }
    if (body && body.prompt === 'reject-b64') {
      requests.push({ provider: match[1], auth: req.headers.authorization, body, raw, contentType, path: req.url })
      if (body.response_format !== undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unknown parameter: response_format' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
      return
    }
    const provider = match[1]
    requests.push({ provider, auth: req.headers.authorization, body, raw, contentType, path: req.url })
    if (provider === 'grok' && match[2] === 'generations') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
    return
  }
  res.writeHead(404).end('not found')
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const port = upstream.address().port
upstreamPort = port

const commands = []
const tools = []
let route
const ctx = {
  webServer: {
    getOrigin() {
      return origin
    },
    register(candidate) {
      route = candidate
      return () => {}
    },
  },
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
  systemPrompt: {
    section() {
      return () => {}
    },
  },
  effect(fn) {
    return fn()
  },
  inject(deps, callback) {
    if (deps.includes('commands')) {
      callback({
        commands: {
          register(definition) {
            commands.push(definition)
            return () => {}
          },
        },
        effect(fn) {
          return fn()
        },
      })
    }
  },
}

const pluginConfig = {}
apply(ctx, pluginConfig)

const server = http.createServer((req, res) => {
  route.handler(req, res).catch((error) => {
    res.writeHead(500).end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
pluginConfig.galleryBaseUrl = `http://127.0.0.1:${port}/gallery`

async function call(pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`)
  console.log(`ok - ${message}`)
}

const storage = path.join(process.env.DSH_HOME, 'image-studio')
await fs.mkdir(storage, { recursive: true })

// Legacy v1 files must still resolve as Agnes.
await fs.writeFile(path.join(storage, 'config.json'), JSON.stringify({
  baseUrl: `http://127.0.0.1:${port}/agnes`,
  model: 'agnes-image-2.5-flash',
}))
await fs.writeFile(path.join(storage, 'credentials.json'), JSON.stringify({ apiKey: 'sk-legacy-1234567890' }))

let result = await call('/image-studio/status')
assert(result.status === 200 && result.json.ok === true, 'status responds')
assert(result.json.value.providers.length === 5, 'five provider profiles')
assert(result.json.value.providers.some((item) => item.id === 'minimax'), 'MiniMax H3 provider is exposed')
assert(typeof result.json.value.version === 'string' && /^\d+\.\d+\.\d+$/.test(result.json.value.version), 'status reports the package version')
const agnes = result.json.value.providers.find((item) => item.id === 'agnes')
assert(agnes.configured === true && agnes.masked === 'sk-l…7890', 'legacy Agnes key migrates to the per-provider file')
assert(agnes.baseUrl === `http://127.0.0.1:${port}/agnes`, 'legacy Agnes baseUrl migrates')
assert(result.json.value.theme === 'auto', 'status exposes the default auto theme')
assert(Array.isArray(result.json.value.themeOptions) && result.json.value.themeOptions.length === 5
  && result.json.value.themeOptions.some((item) => item.id === 'mist' && item.label === '雾青'), 'status exposes five theme options')

// Theme selection persists, and unknown ids are rejected without changing it.
result = await call('/image-studio/setup', { method: 'POST', body: { theme: 'neon' } })
assert(result.status === 422, 'unknown theme is rejected')
result = await call('/image-studio/setup', { method: 'POST', body: { theme: 'mist' } })
assert(result.status === 200 && result.json.value.theme === 'mist', 'theme selection saves')
result = await call('/image-studio/status')
assert(result.json.value.theme === 'mist', 'saved theme is returned by status')

// Add keys/config for the other three providers.
for (const setup of [
  {
    providerId: 'openai',
    apiKey: 'sk-openai-1234567890',
    baseUrl: `http://127.0.0.1:${port}/openai`,
    model: 'gpt-image-1.5',
    size: '1024x1024',
    quality: 'high',
  },
  {
    providerId: 'grok',
    apiKey: 'xai-grok-1234567890',
    baseUrl: `http://127.0.0.1:${port}/grok`,
    model: 'grok-imagine-image-2.0',
    size: '1K',
    ratio: '16:9',
    quality: 'medium',
  },
  {
    providerId: 'minimax',
    apiKey: 'sk-minimax-1234567890',
    baseUrl: `http://127.0.0.1:${port}/minimax`,
    model: 'MiniMax-H3-Image',
    size: '2K',
    ratio: '16:9',
  },
  {
    providerId: 'openai-compatible',
    apiKey: 'sk-compat-1234567890',
    baseUrl: `http://127.0.0.1:${port}/custom`,
    model: 'my-image-model',
    endpointPath: '/v1/images/generations',
    size: '1024x1024',
  },
]) {
  result = await call('/image-studio/setup', { method: 'POST', body: setup })
  assert(result.status === 200 && result.json.ok === true, `setup ${setup.providerId}`)
}
assert(result.json.value.providers.length === 5, 'setup returns provider roster')
assert(result.json.value.providers.every((item) => item.configured), 'all five providers are configured')

// Model sniffing uses the saved key and derives /v1/models from the image path.
result = await call('/image-studio/models', { method: 'POST', body: { provider: 'agnes' } })
assert(result.status === 200 && result.json.value.models.some((item) => item.id === 'agnes-image-2.5-flash' && item.imageLike), 'agnes model sniffing returns image models')
result = await call('/image-studio/models', { method: 'POST', body: { provider: 'openai' } })
assert(result.status === 200 && result.json.value.models.some((item) => item.id === 'gpt-image-1.5'), 'openai model sniffing returns gpt-image')
result = await call('/image-studio/models', { method: 'POST', body: { provider: 'grok' } })
assert(result.status === 200 && result.json.value.models.some((item) => item.id === 'grok-imagine-image-2.0'), 'grok model sniffing returns imagine models')
result = await call('/image-studio/models', { method: 'POST', body: { provider: 'openai-compatible' } })
assert(result.status === 200 && result.json.value.models.some((item) => item.id === 'my-image-model'), 'compatible model sniffing works')
result = await call('/image-studio/models', { method: 'POST', body: { provider: 'nope' } })
assert(result.status === 422, 'unknown provider model sniffing is rejected')

// Agnes body + legacy key.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'agnes', prompt: 'a cat', size: '2K', ratio: '16:9' },
})
assert(result.status === 200 && result.json.ok === true, 'agnes generate')
const agnesRequest = requests.findLast((item) => item.provider === 'agnes')
assert(agnesRequest.auth === 'Bearer sk-legacy-1234567890', 'agnes uses only its own key')
assert(JSON.stringify(agnesRequest.body) === JSON.stringify({
  model: 'agnes-image-2.5-flash',
  prompt: 'a cat',
  size: '2K',
  ratio: '16:9',
  return_base64: true,
}), 'agnes body matches canvas contract')

// Async job mode: /generate returns a job id at once and /jobs/<id> carries
// the finished image, so a panel that navigated away still collects it.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'agnes', prompt: 'async cat', size: '2K', ratio: '16:9', async: true },
})
assert(result.status === 200 && result.json.value.status === 'running' && /^job-/.test(result.json.value.id), 'async generate returns a running job')
const jobId = result.json.value.id
result = await call('/image-studio/jobs')
assert(result.status === 200 && result.json.value.active.some((item) => item.id === jobId), 'active job is listed')
let jobState = null
for (let attempt = 0; attempt < 50; attempt += 1) {
  result = await call(`/image-studio/jobs/${encodeURIComponent(jobId)}`)
  assert(result.status === 200, 'job poll succeeds')
  jobState = result.json.value
  if (jobState.status !== 'running') break
  await new Promise((resolve) => setTimeout(resolve, 40))
}
assert(jobState.status === 'done', 'async job finishes')
assert(/^https?:[/][/]/.test(jobState.result.url), 'async job result URL is absolute')
assert(jobState.result.url.startsWith(origin), 'async job result uses the request origin')
const asyncHistory = await call('/image-studio/history')
assert(asyncHistory.json.value.items.some((item) => item.id === jobState.result.id), 'async job is saved to history')
result = await call('/image-studio/jobs/job-does-not-exist')
assert(result.status === 404, 'unknown job is 404')

// OpenAI GPT Image body + key.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'a dog', model: 'gpt-image-1.5', size: '1024x1024', quality: 'high' },
})
assert(result.status === 200 && result.json.ok === true, 'openai generate')
const openaiRequest = requests.findLast((item) => item.provider === 'openai')
assert(openaiRequest.auth === 'Bearer sk-openai-1234567890', 'openai uses its own key')
assert(JSON.stringify(openaiRequest.body) === JSON.stringify({
  model: 'gpt-image-1.5',
  prompt: 'a dog',
  n: 1,
  size: '1024x1024',
  quality: 'high',
  response_format: 'b64_json',
}), 'openai body is standard Images API + inline base64')

// URL replies are downloaded with parallel range requests; relays that reject
// response_format get an automatic retry without it.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'return-url', model: 'gpt-image-1.5', size: '1024x1024' },
})
assert(result.status === 200 && result.json.ok === true, 'url reply downloads the image')
assert(result.json.value.sourceKind === 'url', 'url reply is recorded as url source')
assert(result.json.value.downloadMode === 'range', 'url reply downloads with parallel ranges')
assert(result.json.value.bytes === BIG_PNG.length, 'url reply bytes match the served file')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'reject-b64', model: 'gpt-image-1.5', size: '1024x1024' },
})
assert(result.status === 200 && result.json.ok === true, 'response_format rejection falls back to url/base64 default')
const b64Attempts = requests.filter((item) => item.body && item.body.prompt === 'reject-b64')
assert(b64Attempts.length === 2, 'response_format rejection retried exactly once')
assert(b64Attempts[1].body.response_format === undefined, 'retry drops response_format')
assert(result.json.value.b64Retry === true, 'telemetry records b64Retry when fallback happened')

// Grok body + URL download.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'grok', prompt: 'a fox', model: 'grok-imagine-image-2.0', size: '1K', ratio: '16:9', quality: 'medium' },
})
assert(result.status === 200 && result.json.ok === true, 'grok generate (b64 result decodes)')
const grokRequest = requests.findLast((item) => item.provider === 'grok')
assert(grokRequest.auth === 'Bearer xai-grok-1234567890', 'grok uses its own key')
assert(JSON.stringify(grokRequest.body) === JSON.stringify({
  model: 'grok-imagine-image-2.0',
  prompt: 'a fox',
  n: 1,
  response_format: 'b64_json',
  aspect_ratio: '16:9',
  resolution: '1k',
  quality: 'medium',
}), 'grok body uses aspect_ratio + resolution')

// Custom OpenAI-compatible body + key.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai-compatible', prompt: 'a bird', model: 'my-image-model', size: '1024x1024' },
})
assert(result.status === 200 && result.json.ok === true, 'openai-compatible generate')
const customRequest = requests.findLast((item) => item.provider === 'custom')
assert(customRequest.auth === 'Bearer sk-compat-1234567890', 'custom provider uses its own key')
assert(JSON.stringify(customRequest.body) === JSON.stringify({
  model: 'my-image-model',
  prompt: 'a bird',
  n: 1,
  size: '1024x1024',
  response_format: 'b64_json',
}), 'custom body asks for inline base64, no auto quality')

// /image is a model-facing tool; request parsing and same-conversation editing.
const toolDef = tools.find((item) => item.name === 'image_studio_generate')
assert(toolDef !== undefined, 'image_studio_generate tool registered')
assert(toolDef.parameters.properties.request !== undefined, 'tool accepts the exact /image request')
assert(typeof toolDef.output.render === 'function', 'tool renders its markdown result')

const shortGpt = await executeImageTool({}, { request: '/image gpt 2k 16:9 a rabbit' })
assert(shortGpt.markdown.includes('OpenAI'), 'tool shorthand gpt reports the provider')
const shortGptRequest = requests.findLast((item) => item.provider === 'openai')
assert(shortGptRequest.body.prompt === 'a rabbit', 'tool shorthand keeps the prompt')
assert(shortGptRequest.body.size === '1536x1024', 'tool gpt 2k 16:9 maps to a 2K-ish landscape GPT size')

const shortGrok = await executeImageTool({}, { request: '/image grok 2k 9:16 a fox' })
assert(shortGrok.markdown.includes('Grok Image'), 'tool shorthand grok reports the provider')
const shortGrokRequest = requests.findLast((item) => item.provider === 'grok')
assert(shortGrokRequest.body.resolution === '2k', 'tool grok 2k keeps the native 2K tier')
assert(shortGrokRequest.body.aspect_ratio === '9:16', 'tool grok 9:16 keeps the ratio')

const shortAgnes = await executeImageTool({}, { request: '/image agnes 1k 1:1 a cat' })
assert(shortAgnes.markdown.includes('Agnes'), 'tool shorthand agnes succeeds')
const shortAgnesRequest = requests.findLast((item) => item.provider === 'agnes')
assert(shortAgnesRequest.body.size === '1K' && shortAgnesRequest.body.ratio === '1:1', 'tool agnes shorthand keeps tier + ratio')

const shortDefault = await executeImageTool({}, { request: '/image 2k 16:9 a default cat' })
assert(shortDefault.markdown.includes('已生成图片'), 'tool shorthand without provider uses the default')

const explicitGrok = await executeImageTool({}, { request: '/image --provider grok --size 2K --ratio 1:1 --quality low a whale' })
assert(explicitGrok.markdown.includes('Grok Image'), 'tool succeeds with --provider')
assert(requests.findLast((item) => item.provider === 'grok').body.prompt === 'a whale', 'tool parses the prompt')
assert(requests.findLast((item) => item.provider === 'grok').body.resolution === '2k', 'tool parses --size')
assert(requests.findLast((item) => item.provider === 'grok').body.aspect_ratio === '1:1', 'tool parses --ratio')

// Same-conversation tool calls: first is text-to-image, next auto-edits, fresh resets.
const toolSession = { id: 'smoke-tool-session' }
const firstConversation = await executeImageTool({}, { request: '/image agnes 1k 1:1 a cat' }, { agent: { session: toolSession } })
assert(firstConversation.referenceCount === 0, 'first tool call is text-to-image')
const secondConversation = await executeImageTool({}, { request: '/image make it blue' }, { agent: { session: toolSession } })
assert(secondConversation.referenceCount === 1 && secondConversation.markdown.includes('基于 1 张参考图'), 'follow-up tool call auto-edits the last image')
const secondConversationRequest = requests.findLast((item) => item.provider === 'agnes')
assert(secondConversationRequest.body.extra_body && secondConversationRequest.body.extra_body.image.length === 1, 'follow-up tool sends the previous image as reference')
const freshConversation = await executeImageTool({}, { request: '/image --new agnes 1k 1:1 a dog' }, { agent: { session: toolSession } })
assert(freshConversation.referenceCount === 0, '--new resets to text-to-image')
const freshConversationRequest = requests.findLast((item) => item.provider === 'agnes')
assert(!freshConversationRequest.body.extra_body, '--new does not send a reference')

// Image-to-image: Agnes JSON extra_body / OpenAI multipart / Grok JSON edits.
result = await call('/image-studio/setup', {
  method: 'POST',
  body: { providerId: 'openai', apiKey: 'sk-openai-1234567890' },
})
assert(result.status === 200, 'openai key restored for img2img tests')
const reference = `data:image/png;base64,${PNG.toString('base64')}`

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'agnes', prompt: 'paint it blue', size: '2K', ratio: '1:1', referenceImages: [reference] },
})
assert(result.status === 200 && result.json.ok === true, 'agnes img2img succeeds')
const agnesEdit = requests.findLast((item) => item.provider === 'agnes' && item.path.includes('/generations'))
assert(Array.isArray(agnesEdit.body.extra_body.image) && agnesEdit.body.extra_body.image[0] === reference, 'agnes sends extra_body.image')
assert(result.json.value.referenceCount === 1, 'agnes record counts the reference')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'edit this apple', model: 'gpt-image-1.5', size: '1024x1024', quality: 'high', referenceImages: [reference] },
})
assert(result.status === 200 && result.json.ok === true, 'openai img2img succeeds')
const openaiEdit = requests.findLast((item) => item.provider === 'openai')
assert(openaiEdit.path.endsWith('/v1/images/edits'), 'openai uses images/edits')
assert(/multipart\/form-data/i.test(openaiEdit.contentType), 'openai sends multipart/form-data')
assert(openaiEdit.raw.includes('name="prompt"') && openaiEdit.raw.includes('edit this apple'), 'openai multipart carries the prompt')
assert(openaiEdit.raw.includes('name="image"') && openaiEdit.raw.includes('filename="reference-1.png"'), 'openai multipart carries the reference file')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'grok', prompt: 'make it night', size: '2K', ratio: '16:9', quality: 'low', referenceImages: [reference] },
})
assert(result.status === 200 && result.json.ok === true, 'grok img2img succeeds')
const grokEdit = requests.findLast((item) => item.provider === 'grok')
assert(grokEdit.path.endsWith('/v1/images/edits'), 'grok uses images/edits')
assert(Array.isArray(grokEdit.body.images) && grokEdit.body.images[0] === reference, 'grok sends images[]')
assert(grokEdit.body.aspect_ratio === '16:9' && grokEdit.body.resolution === '2k', 'grok edit keeps ratio/resolution')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai-compatible', prompt: 'custom edit', model: 'my-image-model', size: '1024x1024', referenceImages: [reference] },
})
assert(result.status === 200 && result.json.ok === true, 'custom img2img succeeds')
const customEdit = requests.findLast((item) => item.provider === 'custom')
assert(customEdit.path.endsWith('/v1/images/edits'), 'custom uses images/edits')
assert(/multipart\/form-data/i.test(customEdit.contentType), 'custom sends multipart/form-data')

// Multiple reference images: up to five, provider-specific carriers.
const twoReferences = [reference, reference]
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'agnes', prompt: 'combine both references', size: '2K', ratio: '1:1', referenceImages: twoReferences },
})
assert(result.status === 200 && result.json.value.referenceCount === 2, 'agnes accepts two references')
const agnesMulti = requests.findLast((item) => item.provider === 'agnes' && item.path.includes('/generations'))
assert(agnesMulti.body.extra_body.image.length === 2, 'agnes sends both reference images')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'combine both references', model: 'gpt-image-1.5', size: '1024x1024', referenceImages: twoReferences },
})
assert(result.status === 200 && result.json.value.referenceCount === 2, 'openai accepts two references')
const openaiMulti = requests.findLast((item) => item.provider === 'openai')
assert((openaiMulti.raw.match(/name="image"/g) || []).length === 2, 'openai multipart repeats the image field')
assert(openaiMulti.raw.includes('filename="reference-2.png"'), 'openai multipart names the second reference')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'grok', prompt: 'combine both references', size: '2K', ratio: '16:9', referenceImages: twoReferences },
})
assert(result.status === 200 && result.json.value.referenceCount === 2, 'grok accepts two references')
const grokMulti = requests.findLast((item) => item.provider === 'grok')
assert(grokMulti.body.images.length === 2, 'grok sends both images[] entries')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'agnes', prompt: 'x', referenceImages: Array.from({ length: 6 }, () => reference) },
})
assert(result.status === 422 && /最多 5 张/.test(result.json.error.message), 'more than five references is rejected')


result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'x', model: 'dall-e-3', referenceImages: [reference] },
})
assert(result.status === 422 && /DALL·E 3/.test(result.json.error.message), 'DALL-E 3 reference is rejected clearly')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'agnes', prompt: 'x', referenceImages: ['not-an-image'] },
})
assert(result.status === 422 && /参考图/.test(result.json.error.message), 'invalid reference is rejected clearly')

result = await call('/image-studio/history')
assert(result.json.value.items.some((item) => item.referenceCount >= 1), 'history records reference count')

// Prompt library: source metadata is static, unknown sources are rejected.
let promptCheck = await call('/image-studio/prompts/sources')
assert(promptCheck.status === 200 && promptCheck.json.value.length >= 3, 'prompt sources are listed')
assert(promptCheck.json.value.some((item) => item.id === 'upma' && /UPMA/.test(item.label)), 'UPMA prompt source is listed')
assert(promptCheck.json.value.some((item) => item.id === 'navxd' && item.filters.styles.length > 1), 'prompt source exposes its filters')
promptCheck = await call('/image-studio/prompts/catalog?source=unknown')
assert(promptCheck.status === 422, 'unknown prompt source is rejected')

// Reference gallery: host proxies the index and images, path-restricted.
let galleryCheck = await call('/image-studio/gallery/catalog?library=pose')
assert(galleryCheck.status === 200 && galleryCheck.json.value.items.length === 1, 'gallery catalog normalizes records')
const galleryItem = galleryCheck.json.value.items[0]
assert(galleryItem.title === '测试站姿' && galleryItem.thumb === 'thumbs/pose-1.png', 'gallery keeps the chinese title and thumb path')
const galleryImage = await fetch(`${origin}/image-studio/gallery/image?path=${encodeURIComponent(galleryItem.thumb)}`)
assert(galleryImage.status === 200 && galleryImage.headers.get('content-type') === 'image/png', 'gallery image proxy serves bytes')
assert(galleryImage.headers.get('x-image-studio-cache') === 'miss', 'first gallery thumb fetch populates disk cache')
const galleryImageCached = await fetch(`${origin}/image-studio/gallery/image?path=${encodeURIComponent(galleryItem.thumb)}`)
assert(galleryImageCached.status === 200 && galleryImageCached.headers.get('x-image-studio-cache') === 'hit', 'second gallery thumb fetch hits disk cache')
const galleryEtag = galleryImageCached.headers.get('etag')
assert(Boolean(galleryEtag), 'cached blob exposes an ETag')
const galleryNotModified = await fetch(`${origin}/image-studio/gallery/image?path=${encodeURIComponent(galleryItem.thumb)}`, {
  headers: { 'If-None-Match': galleryEtag },
})
assert(galleryNotModified.status === 304, 'If-None-Match returns 304 from disk cache')
galleryCheck = await call('/image-studio/gallery/reference', { method: 'POST', body: { path: 'thumbs/pose-1.png' } })
assert(galleryCheck.status === 200 && /^data:image\/png;base64,/.test(galleryCheck.json.value.dataUrl), 'gallery reference import returns a data url')
assert(galleryCheck.json.value.cacheHit === true, 'gallery reference reuses cached thumb blob')
galleryCheck = await call('/image-studio/gallery/reference', { method: 'POST', body: { path: 'img/pose-1.png', fallbackPath: 'thumbs/pose-1.png' } })
assert(galleryCheck.status === 200 && galleryCheck.json.value.path === 'img/pose-1.png', 'gallery reference prefers the full image')
const cacheStatus = await call('/image-studio/cache/status')
assert(cacheStatus.status === 200 && cacheStatus.json.value.thumbCount >= 1 && cacheStatus.json.value.fullCount >= 1, 'cache status reports tiered thumb + full counts')
assert(cacheStatus.json.value.metaFiles >= 1, 'cache status reports persisted metadata')
const cacheCleared = await call('/image-studio/cache/clear', { method: 'POST', body: { scope: 'images' } })
assert(cacheCleared.status === 200 && cacheCleared.json.value.blobBytes === 0, 'clearing image cache empties blob ledger')
galleryCheck = await call('/image-studio/gallery/catalog?library=nope')
assert(galleryCheck.status === 422, 'unknown gallery library is rejected')
const galleryTraversal = await fetch(`${origin}/image-studio/gallery/image?path=${encodeURIComponent('../secret.png')}`)
assert(galleryTraversal.status === 404, 'gallery image refuses traversal')

// Offline resource packs: manifest import, prompt/gallery catalogs, local image serving.
const offlineRoot = path.join(process.env.DSH_HOME, 'offline-fixture')
await fs.mkdir(path.join(offlineRoot, 'img'), { recursive: true })
await fs.writeFile(path.join(offlineRoot, 'img', 'prompt-1.png'), PNG)
await fs.writeFile(path.join(offlineRoot, 'img', 'pose-1.png'), PNG)
await fs.writeFile(path.join(offlineRoot, 'prompts.json'), JSON.stringify({
  id: 'demo-prompts',
  label: '演示提示词包',
  home: 'https://example.com/prompts',
  items: [
    { id: 'p1', title: '测试提示词', prompt: '一只戴帽子的测试猫', image: 'img/prompt-1.png', category: '测试分类', styles: ['扁平插画'], scenes: ['室内'] },
    { id: 'bad', title: '坏数据', prompt: '不能读取', image: '../secret.png' },
  ],
}))
await fs.writeFile(path.join(offlineRoot, 'gallery.json'), JSON.stringify({
  id: 'demo-gallery',
  label: '演示参考图包',
  items: [
    { id: 'g1', title: '测试姿势', thumb: 'img/pose-1.png', full: 'img/pose-1.png', category: '站姿', group: '测试系' },
  ],
}))
promptCheck = await call('/image-studio/offline/import', {
  method: 'POST',
  body: { kind: 'prompts', manifestPath: path.join(offlineRoot, 'prompts.json') },
})
assert(promptCheck.status === 200 && promptCheck.json.value.pack.itemCount === 1, 'offline prompt pack imports and skips unsafe assets')
promptCheck = await call('/image-studio/offline/import', {
  method: 'POST',
  body: {
    kind: 'gallery',
    baseDir: offlineRoot,
    manifest: { id: 'demo-gallery', label: '演示参考图包', items: [{ id: 'g1', title: '测试姿势', thumb: 'img/pose-1.png', full: 'img/pose-1.png', category: '站姿', group: '测试系' }] },
  },
})
assert(promptCheck.status === 200 && promptCheck.json.value.pack.itemCount === 1, 'offline gallery pack imports from direct manifest')
promptCheck = await call('/image-studio/offline/packs')
assert(promptCheck.status === 200 && promptCheck.json.value.prompts.length === 1 && promptCheck.json.value.gallery.length === 1, 'offline packs are listed by kind')
promptCheck = await call('/image-studio/prompts/sources')
assert(promptCheck.json.value.some((item) => item.id === 'offline:demo-prompts' && item.offline === true && item.itemCount === 1), 'offline prompt source is exposed')
promptCheck = await call('/image-studio/prompts/catalog?source=offline%3Ademo-prompts')
assert(promptCheck.status === 200 && promptCheck.json.value.items[0].prompt === '一只戴帽子的测试猫', 'offline prompt catalog returns normalized items')
assert(/^offline:\/\/demo-prompts\//.test(promptCheck.json.value.items[0].image), 'offline prompt keeps a confined image reference')
const offlinePromptImage = await fetch(`${origin}/image-studio/prompts/image?source=${encodeURIComponent('offline:demo-prompts')}&url=${encodeURIComponent(promptCheck.json.value.items[0].image)}`)
assert(offlinePromptImage.status === 200 && offlinePromptImage.headers.get('content-type') === 'image/png', 'offline prompt image is served from disk')
promptCheck = await call('/image-studio/gallery/libraries')
assert(promptCheck.status === 200 && promptCheck.json.value.some((item) => item.id === 'offline:demo-gallery' && item.itemCount === 1), 'offline gallery library is exposed')
promptCheck = await call('/image-studio/gallery/catalog?library=offline%3Ademo-gallery')
assert(promptCheck.status === 200 && promptCheck.json.value.items[0].title === '测试姿势', 'offline gallery catalog returns items')
const offlineGalleryImage = await fetch(`${origin}/image-studio/gallery/image?path=${encodeURIComponent('offline://demo-gallery/img/pose-1.png')}`)
assert(offlineGalleryImage.status === 200 && offlineGalleryImage.headers.get('content-type') === 'image/png', 'offline gallery image is served from disk')
const offlineFile = await fetch(`${origin}/image-studio/offline/file?kind=gallery&pack=demo-gallery&path=${encodeURIComponent('img/pose-1.png')}`)
assert(offlineFile.status === 200 && offlineFile.headers.get('content-type') === 'image/png', 'offline file route serves pack assets')
promptCheck = await call('/image-studio/gallery/reference', { method: 'POST', body: { path: 'offline://demo-gallery/img/pose-1.png' } })
assert(promptCheck.status === 200 && /^data:image\/png;base64,/.test(promptCheck.json.value.dataUrl), 'offline gallery image can be added as a reference')
promptCheck = await call('/image-studio/offline/remove', { method: 'POST', body: { kind: 'prompts', id: 'demo-prompts' } })
assert(promptCheck.status === 200 && promptCheck.json.value.removed === true, 'offline prompt pack removes')
promptCheck = await call('/image-studio/offline/remove', { method: 'POST', body: { kind: 'gallery', id: 'demo-gallery' } })
assert(promptCheck.status === 200 && promptCheck.json.value.removed === true, 'offline gallery pack removes')

// File route + delete from history/disk.
const historyItem = result.json.value.items[0]
assert(/^https?:[/][/]/.test(historyItem.url), 'history image URL is absolute')
assert(historyItem.url.startsWith(origin), 'history image URL uses the request origin')
const historyUrl = new URL(historyItem.url, origin)
const historyDownloadUrl = new URL(historyUrl)
historyDownloadUrl.searchParams.set('download', '1')
const historyFile = await fetch(historyUrl)
assert(historyFile.status === 200 && historyFile.headers.get('content-type') === 'image/png', 'file route serves PNG')
assert(historyFile.headers.get('access-control-allow-origin') === '*', 'file route allows cross-origin image fetch')
const historyDownload = await fetch(historyDownloadUrl)
assert(historyDownload.status === 200 && /attachment/.test(historyDownload.headers.get('content-disposition') || ''), 'download route sends an attachment')
result = await call(`/image-studio/history/${encodeURIComponent(historyItem.id)}`, { method: 'DELETE' })
assert(result.status === 200 && result.json.value.deleted === true, 'delete removes the history item')
const deletedFile = await fetch(historyUrl)
assert(deletedFile.status === 404, 'delete removes the image file')
result = await call('/image-studio/history')
assert(!result.json.value.items.some((item) => item.id === historyItem.id), 'deleted item is gone from history')

// Selected models persist and drive the panel list; a custom GPT model exposes 4K + ratio.
result = await call('/image-studio/setup', {
  method: 'POST',
  body: {
    providerId: 'openai',
    model: 'gpt-image-2.5-sunburst',
    models: ['gpt-image-2.5-sunburst', 'gpt-image-1.5'],
    size: '4K',
    ratio: '1:1',
  },
})
assert(result.status === 200, 'setup saves selected models')
const customized = result.json.value.providers.find((item) => item.id === 'openai')
assert(JSON.stringify(customized.models) === JSON.stringify(['gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst', 'gpt-image-1.5']), 'selected models plus the newest default are exposed')
assert(customized.size === '4K', 'custom GPT model exposes the 4K tier')
assert(customized.supportsRatio === true, 'custom GPT model supports ratio')
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', model: 'gpt-image-2.5-sunburst', prompt: 'a 4k cover', size: '4K', ratio: '16:9' },
})
assert(result.status === 200, 'custom GPT 4K generation succeeds')
assert(requests.findLast((item) => item.provider === 'openai').body.size === '3840x2160', '4K + 16:9 maps to 3840x2160')

assert(result.json.value.size === '3840x2160', 'result records the computed pixel size')
// A compatible endpoint follows the schema chosen for it.
result = await call('/image-studio/setup', {
  method: 'POST',
  body: { providerId: 'openai-compatible', schema: 'minimax', model: 'MiniMax-H3-Image' },
})
assert(result.status === 200, 'compatible schema saves')
let compat = result.json.value.providers.find((item) => item.id === 'openai-compatible')
assert(compat.kind === 'minimax' && compat.maxReferenceImages === 16, 'compatible minimax exposes minimax capabilities')
assert(compat.supportsQuality === false && compat.sizes.includes('4K'), 'compatible minimax sizes and quality follow the schema')
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai-compatible', prompt: 'schema payload', model: 'MiniMax-H3-Image', size: '2K', ratio: '16:9' },
})
assert(result.status === 200, 'compatible minimax generation succeeds')
const compatBody = requests.findLast((item) => item.provider === 'custom').body
assert(compatBody.area === '2K' && compatBody.aspect_ratio === '16:9' && compatBody.size === 'auto', 'compatible minimax uses the minimax payload')
result = await call('/image-studio/setup', {
  method: 'POST',
  body: { providerId: 'openai-compatible', schema: 'openai', model: 'gpt-image-2.6-sunburst', size: '1K', ratio: '16:9', quality: 'high' },
})
compat = result.json.value.providers.find((item) => item.id === 'openai-compatible')
assert(compat.kind === 'openai' && compat.size === '1K', 'compatible schema switches back to openai')
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai-compatible', prompt: 'schema openai', model: 'gpt-image-2.6-sunburst', size: '1K', ratio: '16:9', quality: 'high' },
})
const openaiCompatBody = requests.findLast((item) => item.provider === 'custom').body
assert(openaiCompatBody.size === '1280x720' && openaiCompatBody.output_format === 'png', 'compatible openai uses the gpt-image payload')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', model: 'gpt-image-2.5-sunburst', prompt: 'a wide cover', size: '1K', ratio: '16:9' },
})
assert(result.status === 200, 'custom GPT 1K generation succeeds')
assert(requests.findLast((item) => item.provider === 'openai').body.size === '1280x720', '1K + 16:9 maps to 1280x720 (min pixel budget)')
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', model: 'gpt-image-2.5-sunburst', prompt: 'a 2k cover', size: '2K', ratio: '16:9', quality: 'xhigh' },
})
assert(result.status === 200, 'custom GPT 2K generation succeeds')
const twoK = requests.findLast((item) => item.provider === 'openai').body
assert(twoK.size === '2048x1152', '2K + 16:9 maps to 2048x1152')
assert(twoK.quality === 'xhigh', 'gpt-image-2.5 accepts xhigh quality')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: {
    provider: 'openai', model: 'gpt-image-2.6-sunburst', prompt: 'a 2.6 poster',
    size: '2K', ratio: '16:9', quality: 'high', complexity: 'medium', outputFormat: 'webp',
  },
})
assert(result.status === 200, 'gpt-image-2.6 generation succeeds')
const v26 = requests.findLast((item) => item.provider === 'openai').body
assert(v26.model === 'gpt-image-2.6-sunburst', 'gpt-image-2.6 model id is forwarded')
assert(v26.output_format === 'webp', 'gpt-image-2.6 sends output_format')
assert(v26.complexity === 'medium', 'gpt-image-2.6 sends complexity')
assert(v26.response_format === undefined, 'gpt-image-2.6 skips response_format to avoid 400/422 double-upload retries')
assert(v26.size === '2048x1152', 'gpt-image-2.6 keeps the 2K + 16:9 pixel size')
assert(result.json.value.outputFormat === 'webp', 'result records the output format')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: {
    provider: 'openai', model: 'gpt-image-2.6-sunburst', prompt: 'a lantern swaying',
    size: '1K', ratio: '1:1', outputFormat: 'gif', frameCount: 12, frameDurationMs: 120,
  },
})
assert(result.status === 200, 'gpt-image-2.6 GIF generation succeeds')
const gifBody = requests.findLast((item) => item.provider === 'openai').body
assert(gifBody.output_format === 'gif', 'GIF output_format is sent')
assert(gifBody.size === '512x512', 'GIF uses the per-frame 512x512 budget')
assert(gifBody.frame_count === 12 && gifBody.frame_duration_ms === 120, 'GIF frame settings are sent')
assert(gifBody.model === 'gpt-image-2.6-sunburst', 'GIF keeps the 2.6 model')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: {
    provider: 'openai', model: 'gpt-image-2.6-flare', prompt: 'a still frame',
    size: '1K', ratio: '1:1', outputFormat: 'png',
  },
})
assert(result.status === 200, 'gpt-image-2.6 flare generation succeeds')
assert(requests.findLast((item) => item.provider === 'openai').body.model === 'gpt-image-2.6-flare', 'flare model id is forwarded')


// Path traversal refusal.
result = await call('/image-studio/files/../credentials.json')
assert(result.status === 404, 'path traversal is refused')

// Upstream gateway timeout is explicit about not auto-retrying.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'force-524', model: 'gpt-image-1.5' },
})
assert(result.status === 504, 'HTTP 524 maps to timeout')
assert(/不要自动重试/.test(result.json.error.message), 'HTTP 524 tells the model not to auto-retry')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'force-404-param', model: 'gpt-image-1.5' },
})
assert(result.status === 502, 'upstream 404 parameter error is not a route error')
assert(/中转/.test(result.json.error.message), 'upstream 404 parameter error explains relay channel')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'force-safety', model: 'gpt-image-1.5' },
})
assert(result.status === 422, 'safety rejection is a bad request')
assert(/内容审核/.test(result.json.error.message), 'safety rejection names content moderation')

// A complete JSON body followed by a held-open socket must not block the response.
const openStartedAt = Date.now()
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai', prompt: 'force-open', model: 'gpt-image-1.5' },
})
assert(result.status === 200, 'held-open socket still returns the image')
assert(Date.now() - openStartedAt < 2000, 'early JSON reader returns without waiting for EOF')

// Unknown provider is a clear error.
result = await call('/image-studio/generate', { method: 'POST', body: { provider: 'nope', prompt: 'x' } })
assert(result.status === 422 && result.json.error.code === 'bad-request', 'unknown provider is rejected')

// Client bundle loads cleanly into __ModuleLoader__ and registers bubble annotation + cache controls.
let loadedFactory = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loadedFactory = spec
    },
  },
}
await import('../lib/client.js')
assert(loadedFactory && loadedFactory.id === 'dsh-image-studio-workbench' && typeof loadedFactory.factory === 'function', 'client bundle registers with __ModuleLoader__')
const clientSource = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
assert(clientSource.includes('is-btn-annotate') && clientSource.includes('标注编辑'), 'client registers top-right annotation edit button')
assert(clientSource.includes('renderAnnotatedReference') && clientSource.includes('is-annotate-layer'), 'client includes numbered bubble canvas burner and overlay')
assert(clientSource.includes('is-annotate-title') && clientSource.includes('is-annotate-foot-hint') && clientSource.includes('is-annotate-head-actions'), 'client styles the annotation editor header, hint and actions')
assert(clientSource.includes('function closeIcon') && !clientSource.includes("'×'"), 'client close buttons use centered svg icons')
assert(clientSource.includes('function plusIcon') && !clientSource.includes("'+'") && clientSource.includes('is-reference-plus'), 'client add buttons use centered svg plus icons')
assert(clientSource.includes('display: grid; place-items: center; line-height: 0; transform-origin: 50% 50%;'), 'client centers the filled reference add button plus icon')
assert(clientSource.includes("source: 'annotation'") && clientSource.includes("item.source !== 'annotation'"), 'client replaces previous annotation reference instead of accumulating')
assert(clientSource.includes('data-studio-theme') && clientSource.includes('is-theme-grid'), 'client applies the selected studio theme and renders the picker')
assert(clientSource.includes('backdrop-filter') && clientSource.includes('is-logo-glow'), 'client renders the frosted glass logo with glow')
assert(clientSource.includes('.is-head-actions .is-btn { height: 30px;') && clientSource.includes('is-reference-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px;') && clientSource.includes('is-prompt-head-actions { display: flex; align-items: center; gap: 8px;'), 'client aligns header action button heights and gaps')
assert(clientSource.includes('is-offline-modal') && clientSource.includes('离线导入'), 'client renders the offline import dialog and entry buttons')
assert(clientSource.includes('function droppedImageUrls') && clientSource.includes('async function referenceFileFromUrl') && clientSource.includes("dataTransfer.setData('text/uri-list'"), 'client accepts native image drags into the reference stage')

console.log('\nALL MULTI-PROVIDER SMOKE TESTS PASSED')
server.close()
upstream.close()
await fs.rm(storage, { recursive: true, force: true })
if (ownsSandbox) await fs.rm(sandboxHome, { recursive: true, force: true })
