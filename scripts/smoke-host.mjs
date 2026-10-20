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
import { apply } from '../lib/index.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const requests = []
const upstream = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/download.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length })
    res.end(PNG)
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
    const provider = match[1]
    requests.push({ provider, auth: req.headers.authorization, body, raw, contentType, path: req.url })
    if (provider === 'grok' && match[2] === 'generations') {
      const host = req.headers.host
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ url: `http://${host}/download.png` }] }))
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

const commands = []
let route
const ctx = {
  webServer: {
    register(candidate) {
      route = candidate
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

apply(ctx, {})

const server = http.createServer((req, res) => {
  route.handler(req, res).catch((error) => {
    res.writeHead(500).end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

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
assert(result.json.value.providers.length === 4, 'four provider profiles')
assert(typeof result.json.value.version === 'string' && /^\d+\.\d+\.\d+$/.test(result.json.value.version), 'status reports the package version')
const agnes = result.json.value.providers.find((item) => item.id === 'agnes')
assert(agnes.configured === true && agnes.masked === 'sk-l…7890', 'legacy Agnes key migrates to the per-provider file')
assert(agnes.baseUrl === `http://127.0.0.1:${port}/agnes`, 'legacy Agnes baseUrl migrates')

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
assert(result.json.value.providers.length === 4, 'setup returns provider roster')
assert(result.json.value.providers.every((item) => item.configured), 'all four providers are configured')

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
}), 'openai body is standard Images API')

// Grok body + URL download.
result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'grok', prompt: 'a fox', model: 'grok-imagine-image-2.0', size: '1K', ratio: '16:9', quality: 'medium' },
})
assert(result.status === 200 && result.json.ok === true, 'grok generate (URL result downloaded)')
const grokRequest = requests.findLast((item) => item.provider === 'grok')
assert(grokRequest.auth === 'Bearer xai-grok-1234567890', 'grok uses its own key')
assert(JSON.stringify(grokRequest.body) === JSON.stringify({
  model: 'grok-imagine-image-2.0',
  prompt: 'a fox',
  n: 1,
  response_format: 'url',
  aspect_ratio: '16:9',
  resolution: '1K',
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
}), 'custom body omits auto quality/size surprises')

// Friendly positional shorthand: /image gpt 2k 16:9 <prompt>
const commandDef = commands.find((item) => item.name === 'image')
const shortGpt = await commandDef.handler({
  rawInput: 'gpt 2k 16:9 a rabbit',
  signal: new AbortController().signal,
})
assert(shortGpt.kind === 'success', '/image shorthand gpt succeeds')
const shortGptRequest = requests.findLast((item) => item.provider === 'openai')
assert(shortGptRequest.body.prompt === 'a rabbit', '/image shorthand keeps the prompt')
assert(shortGptRequest.body.size === '1536x1024', 'gpt 2k 16:9 maps to a 2K-ish landscape GPT size')

const shortGrok = await commandDef.handler({
  rawInput: 'grok 2k 9:16 a fox',
  signal: new AbortController().signal,
})
assert(shortGrok.kind === 'success', '/image shorthand grok succeeds')
const shortGrokRequest = requests.findLast((item) => item.provider === 'grok')
assert(shortGrokRequest.body.resolution === '2K', 'grok 2k keeps the native 2K tier')
assert(shortGrokRequest.body.aspect_ratio === '9:16', 'grok 9:16 keeps the ratio')

const shortAgnes = await commandDef.handler({
  rawInput: 'agnes 1k 1:1 a cat',
  signal: new AbortController().signal,
})
assert(shortAgnes.kind === 'success', '/image shorthand agnes succeeds')
const shortAgnesRequest = requests.findLast((item) => item.provider === 'agnes')
assert(shortAgnesRequest.body.size === '1K' && shortAgnesRequest.body.ratio === '1:1', 'agnes shorthand keeps tier + ratio')

const shortDefault = await commandDef.handler({
  rawInput: '2k 16:9 a default cat',
  signal: new AbortController().signal,
})
assert(shortDefault.kind === 'success', '/image shorthand without provider uses the default')

// Per-provider key isolation: clearing OpenAI must not touch the others.
result = await call('/image-studio/setup', { method: 'POST', body: { providerId: 'openai', clearKey: true } })
assert(result.json.value.providers.find((item) => item.id === 'openai').configured === false, 'openai key cleared')
assert(result.json.value.providers.find((item) => item.id === 'agnes').configured === true, 'agnes key untouched')
assert(result.json.value.providers.find((item) => item.id === 'grok').configured === true, 'grok key untouched')
result = await call('/image-studio/generate', { method: 'POST', body: { provider: 'openai', prompt: 'x' } })
assert(result.status === 409 && result.json.error.code === 'unconfigured', 'missing provider key is explicit')
assert(result.json.error.provider === 'openai', 'error names the provider')

// History + file route.
result = await call('/image-studio/history')
const historyProviders = new Set(result.json.value.items.map((item) => item.provider))
assert(result.json.value.items.length >= 8, 'history records every generation')
assert(historyProviders.size === 4, 'history covers all four providers')
const first = result.json.value.items.at(-1)
const file = await fetch(`${origin}${first.url}`)
assert(file.status === 200 && file.headers.get('content-type') === 'image/png', 'file route serves PNG')
const download = await fetch(`${origin}${first.url}?download=1`)
assert(download.status === 200 && /attachment/.test(download.headers.get('content-disposition') || ''), 'download route sends an attachment')

// /image command with an explicit provider.
const command = commands.find((item) => item.name === 'image')
assert(command !== undefined, '/image command registered')
const invocation = await command.handler({
  rawInput: '--provider grok --size 2K --ratio 1:1 --quality low a whale',
  signal: new AbortController().signal,
})
assert(invocation.kind === 'success', '/image succeeds with --provider')
assert(invocation.text.includes('Grok Image'), '/image reports the provider')
assert(requests.findLast((item) => item.provider === 'grok').body.prompt === 'a whale', '/image parses the prompt')
assert(requests.findLast((item) => item.provider === 'grok').body.resolution === '2K', '/image parses --size')
assert(requests.findLast((item) => item.provider === 'grok').body.aspect_ratio === '1:1', '/image parses --ratio')

// Same-conversation /image: first is text-to-image, next auto-edits, --new resets.
const commandSession = { agent: { session: { id: 'smoke-command-session' } } }
const firstConversation = await command.handler({
  rawInput: 'agnes 1k 1:1 a cat',
  signal: new AbortController().signal,
  ...commandSession,
})
assert(firstConversation.kind === 'success', 'conversation first /image succeeds')
const secondConversation = await command.handler({
  rawInput: 'make it blue',
  signal: new AbortController().signal,
  ...commandSession,
})
assert(secondConversation.kind === 'success', 'conversation follow-up /image succeeds')
assert(secondConversation.text.includes('基于参考图'), 'follow-up reports the previous image reference')
const secondConversationRequest = requests.findLast((item) => item.provider === 'agnes')
assert(secondConversationRequest.body.extra_body && secondConversationRequest.body.extra_body.image.length === 1, 'follow-up sends the previous image as reference')
const freshConversation = await command.handler({
  rawInput: '--new agnes 1k 1:1 a dog',
  signal: new AbortController().signal,
  ...commandSession,
})
assert(freshConversation.kind === 'success', 'conversation --new /image succeeds')
const freshConversationRequest = requests.findLast((item) => item.provider === 'agnes')
assert(!freshConversationRequest.body.extra_body, '--new resets to text-to-image')


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
assert(grokEdit.body.aspect_ratio === '16:9' && grokEdit.body.resolution === '2K', 'grok edit keeps ratio/resolution')

result = await call('/image-studio/generate', {
  method: 'POST',
  body: { provider: 'openai-compatible', prompt: 'custom edit', model: 'my-image-model', size: '1024x1024', referenceImages: [reference] },
})
assert(result.status === 200 && result.json.ok === true, 'custom img2img succeeds')
const customEdit = requests.findLast((item) => item.provider === 'custom')
assert(customEdit.path.endsWith('/v1/images/edits'), 'custom uses images/edits')
assert(/multipart\/form-data/i.test(customEdit.contentType), 'custom sends multipart/form-data')

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

// Path traversal refusal.
result = await call('/image-studio/files/../credentials.json')
assert(result.status === 404, 'path traversal is refused')

// Unknown provider is a clear error.
result = await call('/image-studio/generate', { method: 'POST', body: { provider: 'nope', prompt: 'x' } })
assert(result.status === 422 && result.json.error.code === 'bad-request', 'unknown provider is rejected')

console.log('\nALL MULTI-PROVIDER SMOKE TESTS PASSED')
server.close()
upstream.close()
await fs.rm(storage, { recursive: true, force: true })
void os
