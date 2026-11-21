/**
 * dsh-image-studio — browser half.
 *
 * Surfaces:
 *   sidebar.panellist        「生图工作台」 (same level as Plugins / Context Insights)
 *   main / key=image-studio  full panel: provider tabs, prompt, result, history
 *   conversation.chat.commandview / key=image   /image result card
 *
 * Provider metadata, key presence, and defaults come from /image-studio/status;
 * keys never come back to the browser after saving.
 */

window.__ModuleLoader__.load({
  id: 'dsh-image-studio-workbench',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const NS = 'image-studio'
    const API = '/image-studio'
    const JOB_KEY = 'image-studio:activeJob'
    const STYLE_ID = 'dsh-image-studio-styles'
    const FALLBACK_PROVIDERS = ['agnes', 'openai', 'grok', 'minimax', 'openai-compatible']
    const DEFAULT_MAX_REFERENCES = 5
    const STUDIO_THEMES = [
      { id: 'auto', label: '跟随外观', hint: '沿用 DSH 当前深浅色', swatches: ['#f2f3f5', '#d9dce3', '#8b93a1'] },
      { id: 'mist', label: '雾青', hint: '冷调青灰，清透安静', swatches: ['#f2f6f4', '#d8e3de', '#5c8a7b'] },
      { id: 'cream', label: '米杏', hint: '暖调米白，柔和纸感', swatches: ['#faf7f1', '#e6dac9', '#a97c54'] },
      { id: 'haze', label: '黛蓝', hint: '雾蓝灰，克制沉稳', swatches: ['#f3f6fa', '#d6dfe9', '#5f7fa5'] },
      { id: 'lilac', label: '藕荷', hint: '灰紫调，清淡雅致', swatches: ['#f8f5f8', '#e3d7e5', '#8a6f99'] },
    ]
    function maxReferencesFor(provider) {
      const limit = Number(provider && provider.maxReferenceImages)
      return Number.isFinite(limit) && limit > 0 ? Math.min(16, Math.floor(limit)) : DEFAULT_MAX_REFERENCES
    }
    const CAMERA_PROFILES = [
      { id: 'arri_alexa_mini_lf', label: '阿莱 Mini LF', short: 'ARRI Alexa Mini LF', prompt: 'shot on ARRI Alexa Mini LF with ARRI Wide Gamut color science, ALEV III large-format sensor, gorgeous skin-tone rendering, buttery highlight rolloff, industry-standard feature-film look' },
      { id: 'canon_c500_mk2', label: '佳能 C500 Mk II', short: 'Canon C500 Mk II', prompt: 'shot on Canon C500 Mark II with Canon Cinema Gamut, full-frame cinema sensor, warm natural skin tones, premium broadcast and feature-film character' },
      { id: 'sony_venice_2', label: '索尼 Venice 2', short: 'Sony Venice 2', prompt: 'shot on Sony Venice 2 with Sony S-Gamut3.Cine / S-Log3, dual native ISO full-frame cinema sensor, clean shadows, highly refined modern color science' },
      { id: 'red_komodo_6k', label: 'RED 科莫多 6K', short: 'RED Komodo 6K', prompt: 'shot on RED Komodo 6K with RED IPP2 color pipeline, Super35 global-shutter sensor, crisp modern digital detail, clean shadows, crisp action-movie look' },
      { id: 'panavision_dxl2', label: '潘那维申 DXL2', short: 'Panavision DXL2', prompt: 'shot on Panavision DXL2 with Panavision DXL color science, large-format Monstro 8K VV sensor, signature organic highlight rolloff, rich filmic texture, premium modern cinema look' },
      { id: 'blackmagic_ursa_12k', label: '黑魔法 URSA 12K', short: 'Blackmagic URSA 12K', prompt: 'shot on Blackmagic URSA Cine 12K with Blackmagic Generation 5 color science, Super35 12K sensor, rich filmic tones, indie-cinema aesthetic' },
    ]
    const LENS_PROFILES = [
      { id: 'arri_signature_prime', label: '阿莱大师定焦', short: 'ARRI Signature Prime', prompt: 'ARRI Signature Prime lens, large-format coverage, creamy organic bokeh, gentle contrast, smooth highlight rolloff, soft flattering flares' },
      { id: 'cooke_s7i', label: '库克 S7/i', short: 'Cooke S7/i', prompt: 'Cooke S7/i lens, legendary Cooke Look, warm color bias, gentle contrast, soft rounded bokeh, classic flattering skin rendering' },
      { id: 'zeiss_supreme_prime', label: '蔡司至尊定焦', short: 'Zeiss Supreme Prime', prompt: 'Zeiss Supreme Prime lens, neutral modern color, high micro-contrast, sharp yet refined detail, clean bokeh' },
      { id: 'canon_sumire_prime', label: '佳能 Sumire 定焦', short: 'Canon Sumire Prime', prompt: 'Canon Sumire Prime lens, soft organic character, warm gentle color rendering, dreamy rounded bokeh, cinematic softness for portraits' },
      { id: 'anamorphic_cooke', label: 'Cooke 变形宽银幕', short: 'Cooke Anamorphic', prompt: 'Cooke anamorphic lens, oval bokeh, horizontal blue streaks for flares, wide cinematic framing, 2.39:1 anamorphic cinematic feel' },
      { id: 'macro_100mm', label: '100mm 微距', short: 'Macro 100mm', prompt: 'macro 100mm prime lens, extremely shallow depth of field, razor-thin focus plane, smooth creamy bokeh, detail-rich close-up rendering' },
    ]
    const CAMERA_FOCALS = [14, 18, 24, 35, 40, 50, 65, 85, 100, 135, 200]
    const CAMERA_APERTURES = [1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16]
    const CAMERA_DEFAULTS = { camera: 'arri_alexa_mini_lf', lens: 'arri_signature_prime', focal: 50, aperture: 4 }

    function cameraFocalPrompt(mm) {
      if (mm <= 16) return `${mm}mm ultra-wide-angle perspective, strong spatial depth, pronounced edge distortion, immersive wide coverage`
      if (mm <= 24) return `${mm}mm wide-angle perspective, exaggerated depth, strong foreground/background separation, environment-forward framing`
      if (mm <= 35) return `${mm}mm slight-wide cinematic perspective, natural environmental context, balanced depth, classic story-telling framing`
      if (mm <= 50) return `${mm}mm standard/normal perspective, close to natural human eye perspective, neutral spatial compression, flattering portrait framing`
      if (mm <= 85) return `${mm}mm short-telephoto portrait perspective, mild background compression, flattering facial rendering, subject isolation`
      if (mm <= 135) return `${mm}mm telephoto perspective, moderate compression, strong subject isolation from background, cinematic close-up`
      return `${mm}mm long-telephoto perspective, strong background compression, highly isolated subject on compressed flat background, powerful dramatic framing`
    }

    function cameraAperturePrompt(f) {
      if (f <= 1.4) return `shot wide open at f/${f}, extremely shallow depth of field, strong creamy bokeh, razor-thin focus plane, dreamy background separation`
      if (f <= 2) return `shot at f/${f}, very shallow depth of field, smooth cinematic bokeh, clear subject-from-background separation`
      if (f <= 2.8) return `shot at f/${f}, shallow depth of field, soft bokeh, natural subject isolation`
      if (f <= 4) return `shot at f/${f}, moderate depth of field, gentle falloff, clean background blur without over-smoothing`
      if (f <= 5.6) return `shot at f/${f}, balanced depth of field, background retains context while subject remains clearly in focus`
      if (f <= 8) return `shot at f/${f}, wide depth of field, environment and subject both sharp, documentary / landscape style`
      return `shot at f/${f}, very wide depth of field, extensive sharpness from foreground to background, wide-open environmental feel`
    }

    function buildCameraPrompt(input) {
      const camera = CAMERA_PROFILES.find((item) => item.id === input.camera) || CAMERA_PROFILES[0]
      const lens = LENS_PROFILES.find((item) => item.id === input.lens) || LENS_PROFILES[0]
      return [
        'the following parameters describe the virtual camera, lens, and exposure used to render this image — they are camera direction, NOT objects to add inside the frame; do not add any physical camera, lens, tripod, viewfinder, or photography equipment into the image',
        camera.prompt,
        lens.prompt,
        cameraFocalPrompt(input.focal),
        cameraAperturePrompt(input.aperture),
        'keep the subjects, scene, and action unchanged — apply these as optical and sensor characteristics only',
        `[camera body: ${camera.short} · lens: ${lens.short} · focal: ${input.focal}mm · aperture: f/${input.aperture}]`,
      ].join(', ')
    }

    const OPENAI_STANDARD_MODELS = new Set([
      'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'chatgpt-image-latest', 'dall-e-3',
    ])
    const GPT_IMAGE_25_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
    const GPT_IMAGE_COMPLEXITIES = ['auto', 'low', 'medium', 'high']
    const GPT_IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'gif']
    const GPT_IMAGE_GIF_SIZES = {
      '1:1': '512x512', '4:3': '592x448', '3:4': '448x592',
      '16:9': '896x512', '9:16': '512x896', '3:2': '768x512', '2:3': '512x768', '21:9': '1024x448',
    }
    const GIF_FRAME_OPTIONS = [2, 4, 6, 8, 9, 10, 12, 16]
    const GIF_MS_OPTIONS = [50, 80, 100, 120, 150, 200, 300, 500]
    function isGptImage26(model) {
      return /^gpt-image-2\.6/i.test(String(model || ''))
    }
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

    /* ---------------------------------------------------------------- */
    /* Utilities                                                         */
    /* ---------------------------------------------------------------- */

    function formatTime(value) {
      try {
        return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    function sizesFor(provider, model) {
      if (!provider) return []
      const mapped = provider.sizeByModel && provider.sizeByModel[model]
      return Array.isArray(mapped) && mapped.length > 0 ? mapped : (provider.sizes || [])
    }

    function qualitiesFor(provider, model) {
      if (!provider || !provider.supportsQuality) return []
      if (provider.id === 'openai' && /^gpt-image-2\.5/i.test(String(model || ''))) return GPT_IMAGE_25_QUALITIES
      const mapped = provider.qualityByModel && provider.qualityByModel[model]
      return Array.isArray(mapped) && mapped.length > 0 ? mapped : (provider.qualities || [])
    }

    function modelsFor(provider) {
      if (!provider) return []
      const models = Array.isArray(provider.models) ? [...provider.models] : []
      if (provider.model && !models.includes(provider.model)) models.unshift(provider.model)
      return models
    }

    function providerById(status, id) {
      if (!status || !Array.isArray(status.providers)) return undefined
      return status.providers.find((item) => item.id === id)
    }

    function icon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('rect', { key: 'a', x: 3.8, y: 6, width: 16.4, height: 12.5, rx: 2.6 }),
        h('circle', { key: 'b', cx: 14.9, cy: 10.2, r: 1.25 }),
        h('path', { key: 'c', d: 'm5.2 16 3.9-3.9a2 2 0 0 1 2.8 0l2.9 2.9' }),
        h('path', { key: 'd', d: 'M19 3.5v2.6M17.7 4.8h2.6' }),
      ])
    }

    function downloadIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'a', d: 'M12 4v10' }),
        h('path', { key: 'b', d: 'm8 10 4 4 4-4' }),
        h('path', { key: 'c', d: 'M5 19h14' }),
      ])
    }

    function expandIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'a', d: 'M9 4H4v5' }),
        h('path', { key: 'b', d: 'M15 4h5v5' }),
        h('path', { key: 'c', d: 'M15 20h5v-5' }),
        h('path', { key: 'd', d: 'M9 20H4v-5' }),
      ])
    }

    function closeIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'a', d: 'M6.5 6.5l11 11' }),
        h('path', { key: 'b', d: 'M17.5 6.5l-11 11' }),
      ])
    }

    function plusIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'v', d: 'M12 5v14' }),
        h('path', { key: 'h', d: 'M5 12h14' }),
      ])
    }

    function annotatePinIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'pin', d: 'M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z' }),
        h('circle', { key: 'dot', cx: 12, cy: 11, r: 2.2 }),
      ])
    }

    const ANNOTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="36" viewBox="0 0 32 36">'
      + '<path d="M16 34C16 34 6 24.4 6 15a10 10 0 1 1 20 0c0 9.4-10 19-10 19Z" fill="#ff3b30" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>'
      + '<path d="M16 10.5v9M11.5 15h9" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>'
      + '</svg>',
    )}") 16 34, crosshair`

    function formatBytesCompact(bytes) {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
      return `${(value / (1024 * 1024)).toFixed(1)} MB`
    }

    function githubIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true',
      }, h('path', {
        d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z',
      }))
    }

    function spark(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: '1', d: 'M12 3v4M12 17v4M3 12h4M17 12h4' }),
        h('path', { key: '2', d: 'm5.6 5.6 2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8' }),
      ])
    }

    /** Full-canvas dot field; every dot breathes on its own random phase. */
    function DotField(props) {
      const canvasRef = React.useRef(null)
      const animated = !(props && props.animated === false)
      React.useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return undefined
        const context = canvas.getContext('2d')
        if (!context) return undefined

        const reduced = !animated || (typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        let frame = 0
        let width = 0
        let height = 0
        let dots = []
        let color = 'rgb(128,128,128)'

        const build = () => {
          const rect = canvas.getBoundingClientRect()
          width = Math.max(1, Math.round(rect.width))
          height = Math.max(1, Math.round(rect.height))
          canvas.width = Math.round(width * dpr)
          canvas.height = Math.round(height * dpr)
          context.setTransform(dpr, 0, 0, dpr, 0, 0)
          color = getComputedStyle(canvas).color || color
          dots = []
          const gap = 12
          const inset = 8
          for (let y = inset; y <= height - inset; y += gap) {
            for (let x = inset; x <= width - inset; x += gap) {
              dots.push({
                x,
                y,
                radius: 1.6 + Math.random() * 0.45,
                jitter: (Math.random() - 0.5) * 0.4,
                floor: 0.04 + Math.random() * 0.03,
                peak: 0.34 + Math.random() * 0.12,
              })
            }
          }
        }

        const draw = (time) => {
          context.clearRect(0, 0, width, height)
          context.fillStyle = color
          const seconds = time / 1000
          const halfWidth = Math.max(1, width / 2)
          const halfHeight = Math.max(1, height / 2)
          const maxRadius = Math.max(1, Math.hypot(halfWidth, halfHeight))
          for (const dot of dots) {
            const radial = Math.hypot(dot.x - halfWidth, dot.y - halfHeight) / maxRadius
            const edgeT = Math.max(0, Math.min(1, (radial - 0.94) / 0.06))
            const mask = 1 - edgeT * edgeT * (3 - 2 * edgeT)
            const wave = 0.5 + 0.5 * Math.sin(seconds * 2.1 - radial * 3.2 + dot.jitter)
            context.globalAlpha = (reduced ? 0.24 : dot.floor + (dot.peak - dot.floor) * wave) * mask
            context.beginPath()
            context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2)
            context.fill()
          }
          context.globalAlpha = 1
          if (!reduced) frame = requestAnimationFrame(draw)
        }

        build()
        if (reduced) draw(1200)
        else frame = requestAnimationFrame(draw)

        const observer = typeof ResizeObserver === 'function'
          ? new ResizeObserver(() => {
            build()
            if (reduced) draw(1200)
          })
          : null
        if (observer) observer.observe(canvas)

        return () => {
          cancelAnimationFrame(frame)
          if (observer) observer.disconnect()
        }
      }, [])

      return h('canvas', { ref: canvasRef, className: 'is-dot-canvas', 'aria-hidden': 'true' })
    }

    async function api(path, options) {
      const init = { ...options }
      init.headers = { accept: 'application/json', ...(options && options.headers) }
      if (init.body !== undefined) init.headers['content-type'] = 'application/json'
      let response
      try {
        response = await fetch(`${API}${path}`, init)
      } catch (error) {
        const failure = new Error(`无法连接宿主路由（${error instanceof Error ? error.message : String(error)}）。`)
        failure.code = 'host-unreachable'
        throw failure
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`宿主返回了无法解析的响应（HTTP ${response.status}）。`)
      }
      if (!response.ok || !payload || payload.ok !== true) {
        const detail = payload && payload.error ? payload.error : {}
        const failure = new Error(detail.message || `请求失败（HTTP ${response.status}）。`)
        failure.code = detail.code || 'internal'
        failure.status = response.status
        failure.provider = detail.provider
        throw failure
      }
      return payload.value
    }

    /* ---------------------------------------------------------------- */
    /* Styles                                                            */
    /* ---------------------------------------------------------------- */

    function ensureStyles() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById(STYLE_ID)
      if (existing) existing.remove()
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
.is-page {
  height: 100%; overflow: hidden; box-sizing: border-box;
  display: flex; flex-direction: column;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 18px) 32px 24px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.is-page *, .is-page *::before, .is-page *::after { box-sizing: border-box; }

/* 素雅配色：只覆盖工作台自己的作用域，跟随外观时完全沿用 DSH 变量。 */
.is-page[data-studio-theme="mist"] {
  color-scheme: light;
  --dsw-alias-bg-base: #f2f6f4; --dsw-alias-bg-layer-1: #fbfdfc; --dsw-alias-bg-layer-2: #eaf1ee; --dsw-alias-bg-layer-3: #dee9e4; --dsw-alias-bg-overlay: #fbfdfc;
  --dsw-alias-border-l1: #d8e3de; --dsw-alias-border-l2: #c6d6cf; --dsw-alias-border-l3: #b4c9c1;
  --dsw-alias-label-primary: #24312c; --dsw-alias-label-secondary: #586b63; --dsw-alias-label-tertiary: #7c8f87;
  --dsw-alias-state-idle-primary: #8ea19a; --dsw-alias-brand-primary: #5c8a7b; --dsw-alias-state-success-primary: #4d876c;
  --dsw-alias-state-warn-primary: #bd8a4e; --dsw-alias-state-error-primary: #b45b53;
  --dsw-alias-state-business-primary: #5c8a7b; --dsw-alias-state-business-tertiary: #dcebe5;
}
.is-page[data-studio-theme="cream"] {
  color-scheme: light;
  --dsw-alias-bg-base: #faf7f1; --dsw-alias-bg-layer-1: #fffdf8; --dsw-alias-bg-layer-2: #f3ece1; --dsw-alias-bg-layer-3: #eadfce; --dsw-alias-bg-overlay: #fffdf8;
  --dsw-alias-border-l1: #e6dac9; --dsw-alias-border-l2: #d8c8b1; --dsw-alias-border-l3: #c9b79d;
  --dsw-alias-label-primary: #3a3126; --dsw-alias-label-secondary: #6f6354; --dsw-alias-label-tertiary: #948674;
  --dsw-alias-state-idle-primary: #a89a86; --dsw-alias-brand-primary: #a97c54; --dsw-alias-state-success-primary: #5f8259;
  --dsw-alias-state-warn-primary: #c08b3f; --dsw-alias-state-error-primary: #b45a48;
  --dsw-alias-state-business-primary: #a97c54; --dsw-alias-state-business-tertiary: #f1e2ce;
}
.is-page[data-studio-theme="haze"] {
  color-scheme: light;
  --dsw-alias-bg-base: #f3f6fa; --dsw-alias-bg-layer-1: #fcfdff; --dsw-alias-bg-layer-2: #eaeff7; --dsw-alias-bg-layer-3: #dfe7f1; --dsw-alias-bg-overlay: #fcfdff;
  --dsw-alias-border-l1: #d6dfe9; --dsw-alias-border-l2: #c5d2e0; --dsw-alias-border-l3: #b3c4d6;
  --dsw-alias-label-primary: #28323f; --dsw-alias-label-secondary: #5b6878; --dsw-alias-label-tertiary: #7f8c9c;
  --dsw-alias-state-idle-primary: #91a0b1; --dsw-alias-brand-primary: #5f7fa5; --dsw-alias-state-success-primary: #4f7f74;
  --dsw-alias-state-warn-primary: #b5864a; --dsw-alias-state-error-primary: #b25b57;
  --dsw-alias-state-business-primary: #5f7fa5; --dsw-alias-state-business-tertiary: #e1e9f5;
}
.is-page[data-studio-theme="lilac"] {
  color-scheme: light;
  --dsw-alias-bg-base: #f8f5f8; --dsw-alias-bg-layer-1: #fefcff; --dsw-alias-bg-layer-2: #f2ebf3; --dsw-alias-bg-layer-3: #eadfec; --dsw-alias-bg-overlay: #fefcff;
  --dsw-alias-border-l1: #e3d7e5; --dsw-alias-border-l2: #d3c3d6; --dsw-alias-border-l3: #c2afc7;
  --dsw-alias-label-primary: #382f3d; --dsw-alias-label-secondary: #6b5f70; --dsw-alias-label-tertiary: #8f8194;
  --dsw-alias-state-idle-primary: #a294a8; --dsw-alias-brand-primary: #8a6f99; --dsw-alias-state-success-primary: #5c8272;
  --dsw-alias-state-warn-primary: #b88850; --dsw-alias-state-error-primary: #b45d5f;
  --dsw-alias-state-business-primary: #8a6f99; --dsw-alias-state-business-tertiary: #efe3f2;
}
.is-theme-block { margin: 2px 0 16px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.is-theme-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.is-theme-option {
  display: flex; flex-direction: column; align-items: flex-start; gap: 7px; min-width: 0;
  padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.is-theme-option:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.is-theme-option.active { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.is-theme-swatches { display: flex; gap: 3px; }
.is-theme-swatch { width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(0,0,0,.07); }
.is-theme-name { font-size: 11.5px; font-weight: 650; line-height: 1.2; }
.is-theme-hint { font-size: 10px; line-height: 1.35; color: var(--dsw-alias-label-secondary); }
@media (max-width: 760px) { .is-theme-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.is-shell { width: 100%; max-width: 1120px; margin: 0 auto; flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.is-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: nowrap; min-width: 0; }
.is-head-main { display: flex; align-items: center; gap: 12px; min-width: 0; flex: none; }
.is-logo {
  position: relative; isolation: isolate; overflow: visible;
  width: 42px; height: 42px; border-radius: 13px; flex: none; display: grid; place-items: center;
  color: var(--dsw-alias-label-primary);
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, var(--dsw-alias-bg-layer-2));
  background-image:
    linear-gradient(145deg, rgba(255,255,255,.52) 0%, rgba(255,255,255,.15) 34%, rgba(255,255,255,.04) 58%, rgba(255,255,255,.22) 100%),
    radial-gradient(90% 80% at 22% 10%, rgba(255,255,255,.62) 0%, transparent 58%);
  border: 1px solid color-mix(in srgb, #fff 55%, var(--dsw-alias-border-l1));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.8),
    inset 0 -6px 12px rgba(255,255,255,.08),
    inset 0 0 0 1px rgba(255,255,255,.12),
    0 4px 14px rgba(0,0,0,.14),
    0 0 22px color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent),
    0 0 42px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  transition: transform .25s var(--is-ease-spring), box-shadow .25s ease, border-color .25s ease;
}
.is-eyebrow { font-size: 10px; letter-spacing: .18em; font-weight: 700; color: var(--dsw-alias-label-secondary); margin: 1px 0 4px; }
.is-title { margin: 0; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.01em; }
.is-sub { margin: 5px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.is-head-actions { display: flex; align-items: center; gap: 8px; flex: none; padding-top: 2px; }
.is-head-actions .is-btn { height: 30px; padding: 0 10px; font-size: 11.5px; border-radius: 8px; }
.is-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.is-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary); }
.is-dot.ok { background: var(--dsw-alias-state-success-primary); }
.is-btn {
  appearance: none; border: 1px solid transparent; border-radius: 9px; height: 34px; padding: 0 14px;
  font: inherit; font-size: 12.5px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  cursor: pointer; white-space: nowrap; transition: background .15s ease, border-color .15s ease, opacity .15s ease;
}
.is-btn:disabled { cursor: default; opacity: .5; }
.is-btn-primary { background: var(--dsw-alias-brand-primary); color: #fff; }
.is-btn-primary:hover:not(:disabled) { filter: brightness(.94); }
.is-btn-ghost { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.is-btn-ghost:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.is-btn-quiet { background: transparent; color: var(--dsw-alias-label-secondary); padding: 0 8px; }
.is-btn-quiet:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.is-btn-sm { height: 30px; padding: 0 10px; font-size: 11.5px; border-radius: 8px; }
.is-update-btn { height: 30px; padding: 0 10px; font-size: 11.5px; border-radius: 8px; white-space: nowrap; }
.is-update-ready { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); }
.is-update-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 50%, var(--dsw-alias-border-l1)); color: var(--dsw-alias-state-error-primary); }
.is-update-note { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.is-update-note-available {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 42%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}
.is-update-note-updated {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 42%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}
.is-update-note-error {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-state-error-primary);
}
.is-providers {
  margin: 0; flex: 0 1 auto; min-width: 0; width: auto; max-width: max-content; display: flex; flex-wrap: nowrap; gap: 2px; padding: 3px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
}
.is-provider {
  border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary);
  height: 30px; padding: 0 9px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap;
}
.is-provider:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.is-provider.active { background: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.is-provider-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary); }
.is-provider-dot.ok { background: var(--dsw-alias-state-success-primary); }
.is-banner {
  margin-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 11px 13px; border-radius: 11px; font-size: 12.5px; line-height: 1.5;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 32%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1));
}
.is-banner.error {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-1));
}
.is-banner .is-banner-main { flex: 1 1 240px; min-width: 0; }
.is-banner strong { font-weight: 650; }
.is-grid { margin-top: 12px; flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(300px, 390px) minmax(0, 1fr); gap: 16px; align-items: stretch; }
.is-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 16px; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.is-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.is-card-title { margin: 0; font-size: 13px; font-weight: 650; }
.is-card-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.is-field { margin-bottom: 13px; }
.is-field:last-child { margin-bottom: 0; }
.is-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.is-count { font-variant-numeric: tabular-nums; font-weight: 500; }
.is-input, .is-select, .is-textarea {
  width: 100%; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.is-input, .is-select { height: 36px; padding: 0 10px; }
.is-select {
  cursor: pointer; appearance: none; padding-right: 28px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%238a94a6' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m2.8 4.6 3.2 3.2 3.2-3.2'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 9px center;
}
.is-textarea { min-height: 110px; padding: 10px 12px; line-height: 1.6; resize: vertical; }
.is-prompt-card .is-prompt-field { flex: 1 1 auto; min-height: 96px; display: flex; flex-direction: column; }
.is-prompt-card .is-textarea { flex: 1 1 auto; height: auto; min-height: 84px; resize: none; }
.is-prompt-card .is-fields, .is-prompt-card .is-actions, .is-prompt-card .is-tips, .is-prompt-card .is-note, .is-prompt-card .is-banner { flex: none; }
.is-input:focus, .is-select:focus, .is-textarea:focus {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
}
.is-textarea::placeholder, .is-input::placeholder { color: var(--dsw-alias-state-idle-primary); }
.is-reference { flex: 0 0 auto; margin-bottom: 10px; display: flex; flex-direction: column; }
.is-reference-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; row-gap: 6px; gap: 8px; margin-bottom: 6px; }
.is-reference-head .is-label { margin-bottom: 0; }
.is-reference-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.is-reference-stage {
  position: relative; flex: none; height: 78px; min-height: 78px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-base); overflow: hidden; display: flex; align-items: center; justify-content: center;
}
.is-reference-stage.is-dragover {
  border-color: var(--dsw-alias-brand-primary); border-style: solid;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-base));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
}
.is-reference-stage.has-images { border-style: solid; justify-content: flex-start; gap: 6px; padding: 6px 8px; overflow-x: auto; overflow-y: hidden; }
.is-reference-stage.is-disabled { opacity: .55; }
.is-reference-item { position: relative; flex: 0 0 auto; width: 56px; height: 56px; border-radius: 7px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.is-reference-label { position: absolute; left: 3px; bottom: 3px; z-index: 2; padding: 1px 4px; border-radius: 4px; background: rgba(10,12,16,.68); color: #fff; font-size: 9px; line-height: 1.4; pointer-events: none; }
.is-prompt-field { position: relative; }
.is-mention-menu { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 30; max-height: 230px; overflow: auto; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 12px 32px rgba(0,0,0,.2); }
.is-mention-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; text-align: left; cursor: pointer; }
.is-mention-item:hover, .is-mention-item.active { background: var(--dsw-alias-bg-layer-2); }
.is-mention-thumb { width: 24px; height: 24px; flex: none; border-radius: 5px; overflow: hidden; background: var(--dsw-alias-bg-layer-3); }
.is-mention-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.is-mention-name { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.is-reference-item img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
.is-reference-remove {
  position: absolute; top: 2px; right: 2px; width: 17px; height: 17px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; color: #fff; background: rgba(0, 0, 0, .58); cursor: pointer;
}
.is-reference-add {
  flex: 0 0 auto; width: 56px; height: 56px; padding: 0; border-radius: 7px; border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.is-reference-add:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l3); }
.is-reference-empty {
  width: 100%; height: 100%; min-height: 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 12px; padding: 0 10px; cursor: pointer; font: inherit; text-align: left;
}
.is-reference-empty:disabled { cursor: not-allowed; }
.is-reference-plus { width: 30px; height: 30px; border-radius: 50%; border: 1px dashed var(--dsw-alias-border-l2); display: grid; place-items: center; color: var(--dsw-alias-label-secondary); }
.is-reference-empty-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.is-reference-hint { font-size: 10.5px; line-height: 1.45; color: var(--dsw-alias-label-secondary); text-align: center; }
.is-reference-hint span { display: block; }
.is-reference-notice { margin-top: 6px; font-size: 11px; line-height: 1.45; }
.is-reference-notice-info { color: var(--dsw-alias-label-secondary); }
.is-reference-notice-ok { color: var(--dsw-alias-state-success-primary); }
.is-reference-notice-error { color: var(--dsw-alias-state-error-primary, #b42318); }
.is-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 9px; }
.is-fields .is-field { margin-bottom: 0; }
.is-span2 { grid-column: 1 / -1; }
.is-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.is-actions .is-btn-primary { flex: 1; height: 38px; }
.is-kbd { font-size: 10.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.is-studio { display: flex; flex-direction: column; min-height: 0; }
.is-result-head { display: flex; flex-direction: column; gap: 7px; margin-bottom: 9px; }
.is-result-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.is-result-meta { display: flex; align-items: center; gap: 6px; flex: 1 1 0; min-width: 0; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.is-result-corner { flex: none; display: flex; align-items: center; gap: 6px; }
.is-result-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.is-btn-annotate {
  height: 30px; padding: 0 11px; border-radius: 8px; font-size: 11.5px; font-weight: 650;
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-brand-primary);
}
.is-btn-annotate:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 17%, var(--dsw-alias-bg-layer-1));
}
.is-tag { padding: 2px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.is-canvas {
  position: relative; flex: 1 1 0; min-height: 180px; max-height: 100%;
  border-radius: 11px; display: flex; align-items: center; justify-content: center;
  padding: 12px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.is-canvas img {
  position: absolute; top: 50%; left: 50%; z-index: 1; transform: translate(-50%, -50%);
  width: auto; height: auto; max-width: calc(100% - 24px); max-height: calc(100% - 24px);
  border-radius: 8px; display: block; box-shadow: 0 14px 44px rgba(0,0,0,.22);
}
.is-canvas img.is-result-image { cursor: zoom-in; }
.is-viewer {
  position: fixed; inset: 0; z-index: 12000; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 42px 28px 24px; background: rgba(8, 10, 14, .93); backdrop-filter: blur(6px); overflow: hidden;
}
.is-viewer-frame { position: relative; display: inline-flex; max-width: 94vw; max-height: 82vh; }
.is-viewer-frame img { max-width: 94vw; max-height: 82vh; object-fit: contain; border-radius: 8px; box-shadow: 0 20px 80px rgba(0,0,0,.5); cursor: zoom-in; display: block; will-change: transform; }
.is-viewer-frame img.is-zoomed { cursor: grab; }
.is-viewer-frame img.is-zoomed:active { cursor: grabbing; }
.is-viewer-close {
  position: absolute; top: -15px; right: -15px; z-index: 2; width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35);
  background: rgba(20,22,28,.9); color: #fff; display: grid; place-items: center; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.45);
}
.is-viewer-close:hover { background: rgba(255,255,255,.16); }
.is-viewer-bar { position: absolute; left: 24px; right: 24px; bottom: 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; color: rgba(255,255,255,.78); }
.is-viewer-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
.is-viewer-hint { flex: none; font-size: 11px; color: rgba(255,255,255,.45); }
.is-viewer .is-btn-primary { background: rgba(255,255,255,.92); color: #111; border-color: transparent; }
.is-viewer .is-btn-primary:hover { background: #fff; }
.is-viewer .is-btn-quiet { color: rgba(255,255,255,.86); border-color: rgba(255,255,255,.2); }
.is-viewer .is-btn-quiet:hover { background: rgba(255,255,255,.12); color: #fff; }
.is-prompt-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.is-prompt-modal { width: min(1180px, 98vw); height: min(90vh, 840px); }
.is-prompt-filters {
  display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-base);
}
.is-prompt-filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.is-prompt-filter-label { width: 26px; flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.is-prompt-chip {
  height: 24px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer;
}
.is-prompt-chip:hover { background: var(--dsw-alias-bg-layer-2); }
.is-prompt-chip.active { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); }
.is-prompt-grid {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; align-content: start;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  grid-auto-rows: max-content; gap: 12px; padding: 2px;
}
.is-plib-card { position: relative; display: flex; flex-direction: column; height: max-content; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-base); cursor: pointer; }
.is-plib-card:hover { border-color: var(--dsw-alias-brand-primary); }
.is-plib-card img { flex: none; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; display: block; background: var(--dsw-alias-bg-layer-2); }
.is-plib-body { display: flex; flex-direction: column; gap: 4px; padding: 7px 8px 8px; }
.is-plib-name { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-plib-desc {
  font-size: 10.5px; line-height: 1.4; color: var(--dsw-alias-label-secondary); min-height: 29px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.is-plib-actions { display: flex; gap: 4px; margin-top: 2px; }
.is-plib-actions .is-btn { height: 26px; padding: 0 8px; font-size: 10.5px; }
.is-gallery-layer.is-preview-layer { z-index: 12700; }
.is-lightbox { position: relative; display: inline-flex; max-width: 92vw; max-height: 86vh; }
.is-lightbox img { max-width: 92vw; max-height: 86vh; object-fit: contain; border-radius: 10px; box-shadow: 0 22px 80px rgba(0,0,0,.5); display: block; }
.is-preview-modal {
  width: min(1100px, 96vw); height: min(88vh, 780px); display: flex; flex-direction: column;
  padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1); box-shadow: 0 24px 80px rgba(0,0,0,.35);
}
.is-preview-body { flex: 1 1 auto; min-height: 0; display: flex; gap: 14px; margin-top: 12px; }
.is-preview-body > img {
  flex: 1 1 auto; min-width: 0; max-width: 100%; height: 100%; object-fit: contain;
  border-radius: 10px; background: var(--dsw-alias-bg-base);
}
.is-preview-side { flex: 0 0 360px; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.is-preview-prompt {
  flex: 1 1 auto; min-height: 0; overflow: auto; margin: 0; padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-base);
  font-family: inherit; font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-primary);
  white-space: pre-wrap; word-break: break-word;
}
.is-preview-note { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.is-preview-variants { display: flex; flex-direction: column; gap: 8px; }
.is-preview-variant-actions { display: flex; align-items: center; gap: 8px; }
.is-preview-variant-count { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.is-preview-status { font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-brand-primary); }
.is-preview-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.is-gallery-layer {
  position: fixed; inset: 0; z-index: 12400; display: flex; align-items: center; justify-content: center;
  padding: 22px; background: rgba(8, 10, 14, .72); backdrop-filter: blur(5px);
}
.is-gallery-layer.is-offline-layer { z-index: 12750; }
.is-gallery-modal.is-offline-modal { width: min(640px, 100%); height: auto; max-height: 88vh; }
.is-offline-body { min-height: 0; overflow-y: auto; padding-right: 2px; }
.is-offline-section { margin-top: 14px; }
.is-offline-section-title { margin-bottom: 7px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.is-offline-pack {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px; background: var(--dsw-alias-bg-base);
}
.is-offline-pack-main { min-width: 0; }
.is-offline-pack-name { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.is-offline-pack-meta { margin-top: 2px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-offline-empty { padding: 10px 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.is-offline-form { display: flex; flex-direction: column; gap: 9px; margin-top: 8px; padding-top: 12px; border-top: 1px dashed var(--dsw-alias-border-l1); }
.is-offline-form .is-field { margin-bottom: 0; }
.is-offline-note { margin-top: 14px; padding: 9px 11px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); font-size: 10.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); word-break: break-word; }
.is-offline-note > div + div { margin-top: 3px; }
.is-gallery-modal {
  width: min(1040px, 100%); height: min(86vh, 760px); display: flex; flex-direction: column;
  padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1); box-shadow: 0 24px 80px rgba(0,0,0,.35);
}
.is-gallery-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.is-gallery-title { font-size: 15px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.is-gallery-sub { margin-top: 3px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.is-gallery-status { margin-top: 5px; font-size: 11.5px; line-height: 1.45; color: var(--dsw-alias-brand-primary); }
.is-gallery-tabs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 12px 0 10px; }
.is-gallery-tab {
  height: 28px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.is-gallery-tab:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.is-gallery-tab.active { background: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.is-gallery-search { margin-left: auto; max-width: 240px; height: 30px; }
.is-gallery-grid {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; align-content: start;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  grid-auto-rows: max-content; gap: 10px; padding: 2px;
}
.is-gallery-card {
  position: relative; display: flex; flex-direction: column; height: max-content; padding: 0; overflow: hidden; text-align: left;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-base); cursor: pointer;
}
.is-gallery-card:hover { border-color: var(--dsw-alias-brand-primary); }
.is-gallery-card.is-added { border-color: var(--dsw-alias-state-success-primary); }
.is-gallery-card.is-busy { opacity: .6; }
.is-gallery-card img { flex: none; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; display: block; background: var(--dsw-alias-bg-layer-2); }
.is-gallery-add {
  position: absolute; right: 5px; bottom: 5px; width: 24px; height: 24px; padding: 0; border-radius: 50%;
  border: 1px solid var(--dsw-alias-border-l1); background: rgba(255,255,255,.92); color: #111;
  display: grid; place-items: center; cursor: pointer;
}
.is-gallery-add:hover { background: #fff; border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.is-gallery-badge {
  position: absolute; top: 5px; right: 5px; padding: 1px 5px; border-radius: 5px;
  background: rgba(10, 12, 16, .72); color: #fff; font-size: 9.5px; line-height: 1.5;
}
.is-gallery-meta { display: flex; flex-direction: column; gap: 1px; padding: 5px 7px 6px; }
.is-gallery-name {
  font-size: 10.5px; line-height: 1.35; color: var(--dsw-alias-label-primary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.is-gallery-cat { font-size: 9.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-gallery-foot {
  display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary);
}
.is-gallery-foot > span:first-child { margin-right: auto; }
.is-github-link { display: inline-flex; align-items: center; gap: 5px; padding: 0 7px; }
.is-gallery-empty { padding: 28px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.is-camera-layer {
  position: fixed; inset: 0; z-index: 12500; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(8, 10, 14, .72); backdrop-filter: blur(5px);
}
.is-camera-modal {
  width: min(880px, 100%); max-height: min(90vh, 720px); overflow: auto;
  padding: 18px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1); box-shadow: 0 24px 80px rgba(0,0,0,.35);
}
.is-camera-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.is-camera-title { font-size: 15px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.is-camera-sub { margin-top: 4px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.is-camera-close { width: 30px; height: 30px; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary); display: grid; place-items: center; cursor: pointer; }
.is-camera-close:hover { background: var(--dsw-alias-bg-layer-2); }
.is-camera-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.is-camera-field { display: flex; flex-direction: column; gap: 6px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.is-camera-preview { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); }
.is-camera-preview-title { margin-bottom: 5px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.is-camera-preview-text { max-height: 96px; overflow: auto; font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-primary); }
.is-camera-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
@media (max-width: 720px) { .is-camera-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

@media (max-height: 860px) {
  .is-page { padding-top: calc(var(--dsh-frame-top-clearance, 0px) + 10px); padding-bottom: 14px; }
  .is-card { padding: 12px; }
  .is-head { gap: 10px; }
  .is-grid { margin-top: 10px; gap: 12px; }
  .is-prompt-card .is-textarea { min-height: 64px; }
  .is-reference { min-height: 70px; margin-bottom: 8px; }
  .is-reference-stage { height: 62px; min-height: 62px; }
  .is-reference-item { width: 48px; height: 48px; }
  .is-reference-add { width: 48px; height: 48px; }
  .is-tips { margin-top: 6px; padding-top: 6px; }
  .is-canvas { min-height: 140px; }
  .is-field { margin-bottom: 10px; }
}
@media (max-height: 740px) {
  .is-prompt-card .is-textarea { min-height: 54px; }
  .is-reference-stage { min-height: 42px; }
  .is-history { margin-top: 8px; padding-top: 8px; }
}
.is-context-menu {
  position: fixed; z-index: 13000; min-width: 164px; padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1); box-shadow: 0 12px 32px rgba(0,0,0,.2);
}
.is-context-item {
  display: flex; align-items: center; width: 100%; padding: 8px 10px;
  border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.4; text-align: left; cursor: pointer;
}
.is-context-item:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.is-context-item:disabled { opacity: .45; cursor: default; }
.is-copy-toast {
  position: fixed; left: 50%; bottom: 28px; z-index: 13001; transform: translateX(-50%);
  max-width: min(80vw, 420px); padding: 9px 14px; border-radius: 8px;
  background: rgba(20, 22, 28, .92); color: #fff; font-size: 12px; line-height: 1.45;
  box-shadow: 0 8px 28px rgba(0,0,0,.24); pointer-events: none;
}
.is-canvas.is-loading-canvas { background: var(--dsw-alias-bg-layer-1); }
.is-empty { position: relative; z-index: 1; text-align: center; color: var(--dsw-alias-label-secondary); padding: 20px 14px; }
.is-empty-icon { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; margin: 0 auto 10px; border: 1px dashed var(--dsw-alias-border-l2); }
.is-empty-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); margin-bottom: 4px; }
.is-empty-text { font-size: 11.5px; line-height: 1.55; }
.is-loading {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; padding: 24px;
}
.is-dot-canvas {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  color: var(--dsw-alias-label-primary); pointer-events: none;
}
.is-loading .is-empty-title, .is-loading .is-empty-text { position: relative; z-index: 1; }
.is-loading .is-empty-title { margin-bottom: 4px; }
.is-skeleton { height: 220px; border-radius: 9px; background: linear-gradient(100deg, var(--dsw-alias-bg-layer-2) 30%, var(--dsw-alias-bg-layer-1) 50%, var(--dsw-alias-bg-layer-2) 70%); background-size: 220% 100%; animation: is-shimmer 1.4s ease-in-out infinite; }
@keyframes is-shimmer { to { background-position: -120% 0; } }
.is-tips {
  margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1);
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary);
}
.is-tips-title { font-size: 11px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.is-tips-code { flex: none; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; line-height: 1.6; white-space: nowrap; }
.is-tips-note { color: var(--dsw-alias-label-secondary); }
.is-history { margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.is-history .is-card-head { margin-bottom: 7px; }
.is-history-list { display: flex; gap: 8px; overflow-x: auto; padding: 6px 1px 4px; }
.is-thumb { width: 58px; flex: none; padding: 0; border-radius: 9px; overflow: hidden; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); position: relative; aspect-ratio: 1; }
.is-thumb-wrap { position: relative; flex: none; width: 58px; height: 58px; }
.is-thumb-delete {
  position: absolute; top: 2px; right: 2px; z-index: 2; width: 17px; height: 17px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; color: #fff; background: rgba(0,0,0,.62); cursor: pointer;
}
.is-thumb-delete:hover { background: var(--dsw-alias-state-error-primary); }
.is-thumb-delete:disabled { opacity: .45; cursor: wait; }
.is-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.is-thumb:hover { border-color: var(--dsw-alias-brand-primary); }
.is-thumb.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent); }
.is-thumb-time { position: absolute; right: 3px; bottom: 3px; font-size: 9px; padding: 1px 4px; border-radius: 5px; background: rgba(0,0,0,.55); color: #fff; font-variant-numeric: tabular-nums; }
.is-history-empty { font-size: 11.5px; color: var(--dsw-alias-label-secondary); padding: 3px 0 0; }
.is-modal { position: fixed; inset: 0; z-index: 12600; display: flex; align-items: center; justify-content: center; padding: 28px; background: rgba(8,10,16,.52); backdrop-filter: blur(4px); }
.is-btn.is-toggle-on {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 52%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-brand-primary);
}
.is-cache-pill {
  display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--dsw-alias-label-secondary);
  padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
  font-variant-numeric: tabular-nums;
}
/* ---------- Bubble Annotation Editor ---------- */
.is-annotate-layer {
  position: fixed; inset: 0; z-index: 12850; display: flex; align-items: center; justify-content: center;
  padding: 22px; background: rgba(8, 10, 14, .72); backdrop-filter: blur(5px);
}
.is-annotate-modal {
  width: min(1120px, 96vw); height: min(88vh, 800px); display: flex; flex-direction: column;
  padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1); box-shadow: 0 24px 80px rgba(0,0,0,.35);
  animation: is-modal-in .42s var(--is-ease-spring) both;
}
.is-annotate-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.is-annotate-title {
  display: flex; align-items: center; flex-wrap: wrap; gap: 7px;
  font-size: 15px; font-weight: 650; color: var(--dsw-alias-label-primary);
}
.is-annotate-title .is-tag { font-size: 10.5px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.is-annotate-sub { margin-top: 3px; max-width: 760px; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.is-annotate-head-actions { flex: none; display: flex; align-items: center; gap: 8px; }
.is-annotate-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 14px; margin-top: 12px; }
.is-annotate-stage {
  position: relative; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center;
  padding: 10px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base); overflow: hidden; user-select: none;
}
.is-annotate-canvas-wrap {
  position: relative; display: inline-flex; max-width: 100%; max-height: 100%;
  cursor: ${ANNOTATE_CURSOR};
}
.is-annotate-canvas-wrap > img {
  display: block; max-width: 100%; max-height: calc(88vh - 200px); width: auto; height: auto;
  object-fit: contain; border-radius: 8px; box-shadow: 0 10px 36px rgba(0,0,0,.22); pointer-events: none;
}
.is-annotate-pin {
  position: absolute; transform: translate(-50%, -100%); z-index: 3; padding: 0; border: 0; background: transparent;
  cursor: pointer; display: flex; flex-direction: column; align-items: center;
  animation: is-pop-in .26s var(--is-ease-spring) both;
}
.is-annotate-pin-head {
  position: relative; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  background: #ff3b30; color: #fff; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums;
  border: 2px solid #fff; box-shadow: 0 3px 10px rgba(0,0,0,.35);
  transition: transform .16s var(--is-ease-spring), background .15s ease, box-shadow .16s ease;
}
.is-annotate-pin-del {
  position: absolute; top: -6px; right: -6px; width: 15px; height: 15px; padding: 0; display: grid; place-items: center;
  border: 1px solid rgba(255,255,255,.9); border-radius: 50%; background: rgba(15,18,24,.82); color: #fff;
  cursor: pointer; opacity: 0; transition: opacity .15s ease;
}
.is-annotate-pin:hover .is-annotate-pin-del, .is-annotate-pin.is-active .is-annotate-pin-del { opacity: 1; }
.is-annotate-pin-tail {
  width: 0; height: 0; margin-top: -2px;
  border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid #fff;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.28));
}
.is-annotate-pin:hover .is-annotate-pin-head, .is-annotate-pin.is-active .is-annotate-pin-head {
  transform: scale(1.12); background: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent), 0 5px 14px rgba(0,0,0,.4);
}
.is-annotate-side {
  min-height: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
}
.is-annotate-side-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 20px; }
.is-annotate-side-title { font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.is-annotate-side-head .is-count { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.is-annotate-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
.is-annotate-item {
  display: flex; flex-direction: column; gap: 6px; padding: 9px 10px 10px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.is-annotate-item.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.is-annotate-item-top { display: flex; align-items: center; gap: 7px; min-width: 0; }
.is-annotate-badge { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: #ff3b30; color: #fff; font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.is-annotate-item.is-active .is-annotate-badge { background: var(--dsw-alias-brand-primary); }
.is-annotate-item-title { flex: 1 1 auto; min-width: 0; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-annotate-coord { flex: none; font-size: 10px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.is-annotate-del { flex: none; height: 22px; padding: 0 5px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10.5px; cursor: pointer; }
.is-annotate-del:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); color: var(--dsw-alias-state-error-primary); }
.is-annotate-item textarea {
  width: 100%; min-height: 54px; max-height: 140px; resize: vertical; padding: 7px 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; line-height: 1.5; outline: none;
}
.is-annotate-item textarea:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.is-annotate-empty { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px 14px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.65; }
.is-annotate-foot { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.is-annotate-foot-hint { flex: 1 1 auto; min-width: 0; font-size: 10.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.is-annotate-foot-actions { flex: none; display: flex; align-items: center; gap: 8px; }
@media (max-width: 920px) {
  .is-annotate-layer { padding: 12px; }
  .is-annotate-modal { width: 100%; height: min(94vh, 900px); }
  .is-annotate-head { flex-direction: column; gap: 8px; }
  .is-annotate-head-actions { align-self: flex-end; }
  .is-annotate-body { grid-template-columns: 1fr; grid-template-rows: minmax(240px, 1fr) minmax(220px, 300px); }
  .is-annotate-canvas-wrap > img { max-height: calc(94vh - 420px); }
  .is-annotate-foot { align-items: flex-start; flex-direction: column; gap: 10px; }
}
.is-modal-card { width: 480px; max-width: 100%; max-height: 88vh; overflow: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; padding: 20px; box-shadow: 0 26px 80px rgba(0,0,0,.32); }
.is-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.is-modal-title { margin: 0; font-size: 15px; font-weight: 650; }
.is-modal-sub { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.is-note { font-size: 10.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); margin: 4px 0 0; }
.is-key-link { display: flex; align-items: center; gap: 8px; margin-top: 7px; }
.is-key-link .is-note { margin: 0; text-decoration: underline; text-underline-offset: 2px; }
.is-modal-actions { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
.is-modal-actions .is-spacer { flex: 1; }
.is-close { width: 28px; height: 28px; padding: 0; border-radius: 8px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); display: grid; place-items: center; cursor: pointer; }
.is-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.is-close > svg, .is-camera-close > svg, .is-viewer-close > svg, .is-thumb-delete > svg, .is-reference-remove > svg, .is-annotate-pin-del > svg,
.is-reference-add > svg, .is-reference-plus > svg, .is-gallery-add > svg { display: block; }
.is-error-text { font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); margin: 10px 0 0; white-space: pre-wrap; }
.is-model-sniff { margin-top: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); padding: 8px; }
.is-model-sniff-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.is-model-sniff-hint { color: var(--dsw-alias-label-tertiary); }
.is-model-sniff-list { display: flex; flex-wrap: wrap; gap: 5px; max-height: 150px; overflow-y: auto; }
.is-model-chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 3px 7px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);
  font: 10.5px/1.4 var(--ds-font-family-code); cursor: pointer; text-align: left;
}
.is-model-chip:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l3); }
.is-model-chip.active { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); }
.is-model-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-model-chip-check { flex: none; width: 10px; color: var(--dsw-alias-state-business-primary); font-size: 10px; }
.is-model-chip-tag { flex: none; font-size: 9px; padding: 0 3px; border-radius: 3px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent); color: var(--dsw-alias-state-business-primary); }
.is-command { margin: 2px 0; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; padding: 12px; max-width: 560px; }
.is-command img { display: block; max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 8px; }
.is-command-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.is-command-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
.is-command-hint { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.is-tool-image { display: flex; flex-direction: column; gap: 6px; width: min(100%, 520px); padding: 8px 0 4px; }
.is-tool-image-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-tertiary); letter-spacing: .04em; }
.is-tool-image img { max-width: 100%; max-height: 360px; border-radius: 8px; display: block; box-shadow: 0 10px 30px rgba(0,0,0,.16); }
.is-tool-image-meta { font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.is-tool-image-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.is-tool-image-hint { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.is-tool-image-empty { padding: 8px 0; }
.is-tool-image-empty .is-tool-image-meta { white-space: pre-wrap; }
/* ---------- motion & polish ---------- */
.is-page {
  --is-ease-out: cubic-bezier(.22, 1, .36, 1);
  --is-ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --is-ease-snap: cubic-bezier(.2, .9, .25, 1);
  --is-dur-fast: 140ms;
  --is-dur-base: 240ms;
  --is-dur-slow: 520ms;
  background:
    radial-gradient(1200px 620px at 12% -12%, color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent), transparent 62%),
    radial-gradient(900px 520px at 100% 0%, color-mix(in srgb, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)) 5%, transparent), transparent 60%),
    var(--dsw-alias-bg-base);
}
@keyframes is-rise-in { from { opacity: 0; translate: 0 12px; } to { opacity: 1; translate: 0 0; } }
@keyframes is-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes is-pop-in { 0% { opacity: 0; scale: .86; } 62% { opacity: 1; scale: 1.035; } 100% { opacity: 1; scale: 1; } }
@keyframes is-menu-in { from { opacity: 0; transform: translateY(-5px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes is-toast-in { from { opacity: 0; transform: translate(-50%, 16px) scale(.94); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes is-modal-in { from { opacity: 0; transform: translateY(16px) scale(.965); } to { opacity: 1; transform: none; } }
@keyframes is-viewer-in { from { opacity: 0; transform: scale(.93); } to { opacity: 1; transform: scale(1); } }
@keyframes is-reveal { from { opacity: 0; transform: translate(-50%, -50%) scale(.94); filter: blur(7px); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: blur(0); } }
@keyframes is-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes is-orbit { to { transform: rotate(360deg); } }
@keyframes is-dot-pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-success-primary) 42%, transparent); } 50% { opacity: .72; box-shadow: 0 0 0 4px transparent; } }
@keyframes is-white-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .58; transform: scale(.86); } }
@keyframes is-indeterminate { 0% { translate: -110% 0; } 100% { translate: 360% 0; } }
@keyframes is-text-shimmer { to { background-position: -200% 0; } }
@keyframes is-ripple { to { transform: scale(2.8); opacity: 0; } }
.is-head { animation: is-rise-in var(--is-dur-slow) var(--is-ease-out) both; }
.is-logo::before {
  content: ''; position: absolute; inset: -6px; z-index: -1; border-radius: 19px; pointer-events: none;
  background: radial-gradient(65% 65% at 32% 30%, color-mix(in srgb, var(--dsw-alias-brand-primary) 48%, transparent), transparent 72%);
  filter: blur(9px); opacity: .66;
  transition: opacity .3s ease, transform .3s ease;
}
.is-logo::after {
  content: ''; position: absolute; inset: 0; z-index: 0; border-radius: inherit; pointer-events: none;
  background:
    linear-gradient(135deg, rgba(255,255,255,.58) 0%, rgba(255,255,255,.12) 28%, transparent 50%, rgba(255,255,255,.18) 100%),
    repeating-linear-gradient(115deg, rgba(255,255,255,.06) 0 1px, transparent 1px 3px),
    radial-gradient(70% 55% at 72% 88%, rgba(255,255,255,.22), transparent 72%);
  mix-blend-mode: screen; opacity: .9;
}
.is-logo > * { position: relative; z-index: 1; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.18)); }
.is-head:hover .is-logo, .is-page.is-busy-page .is-logo {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, #fff 72%, var(--dsw-alias-border-l1));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.9),
    inset 0 -6px 12px rgba(255,255,255,.1),
    inset 0 0 0 1px rgba(255,255,255,.16),
    0 6px 18px rgba(0,0,0,.16),
    0 0 28px color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, transparent);
}
.is-head:hover .is-logo::before, .is-page.is-busy-page .is-logo::before { opacity: .9; transform: scale(1.08); }
.is-page.is-busy-page .is-logo::before { animation: is-logo-glow 2.6s ease-in-out infinite; }
@keyframes is-logo-glow {
  0%, 100% { opacity: .5; transform: scale(.98); }
  50% { opacity: .92; transform: scale(1.12); }
}
.is-grid > .is-card { animation: is-rise-in .56s var(--is-ease-out) both; }
.is-grid > .is-card:nth-child(2) { animation-delay: 70ms; }
.is-card {
  position: relative;
  transition: border-color var(--is-dur-base) ease, box-shadow var(--is-dur-base) var(--is-ease-out), transform var(--is-dur-base) var(--is-ease-out);
}
.is-card::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
}
.is-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, var(--dsw-alias-border-l1));
  box-shadow: 0 12px 28px -24px rgba(0,0,0,.36), 0 2px 8px -7px rgba(0,0,0,.1);
}
.is-btn {
  position: relative; overflow: hidden;
  transition: background var(--is-dur-fast) ease, border-color var(--is-dur-fast) ease, color var(--is-dur-fast) ease, opacity var(--is-dur-fast) ease, box-shadow var(--is-dur-base) ease, transform 110ms var(--is-ease-snap);
}
.is-btn:active:not(:disabled) { transform: scale(.96); }
.is-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); outline-offset: 2px; }
.is-btn-primary {
  background-image: linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 82%, #fff) 0%, var(--dsw-alias-brand-primary) 52%, color-mix(in srgb, var(--dsw-alias-brand-primary) 82%, #000) 100%);
  box-shadow: 0 8px 20px -12px color-mix(in srgb, var(--dsw-alias-brand-primary) 90%, transparent);
}
.is-btn-primary::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 32%, rgba(255,255,255,.34) 46%, transparent 60%);
  translate: -130% 0; transition: translate .65s var(--is-ease-out);
}
.is-btn-primary:hover:not(:disabled)::after { translate: 130% 0; }
.is-btn.is-generating::before {
  content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: #fff;
  animation: is-white-pulse 1.15s ease-in-out infinite;
}
.is-provider {
  position: relative; overflow: hidden;
  transition: background var(--is-dur-fast) ease, color var(--is-dur-fast) ease, border-color var(--is-dur-fast) ease, box-shadow var(--is-dur-base) ease, transform 110ms var(--is-ease-snap);
}
.is-provider:active { transform: scale(.96); }
.is-providers { position: relative; }
.is-provider { z-index: 1; }
.is-providers.has-glider .is-provider.active { background: transparent; border-color: transparent; box-shadow: none; }
.is-providers.has-glider .is-provider.active:hover { background: transparent; }
.is-provider-glider {
  position: absolute; top: 3px; bottom: 3px; left: 0; z-index: 0; pointer-events: none;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base);
  box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 6px 16px -10px color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent);
  transition: transform .38s var(--is-ease-spring), width .3s var(--is-ease-out), opacity .18s ease;
}
.is-provider.active .is-provider-dot.ok {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent);
}
.is-input, .is-select, .is-textarea { transition: border-color var(--is-dur-fast) ease, box-shadow var(--is-dur-base) ease, background-color var(--is-dur-base) ease; }
.is-input:hover:not(:focus), .is-select:hover:not(:focus), .is-textarea:hover:not(:focus) { border-color: var(--dsw-alias-border-l2); }
.is-reference-stage { transition: border-color var(--is-dur-base) ease, background-color var(--is-dur-base) ease, box-shadow var(--is-dur-base) ease; }
.is-reference-stage:hover { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, var(--dsw-alias-border-l2)); }
.is-reference-item {
  animation: is-pop-in .34s var(--is-ease-spring) both;
  transition: transform .22s var(--is-ease-out), border-color .22s ease, box-shadow .26s ease;
}
.is-reference-item:hover { transform: translateY(-2px) scale(1.035); border-color: var(--dsw-alias-brand-primary); box-shadow: 0 10px 20px -10px rgba(0,0,0,.5); z-index: 2; }
.is-reference-remove { opacity: 0; scale: .8; transition: opacity var(--is-dur-fast) ease, scale var(--is-dur-fast) var(--is-ease-spring), background var(--is-dur-fast) ease; }
.is-reference-item:hover .is-reference-remove, .is-reference-item:focus-within .is-reference-remove { opacity: 1; scale: 1; }
.is-reference-add { transition: transform .28s var(--is-ease-spring), border-color var(--is-dur-fast) ease, color var(--is-dur-fast) ease; }
.is-reference-add:hover { transform: rotate(90deg) scale(1.06); }
.is-reference-plus { transition: transform .28s var(--is-ease-spring), border-color var(--is-dur-fast) ease, color var(--is-dur-fast) ease; }
.is-reference-empty:hover .is-reference-plus { transform: scale(1.12); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.is-thumb-wrap { animation: is-pop-in .32s var(--is-ease-spring) both; transition: transform .22s var(--is-ease-out); }
.is-thumb-wrap:hover, .is-thumb-wrap:focus-within { transform: translateY(-3px); }
.is-thumb { transition: border-color .22s ease, box-shadow .26s ease; }
.is-thumb-wrap:hover .is-thumb, .is-thumb-wrap:focus-within .is-thumb { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 10px 20px -10px rgba(0,0,0,.55); }
.is-thumb-delete { opacity: 0; scale: .8; transition: opacity var(--is-dur-fast) ease, scale var(--is-dur-fast) var(--is-ease-spring), background var(--is-dur-fast) ease; }
.is-thumb-wrap:hover .is-thumb-delete, .is-thumb-wrap:focus-within .is-thumb-delete { opacity: 1; scale: 1; }
.is-canvas { transition: border-color var(--is-dur-base) ease, box-shadow var(--is-dur-base) ease, background-color var(--is-dur-base) ease; }
.is-canvas.is-loading-canvas {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-border-l1));
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 0 90px -44px color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent);
}
.is-canvas.is-loading-canvas::before {
  content: ''; position: absolute; inset: -35%; pointer-events: none; z-index: 0; opacity: .55;
  background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent) 68deg, transparent 145deg, color-mix(in srgb, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)) 20%, transparent) 240deg, transparent 325deg);
  animation: is-orbit 5.2s linear infinite; will-change: transform;
}
.is-canvas.is-loading-canvas::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent) 46%, transparent 100%);
  translate: 0 -100%; animation: is-scan 2.8s var(--is-ease-out) infinite;
}
@keyframes is-scan { 0% { translate: 0 -100%; opacity: 0; } 18% { opacity: 1; } 82% { opacity: 1; } 100% { translate: 0 100%; opacity: 0; } }
.is-loading .is-empty-title {
  font-size: 14px; font-variant-numeric: tabular-nums;
  background: linear-gradient(90deg, var(--dsw-alias-label-primary) 18%, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-label-primary) 72%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: is-text-shimmer 2.2s linear infinite;
}
.is-progress {
  position: relative; z-index: 1; width: min(260px, 72%); height: 4px; margin-top: 14px;
  border-radius: 999px; background: var(--dsw-alias-bg-layer-3); overflow: hidden;
}
.is-progress-bar {
  position: absolute; inset: 0; width: 42%; border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--dsw-alias-brand-primary), transparent);
  animation: is-indeterminate 1.55s var(--is-ease-out) infinite;
}
.is-canvas img.is-result-image { animation: is-reveal .55s var(--is-ease-out) both; transition: box-shadow var(--is-dur-base) ease, scale .5s var(--is-ease-out); }
.is-canvas img.is-result-image:hover { box-shadow: 0 18px 60px rgba(0,0,0,.34); scale: 1.012; }
.is-empty-icon { transition: transform .35s var(--is-ease-spring), border-color .22s ease; }
.is-canvas:hover .is-empty-icon { transform: translateY(-4px) scale(1.04); border-color: var(--dsw-alias-brand-primary); }
.is-modal, .is-gallery-layer, .is-camera-layer, .is-viewer, .is-annotate-layer { animation: is-fade-in .22s ease-out both; }
.is-modal-card, .is-gallery-modal, .is-camera-modal, .is-preview-modal { animation: is-modal-in .42s var(--is-ease-spring) both; }
.is-viewer-frame, .is-lightbox { animation: is-viewer-in .38s var(--is-ease-out) both; }
.is-close, .is-camera-close, .is-viewer-close { transition: background var(--is-dur-fast) ease, color var(--is-dur-fast) ease, border-color var(--is-dur-fast) ease, transform .2s var(--is-ease-spring); }
.is-close:hover, .is-camera-close:hover, .is-viewer-close:hover { transform: rotate(90deg) scale(1.04); }
.is-context-menu { transform-origin: top left; animation: is-menu-in .18s var(--is-ease-out) both; }
.is-mention-menu { transform-origin: top center; animation: is-menu-in .16s var(--is-ease-out) both; }
.is-copy-toast { animation: is-toast-in .34s var(--is-ease-spring) both; }
.is-copy-toast::before {
  content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%;
  background: var(--dsw-alias-state-success-primary); vertical-align: 1px;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent);
}
.is-gallery-card, .is-plib-card { transition: transform .22s var(--is-ease-out), border-color .2s ease, box-shadow .26s ease; }
.is-gallery-card:hover, .is-plib-card:hover { transform: translateY(-3px); box-shadow: 0 14px 28px -16px rgba(0,0,0,.55); }
.is-gallery-card img, .is-plib-card img { transition: scale .55s var(--is-ease-out); }
.is-gallery-card:hover img, .is-plib-card:hover img { scale: 1.045; }
.is-gallery-tab, .is-prompt-chip {
  position: relative; overflow: hidden;
  transition: background var(--is-dur-fast) ease, border-color var(--is-dur-fast) ease, color var(--is-dur-fast) ease, transform 110ms var(--is-ease-snap);
}
.is-gallery-tab:active, .is-prompt-chip:active { transform: scale(.96); }
.is-ripple {
  position: absolute; border-radius: 50%; pointer-events: none; background: currentColor; opacity: .22;
  transform: scale(0); animation: is-ripple .6s var(--is-ease-out) forwards;
}
.is-history-list, .is-gallery-grid, .is-prompt-grid { scroll-behavior: smooth; }
.is-history-list::-webkit-scrollbar, .is-gallery-grid::-webkit-scrollbar, .is-prompt-grid::-webkit-scrollbar, .is-model-sniff-list::-webkit-scrollbar { width: 8px; height: 8px; }
.is-history-list::-webkit-scrollbar-thumb, .is-gallery-grid::-webkit-scrollbar-thumb, .is-prompt-grid::-webkit-scrollbar-thumb, .is-model-sniff-list::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); border-radius: 999px; }
.is-history-list::-webkit-scrollbar-track, .is-gallery-grid::-webkit-scrollbar-track, .is-prompt-grid::-webkit-scrollbar-track, .is-model-sniff-list::-webkit-scrollbar-track { background: transparent; }

@media (max-width: 900px) {
  .is-page { padding: calc(var(--dsh-frame-top-clearance, 0px) + 18px) 16px 30px; }
  .is-grid { grid-template-columns: 1fr; }
  .is-head { flex-direction: column; }
  .is-head-actions { width: 100%; }
  .is-canvas { min-height: 240px; }
}
@media (prefers-reduced-motion: reduce) {
  .is-page *, .is-page *::before, .is-page *::after,
  .is-command *, .is-tool-image *, .is-modal *, .is-gallery-layer *, .is-camera-layer *, .is-viewer *, .is-annotate-layer * {
    animation-duration: .001ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
  .is-skeleton, .is-ripple { animation: none !important; }
  .is-progress { display: none; }
}
`
      document.head.appendChild(style)
    }

    function StudioIcon(props) {
      return icon(props && typeof props.size === 'number' ? props.size : 18)
    }

    /* ---------------------------------------------------------------- */
    /* Panel                                                             */
    /* ---------------------------------------------------------------- */

    function readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('读取参考图失败。'))
        reader.readAsDataURL(file)
      })
    }

    function loadImageElement(src, crossOrigin) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        if (crossOrigin) image.crossOrigin = crossOrigin
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('参考图解码失败，请换一张 PNG/JPEG/WebP。'))
        image.src = src
      })
    }

    async function renderAnnotatedReference(sourceUrl, markers, nameHint) {
      let image
      try {
        image = await loadImageElement(sourceUrl, 'anonymous')
      } catch {
        const res = await fetch(sourceUrl)
        if (!res.ok) throw new Error(`读取原图失败（HTTP ${res.status}）`)
        const blob = await res.blob()
        const dataUrl = await readFileAsDataURL(blob)
        image = await loadImageElement(dataUrl)
      }
      const max = 1536
      const scale = Math.min(1, max / Math.max(image.width, image.height))
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('浏览器无法创建标注画布。')
      ctx.drawImage(image, 0, 0, width, height)

      const shortSide = Math.min(width, height)
      const radius = Math.max(15, Math.min(34, Math.round(shortSide * 0.026)))
      const tipOffset = Math.round(radius * 1.45)
      const strokeW = Math.max(2.5, Math.round(radius * 0.16))

      markers.forEach((marker, idx) => {
        const num = String(idx + 1)
        const tipX = Math.max(4, Math.min(width - 4, marker.x * width))
        const tipY = Math.max(4, Math.min(height - 4, marker.y * height))
        const flipDown = tipY < tipOffset + radius + 8
        const cx = Math.max(radius + 6, Math.min(width - radius - 6, tipX))
        const cy = flipDown ? tipY + tipOffset : tipY - tipOffset

        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
        ctx.shadowBlur = Math.round(radius * 0.45)
        ctx.shadowOffsetY = Math.round(radius * 0.14)

        // Target anchor dot at exact click point
        ctx.beginPath()
        ctx.arc(tipX, tipY, Math.max(3.5, radius * 0.22), 0, Math.PI * 2)
        ctx.fillStyle = '#ef4444'
        ctx.fill()
        ctx.lineWidth = Math.max(1.8, strokeW * 0.7)
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()

        // Pointer triangle connecting bubble to anchor point
        const baseHalf = radius * 0.48
        const joinY = flipDown ? cy - radius * 0.72 : cy + radius * 0.72
        ctx.beginPath()
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(cx - baseHalf, joinY)
        ctx.lineTo(cx + baseHalf, joinY)
        ctx.closePath()
        ctx.fillStyle = '#ef4444'
        ctx.fill()
        ctx.lineWidth = strokeW
        ctx.strokeStyle = '#ffffff'
        ctx.lineJoin = 'round'
        ctx.stroke()

        // Main numbered bubble circle
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fillStyle = '#ef4444'
        ctx.fill()
        ctx.lineWidth = strokeW
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.restore()

        // Crisp number label
        ctx.save()
        ctx.fillStyle = '#ffffff'
        ctx.font = `800 ${Math.round(radius * (num.length > 1 ? 0.95 : 1.12))}px system-ui, -apple-system, "Segoe UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(num, cx, cy + 1)
        ctx.restore()
      })

      const dataUrl = canvas.toDataURL('image/png')
      return {
        dataUrl,
        name: `${nameHint || 'annotated'}-标注.png`,
        width,
        height,
        bytes: Math.round((dataUrl.length * 3) / 4),
      }
    }

    async function prepareReferenceFile(file) {
      if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
        throw new Error('参考图只支持 PNG / JPEG / WebP。')
      }
      if (file.size > 20 * 1024 * 1024) {
        throw new Error('参考图不能超过 20MB。')
      }
      const original = await readFileAsDataURL(file)
      const image = await loadImageElement(original)
      const max = 1536
      const scale = Math.min(1, max / Math.max(image.width, image.height))
      if (scale === 1 && original.length <= 8 * 1024 * 1024) {
        return { dataUrl: original, name: file.name, width: image.width, height: image.height, bytes: file.size }
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法处理这张参考图。')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const mime = file.type === 'image/png' ? 'image/png' : (file.type === 'image/webp' ? 'image/webp' : 'image/jpeg')
      const dataUrl = canvas.toDataURL(mime, 0.9)
      return {
        dataUrl,
        name: file.name,
        width: canvas.width,
        height: canvas.height,
        bytes: Math.round((dataUrl.length * 3) / 4),
      }
    }

    /** Keep one render error from blanking the whole panel. */
    class PluginErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error !== null) {
          const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
          return h('div', { className: 'is-page' },
            h('div', { className: 'is-card' },
              h('div', { className: 'is-card-title' }, '生图工作台渲染出错'),
              h('p', { className: 'is-sub' }, message),
              h('button', {
                className: 'is-btn is-btn-ghost',
                onClick: () => this.setState({ error: null }),
              }, '重试'),
            ),
          )
        }
        return this.props.children
      }
    }

    function StudioPage() {
      const [status, setStatus] = React.useState(null)
      const [statusError, setStatusError] = React.useState('')
      const [history, setHistory] = React.useState([])
      const [activeId, setActiveId] = React.useState(FALLBACK_PROVIDERS[0])
      const providerBarRef = React.useRef(null)
      const [providerGlider, setProviderGlider] = React.useState({ left: 0, width: 0, ready: false })
      const [prompt, setPrompt] = React.useState('')
      const [model, setModel] = React.useState('')
      const [size, setSize] = React.useState('')
      const [ratio, setRatio] = React.useState('')
      const [quality, setQuality] = React.useState('')
      const [outputFormat, setOutputFormat] = React.useState('png')
      const [complexity, setComplexity] = React.useState('auto')
      const [frameCount, setFrameCount] = React.useState(9)
      const [frameDurationMs, setFrameDurationMs] = React.useState(200)
      const [generating, setGenerating] = React.useState(false)
      const [activeJob, setActiveJob] = React.useState(null)
      const [elapsed, setElapsed] = React.useState(0)
      const [error, setError] = React.useState('')
      const [references, setReferences] = React.useState([])
      const referencesRef = React.useRef([])
      React.useEffect(() => {
        referencesRef.current = references
      }, [references])

      const [result, setResult] = React.useState(null)
      const [imageSize, setImageSize] = React.useState(null)
      const [setupOpen, setSetupOpen] = React.useState(false)
      const [setupProviderId, setSetupProviderId] = React.useState('')
      const [setupDraft, setSetupDraft] = React.useState({
        apiKey: '', baseUrl: '', endpointPath: '', model: '', size: '', ratio: '', quality: '', schema: '',
      })
      const [setupBusy, setSetupBusy] = React.useState(false)
      const [setupError, setSetupError] = React.useState('')
      const [sniffModels, setSniffModels] = React.useState([])
      const [sniffSelected, setSniffSelected] = React.useState([])
      const [sniffBusy, setSniffBusy] = React.useState(false)
      const [sniffError, setSniffError] = React.useState('')
      const [copied, setCopied] = React.useState('')
      const [contextMenu, setContextMenu] = React.useState(null)
      const [toast, setToast] = React.useState('')
      const toastTimer = React.useRef(null)
      const [viewerOpen, setViewerOpen] = React.useState(false)
      const [viewerZoomed, setViewerZoomed] = React.useState(false)
      const viewerTransformRef = React.useRef({ zoom: 1, x: 0, y: 0 })
      const viewerRef = React.useRef(null)
      const viewerFrameRef = React.useRef(null)
      const viewerImgRef = React.useRef(null)
      const viewerZoomTextRef = React.useRef(null)
      const [dragOverRef, setDragOverRef] = React.useState(false)
      const [annotateOpen, setAnnotateOpen] = React.useState(false)
      const [annotateMarkers, setAnnotateMarkers] = React.useState([])
      const [annotateActiveId, setAnnotateActiveId] = React.useState('')
      const [annotateBusy, setAnnotateBusy] = React.useState(false)
      const annotateInputRefs = React.useRef({})
      const [cacheInfo, setCacheInfo] = React.useState(null)
      const [cacheBusy, setCacheBusy] = React.useState(false)
      const promptPageCacheRef = React.useRef({})
      const [deletingId, setDeletingId] = React.useState('')
      const [update, setUpdate] = React.useState({ state: 'idle', latestVersion: '', currentVersion: '', message: '', releaseUrl: '', canUpdate: false })
      const [cameraOpen, setCameraOpen] = React.useState(false)
      const [mention, setMention] = React.useState({ open: false, start: 0, end: 0, index: 0, query: '' })
      const promptRef = React.useRef(null)
      const [cameraDraft, setCameraDraft] = React.useState(CAMERA_DEFAULTS)
      const [galleryOpen, setGalleryOpen] = React.useState(false)
      const [galleryLibrary, setGalleryLibrary] = React.useState('pose')
      const [galleryItems, setGalleryItems] = React.useState([])
      const [galleryLoading, setGalleryLoading] = React.useState(false)
      const [galleryError, setGalleryError] = React.useState('')
      const [galleryQuery, setGalleryQuery] = React.useState('')
      const [galleryLimit, setGalleryLimit] = React.useState(60)
      const [galleryBusyId, setGalleryBusyId] = React.useState('')
      const [galleryAdded, setGalleryAdded] = React.useState({})
      const galleryCacheRef = React.useRef({})
      const [promptLibOpen, setPromptLibOpen] = React.useState(false)
      const [promptSource, setPromptSource] = React.useState('navxd')
      const [promptItems, setPromptItems] = React.useState([])
      const [promptFilters, setPromptFilters] = React.useState({ styles: [], types: [], models: [], categories: [], scenes: [] })
      const [promptFilter, setPromptFilter] = React.useState({ style: '', type: '', model: '', category: '', scene: '' })
      const [promptPage, setPromptPage] = React.useState(1)
      const [promptTotalPages, setPromptTotalPages] = React.useState(1)
      const [promptLoading, setPromptLoading] = React.useState(false)
      const [promptError, setPromptError] = React.useState('')
      const [promptQuery, setPromptQuery] = React.useState('')
      const [promptCopiedId, setPromptCopiedId] = React.useState('')
      const [promptSources, setPromptSources] = React.useState([])
      const [galleryLibraries, setGalleryLibraries] = React.useState([])
      const [offlineOpen, setOfflineOpen] = React.useState(false)
      const [offlineKind, setOfflineKind] = React.useState('prompts')
      const [offlinePacks, setOfflinePacks] = React.useState({ prompts: [], gallery: [] })
      const [offlineManifestPath, setOfflineManifestPath] = React.useState('')
      const [offlineBaseDir, setOfflineBaseDir] = React.useState('')
      const [offlineBusy, setOfflineBusy] = React.useState(false)
      const [offlineNotice, setOfflineNotice] = React.useState({ kind: '', text: '' })
      const [mediaPreview, setMediaPreview] = React.useState(null)
      const [imageLightbox, setImageLightbox] = React.useState(null)
      const [galleryStatus, setGalleryStatus] = React.useState('')
      const [sfwOnly, setSfwOnly] = React.useState(() => {
        try {
          return window.localStorage.getItem('image-studio:sfw') !== '0'
        } catch {
          return true
        }
      })
      React.useEffect(() => {
        try {
          window.localStorage.setItem('image-studio:sfw', sfwOnly ? '1' : '0')
        } catch {
          // private mode: keep the in-memory choice
        }
      }, [sfwOnly])
      const [referenceNotice, setReferenceNotice] = React.useState({ kind: '', text: '' })
      const galleryAddRef = React.useRef(false)

      React.useEffect(() => {
        if (!generating) {
          setElapsed(0)
          return undefined
        }
        const startedAt = activeJob && Number.isFinite(activeJob.startedAt) ? activeJob.startedAt : Date.now()
        setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
        const timer = window.setInterval(() => {
          setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
        }, 1000)
        return () => window.clearInterval(timer)
      }, [generating, activeJob])
      const mounted = React.useRef(true)
      const fileInputRef = React.useRef(null)

      React.useEffect(() => () => { mounted.current = false }, [])

      // 服务商页签的滑动底板：测量当前激活项，切换时平滑滑过去。
      React.useEffect(() => {
        const bar = providerBarRef.current
        if (!bar) return undefined
        const measure = () => {
          const target = bar.querySelector('.is-provider.active')
          if (!target) return
          setProviderGlider({
            left: target.offsetLeft,
            width: target.offsetWidth,
            ready: true,
          })
        }
        measure()
        const frame = window.requestAnimationFrame(measure)
        let observer = null
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure)
          observer.observe(bar)
        }
        window.addEventListener('resize', measure)
        return () => {
          window.cancelAnimationFrame(frame)
          if (observer) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [activeId, status])

      // 点击涟漪：只在小控件上触发，响应式监听低动效偏好，避免大卡片生成巨型图层。
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const mq = typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)')
          : null
        const selector = '.is-btn, .is-provider, .is-gallery-tab, .is-prompt-chip'
        const onPointerDown = (event) => {
          if (mq && mq.matches) return
          const target = event.target && event.target.closest ? event.target.closest(selector) : null
          if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return
          const rect = target.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          const size = Math.min(260, Math.max(rect.width, rect.height) * 1.35)
          const node = document.createElement('span')
          node.className = 'is-ripple'
          node.setAttribute('aria-hidden', 'true')
          node.style.width = `${size}px`
          node.style.height = `${size}px`
          node.style.left = `${event.clientX - rect.left - size / 2}px`
          node.style.top = `${event.clientY - rect.top - size / 2}px`
          target.appendChild(node)
          window.setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node) }, 620)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => document.removeEventListener('pointerdown', onPointerDown, true)
      }, [])

      const applyViewerTransform = React.useCallback((next) => {
        viewerTransformRef.current = next
        const img = viewerImgRef.current
        if (img) {
          img.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`
        }
        const zoomNode = viewerZoomTextRef.current
        if (zoomNode) {
          zoomNode.textContent = next.zoom > 1.005 ? `  ·  ${Math.round(next.zoom * 100)}%` : ''
        }
        setViewerZoomed((prev) => {
          const z = next.zoom > 1.005
          return prev === z ? prev : z
        })
      }, [])

      React.useEffect(() => {
        if (!viewerOpen) return undefined
        if (!result) {
          setViewerOpen(false)
          return undefined
        }
        applyViewerTransform({ zoom: 1, x: 0, y: 0 })
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const node = viewerRef.current
        const onWheel = (event) => {
          event.preventDefault()
          const frame = viewerFrameRef.current
          const rect = frame ? frame.getBoundingClientRect() : null
          const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
          const current = viewerTransformRef.current
          const zoom = Math.min(6, Math.max(1, current.zoom * factor))
          if (Math.abs(zoom - current.zoom) < 0.0001) return
          if (zoom === 1) {
            applyViewerTransform({ zoom: 1, x: 0, y: 0 })
            return
          }
          const ratio = zoom / current.zoom
          const dx = rect ? event.clientX - (rect.left + rect.width / 2) : 0
          const dy = rect ? event.clientY - (rect.top + rect.height / 2) : 0
          applyViewerTransform({
            zoom,
            x: current.x * ratio + dx * (1 - ratio),
            y: current.y * ratio + dy * (1 - ratio),
          })
        }
        if (node) node.addEventListener('wheel', onWheel, { passive: false })
        return () => {
          document.body.style.overflow = previousOverflow
          if (node) node.removeEventListener('wheel', onWheel)
        }
      }, [viewerOpen, result, applyViewerTransform])

      // 全局顶层弹层 Escape 栈：优先关闭最上层的灯箱 / 预览 / 标注 / 全屏 / 相机 / 图库 / 提示词库 / 设置。
      React.useEffect(() => {
        if (!imageLightbox && !mediaPreview && !annotateOpen && !viewerOpen && !cameraOpen && !galleryOpen && !promptLibOpen && !setupOpen) {
          return undefined
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          if (imageLightbox) { setImageLightbox(null); return }
          if (mediaPreview) { setMediaPreview(null); return }
          if (annotateOpen && !annotateBusy) { setAnnotateOpen(false); return }
          if (viewerOpen) { setViewerOpen(false); return }
          if (cameraOpen) { setCameraOpen(false); return }
          if (galleryOpen) { setGalleryOpen(false); return }
          if (promptLibOpen) { setPromptLibOpen(false); return }
          if (setupOpen && !setupBusy) { setSetupOpen(false) }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [imageLightbox, mediaPreview, annotateOpen, annotateBusy, viewerOpen, cameraOpen, galleryOpen, promptLibOpen, setupOpen, setupBusy])

      const providers = status && Array.isArray(status.providers) ? status.providers : []
      const active = providers.find((item) => item.id === activeId) || providers[0]
      const studioTheme = (status && status.theme) || 'auto'
      const versionLabel = status && status.version ? `IMAGE WORKBENCH · v${status.version}` : 'IMAGE WORKBENCH'
      const updateBusy = update.state === 'checking' || update.state === 'updating'
      const updateLabel = update.state === 'checking' ? '检查中…'
        : update.state === 'updating' ? '更新中…'
          : update.state === 'available' ? (update.canUpdate ? `更新到 v${update.latestVersion}` : `查看 v${update.latestVersion}`)
            : update.state === 'updated' ? '已更新 · 重启 DSH'
              : update.state === 'current' ? `已最新 v${update.currentVersion}`
                : update.state === 'error' ? '重试检查' : '检查更新'
      const ratioSupported = !!(active && active.supportsRatio
        && !(active.id === 'openai' && OPENAI_STANDARD_MODELS.has(model)))
      const computedSize = active && active.id === 'openai' && /^[1-4]K$/i.test(size)
        ? (OPENAI_TIER_PIXELS[size.toUpperCase()]?.[ratio || '1:1'] || '')
        : ''

      const syncForm = React.useCallback((provider) => {
        if (!provider) return
        const nextModel = provider.model || (provider.models && provider.models[0]) || ''
        const sizes = sizesFor(provider, nextModel)
        const qualities = qualitiesFor(provider, nextModel)
        setModel(nextModel)
        setSize(sizes.includes(provider.size) ? provider.size : (sizes[0] || ''))
        setRatio(provider.supportsRatio ? (provider.ratio || (provider.ratios && provider.ratios[0]) || '') : '')
        setQuality(provider.supportsQuality ? (qualities.includes(provider.quality) ? provider.quality : (qualities[0] || '')) : '')
        const formats = provider.kind === 'openai' && /^gpt-image-2\.6/i.test(nextModel) ? GPT_IMAGE_OUTPUT_FORMATS : ['png']
        setOutputFormat(formats.includes(provider.outputFormat) ? provider.outputFormat : 'png')
        setComplexity('auto')
        setFrameCount(9)
        setFrameDurationMs(200)
      }, [])

      const applyStatus = React.useCallback((next, shouldSync) => {
        setStatus(next)
        const list = next && Array.isArray(next.providers) ? next.providers : []
        const chosen = list.find((item) => item.id === next.defaultProvider) || list[0]
        if (chosen) {
          setActiveId(chosen.id)
          if (shouldSync) syncForm(chosen)
        }
      }, [syncForm])

      const refreshStatus = React.useCallback(async () => {
        try {
          const next = await api('/status')
          if (!mounted.current) return
          applyStatus(next, true)
          setStatusError('')
        } catch (failure) {
          if (!mounted.current) return
          setStatusError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [applyStatus])

      const refreshHistory = React.useCallback(async () => {
        try {
          const value = await api('/history')
          if (!mounted.current) return
          setHistory(Array.isArray(value.items) ? value.items : [])
        } catch {
          /* optional */
        }
      }, [])

      const checkUpdate = React.useCallback(async () => {
        setUpdate({ state: 'checking', latestVersion: '', currentVersion: '', message: '正在检查 GitHub 版本…', releaseUrl: '' })
        try {
          const value = await api('/update/check')
          if (!mounted.current) return
          setUpdate({
            state: value.hasUpdate ? 'available' : 'current',
            latestVersion: value.latestVersion || '',
            currentVersion: value.currentVersion || '',
            message: value.hasUpdate
              ? `发现新版本 v${value.latestVersion}（当前 v${value.currentVersion}）`
              : `已是最新版本 v${value.currentVersion}`,
            releaseUrl: value.releaseUrl || '',
            canUpdate: value.canUpdate === true,
          })
        } catch (failure) {
          if (!mounted.current) return
          setUpdate({ state: 'error', latestVersion: '', currentVersion: '', message: failure instanceof Error ? failure.message : String(failure), releaseUrl: '', canUpdate: false })
        }
      }, [])

      const applyUpdate = React.useCallback(async () => {
        setUpdate((previous) => ({ ...previous, state: 'updating', message: '正在执行 git pull…' }))
        try {
          const value = await api('/update/apply', { method: 'POST' })
          if (!mounted.current) return
          setUpdate({
            state: value.updated ? 'updated' : 'current',
            latestVersion: value.latestVersion || '',
            currentVersion: value.currentVersion || '',
            message: value.message || (value.updated ? '更新完成，重启 DSH 后生效。' : '已是最新版本。'),
            releaseUrl: value.releaseUrl || '',
            canUpdate: value.canUpdate !== false,
          })
        } catch (failure) {
          if (!mounted.current) return
          setUpdate((previous) => ({ ...previous, state: 'error', message: failure instanceof Error ? failure.message : String(failure) }))
        }
      }, [])

      const onUpdateClick = () => {
        if (update.state === 'available') {
          if (update.canUpdate) applyUpdate()
          else if (update.releaseUrl) window.open(update.releaseUrl, '_blank', 'noopener')
          return
        }
        if (update.state !== 'checking' && update.state !== 'updating') checkUpdate()
      }

      React.useEffect(() => {
        refreshStatus()
        refreshHistory()
      }, [refreshStatus, refreshHistory])

      const selectProvider = React.useCallback((id) => {
        const provider = providerById(status, id)
        if (!provider) return
        setActiveId(id)
        syncForm(provider)
        setError('')
        if (status && status.defaultProvider !== id) {
          setStatus({ ...status, defaultProvider: id })
          api('/setup', { method: 'POST', body: JSON.stringify({ providerId: id, defaultProvider: id }) }).catch(() => {})
        }
      }, [status, syncForm])

      const onModelChange = (nextModel) => {
        setModel(nextModel)
        if (!isGptImage26(nextModel)) { setOutputFormat('png'); setComplexity('auto') }
        const sizes = sizesFor(active, nextModel)
        if (!sizes.includes(size)) setSize(sizes[0] || '')
        const qualities = qualitiesFor(active, nextModel)
        if (qualities.length === 0) setQuality('')
        else if (!qualities.includes(quality)) setQuality(qualities[0])
      }

      const onRatioChange = (nextRatio) => {
        setRatio(nextRatio)
      }

      const openSetup = React.useCallback((providerId) => {
        const provider = providerById(status, providerId)
          || providerById(status, activeId)
          || active
        if (!provider) return
        setSetupProviderId(provider.id)
        setSetupDraft({
          apiKey: '',
          baseUrl: provider.baseUrl || '',
          endpointPath: provider.endpointPath || provider.endpointDefault || '',
          model: provider.model || '',
          size: provider.size || '',
          ratio: provider.ratio || '',
          quality: provider.quality || '',
          schema: provider.schema || (Array.isArray(provider.schemas) ? provider.schemas[0][0] : ''),
        })
        setSetupError('')
        setSniffModels([])
        setSniffSelected([])
        setSniffError('')
        setSetupOpen(true)
      }, [status, activeId, active])

      const setupProvider = providerById(status, setupProviderId) || active
      const setupSchemas = Array.isArray(setupProvider && setupProvider.schemas) ? setupProvider.schemas : null
      const setupSchema = setupDraft.schema || (setupSchemas ? setupSchemas[0][0] : '')
      const setupSizes = setupSchemas
        ? (setupSchema === 'minimax' ? ['1K', '2K', '4K'] : ['1K', '2K', '3K', '4K', 'auto'])
        : (setupProvider ? sizesFor(setupProvider, setupDraft.model) : [])
      const setupQualities = setupSchemas
        ? (setupSchema === 'minimax' ? [] : qualitiesFor(setupProvider, setupDraft.model))
        : (setupProvider ? qualitiesFor(setupProvider, setupDraft.model) : [])
      const setupSupportsQuality = setupSchemas ? setupSchema !== 'minimax' : !!(setupProvider && setupProvider.supportsQuality)
      const setupRatioSupported = setupSchemas
        ? true
        : !!(setupProvider && setupProvider.supportsRatio
          && !(setupProvider.id === 'openai' && OPENAI_STANDARD_MODELS.has(setupDraft.model)))

      const runModelSniff = React.useCallback(async () => {
        if (!setupProvider) return
        if (!setupProvider.configured) {
          setSniffError('先保存 Key，再嗅探模型。')
          return
        }
        setSniffBusy(true)
        setSniffError('')
        try {
          const value = await api('/models', {
            method: 'POST',
            body: JSON.stringify({ provider: setupProvider.id }),
          })
          if (!mounted.current) return
          const models = Array.isArray(value.models) ? value.models : []
          setSniffModels(models)
          if (models.length === 0) {
            setSniffError('接口返回了空模型列表。')
            return
          }
          const existing = Array.isArray(setupProvider.models) ? setupProvider.models : []
          const fromExisting = models.filter((item) => existing.includes(item.id)).map((item) => item.id)
          const imageModels = models.filter((item) => item.imageLike).map((item) => item.id)
          const initial = fromExisting.length > 0
            ? fromExisting
            : (imageModels.length > 0 ? imageModels : [models[0].id])
          setSniffSelected(initial)
          setSetupDraft((current) => {
            if (initial.includes(current.model)) return current
            return { ...current, model: initial[0] }
          })
        } catch (failure) {
          if (mounted.current) setSniffError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (mounted.current) setSniffBusy(false)
        }
      }, [setupProvider, api])

      const toggleSniffModel = (id) => {
        const next = sniffSelected.includes(id)
          ? sniffSelected.filter((item) => item !== id)
          : [...sniffSelected, id]
        setSniffSelected(next)
        if (next.length > 0 && !next.includes(setupDraft.model)) {
          setSetupDraft({ ...setupDraft, model: next[0] })
        }
      }

      const saveSetup = React.useCallback(async (clearKey) => {
        if (!setupProvider) return
        setSetupBusy(true)
        setSetupError('')
        try {
          const body = {
            providerId: setupProvider.id,
            baseUrl: setupDraft.baseUrl,
            endpointPath: setupDraft.endpointPath,
            model: setupDraft.model,
            size: setupDraft.size,
          }
          if (setupSchemas) body.schema = setupSchema
          if (setupRatioSupported) body.ratio = setupDraft.ratio
          if (setupSupportsQuality) body.quality = setupDraft.quality
          if (sniffModels.length > 0) {
            if (sniffSelected.length === 0) {
              setSetupError('至少勾选一个模型；勾选的模型才会出现在主面板下拉。')
              return
            }
            const selected = [...sniffSelected]
            if (!selected.includes(body.model)) selected.push(body.model)
            body.models = selected
          }
          if (clearKey === true) body.clearKey = true
          else if (setupDraft.apiKey.trim() !== '') body.apiKey = setupDraft.apiKey.trim()
          const next = await api('/setup', { method: 'POST', body: JSON.stringify(body) })
          if (!mounted.current) return
          setStatus(next)
          if (setupProvider.id === activeId) {
            syncForm(providerById(next, setupProvider.id))
          }
          setSetupOpen(false)
          setSetupDraft({ apiKey: '', baseUrl: '', endpointPath: '', model: '', size: '', ratio: '', quality: '' })
        } catch (failure) {
          if (mounted.current) setSetupError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (mounted.current) setSetupBusy(false)
        }
      }, [setupProvider, setupDraft, activeId, syncForm, sniffModels, sniffSelected, setupRatioSupported])

      const finishJob = React.useCallback((job, state) => {
        try {
          window.sessionStorage.removeItem(JOB_KEY)
        } catch {
          // private mode: nothing to clean up
        }
        setActiveJob(null)
        setGenerating(false)
        if (state && state.status === 'done' && state.result) {
          setResult(state.result)
          setImageSize(null)
          refreshHistory()
          return
        }
        if (state && state.status === 'error') {
          setError(state.error && state.error.message ? state.error.message : '生成失败。')
          if (state.error && state.error.code === 'unconfigured') openSetup(state.error.provider || (job && job.provider))
        }
      }, [refreshHistory, openSetup])

      // Poll the host for the job instead of holding one long request open:
      // switching to another session no longer loses the generation.
      React.useEffect(() => {
        if (!activeJob || !activeJob.id) return undefined
        let alive = true
        let timer = null
        const poll = async () => {
          let state
          try {
            state = await api('/jobs/' + encodeURIComponent(activeJob.id))
          } catch (failure) {
            if (!alive) return
            if (failure && failure.code === 'not-found') {
              try {
                window.sessionStorage.removeItem(JOB_KEY)
              } catch {
                // ignore
              }
              setActiveJob(null)
              setGenerating(false)
              // The host may have restarted (and dropped its job table) while
              // the image was still written to history: adopt it if present.
              let recovered = null
              try {
                const listing = await api('/history')
                const items = listing && Array.isArray(listing.items) ? listing.items : []
                recovered = items.find((item) => item.createdAt && Date.parse(item.createdAt) >= activeJob.startedAt - 1000) || null
              } catch {
                recovered = null
              }
              if (recovered) {
                setResult(recovered)
                setImageSize(null)
              }
              refreshHistory()
              return
            }
            timer = window.setTimeout(poll, 2500)
            return
          }
          if (!alive) return
          if (!state || state.status === 'running') {
            timer = window.setTimeout(poll, 1500)
            return
          }
          finishJob(activeJob, state)
        }
        timer = window.setTimeout(poll, 1000)
        return () => {
          alive = false
          if (timer) window.clearTimeout(timer)
        }
      }, [activeJob, finishJob, refreshHistory])

      // Resume a job that was running when this panel unmounted.
      React.useEffect(() => {
        let stored = null
        try {
          stored = JSON.parse(window.sessionStorage.getItem(JOB_KEY) || 'null')
        } catch {
          stored = null
        }
        if (!stored || typeof stored.id !== 'string' || stored.id === '') return
        setGenerating(true)
        setActiveJob(stored)
      }, [])

      const generate = React.useCallback(async () => {
        if (!active || activeJob) return
        const text = prompt.trim()
        if (text === '') {
          setError('请先填写提示词。')
          return
        }
        setGenerating(true)
        setError('')
        try {
          const body = {
            provider: active.id,
            prompt: text,
            model,
            size,
          }
          if (ratioSupported) body.ratio = ratio
          if (active.supportsQuality) body.quality = quality
          if (active.kind === 'openai' && isGptImage26(model)) {
            body.outputFormat = outputFormat
            if (complexity !== 'auto') body.complexity = complexity
            if (outputFormat === 'gif') {
              body.frameCount = frameCount
              body.frameDurationMs = frameDurationMs
            }
          }
          if (references.length > 0) body.referenceImages = references.map((item) => item.dataUrl)
          const started = await api('/generate', { method: 'POST', body: JSON.stringify({ ...body, async: true }) })
          if (!mounted.current) return
          const job = {
            id: started.id,
            startedAt: started.startedAt,
            prompt: started.prompt || text,
            provider: started.provider || active.id,
          }
          try {
            window.sessionStorage.setItem(JOB_KEY, JSON.stringify(job))
          } catch {
            // private mode: polling still works while the panel stays mounted
          }
          setActiveJob(job)
        } catch (failure) {
          if (!mounted.current) return
          const message = failure instanceof Error ? failure.message : String(failure)
          setError(message)
          setGenerating(false)
          if (failure && failure.code === 'unconfigured') openSetup(failure.provider || active.id)
        }
      }, [active, activeJob, prompt, model, size, ratio, quality, references, refreshHistory, openSetup])

      const insertMention = (index) => {
        const reference = references[index]
        if (!reference) return
        const inserted = `@参考图${index + 1} `
        const next = prompt.slice(0, mention.start) + inserted + prompt.slice(mention.end)
        setPrompt(next)
        setMention({ open: false, start: 0, end: 0, index: 0, query: '' })
        window.setTimeout(() => {
          const textarea = promptRef.current
          if (!textarea) return
          const caret = mention.start + inserted.length
          textarea.focus()
          textarea.setSelectionRange(caret, caret)
        }, 0)
      }

      const updateMention = (value, caret) => {
        if (references.length === 0 || caret === null || caret === undefined) {
          setMention({ open: false, start: 0, end: 0, index: 0, query: '' })
          return
        }
        const before = value.slice(0, caret)
        // The picker opens for any "@" token, including one typed right after
        // other text (Chinese or English).
        const match = /@([^\s@]*)$/.exec(before)
        if (!match) {
          setMention({ open: false, start: 0, end: 0, index: 0, query: '' })
          return
        }
        const at = before.lastIndexOf('@')
        setMention({
          open: true,
          start: at,
          end: caret,
          index: 0,
          query: match[1],
        })
      }

      const mentionMatches = React.useMemo(() => {
        if (!mention.open) return []
        const query = String(mention.query || '').trim()
        return references
          .map((reference, index) => ({ reference, index, label: `参考图${index + 1}` }))
          .filter((entry) => query === '' || entry.label.includes(query) || String(entry.index + 1).startsWith(query))
      }, [references, mention.query, mention.open])

      const onKeyDown = (event) => {
        if (mention.open) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setMention((current) => ({ ...current, index: (current.index + 1) % Math.max(1, mentionMatches.length) }))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setMention((current) => ({ ...current, index: (current.index - 1 + Math.max(1, mentionMatches.length)) % Math.max(1, mentionMatches.length) }))
            return
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const chosen = mentionMatches[mention.index]
            if (chosen !== undefined) insertMention(chosen.index)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setMention({ open: false, start: 0, end: 0, index: 0, query: '' })
            return
          }
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          if (!generating) generate()
        }
      }

      const showToast = React.useCallback((message) => {
        setToast(message)
        if (toastTimer.current) window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(''), 2000)
      }, [])

      const applyTheme = React.useCallback(async (themeId) => {
        if (!status || !STUDIO_THEMES.some((theme) => theme.id === themeId)) return
        const previous = status.theme || 'auto'
        if (previous === themeId) return
        setStatus({ ...status, theme: themeId })
        try {
          const next = await api('/setup', { method: 'POST', body: JSON.stringify({ theme: themeId }) })
          if (mounted.current) setStatus(next)
        } catch (failure) {
          if (!mounted.current) return
          setStatus({ ...status, theme: previous })
          showToast(`配色保存失败：${failure instanceof Error ? failure.message : String(failure)}`)
        }
      }, [status, showToast])

      React.useEffect(() => () => {
        if (toastTimer.current) window.clearTimeout(toastTimer.current)
      }, [])

      const copyText = React.useCallback(async (text, okMessage) => {
        const value = typeof text === 'string' ? text : ''
        if (value.trim() === '') {
          showToast('没有可复制的内容')
          return
        }
        let copiedOk = false
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(value)
            copiedOk = true
          }
        } catch {
          copiedOk = false
        }
        if (!copiedOk) {
          try {
            const textarea = document.createElement('textarea')
            textarea.value = value
            textarea.setAttribute('readonly', 'readonly')
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            textarea.style.pointerEvents = 'none'
            document.body.appendChild(textarea)
            textarea.select()
            textarea.setSelectionRange(0, textarea.value.length)
            copiedOk = document.execCommand('copy')
            textarea.remove()
          } catch {
            copiedOk = false
          }
        }
        showToast(copiedOk ? okMessage : '复制失败，请手动选择复制')
      }, [showToast])

      const toPngBlob = async (blob) => {
        if (blob.type === 'image/png') return blob
        let source
        try {
          source = await createImageBitmap(blob)
        } catch {
          const objectUrl = URL.createObjectURL(blob)
          try {
            source = await new Promise((resolve, reject) => {
              const image = new Image()
              image.onload = () => resolve(image)
              image.onerror = () => reject(new Error('图片解码失败'))
              image.src = objectUrl
            })
          } finally {
            URL.revokeObjectURL(objectUrl)
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = source.width || source.naturalWidth
        canvas.height = source.height || source.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建图片画布')
        context.drawImage(source, 0, 0)
        if (typeof source.close === 'function') source.close()
        return new Promise((resolve, reject) => {
          canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('PNG 转换失败'))), 'image/png')
        })
      }

      const copyImage = React.useCallback(async (url) => {
        setContextMenu(null)
        const candidates = []
        try {
          const parsed = new URL(url, window.location.href)
          candidates.push(parsed.pathname + parsed.search)
        } catch {
          // keep the absolute URL below
        }
        candidates.push(url)
        let lastError = null
        for (const candidate of [...new Set(candidates)]) {
          try {
            const response = await fetch(candidate, { credentials: 'same-origin' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const blob = await toPngBlob(await response.blob())
            const ClipboardItemCtor = window.ClipboardItem
            if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItemCtor !== 'function') {
              throw new Error('当前浏览器不支持复制图片')
            }
            await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })])
            showToast('图片已复制，可直接粘贴发送')
            return
          } catch (error) {
            lastError = error
          }
        }
        showToast(`复制图片失败：${lastError instanceof Error ? lastError.message : String(lastError || '无法读取图片')}`)
      }, [showToast])

      const openImageMenu = (event, url, text) => {
        event.preventDefault()
        event.stopPropagation()
        const width = 176
        const height = 88
        setContextMenu({
          x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
          kind: 'image',
          url,
          text: typeof text === 'string' ? text : '',
        })
      }

      const openPromptMenu = (event) => {
        event.preventDefault()
        const target = event.currentTarget
        const selected = target && typeof target.value === 'string'
          ? target.value.slice(target.selectionStart || 0, target.selectionEnd || 0)
          : ''
        setContextMenu({
          x: Math.max(8, Math.min(event.clientX, window.innerWidth - 176 - 8)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - 56 - 8)),
          kind: 'prompt',
          url: '',
          text: selected || prompt,
        })
      }

      React.useEffect(() => {
        if (!contextMenu) return undefined
        const close = () => setContextMenu(null)
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setContextMenu(null)
        }
        window.addEventListener('click', close)
        window.addEventListener('scroll', close, true)
        window.addEventListener('resize', close)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('click', close)
          window.removeEventListener('scroll', close, true)
          window.removeEventListener('resize', close)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [contextMenu])

      const copyPath = async () => {
        if (!result) return
        const text = result.filePath || result.url
        if (!text) return
        let copiedOk = false
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text)
            copiedOk = true
          }
        } catch {
          copiedOk = false
        }
        if (!copiedOk) {
          try {
            const textarea = document.createElement('textarea')
            textarea.value = text
            textarea.setAttribute('readonly', 'readonly')
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            textarea.style.pointerEvents = 'none'
            document.body.appendChild(textarea)
            textarea.select()
            textarea.setSelectionRange(0, textarea.value.length)
            copiedOk = document.execCommand('copy')
            textarea.remove()
          } catch {
            copiedOk = false
          }
        }
        if (!copiedOk) {
          try { window.prompt('复制路径（Ctrl+C）', text) } catch { /* prompt unavailable */ }
        }
        setCopied(copiedOk ? '已复制' : '复制失败')
        window.setTimeout(() => setCopied(''), 1600)
      }

      const applyCamera = () => {
        const fragment = buildCameraPrompt(cameraDraft)
        const next = prompt.trim() === '' ? fragment : `${prompt.trim()}\n${fragment}`
        if (next.length > 4000) {
          setError('提示词加相机参数超过 4000 字，请先精简提示词。')
          return
        }
        setPrompt(next)
        setCameraOpen(false)
        setError('')
      }

      const deleteImage = React.useCallback(async (id) => {
        if (!id || deletingId !== '') return
        if (!window.confirm('删除这张图片？会同时删除本地文件，且不可恢复。')) return
        setDeletingId(id)
        try {
          await api(`/history/${encodeURIComponent(id)}`, { method: 'DELETE' })
          if (!mounted.current) return
          setHistory((current) => current.filter((item) => item.id !== id))
          if (result && result.id === id) {
            setViewerOpen(false)
            setResult(null)
            setImageSize(null)
          }
        } catch (failure) {
          if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (mounted.current) setDeletingId('')
        }
      }, [api, deletingId, result])

      const maxReferences = maxReferencesFor(active)
      const supports26 = !!(active && active.kind === 'openai' && isGptImage26(model))
      const gifOutput = supports26 && outputFormat === 'gif'
      const referenceDisabledHint = gifOutput ? 'GIF 动图只支持文生图' : 'DALL·E 3 不支持参考图'
      const referenceSupported = !(active && active.id === 'openai' && /^dall-e-3$/i.test(model)) && !gifOutput
      const loadReferences = async (files) => {
        const list = Array.from(files || []).filter((file) => file && typeof file === 'object')
        if (list.length === 0) return
        if (!referenceSupported) {
          setError(gifOutput ? 'GIF 动图只支持文生图，请先移除参考图或改回静态格式。' : 'DALL·E 3 不支持参考图编辑，请切换到 gpt-image 系列模型。')
          return
        }
        const room = maxReferences - references.length
        if (room <= 0) {
          setError(`参考图最多 ${maxReferences} 张，先移除一张再添加。`)
          return
        }
        setError(list.length > room ? `参考图最多 ${maxReferences} 张，只添加前 ${room} 张。` : '')
        const prepared = []
        for (const file of list.slice(0, room)) {
          try {
            prepared.push(await prepareReferenceFile(file))
          } catch (failure) {
            if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
          }
        }
        if (prepared.length > 0 && mounted.current) {
          setReferences((current) => [...current, ...prepared].slice(0, maxReferences))
          setReferenceNotice({ kind: 'ok', text: `已添加 ${prepared.length} 张参考图` })
        }
      }
      const pickReference = () => {
        if (!referenceSupported) {
          setError(gifOutput ? 'GIF 动图只支持文生图，请先移除参考图或改回静态格式。' : 'DALL·E 3 不支持参考图编辑，请切换到 gpt-image 系列模型。')
          return
        }
        if (references.length >= maxReferences) {
          setError(`参考图最多 ${maxReferences} 张，先移除一张再添加。`)
          return
        }
        if (fileInputRef.current) fileInputRef.current.click()
      }
      const onReferenceChange = async (event) => {
        const files = event.target.files ? Array.from(event.target.files) : []
        event.target.value = ''
        await loadReferences(files)
      }
      const onReferenceDrop = async (event) => {
        event.preventDefault()
        setDragOverRef(false)
        await loadReferences(event.dataTransfer && event.dataTransfer.files)
      }
      const removeReference = (index) => {
        setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))
        setReferenceNotice({ kind: '', text: '' })
      }

      const openAnnotateEditor = () => {
        if (!result || !result.url) return
        if (!referenceSupported) {
          setError(referenceDisabledHint)
          showToast(referenceDisabledHint)
          return
        }
        setAnnotateMarkers([])
        setAnnotateActiveId('')
        setAnnotateOpen(true)
      }

      const addAnnotateMarker = (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const x = Math.max(0.01, Math.min(0.99, (event.clientX - rect.left) / rect.width))
        const y = Math.max(0.01, Math.min(0.99, (event.clientY - rect.top) / rect.height))
        const id = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        setAnnotateMarkers((current) => [...current, { id, x, y, text: '' }])
        setAnnotateActiveId(id)
        window.requestAnimationFrame(() => {
          const input = annotateInputRefs.current[id]
          if (input && typeof input.focus === 'function') input.focus()
        })
      }

      const updateAnnotateMarkerText = (id, text) => {
        setAnnotateMarkers((current) => current.map((item) => (item.id === id ? { ...item, text } : item)))
      }

      const removeAnnotateMarker = (id) => {
        setAnnotateMarkers((current) => current.filter((item) => item.id !== id))
        setAnnotateActiveId((current) => (current === id ? '' : current))
      }

      const finishAnnotation = async () => {
        if (!result || annotateMarkers.length === 0 || annotateBusy) return
        setAnnotateBusy(true)
        try {
          const prepared = await renderAnnotatedReference(result.url, annotateMarkers, result.id || 'result')
          const nextRefs = [...referencesRef.current]
          let refIndex = nextRefs.length + 1
          if (nextRefs.length >= maxReferences) {
            nextRefs[nextRefs.length - 1] = prepared
            refIndex = nextRefs.length
          } else {
            nextRefs.push(prepared)
            refIndex = nextRefs.length
          }
          const lines = annotateMarkers.map((item, idx) => {
            const detail = item.text.trim() || '按标记微调此处细节'
            return `${idx + 1}. 标记${idx + 1}处：${detail}`
          })
          const refTag = nextRefs.length > 1 ? `@参考图${refIndex} ` : ''
          const composed = `请基于${refTag}图中的红色序号标记修改对应区域（其余画面主体、光影与构图保持一致，并在最终成图中去除所有红色序号气泡标记）：\n${lines.join('\n')}`
          setReferences(nextRefs)
          setReferenceNotice({ kind: 'ok', text: `已生成带 ${annotateMarkers.length} 个序号标记的参考图` })
          setPrompt(composed.slice(0, 4000))
          setError('')
          setAnnotateOpen(false)
          showToast(`已生成标注参考图与 ${annotateMarkers.length} 条修改提示词`)
          window.requestAnimationFrame(() => {
            if (promptRef.current && typeof promptRef.current.focus === 'function') {
              promptRef.current.focus()
            }
          })
        } catch (failure) {
          const msg = failure instanceof Error ? failure.message : String(failure)
          showToast(`生成标注参考图失败：${msg}`)
        } finally {
          if (mounted.current) setAnnotateBusy(false)
        }
      }

      const refreshCacheStatus = React.useCallback(async () => {
        try {
          const info = await api('/cache/status')
          if (mounted.current) setCacheInfo(info)
        } catch {
          // ignore on older host
        }
      }, [])

      const loadPromptSources = React.useCallback(async () => {
        try {
          const list = await api('/prompts/sources')
          if (mounted.current) setPromptSources(Array.isArray(list) ? list : [])
        } catch {
          // Older host: keep the built-in tabs.
        }
      }, [])

      const loadGalleryLibraries = React.useCallback(async () => {
        try {
          const list = await api('/gallery/libraries')
          if (mounted.current) setGalleryLibraries(Array.isArray(list) ? list : [])
        } catch {
          // Older host: keep the built-in tabs.
        }
      }, [])

      const loadOfflinePacks = React.useCallback(async () => {
        try {
          const value = await api('/offline/packs')
          if (mounted.current) {
            setOfflinePacks({
              prompts: Array.isArray(value && value.prompts) ? value.prompts : [],
              gallery: Array.isArray(value && value.gallery) ? value.gallery : [],
            })
          }
        } catch {
          // Older host: no offline packs yet.
        }
      }, [])

      const openOfflineDialog = React.useCallback((kind) => {
        setOfflineKind(kind === 'gallery' ? 'gallery' : 'prompts')
        setOfflineNotice({ kind: '', text: '' })
        setOfflineManifestPath('')
        setOfflineBaseDir('')
        setOfflineOpen(true)
        loadOfflinePacks()
      }, [loadOfflinePacks])

      const submitOfflineImport = React.useCallback(async (event) => {
        if (event) event.preventDefault()
        if (offlineManifestPath.trim() === '') {
          setOfflineNotice({ kind: 'error', text: '请填写 manifest.json 的路径，或包含清单文件的目录。' })
          return
        }
        setOfflineBusy(true)
        setOfflineNotice({ kind: 'info', text: '正在导入离线资源包…' })
        try {
          const body = { kind: offlineKind, manifestPath: offlineManifestPath.trim() }
          if (offlineBaseDir.trim() !== '') body.baseDir = offlineBaseDir.trim()
          const result = await api('/offline/import', { method: 'POST', body: JSON.stringify(body) })
          const pack = result && result.pack ? result.pack : {}
          await loadOfflinePacks()
          await loadPromptSources()
          await loadGalleryLibraries()
          setOfflineNotice({
            kind: 'ok',
            text: `已导入「${pack.label || pack.id || '离线资源包'}」：${pack.itemCount || 0} 条${pack.skipped ? `，跳过 ${pack.skipped} 条` : ''}。`,
          })
          showToast('离线资源包已导入')
          promptPageCacheRef.current = {}
          galleryCacheRef.current = {}
        } catch (failure) {
          setOfflineNotice({ kind: 'error', text: failure instanceof Error ? failure.message : String(failure) })
        } finally {
          if (mounted.current) setOfflineBusy(false)
        }
      }, [offlineKind, offlineManifestPath, offlineBaseDir, loadOfflinePacks, loadPromptSources, loadGalleryLibraries, showToast])

      const removeOfflinePackById = React.useCallback(async (id) => {
        const pack = (offlinePacks[offlineKind] || []).find((entry) => entry.id === id)
        const name = pack ? pack.label : id
        if (!window.confirm(`删除离线资源包「${name}」？图片文件不会删除。`)) return
        setOfflineBusy(true)
        setOfflineNotice({ kind: 'info', text: '正在删除…' })
        try {
          await api('/offline/remove', { method: 'POST', body: JSON.stringify({ kind: offlineKind, id }) })
          await loadOfflinePacks()
          await loadPromptSources()
          await loadGalleryLibraries()
          promptPageCacheRef.current = {}
          galleryCacheRef.current = {}
          setOfflineNotice({ kind: 'ok', text: `已删除「${name}」。` })
        } catch (failure) {
          setOfflineNotice({ kind: 'error', text: failure instanceof Error ? failure.message : String(failure) })
        } finally {
          if (mounted.current) setOfflineBusy(false)
        }
      }, [offlineKind, offlinePacks, loadOfflinePacks, loadPromptSources, loadGalleryLibraries])

      const clearImageCache = React.useCallback(async () => {
        if (cacheBusy) return
        setCacheBusy(true)
        try {
          const info = await api('/cache/clear', { method: 'POST', body: JSON.stringify({ scope: 'images' }) })
          if (mounted.current) {
            setCacheInfo(info)
            showToast('已清理图库与提示词图片缓存')
          }
        } catch (failure) {
          showToast(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (mounted.current) setCacheBusy(false)
        }
      }, [cacheBusy, showToast])

      const loadGallery = React.useCallback(async (library, forceRefresh = false) => {
        setGalleryLibrary(library)
        if (!forceRefresh) setGalleryQuery('')
        setGalleryLimit(60)
        setGalleryError('')
        const cached = !forceRefresh ? galleryCacheRef.current[library] : null
        if (Array.isArray(cached)) {
          setGalleryItems(cached)
          return
        }
        setGalleryLoading(true)
        if (!forceRefresh) setGalleryItems([])
        try {
          const suffix = forceRefresh ? '&refresh=1' : ''
          const value = await api(`/gallery/catalog?library=${encodeURIComponent(library)}${suffix}`)
          if (!mounted.current) return
          const items = Array.isArray(value.items) ? value.items : []
          galleryCacheRef.current[library] = items
          setGalleryItems(items)
          refreshCacheStatus()
          if (forceRefresh) showToast('图库索引已检查更新')
        } catch (failure) {
          if (!mounted.current) return
          const hostMissingRoute = failure && (failure.code === 'not-found' || failure.status === 404)
          setGalleryError(hostMissingRoute
            ? '宿主还在运行旧版本：请重启 DSH 后再打开图库。'
            : (failure instanceof Error ? failure.message : String(failure)))
        } finally {
          if (mounted.current) setGalleryLoading(false)
        }
      }, [refreshCacheStatus, showToast])

      const openGallery = () => {
        setGalleryStatus('')
        if (!referenceSupported) {
          setError(referenceDisabledHint)
          return
        }
        setGalleryOpen(true)
        loadGallery(galleryLibrary, false)
        loadGalleryLibraries()
        refreshCacheStatus()
      }

      const addGalleryImage = React.useCallback(async (item) => {
        if (!item) return
        if (galleryAddRef.current) {
          showToast('正在读取上一张，请稍候')
          return
        }
        if (referencesRef.current.length >= maxReferences) {
          setGalleryStatus(`参考图已满（${maxReferences} 张），先移除一张`)
          setReferenceNotice({ kind: 'error', text: `参考图已满（${maxReferences}/${maxReferences}），先移除一张` })
          showToast(`参考图最多 ${maxReferences} 张，先移除一张再添加`)
          return
        }
        galleryAddRef.current = true
        setGalleryBusyId(item.id)
        setGalleryStatus('正在读取图片…')
        setReferenceNotice({ kind: 'info', text: `正在读取${item.title ? `「${item.title}」` : '图片'}…` })
        try {
          // The host fetches the bytes and returns a data URL, so the browser
          // never has to decode or re-encode the image here. Prefer the full
          // image and fall back to the thumbnail when it is too large.
          const stored = await api('/gallery/reference', {
            method: 'POST',
            body: JSON.stringify({
              path: item.full || item.thumb,
              fallbackPath: item.thumb,
            }),
          })
          if (!stored || typeof stored.dataUrl !== 'string') {
            throw new Error('读取图库图片失败')
          }
          const prepared = {
            dataUrl: stored.dataUrl,
            name: stored.name || `${item.id}.png`,
            width: 0,
            height: 0,
            bytes: Number.isFinite(stored.bytes) ? stored.bytes : 0,
          }
          if (!mounted.current) return
          setReferences((current) => (current.length >= maxReferences
            ? current
            : [...current, prepared].slice(0, maxReferences)))
          setGalleryAdded((current) => ({ ...current, [item.id]: true }))
          const total = Math.min(maxReferences, referencesRef.current.length + 1)
          setGalleryStatus(`已加入参考图（${total}/${maxReferences}）`)
          window.setTimeout(() => {
            if (mounted.current) setGalleryOpen(false)
          }, 350)
          setReferenceNotice({ kind: 'ok', text: `已加入（${total}/${maxReferences}）` })
          showToast('已加入参考图')
          window.setTimeout(() => {
            if (mounted.current) setMediaPreview(null)
          }, 350)
        } catch (failure) {
          const reason = failure instanceof Error ? failure.message : String(failure)
          setGalleryStatus(`加入失败：${reason}`)
          setReferenceNotice({ kind: 'error', text: `加入失败：${reason}` })
          showToast(`加入失败：${reason}`)
        } finally {
          galleryAddRef.current = false
          if (mounted.current) setGalleryBusyId('')
        }
      }, [maxReferences, showToast])

      const galleryFiltered = React.useMemo(() => {
        const query = galleryQuery.trim().toLowerCase()
        if (query === '') return galleryItems
        return galleryItems.filter((item) => `${item.title} ${item.category} ${item.group} ${item.search}`.toLowerCase().includes(query))
      }, [galleryItems, galleryQuery])

      const isSensitiveGalleryItem = (item) => {
        if (!item) return false
        const category = String(item.category || '')
        const group = String(item.group || '')
        if (group.includes('性感')) return true
        return ['内衣・睡衣', '性感穿搭', '泳装・度假', '内衣', '泳装'].some((name) => category.includes(name))
      }

      const galleryVisible = React.useMemo(() => (sfwOnly ? galleryFiltered.filter((item) => !isSensitiveGalleryItem(item)) : galleryFiltered), [galleryFiltered, sfwOnly])
      const galleryHiddenCount = galleryFiltered.length - galleryVisible.length
      const galleryOffline = galleryLibrary.startsWith('offline:')

      const loadPrompts = React.useCallback(async (source, page, filters, query, forceRefresh = false) => {
        const params = new URLSearchParams({ source, page: String(page) })
        for (const key of ['style', 'type', 'model', 'category', 'scene']) {
          if (typeof filters[key] === 'string' && filters[key] !== '') params.set(key, filters[key])
        }
        if (typeof query === 'string' && query.trim() !== '') params.set('q', query.trim())
        const cacheKey = params.toString()
        const memHit = !forceRefresh ? promptPageCacheRef.current[cacheKey] : null
        if (memHit && Date.now() - memHit.at < 10 * 60 * 1000) {
          setPromptSource(source)
          setPromptItems(memHit.items)
          setPromptTotalPages(memHit.totalPages)
          setPromptPage(memHit.page)
          if (memHit.filters) setPromptFilters(memHit.filters)
          setPromptError('')
          return
        }
        setPromptLoading(true)
        setPromptError('')
        try {
          if (forceRefresh) params.set('refresh', '1')
          const value = await api(`/prompts/catalog?${params.toString()}`)
          if (!mounted.current) return
          const items = Array.isArray(value.items) ? value.items : []
          const totalPages = Number(value.totalPages) || 1
          const resolvedPage = Number(value.page) || page
          const resolvedFilters = value.filters ? {
            styles: value.filters.styles || [],
            types: value.filters.types || [],
            models: value.filters.models || [],
            categories: value.filters.categories || [],
            scenes: value.filters.scenes || [],
          } : null
          promptPageCacheRef.current[cacheKey] = {
            at: Date.now(),
            items,
            totalPages,
            page: resolvedPage,
            filters: resolvedFilters,
          }
          setPromptSource(source)
          setPromptItems(items)
          setPromptTotalPages(totalPages)
          setPromptPage(resolvedPage)
          if (resolvedFilters) setPromptFilters(resolvedFilters)
          refreshCacheStatus()
          if (forceRefresh) showToast('提示词库已检查最新条目')
        } catch (failure) {
          if (!mounted.current) return
          const hostMissingRoute = failure && (failure.code === 'not-found' || failure.status === 404)
          setPromptError(hostMissingRoute
            ? '宿主还在运行旧版本：请重启 DSH 后再打开提示词库。'
            : (failure instanceof Error ? failure.message : String(failure)))
        } finally {
          if (mounted.current) setPromptLoading(false)
        }
      }, [refreshCacheStatus, showToast])

      const openPromptLibrary = () => {
        setPromptLibOpen(true)
        setPromptFilter({ style: '', type: '', model: '', category: '', scene: '' })
        setPromptQuery('')
        loadPromptSources()
        loadPrompts(promptSource, 1, {}, '', false)
        refreshCacheStatus()
      }

      const switchPromptSource = (source) => {
        setPromptFilter({ style: '', type: '', model: '', category: '', scene: '' })
        setPromptQuery('')
        loadPrompts(source, 1, {}, '')
      }

      const applyPromptFilter = (key, value) => {
        const next = { ...promptFilter, [key]: value }
        setPromptFilter(next)
        loadPrompts(promptSource, 1, next, promptQuery)
      }

      const submitPromptSearch = () => {
        loadPrompts(promptSource, 1, promptFilter, promptQuery)
      }

      const gotoPromptPage = (page) => {
        if (page < 1 || page > promptTotalPages || promptLoading) return
        loadPrompts(promptSource, page, promptFilter, promptQuery)
      }

      const fillPromptFromLibrary = (item) => {
        if (!item || typeof item.prompt !== 'string' || item.prompt.trim() === '') return
        const next = prompt.trim() === '' ? item.prompt.trim() : `${prompt.trim()}\n${item.prompt.trim()}`
        if (next.length > 4000) {
          showToast('提示词超过 4000 字，请先精简当前提示词')
          return
        }
        setPrompt(next)
        setPromptLibOpen(false)
        setMediaPreview(null)
        showToast('已填入提示词')
      }

      const copyPromptFromLibrary = (item) => {
        if (!item || typeof item.prompt !== 'string') return
        copyText(item.prompt, '提示词已复制')
        setPromptCopiedId(item.id)
        window.setTimeout(() => setPromptCopiedId(''), 1500)
      }

      const previewVariant = (preview) => {
        if (!preview || !preview.item) return null
        const variants = preview.kind === 'reference' && Array.isArray(preview.item.variants) ? preview.item.variants : []
        if (variants.length === 0) return preview.item
        const index = Math.max(0, Math.min(preview.variantIndex || 0, variants.length - 1))
        return { ...preview.item, ...variants[index], variantCount: variants.length, variantIndex: index }
      }

      const previewUrlOf = (preview) => {
        if (!preview || !preview.item) return ''
        if (preview.kind === 'prompt') {
          return `${API}/prompts/image?source=${preview.source || promptSource}&url=${encodeURIComponent(preview.item.image)}`
        }
        const variant = previewVariant(preview)
        return `${API}/gallery/image?path=${encodeURIComponent(variant.full || variant.thumb)}`
      }

      const downloadPreviewImage = async () => {
        if (!mediaPreview) return
        const url = previewUrlOf(mediaPreview)
        const variant = previewVariant(mediaPreview)
        const sourcePath = mediaPreview.kind === 'prompt'
          ? mediaPreview.item.image
          : (variant.full || variant.thumb)
        const extension = String(sourcePath).split('?')[0].split('.').pop() || 'jpg'
        const name = `${mediaPreview.item.id || 'image'}.${extension}`
        try {
          const response = await fetch(url, { credentials: 'same-origin' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const blob = await response.blob()
          const objectUrl = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = objectUrl
          link.download = name
          document.body.appendChild(link)
          link.click()
          link.remove()
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
          showToast('已开始下载')
        } catch (failure) {
          showToast(`下载失败：${failure instanceof Error ? failure.message : String(failure)}`)
        }
      }

      React.useEffect(() => {
        if (!promptLibOpen) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setPromptLibOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [promptLibOpen])

      const clearReferences = () => {
        setReferences([])
        setReferenceNotice({ kind: '', text: '' })
      }

      if (statusError !== '') {
        return h('div', { className: 'is-page', 'data-studio-theme': studioTheme },
          h('div', { className: 'is-shell' },
            h('div', { className: 'is-card' },
              h('div', { className: 'is-card-title' }, '生图工作台暂时不可用'),
              h('p', { className: 'is-sub' }, statusError),
              h('div', { className: 'is-actions' },
                h('button', { className: 'is-btn is-btn-ghost', onClick: refreshStatus }, '重试'),
              ),
            ),
          ),
        )
      }

      if (status === null || !active) {
        return h('div', { className: 'is-page', 'data-studio-theme': studioTheme },
          h('div', { className: 'is-shell' },
            h('div', { className: 'is-head' },
              h('div', { className: 'is-head-main' },
                h('div', { className: 'is-logo' }, icon(22)),
                h('div', {},
                  h('div', { className: 'is-eyebrow' }, versionLabel),
                  h('h1', { className: 'is-title' }, '生图工作台'),
                  h('p', { className: 'is-sub' }, '正在连接宿主服务…'),
                ),
              ),
            ),
            h('div', { className: 'is-grid' },
              h('div', { className: 'is-card' }, h('div', { className: 'is-skeleton', style: { height: 320 } })),
              h('div', { className: 'is-card' }, h('div', { className: 'is-skeleton' })),
            ),
          ),
        )
      }

      const modelOptions = (() => {
        const list = modelsFor(active)
        return model && !list.includes(model) ? [model, ...list] : list
      })()
      const sizeOptions = sizesFor(active, model)
      const qualityOptions = qualitiesFor(active, model)

      return h('div', { className: 'is-page' + (generating ? ' is-busy-page' : ''), 'data-studio-theme': studioTheme },
        h('div', { className: 'is-shell' },
          h('div', { className: 'is-head' },
            h('div', { className: 'is-head-main' },
              h('div', { className: 'is-logo' }, icon(22)),
              h('div', {},
                h('div', { className: 'is-eyebrow' }, versionLabel),
                h('h1', { className: 'is-title' }, '生图工作台'),
              ),
            ),
            h('div', { className: 'is-providers has-glider', ref: providerBarRef },
              h('span', {
                className: 'is-provider-glider',
                'aria-hidden': 'true',
                style: {
                  transform: `translateX(${providerGlider.left}px)`,
                  width: `${providerGlider.width}px`,
                  opacity: providerGlider.ready ? 1 : 0,
                },
              }),
              providers.map((provider) => h('button', {
                key: provider.id,
                className: 'is-provider' + (provider.id === active.id ? ' active' : ''),
                onClick: () => selectProvider(provider.id),
                title: provider.configured
                  ? `${provider.label} · Key 已配置`
                  : `${provider.label} · Key 未配置（点「配置」填写）`,
              },
                h('span', { className: 'is-provider-dot' + (provider.configured ? ' ok' : '') }),
                provider.shortLabel || provider.label,
              )),
            ),
            h('div', { className: 'is-head-actions' },
              h('button', {
                className: 'is-btn is-btn-ghost is-update-btn' + (update.state === 'available' ? ' is-update-ready' : '') + (update.state === 'error' ? ' is-update-error' : ''),
                onClick: onUpdateClick,
                disabled: updateBusy,
                title: update.message || '检查 GitHub 最新 Release；有新版时执行 git pull，重启 DSH 后生效',
              }, updateLabel),
              h('button', { className: 'is-btn is-btn-ghost is-btn-sm', onClick: () => openSetup(active.id) }, '配置'),
            ),
          ),

          ['available', 'updated', 'error'].includes(update.state) && update.message
            ? h('div', { className: 'is-update-note is-update-note-' + update.state }, update.message)
            : null,

          active.configured ? null : h('div', { className: 'is-banner' },
            h('div', { className: 'is-banner-main' },
              h('strong', {}, `${active.label} 还没有配置 Key。`),
              ` 这个 Key 只用于 ${active.label}，不会影响其他服务商。`,
            ),
            h('button', { className: 'is-btn is-btn-ghost', onClick: () => openSetup(active.id) }, '现在配置'),
          ),

          h('div', { className: 'is-grid' },
            h('div', { className: 'is-card is-prompt-card' },
              h('div', { className: 'is-card-head' },
                h('h2', { className: 'is-card-title' }, '提示词'),
                h('div', { className: 'is-prompt-head-actions' },
                  h('button', {
                    className: 'is-btn is-btn-ghost is-btn-sm',
                    onClick: openPromptLibrary,
                    title: '打开提示词库：按来源/风格筛选，复制或填入提示词',
                  }, '提示词库'),
                  h('button', {
                    className: 'is-btn is-btn-ghost is-btn-sm',
                    onClick: () => setCameraOpen(true),
                    title: '追加相机、镜头、焦段和光圈参数',
                  }, '相机控制'),
                ),
              ),
              referenceNotice.text === '' ? null : h('div', {
                className: 'is-reference-notice is-reference-notice-' + referenceNotice.kind,
              }, referenceNotice.text),
              h('div', { className: 'is-field is-prompt-field' },
                h('div', { className: 'is-label' },
                  h('span', {}, '画面描述'),
                  h('span', { className: 'is-count' }, `${prompt.length} / 4000`),
                ),
                h('textarea', {
                  className: 'is-textarea',
                  ref: promptRef,
                  value: prompt,
                  maxLength: 4000,
                  placeholder: '例如：雨夜的霓虹街道，湿润路面反射灯光，电影感广角，青橙色调，高细节',
                  onChange: (event) => {
                    const value = event.target.value
                    setPrompt(value)
                    updateMention(value, event.target.selectionStart)
                  },
                  onKeyDown,
                  onBlur: () => window.setTimeout(() => setMention({ open: false, start: 0, end: 0, index: 0, query: '' }), 150),
                  onContextMenu: openPromptMenu,
                  'aria-label': '画面描述',
                }),
                mention.open ? h('div', { className: 'is-mention-menu', role: 'listbox', 'aria-label': '插入参考图' },
                  mentionMatches.map((entry, position) => h('button', {
                    key: `mention-${entry.index}`,
                    type: 'button',
                    className: 'is-mention-item' + (mention.index === position ? ' active' : ''),
                    role: 'option',
                    'aria-selected': mention.index === position,
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => insertMention(entry.index),
                  },
                    h('span', { className: 'is-mention-thumb' }, h('img', { src: entry.reference.dataUrl, alt: '' })),
                    h('span', {}, entry.label),
                    h('span', { className: 'is-mention-name' }, entry.reference.name || ''),
                  )),
                ) : null,
              ),
              gifOutput ? null : h('div', { className: 'is-reference' },
                h('div', { className: 'is-reference-head' },
                  h('div', { className: 'is-label' },
                    h('span', {}, '参考图'),
                  ),
                  h('div', { className: 'is-reference-actions' },
                    h('button', {
                      className: 'is-btn is-btn-ghost is-btn-sm',
                      onClick: openGallery,
                      disabled: !referenceSupported,
                      title: '打开参考图库，点图片直接加入参考图',
                    }, '参考图库'),
                    h('button', {
                      className: 'is-btn is-btn-ghost is-btn-sm',
                      onClick: pickReference,
                      disabled: !referenceSupported || references.length >= maxReferences,
                      title: referenceSupported
                        ? (references.length >= maxReferences ? `最多 ${maxReferences} 张` : '选择一张或多张参考图')
                        : referenceDisabledHint,
                    }, references.length > 0 ? '继续添加' : '添加参考图'),
                    references.length > 0 ? h('button', {
                      className: 'is-btn is-btn-quiet is-btn-sm',
                      onClick: clearReferences,
                    }, '清空') : null,
                  ),
                ),
                h('div', {
                  className: 'is-reference-stage'
                    + (references.length > 0 ? ' has-images' : '')
                    + (referenceSupported ? '' : ' is-disabled')
                    + (dragOverRef && referenceSupported ? ' is-dragover' : ''),
                  onDragEnter: (event) => {
                    event.preventDefault()
                    if (referenceSupported) setDragOverRef(true)
                  },
                  onDragOver: (event) => {
                    event.preventDefault()
                    if (referenceSupported && !dragOverRef) setDragOverRef(true)
                  },
                  onDragLeave: (event) => {
                    if (event.currentTarget === event.target) setDragOverRef(false)
                  },
                  onDrop: onReferenceDrop,
                },
                  references.length > 0
                    ? [
                      ...references.map((item, index) => h('div', {
                        className: 'is-reference-item',
                        key: `reference-${index}`,
                        title: item.width > 0 && item.height > 0 ? `${item.name} · ${item.width}×${item.height}` : item.name,
                      },
                        h('img', {
                          src: item.dataUrl,
                          alt: item.name,
                          title: '点击预览大图',
                          onClick: (event) => {
                            event.stopPropagation()
                            setImageLightbox({ src: item.dataUrl, title: item.name || `参考图${index + 1}` })
                          },
                        }),
                        h('span', { className: 'is-reference-label' }, `参考图${index + 1}`),
                        h('button', {
                          className: 'is-reference-remove',
                          onClick: () => removeReference(index),
                          title: '移除此参考图',
                        }, closeIcon(9)),
                      )),
                      referenceSupported && references.length < maxReferences
                        ? h('button', {
                          className: 'is-reference-add',
                          key: 'reference-add',
                          onClick: pickReference,
                          title: '继续添加参考图',
                        }, plusIcon(18))
                        : null,
                    ]
                    : h('button', {
                      className: 'is-reference-empty',
                      onClick: pickReference,
                      disabled: !referenceSupported,
                    },
                      h('div', { className: 'is-reference-plus' }, plusIcon(14)),
                      h('div', { className: 'is-reference-empty-title' }, referenceSupported ? '添加参考图' : '当前模型不支持参考图'),
                      referenceSupported
                        ? h('div', { className: 'is-reference-hint' },
                          h('span', {}, 'PNG / JPEG / WebP，可拖入；'),
                          h('span', {}, `最多 ${maxReferences} 张，用于图生图`),
                        )
                        : h('div', { className: 'is-reference-hint' }, referenceDisabledHint),
                    ),
                ),
                h('input', {
                  ref: fileInputRef,
                  type: 'file',
                  accept: 'image/png,image/jpeg,image/webp',
                  multiple: true,
                  style: { display: 'none' },
                  onChange: onReferenceChange,
                }),
              ),
              h('div', { className: 'is-fields' },
                h('div', { className: 'is-field is-span2' },
                  h('div', { className: 'is-label' }, h('span', {}, '模型')),
                  h('select', {
                    className: 'is-select',
                    value: model,
                    onChange: (event) => onModelChange(event.target.value),
                    'aria-label': '模型',
                  }, modelOptions.map((item) => h('option', { key: item, value: item }, item))),
                ),
                gifOutput ? null : h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '尺寸')),
                  h('select', {
                    className: 'is-select',
                    value: size,
                    onChange: (event) => setSize(event.target.value),
                    'aria-label': '尺寸',
                  }, sizeOptions.map((item) => h('option', { key: item, value: item }, item))),
                ),
                ratioSupported ? h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '比例')),
                  h('select', {
                    className: 'is-select',
                    value: ratio,
                    onChange: (event) => onRatioChange(event.target.value),
                    'aria-label': '比例',
                  }, (active.ratios || []).map((item) => h('option', { key: item, value: item }, item))),
                ) : null,
                active.supportsQuality && qualityOptions.length > 0 ? h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '质量')),
                  h('select', {
                    className: 'is-select',
                    value: quality,
                    onChange: (event) => setQuality(event.target.value),
                    'aria-label': '质量',
                  }, qualityOptions.map((item) => h('option', { key: item, value: item }, item))),
                ) : null,
                supports26 ? h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '复杂度')),
                  h('select', {
                    className: 'is-select',
                    value: complexity,
                    onChange: (event) => setComplexity(event.target.value),
                    'aria-label': '复杂度',
                    title: '规划投入，和渲染质量分开；复杂排版可用 high',
                  }, GPT_IMAGE_COMPLEXITIES.map((item) => h('option', { key: item, value: item }, item))),
                ) : null,
                supports26 ? h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '格式')),
                  h('select', {
                    className: 'is-select',
                    value: outputFormat,
                    onChange: (event) => {
                      const next = event.target.value
                      setOutputFormat(next)
                      if (next === 'gif' && references.length > 0) {
                        setReferences([])
                        setError('GIF 动图只支持文生图，已清空参考图。')
                      }
                    },
                    'aria-label': '输出格式',
                  }, GPT_IMAGE_OUTPUT_FORMATS.map((item) => h('option', { key: item, value: item }, item === 'gif' ? 'gif（动图）' : item))),
                ) : null,
                gifOutput ? h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '帧数')),
                  h('select', {
                    className: 'is-select',
                    value: String(frameCount),
                    onChange: (event) => setFrameCount(Number(event.target.value)),
                    'aria-label': '帧数',
                  }, GIF_FRAME_OPTIONS.map((item) => h('option', { key: item, value: String(item) }, `${item} 帧`))),
                ) : null,
                gifOutput ? h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '每帧')),
                  h('select', {
                    className: 'is-select',
                    value: String(frameDurationMs),
                    onChange: (event) => setFrameDurationMs(Number(event.target.value)),
                    'aria-label': '每帧毫秒',
                  }, GIF_MS_OPTIONS.map((item) => h('option', { key: item, value: String(item) }, `${item} ms`))),
                ) : null,
              ),
              !gifOutput && computedSize ? h('p', { className: 'is-note' }, `实际输出：${computedSize}`) : null,
              gifOutput ? h('p', { className: 'is-note' }, `GIF 动图：每帧 ${GPT_IMAGE_GIF_SIZES[ratio || '1:1'] || '512x512'}（尺寸档不生效）· ${frameCount} 帧 · ${frameDurationMs}ms（约 ${(frameCount * frameDurationMs / 1000).toFixed(1)}s 循环）`) : null,
              supports26 ? h('p', { className: 'is-note' }, '复杂度＝出图前的规划投入，和「质量」分开：简单画面用 low 更快，复杂排版/多人物关系用 high。') : null,
              error === '' ? null : h('div', { className: 'is-banner error' },
                h('div', { className: 'is-banner-main' }, error),
                (error.includes('Key') || error.includes('鉴权') || error.includes('401'))
                  ? h('button', { className: 'is-btn is-btn-ghost', onClick: () => openSetup(active.id) }, '检查 Key')
                  : null,
              ),
              h('div', { className: 'is-actions' },
                h('button', {
                  className: 'is-btn is-btn-primary' + (generating ? ' is-generating' : ''),
                  onClick: generate,
                  disabled: generating || prompt.trim() === '' || (references.length > 0 && !referenceSupported),
                  title: references.length > 0 && !referenceSupported ? referenceDisabledHint : undefined,
                }, generating ? '生成中…' : '生成图片'),
                h('span', { className: 'is-kbd' }, generating ? (elapsed > 0 ? `已等待 ${elapsed}s · 最长 5 分钟` : '通常需要 10–60 秒') : '结果会自动保存到本机'),
              ),
              h('div', { className: 'is-tips' },
                h('span', { className: 'is-tips-title' }, '快捷'),
                h('span', {
                  className: 'is-tips-code',
                  title: '服务商 + 尺寸 + 比例；也支持 --provider / --size / --ratio',
                }, '/image gpt 2k 16:9'),
                h('span', { className: 'is-tips-note' }, 'Ctrl / ⌘ + Enter 生成'),
              ),
            ),

            h('div', { className: 'is-card is-studio' },
              h('div', { className: 'is-result-head' },
                h('div', { className: 'is-result-top' },
                  h('div', { className: 'is-result-meta' },
                    result
                      ? [
                        h('span', { key: 'p', className: 'is-tag' }, result.providerLabel || result.provider || ''),
                        h('span', { key: 'm', className: 'is-tag' }, result.model),
                        h('span', { key: 's', className: 'is-tag' }, result.size),
                        result.ratio ? h('span', { key: 'r', className: 'is-tag' }, result.ratio) : null,
                        result.quality ? h('span', { key: 'q', className: 'is-tag' }, result.quality) : null,
                        result.outputFormat && result.outputFormat !== 'png'
                          ? h('span', { key: 'fmt', className: 'is-tag' }, result.outputFormat === 'gif' ? 'GIF 动图' : String(result.outputFormat).toUpperCase())
                          : null,
                        result.referenceCount > 0 ? h('span', { key: 'ref', className: 'is-tag' }, `参考图 ${result.referenceCount}`) : null,
                        h('span', { key: 't' }, `${(result.elapsedMs / 1000).toFixed(1)}s`),
                        Number.isFinite(result.postMs)
                          ? h('span', {
                            key: 'st',
                            className: 'is-tag',
                            title: '生成请求耗时（响应头 / 响应体）· 图片回传耗时',
                          }, `请求 ${(result.postMs / 1000).toFixed(1)}s`
                            + (Number.isFinite(result.headersMs) && Number.isFinite(result.bodyMs)
                              ? `（头 ${(result.headersMs / 1000).toFixed(1)}s / 体 ${(result.bodyMs / 1000).toFixed(1)}s）`
                              : '')
                            + ` · 回传 ${(Number(result.downloadMs) / 1000).toFixed(1)}s`
                            + (result.sourceKind === 'url' && Number.isFinite(result.bytes) && Number(result.downloadMs) > 5000
                              ? `（${(result.bytes / 1048576).toFixed(1)}MB${result.downloadMode === 'range' ? ' · 分段并发' : ''}）`
                              : ''))
                          : null,
                        imageSize ? h('span', { key: 'd' }, `${imageSize.w} × ${imageSize.h}`) : null,
                      ].filter(Boolean)
                      : h('span', {}, '结果'),
                  ),
                  result
                    ? h('div', { className: 'is-result-corner' },
                      h('button', {
                        type: 'button',
                        className: 'is-btn is-btn-sm is-btn-annotate',
                        onClick: openAnnotateEditor,
                        disabled: !referenceSupported || result.outputFormat === 'gif',
                        title: !referenceSupported
                          ? referenceDisabledHint
                          : '放大当前图片，用气泡序号标记要修改的位置并生成图生图参考与提示词',
                      }, annotatePinIcon(14), '标注编辑'),
                    )
                    : null,
                ),
                result
                  ? h('div', { className: 'is-result-actions' },
                    h('button', {
                      className: 'is-btn is-btn-ghost is-btn-sm',
                      onClick: () => setViewerOpen(true),
                      title: '全屏看图',
                      'aria-label': '全屏看图',
                    }, expandIcon(14)),
                    h('button', {
                      className: 'is-btn is-btn-quiet is-btn-sm',
                      onClick: () => deleteImage(result.id),
                      disabled: deletingId !== '',
                      title: '删除这张图',
                    }, deletingId === result.id ? '删除中…' : '删除'),
                    h('a', {
                      className: 'is-btn is-btn-ghost is-btn-sm',
                      href: result.url + '?download=1',
                      download: true,
                      title: '下载原图',
                    }, downloadIcon(14), '下载原图'),
                    h('button', {
                      className: 'is-btn is-btn-quiet is-btn-sm',
                      onClick: copyPath,
                      title: '复制本地路径',
                    }, copied || '复制路径'),
                  )
                  : null,
              ),
              h('div', { className: generating ? 'is-canvas is-loading-canvas' : 'is-canvas' },
                generating
                  ? h('div', { className: 'is-loading', role: 'status', 'aria-live': 'polite' },
                    h(DotField, { key: 'dots' }),
                    h('div', { className: 'is-empty-title' }, elapsed > 0 ? `正在生成 · ${elapsed}s` : '正在生成'),
                    h('div', { className: 'is-empty-text' }, `${active.label} 正在绘制，完成后会自动显示在这里。通常 10–60 秒；复杂提示词或高分辨率可能更久（最长 5 分钟）。`),
                    h('div', { className: 'is-progress', 'aria-hidden': 'true' },
                      h('div', { className: 'is-progress-bar' }),
                    ),
                  )
                  : result
                    ? [
                      h(DotField, { key: 'static', animated: false }),
                      h('img', {
                        key: `result-${result.id}`,
                        className: 'is-result-image',
                        src: result.url,
                        alt: result.prompt || '生成的图片',
                        decoding: 'async',
                        title: '点击全屏查看',
                        onClick: () => setViewerOpen(true),
                        onContextMenu: (event) => openImageMenu(event, result.url, result.prompt),
                        onLoad: (event) => setImageSize({
                          w: event.currentTarget.naturalWidth,
                          h: event.currentTarget.naturalHeight,
                        }),
                      }),
                    ]
                    : [
                      h(DotField, { key: 'static', animated: false }),
                      h('div', { key: 'empty', className: 'is-empty' },
                        h('div', { className: 'is-empty-icon' }, spark(20)),
                        h('div', { className: 'is-empty-title' }, '等待第一张图'),
                        h('div', { className: 'is-empty-text' }, '在左侧写下画面描述，选择服务商、模型与参数，然后点击「生成图片」。'),
                      ),
                    ],
              ),
              h('div', { className: 'is-history' },
                h('div', { className: 'is-card-head' },
                  h('h2', { className: 'is-card-title' }, '最近生成'),
                  h('span', { className: 'is-card-hint' }, history.length > 0 ? `${history.length} 张` : '本机保留最近 80 张'),
                ),
                history.length === 0
                  ? h('div', { className: 'is-history-empty' }, '还没有生成记录。')
                  : h('div', { className: 'is-history-list' },
                    history.map((item) => h('div', {
                      key: item.id,
                      className: 'is-thumb-wrap',
                    },
                      h('button', {
                        className: 'is-thumb' + (result && result.id === item.id ? ' is-active' : ''),
                        title: `${item.providerLabel || item.provider || ''} · ${item.prompt || item.id}`,
                        onClick: () => {
                          setResult(item)
                          setImageSize(null)
                        },
                      },
                        h('img', { src: item.url, alt: item.prompt || '历史图片', loading: 'lazy', decoding: 'async' }),
                        h('span', { className: 'is-thumb-time' }, formatTime(item.createdAt)),
                      ),
                      h('button', {
                        className: 'is-thumb-delete',
                        onClick: () => deleteImage(item.id),
                        disabled: deletingId !== '',
                        title: '删除这张图',
                        'aria-label': '删除这张图',
                      }, closeIcon(9)),
                    )),
                  ),
              ),
            ),
          ),
        ),

        setupOpen && setupProvider ? h('div', {
          className: 'is-modal',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !setupBusy) setSetupOpen(false)
          },
        },
          h('div', { className: 'is-modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': '生图设置' },
            h('div', { className: 'is-modal-head' },
              h('div', {},
                h('h2', { className: 'is-modal-title' }, '生图设置'),
                h('p', { className: 'is-modal-sub' }, '每个服务商有独立 Key；只保存在本机插件目录，不写入 dsh 的其他配置，也不会回显。'),
              ),
              h('button', {
                className: 'is-close',
                onClick: () => { if (!setupBusy) setSetupOpen(false) },
                'aria-label': '关闭',
              }, closeIcon(14)),
            ),
            h('div', { className: 'is-theme-block' },
              h('div', { className: 'is-label' },
                h('span', {}, '工作台配色'),
                h('span', { className: 'is-count' }, '素雅'),
              ),
              h('div', { className: 'is-theme-grid' },
                STUDIO_THEMES.map((theme) => h('button', {
                  key: theme.id,
                  type: 'button',
                  className: 'is-theme-option' + ((status.theme || 'auto') === theme.id ? ' active' : ''),
                  'aria-pressed': (status.theme || 'auto') === theme.id,
                  title: theme.hint,
                  onClick: () => applyTheme(theme.id),
                },
                  h('span', { className: 'is-theme-swatches' },
                    theme.swatches.map((color, index) => h('span', {
                      key: index,
                      className: 'is-theme-swatch',
                      style: { background: color },
                    })),
                  ),
                  h('span', { className: 'is-theme-name' }, theme.label),
                  h('span', { className: 'is-theme-hint' }, theme.hint),
                )),
              ),
            ),
            h('div', { className: 'is-providers', style: { width: '100%' } },
              providers.map((provider) => h('button', {
                key: provider.id,
                className: 'is-provider' + (provider.id === setupProvider.id ? ' active' : ''),
                style: { flex: 1, justifyContent: 'center' },
                onClick: () => {
                  if (setupBusy) return
                  setSetupProviderId(provider.id)
                  setSetupDraft({
                    apiKey: '',
                    baseUrl: provider.baseUrl || '',
                    endpointPath: provider.endpointPath || provider.endpointDefault || '',
                    model: provider.model || '',
                    size: provider.size || '',
                    ratio: provider.ratio || '',
                    quality: provider.quality || '',
                    schema: provider.schema || (Array.isArray(provider.schemas) ? provider.schemas[0][0] : ''),
                  })
                  setSetupError('')
                  setSniffModels([])
                  setSniffSelected([])
                  setSniffError('')
                },
              },
                h('span', { className: 'is-provider-dot' + (provider.configured ? ' ok' : '') }),
                provider.shortLabel || provider.label,
              )),
            ),
            h('div', { style: { height: 14 } }),
            setupSchemas ? h('div', { className: 'is-field' },
              h('div', { className: 'is-label' },
                h('span', {}, '协议 / Payload'),
                h('span', { className: 'is-count' }, setupSchema === 'minimax' ? 'MiniMax H3' : 'GPT Image'),
              ),
              h('select', {
                className: 'is-select',
                value: setupSchema,
                onChange: (event) => {
                  const next = event.target.value
                  const defaults = next === 'minimax'
                    ? { size: '2K', ratio: '1:1', quality: '', model: setupDraft.model || 'MiniMax-H3-Image' }
                    : { size: '1K', ratio: '1:1', quality: 'auto', model: setupDraft.model || 'gpt-image-2.5-sunburst' }
                  setSetupDraft({ ...setupDraft, schema: next, ...defaults })
                },
              }, setupSchemas.map(([id, label]) => h('option', { key: id, value: id }, label))),
              h('p', { className: 'is-note' }, '兼容接口按所选协议组包：GPT Image 走 Images generations/edits；MiniMax H3 用 area + aspect_ratio，编辑走 images[].image_url。'),
            ) : null,
            h('div', { className: 'is-field' },
              h('div', { className: 'is-label' },
                h('span', {}, `${setupProvider.label} API Key`),
                setupProvider.configured ? h('span', { className: 'is-count' }, `已保存 ${setupProvider.masked}`) : null,
              ),
              h('input', {
                className: 'is-input',
                type: 'password',
                autoComplete: 'off',
                spellCheck: false,
                value: setupDraft.apiKey,
                placeholder: setupProvider.configured ? '留空保持不变；输入新 Key 可替换' : setupProvider.keyPlaceholder,
                onChange: (event) => setSetupDraft({ ...setupDraft, apiKey: event.target.value }),
              }),
              h('p', { className: 'is-note' }, `${setupProvider.keyHint}。存储位置：${status.storageDir || '~/.dsh/image-studio'}（credentials.json）`),
              setupProvider.id === 'agnes' ? h('div', { className: 'is-key-link' },
                h('a', {
                  className: 'is-btn is-btn-ghost is-btn-sm',
                  href: 'https://platform.agnes-ai.cn/',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                }, '获取 Agnes Key ↗'),
                h('a', {
                  className: 'is-note',
                  href: 'https://platform.agnes-ai.com/',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                }, '国际站'),
              ) : null,
            ),
            h('div', { className: 'is-field' },
              h('div', { className: 'is-label' }, h('span', {}, 'Base URL')),
              h('input', {
                className: 'is-input',
                type: 'url',
                value: setupDraft.baseUrl,
                placeholder: setupProvider.baseUrlDefault,
                onChange: (event) => setSetupDraft({ ...setupDraft, baseUrl: event.target.value }),
              }),
            ),
            h('div', { className: 'is-field' },
              h('div', { className: 'is-label' }, h('span', {}, '接口路径')),
              h('input', {
                className: 'is-input',
                type: 'text',
                value: setupDraft.endpointPath,
                placeholder: setupProvider.endpointDefault,
                onChange: (event) => setSetupDraft({ ...setupDraft, endpointPath: event.target.value }),
              }),
              h('p', { className: 'is-note' }, `默认 ${setupProvider.endpointDefault}；兼容中转可改成自己的路径。`),
            ),
            h('div', { className: 'is-field' },
              h('div', { className: 'is-label' },
                h('span', {}, '默认模型'),
                h('button', {
                  className: 'is-btn is-btn-quiet is-btn-sm',
                  type: 'button',
                  onClick: runModelSniff,
                  disabled: sniffBusy || !setupProvider.configured,
                  title: setupProvider.configured ? '用已保存的 Key 拉取服务商模型列表' : '先保存 Key，再嗅探模型',
                }, sniffBusy ? '嗅探中…' : '嗅探模型'),
              ),
              h('input', {
                className: 'is-input',
                type: 'text',
                value: setupDraft.model,
                placeholder: setupProvider.modelDefault,
                onChange: (event) => setSetupDraft({ ...setupDraft, model: event.target.value }),
              }),
              sniffError === '' ? null : h('p', { className: 'is-error-text' }, sniffError),
              sniffModels.length > 0 ? h('div', { className: 'is-model-sniff' },
                h('div', { className: 'is-model-sniff-head' },
                  h('span', {}, `已勾选 ${sniffSelected.length} / 找到 ${sniffModels.length} 个`),
                  h('span', { className: 'is-model-sniff-hint' }, '只有勾选的会出现在主面板下拉'),
                ),
                h('div', { className: 'is-model-sniff-list' },
                  sniffModels.slice(0, 160).map((item) => {
                    const selected = sniffSelected.includes(item.id)
                    return h('button', {
                      key: item.id,
                      className: 'is-model-chip' + (selected ? ' active' : ''),
                      type: 'button',
                      title: item.id,
                      'aria-pressed': selected,
                      onClick: () => toggleSniffModel(item.id),
                    },
                      h('span', { className: 'is-model-chip-check' }, selected ? '✓' : ''),
                      h('span', { className: 'is-model-chip-name' }, item.id),
                      item.imageLike ? h('span', { className: 'is-model-chip-tag' }, '图像') : null,
                    )
                  }),
                ),
              ) : null,
              h('p', { className: 'is-note' }, '嗅探使用已保存的 Key；改了 Base URL 或 Key 后先保存再嗅探。'),
              sniffModels.length > 0 ? h('p', { className: 'is-note' }, '取消勾选不会删除已有历史；保存后只有勾选的模型会进入主面板下拉。') : null,
            ),
            h('div', { className: 'is-fields' },
              h('div', { className: 'is-field' },
                h('div', { className: 'is-label' }, h('span', {}, '默认尺寸')),
                h('select', {
                  className: 'is-select',
                  value: setupDraft.size,
                  onChange: (event) => setSetupDraft({ ...setupDraft, size: event.target.value }),
                }, setupSizes.map((item) => h('option', { key: item, value: item }, item))),
              ),
              setupRatioSupported ? h('div', { className: 'is-field' },
                h('div', { className: 'is-label' }, h('span', {}, '默认比例')),
                h('select', {
                  className: 'is-select',
                  value: setupDraft.ratio,
                  onChange: (event) => setSetupDraft({ ...setupDraft, ratio: event.target.value }),
                }, (setupProvider.ratios || []).map((item) => h('option', { key: item, value: item }, item))),
              ) : null,
              setupSupportsQuality && setupQualities.length > 0 ? h('div', { className: 'is-field' },
                h('div', { className: 'is-label' }, h('span', {}, '默认质量')),
                h('select', {
                  className: 'is-select',
                  value: setupDraft.quality,
                  onChange: (event) => setSetupDraft({ ...setupDraft, quality: event.target.value }),
                }, setupQualities.map((item) => h('option', { key: item, value: item }, item))),
              ) : null,
            ),
            setupError === '' ? null : h('div', { className: 'is-error-text' }, setupError),
            h('div', { className: 'is-modal-actions' },
              setupProvider.configured
                ? h('button', {
                  className: 'is-btn is-btn-quiet',
                  disabled: setupBusy,
                  onClick: () => saveSetup(true),
                }, '清除 Key')
                : null,
              h('div', { className: 'is-spacer' }),
              h('button', {
                className: 'is-btn is-btn-ghost',
                disabled: setupBusy,
                onClick: () => setSetupOpen(false),
              }, '取消'),
              h('button', {
                className: 'is-btn is-btn-primary',
                disabled: setupBusy,
                onClick: () => saveSetup(false),
              }, setupBusy ? '保存中…' : '保存'),
            ),
          ),
        ) : null,

        mediaPreview ? h('div', {
          className: 'is-gallery-layer is-preview-layer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '大图预览',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setMediaPreview(null)
          },
        },
          h('div', { className: 'is-preview-modal' },
            h('div', { className: 'is-gallery-head' },
              h('div', {},
                h('div', { className: 'is-gallery-title' }, mediaPreview.item.title || '预览'),
                h('div', { className: 'is-gallery-sub' },
                  mediaPreview.kind === 'prompt'
                    ? (mediaPreview.item.description || '提示词示例图')
                    : (mediaPreview.item.category || '参考图')),
              ),
              h('button', {
                className: 'is-camera-close',
                onClick: () => setMediaPreview(null),
                'aria-label': '关闭预览',
              }, closeIcon(14)),
            ),
            h('div', { className: 'is-preview-body' },
              h('img', {
                src: previewUrlOf(mediaPreview),
                alt: mediaPreview.item.title || '预览图',
              }),
              h('div', { className: 'is-preview-side' },
                mediaPreview.kind === 'prompt'
                  ? h('pre', { className: 'is-preview-prompt' }, mediaPreview.item.prompt || '')
                  : h('div', { className: 'is-preview-variants' },
                    (() => {
                      const variants = Array.isArray(mediaPreview.item.variants) ? mediaPreview.item.variants : []
                      if (variants.length <= 1) return h('div', { className: 'is-preview-note' }, '这张图会作为参考图参与生图。')
                      const index = Math.max(0, Math.min(mediaPreview.variantIndex || 0, variants.length - 1))
                      return [
                        h('div', { className: 'is-preview-note' }, `共 ${variants.length} 个角度：${variants[index].angle || `第 ${index + 1} 个`}`),
                        h('div', { className: 'is-preview-variant-actions' },
                          h('button', {
                            className: 'is-btn is-btn-ghost is-btn-sm',
                            disabled: index <= 0,
                            onClick: () => setMediaPreview({ ...mediaPreview, variantIndex: index - 1 }),
                          }, '‹ 上一个'),
                          h('span', { className: 'is-preview-variant-count' }, `${index + 1} / ${variants.length}`),
                          h('button', {
                            className: 'is-btn is-btn-ghost is-btn-sm',
                            disabled: index >= variants.length - 1,
                            onClick: () => setMediaPreview({ ...mediaPreview, variantIndex: index + 1 }),
                          }, '下一个 ›'),
                        ),
                      ]
                    })(),
                  ),
                galleryStatus !== '' ? h('div', { className: 'is-preview-status' }, galleryStatus) : null,
                h('div', { className: 'is-preview-actions' },
                  mediaPreview.kind === 'prompt'
                    ? [
                      h('button', {
                        key: 'copy',
                        className: 'is-btn is-btn-ghost',
                        onClick: () => copyPromptFromLibrary(mediaPreview.item),
                      }, promptCopiedId === mediaPreview.item.id ? '已复制' : '复制提示词'),
                      h('button', {
                        key: 'fill',
                        className: 'is-btn is-btn-primary',
                        onClick: () => fillPromptFromLibrary(mediaPreview.item),
                      }, '填入提示词'),
                    ]
                    : [
                      h('button', {
                        key: 'add',
                        className: 'is-btn is-btn-primary',
                        title: references.length >= maxReferences ? `参考图已满（${maxReferences} 张）` : '加入参考图',
                        onClick: () => addGalleryImage(previewVariant(mediaPreview)),
                      }, galleryBusyId === mediaPreview.item.id ? '读取中…' : (galleryAdded[mediaPreview.item.id] ? '已加入参考图' : '加入参考图')),
                    ],
                  h('button', {
                    key: 'download',
                    className: 'is-btn is-btn-ghost',
                    onClick: downloadPreviewImage,
                  }, '下载图片'),
                  mediaPreview.kind === 'prompt' && mediaPreview.item.pageUrl
                    ? h('a', {
                      key: 'page',
                      className: 'is-btn is-btn-quiet',
                      href: mediaPreview.item.pageUrl,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    }, '原页')
                    : null,
                ),
              ),
            ),
          ),
        ) : null,

        promptLibOpen ? h('div', {
          className: 'is-gallery-layer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '提示词库',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setPromptLibOpen(false)
          },
        },
          h('div', { className: 'is-gallery-modal is-prompt-modal' },
            h('div', { className: 'is-gallery-head' },
              h('div', {},
                h('div', { className: 'is-gallery-title' }, '提示词库'),
                h('div', { className: 'is-gallery-sub' }, '选来源和筛选条件，复制提示词或直接填入输入框 · 本机增量缓存，点开即存'),
              ),
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                cacheInfo
                  ? h('span', {
                    className: 'is-cache-pill',
                    title: `缩略图 ${cacheInfo.thumbCount || 0} 张（${formatBytesCompact(cacheInfo.thumbBytes)}）· 原图 ${cacheInfo.fullCount || 0} 张（${formatBytesCompact(cacheInfo.fullBytes)}）· 索引 ${formatBytesCompact(cacheInfo.metaBytes)}`,
                  }, `缓存 ${formatBytesCompact(cacheInfo.totalBytes)}`)
                  : null,
                h('button', {
                  type: 'button',
                  className: 'is-btn is-btn-ghost is-btn-sm',
                  onClick: () => loadPrompts(promptSource, promptPage, promptFilter, promptQuery, true),
                  disabled: promptLoading,
                  title: '向源站增量检查是否有新提示词',
                }, '检查更新'),
                cacheInfo && cacheInfo.blobBytes > 0
                  ? h('button', {
                    type: 'button',
                    className: 'is-btn is-btn-quiet is-btn-sm',
                    onClick: clearImageCache,
                    disabled: cacheBusy,
                    title: '清理已缓存的提示词与图库图片（保留轻量索引）',
                  }, cacheBusy ? '清理中…' : '清图片缓存')
                  : null,
                h('button', {
                  type: 'button',
                  className: 'is-btn is-btn-ghost is-btn-sm',
                  onClick: () => openOfflineDialog('prompts'),
                  title: '导入本地爬取的提示词资源包',
                }, '离线导入'),
                h('button', {
                  className: 'is-camera-close',
                  onClick: () => setPromptLibOpen(false),
                  'aria-label': '关闭提示词库',
                }, closeIcon(14)),
              ),
            ),
            h('div', { className: 'is-gallery-tabs' },
              (promptSources.length > 0
                ? promptSources
                : [{ id: 'navxd', label: 'NavXD' }, { id: 'canghe', label: 'GPT-Image2' }]).map((entry) => {
                const id = typeof entry === 'string' ? entry : entry.id
                const label = typeof entry === 'string' ? entry : entry.label
                return h('button', {
                  key: id,
                  type: 'button',
                  className: 'is-gallery-tab' + (promptSource === id ? ' active' : ''),
                  onClick: () => switchPromptSource(id),
                  title: entry && entry.offline ? `离线包 · ${entry.itemCount || 0} 条` : undefined,
                }, label)
              }),
              h('input', {
                className: 'is-input is-gallery-search',
                placeholder: '搜索提示词 / 关键词…',
                value: promptQuery,
                onChange: (event) => setPromptQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submitPromptSearch()
                },
                'aria-label': '搜索提示词',
              }),
              h('button', { className: 'is-btn is-btn-ghost is-btn-sm', onClick: submitPromptSearch, disabled: promptLoading }, '搜索'),
            ),
            (() => {
              const rows = [
                ['模型', 'model', promptFilters.models],
                ['分类', 'category', promptFilters.categories],
                ['风格', 'style', promptFilters.styles],
                ['类型', 'type', promptFilters.types],
                ['场景', 'scene', promptFilters.scenes],
              ].filter(([, , options]) => Array.isArray(options) && options.length > 1)
              if (rows.length === 0) return null
              return h('div', { className: 'is-prompt-filters' },
                rows.map(([label, key, options]) => h('div', { className: 'is-prompt-filter-row', key },
                  h('span', { className: 'is-prompt-filter-label' }, label),
                  options.map((entry) => {
                    const value = Array.isArray(entry) ? entry[0] : entry
                    const text = Array.isArray(entry) ? entry[1] : entry
                    return h('button', {
                      key: `${key}-${value || 'all'}`,
                      type: 'button',
                      className: 'is-prompt-chip' + (promptFilter[key] === value ? ' active' : ''),
                      onClick: () => applyPromptFilter(key, value),
                    }, text)
                  }),
                )),
              )
            })(),
            promptError !== '' ? h('div', { className: 'is-banner error' },
              h('div', { className: 'is-banner-main' }, promptError),
              h('button', { className: 'is-btn is-btn-ghost is-btn-sm', onClick: () => loadPrompts(promptSource, promptPage, promptFilter, promptQuery) }, '重试'),
            ) : null,
            promptLoading ? h('div', { className: 'is-gallery-empty' }, '正在读取提示词…') : null,
            !promptLoading && promptError === '' && promptItems.length === 0
              ? h('div', { className: 'is-gallery-empty' }, '没有匹配的提示词')
              : null,
            h('div', { className: 'is-prompt-grid' },
              promptItems.map((item) => h('div', {
                className: 'is-plib-card',
                key: item.id,
                onClick: () => {
                  setGalleryStatus('')
                  setMediaPreview({ kind: 'prompt', item, source: promptSource })
                },
                title: '点击查看大图和完整提示词',
              },
                h('img', {
                  src: `${API}/prompts/image?source=${promptSource}&url=${encodeURIComponent(item.image)}`,
                  alt: item.title || '提示词示例',
                  loading: 'lazy',
                  decoding: 'async',
                }),
                h('div', { className: 'is-plib-body' },
                  h('div', { className: 'is-plib-name', title: item.title }, item.title || item.description || '未命名'),
                  h('div', { className: 'is-plib-desc', title: item.prompt }, item.description || item.prompt || ''),
                  h('div', { className: 'is-plib-actions' },
                    h('button', {
                      className: 'is-btn is-btn-ghost is-btn-sm',
                      onClick: (event) => {
                        event.stopPropagation()
                        copyPromptFromLibrary(item)
                      },
                    }, promptCopiedId === item.id ? '已复制' : '复制'),
                    h('button', {
                      className: 'is-btn is-btn-primary is-btn-sm',
                      onClick: (event) => {
                        event.stopPropagation()
                        fillPromptFromLibrary(item)
                      },
                    }, '填入'),
                    item.pageUrl
                      ? h('a', {
                        className: 'is-btn is-btn-quiet is-btn-sm',
                        href: item.pageUrl,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        onClick: (event) => event.stopPropagation(),
                      }, '原页')
                      : null,
                  ),
                ),
              )),
            ),
            h('div', { className: 'is-gallery-foot' },
              h('span', {}, `第 ${promptPage} / ${promptTotalPages} 页 · 本页 ${promptItems.length} 条`),
              h('button', {
                className: 'is-btn is-btn-ghost is-btn-sm',
                onClick: () => gotoPromptPage(promptPage - 1),
                disabled: promptLoading || promptPage <= 1,
              }, '上一页'),
              h('button', {
                className: 'is-btn is-btn-ghost is-btn-sm',
                onClick: () => gotoPromptPage(promptPage + 1),
                disabled: promptLoading || promptPage >= promptTotalPages,
              }, '下一页'),
              (() => {
                const info = promptSources.find((entry) => entry.id === promptSource)
                const home = info && info.home
                  ? info.home
                  : (promptSource === 'canghe'
                    ? 'https://gpt-image2.canghe.ai/#gallery'
                    : promptSource === 'upma'
                      ? 'https://www.upma.cn/image-prompts'
                      : promptSource === 'navxd' ? 'https://navxd.com/prompt-template-library?cat=image' : '')
                return home === '' ? null : h('a', {
                  className: 'is-btn is-btn-quiet is-btn-sm',
                  href: home,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                }, '在浏览器打开')
              })(),
            ),
          ),
        ) : null,

        galleryOpen ? h('div', {
          className: 'is-gallery-layer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '参考图库',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setGalleryOpen(false)
          },
        },
          h('div', { className: 'is-gallery-modal' },
            h('div', { className: 'is-gallery-head' },
              h('div', {},
                h('div', { className: 'is-gallery-title' }, '参考图库'),
                h('div', { className: 'is-gallery-sub' }, '未点开仅缓存轻量缩略图，点开/加入才缓存高清原图 · 版权归原作者'),
                galleryStatus !== '' ? h('div', { className: 'is-gallery-status' }, galleryStatus) : null,
              ),
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                cacheInfo
                  ? h('span', {
                    className: 'is-cache-pill',
                    title: `缩略图 ${cacheInfo.thumbCount || 0} 张（${formatBytesCompact(cacheInfo.thumbBytes)}）· 原图 ${cacheInfo.fullCount || 0} 张（${formatBytesCompact(cacheInfo.fullBytes)}）· 索引 ${formatBytesCompact(cacheInfo.metaBytes)}`,
                  }, `缓存 ${formatBytesCompact(cacheInfo.totalBytes)}`)
                  : null,
                galleryOffline ? null : h('button', {
                  type: 'button',
                  className: 'is-btn is-btn-ghost is-btn-sm',
                  onClick: () => loadGallery(galleryLibrary, true),
                  disabled: galleryLoading,
                  title: '通过 ETag 向源站增量检查新图',
                }, '检查更新'),
                cacheInfo && cacheInfo.blobBytes > 0
                  ? h('button', {
                    type: 'button',
                    className: 'is-btn is-btn-quiet is-btn-sm',
                    onClick: clearImageCache,
                    disabled: cacheBusy,
                    title: '清理已缓存的图库与提示词图片（保留轻量索引）',
                  }, cacheBusy ? '清理中…' : '清图片缓存')
                  : null,
                h('button', {
                  type: 'button',
                  className: 'is-btn is-btn-ghost is-btn-sm',
                  onClick: () => openOfflineDialog('gallery'),
                  title: '导入本地爬取的参考图资源包',
                }, '离线导入'),
                h('button', {
                  className: 'is-camera-close',
                  onClick: () => setGalleryOpen(false),
                  'aria-label': '关闭图库',
                }, closeIcon(14)),
              ),
            ),
            h('div', { className: 'is-gallery-tabs' },
              (galleryLibraries.length > 0
                ? galleryLibraries
                : [{ id: 'pose', label: '姿势' }, { id: 'costume', label: '服装' }, { id: 'portrait', label: '人像' }]).map((entry) => {
                const id = typeof entry === 'string' ? entry : entry.id
                const label = typeof entry === 'string' ? entry : entry.label
                return h('button', {
                  key: id,
                  type: 'button',
                  className: 'is-gallery-tab' + (galleryLibrary === id ? ' active' : ''),
                  onClick: () => loadGallery(id),
                  title: entry && entry.offline ? `离线包 · ${entry.itemCount || 0} 条` : undefined,
                }, label)
              }),
              h('input', {
                className: 'is-input is-gallery-search',
                placeholder: '搜索姿势 / 服装 / 发型…',
                value: galleryQuery,
                onChange: (event) => {
                  setGalleryQuery(event.target.value)
                  setGalleryLimit(60)
                },
                'aria-label': '搜索图库',
              }),
            ),
            galleryError !== '' ? h('div', { className: 'is-banner error' },
              h('div', { className: 'is-banner-main' }, galleryError),
              h('button', { className: 'is-btn is-btn-ghost is-btn-sm', onClick: () => loadGallery(galleryLibrary) }, '重试'),
            ) : null,
            galleryLoading ? h('div', { className: 'is-gallery-empty' }, '正在读取图库索引…') : null,
            !galleryLoading && galleryError === '' && galleryVisible.length === 0
              ? h('div', { className: 'is-gallery-empty' }, '没有匹配的图片')
              : null,
            h('div', { className: 'is-gallery-grid' },
              galleryVisible.slice(0, galleryLimit).map((item) => h('div', {
                key: item.id,
                role: 'button',
                tabIndex: 0,
                className: 'is-gallery-card'
                  + (galleryAdded[item.id] ? ' is-added' : '')
                  + (galleryBusyId === item.id ? ' is-busy' : ''),
                onClick: () => {
                  setGalleryStatus('')
                  setMediaPreview({ kind: 'reference', item, variantIndex: 0 })
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setMediaPreview({ kind: 'reference', item, variantIndex: 0 })
                  }
                },
                title: `${item.title}${item.category === '' ? '' : ` · ${item.category}`}（点击查看大图）`,
              },
                h('img', {
                  src: `${API}/gallery/image?path=${encodeURIComponent(item.thumb)}`,
                  alt: item.title,
                  loading: 'lazy',
                  decoding: 'async',
                }),
                Array.isArray(item.variants) && item.variants.length > 1
                  ? h('span', { className: 'is-gallery-badge' }, `${item.variants.length} 角度`)
                  : (galleryAdded[item.id] ? h('span', { className: 'is-gallery-badge' }, '已加入') : null),
                h('button', {
                  type: 'button',
                  className: 'is-gallery-add',
                  title: '直接加入参考图',
                  onClick: (event) => {
                    event.stopPropagation()
                    try {
                      setGalleryStatus('')
                      addGalleryImage(item)
                    } catch (failure) {
                      const reason = failure instanceof Error ? failure.message : String(failure)
                      setGalleryStatus(`点击处理失败：${reason}`)
                      setReferenceNotice({ kind: 'error', text: `点击处理失败：${reason}` })
                    }
                  },
                }, plusIcon(12)),
                galleryBusyId === item.id ? h('span', { className: 'is-gallery-badge' }, '读取中…') : null,
                h('span', { className: 'is-gallery-meta' },
                  h('span', { className: 'is-gallery-name' }, item.title),
                  item.category === '' ? null : h('span', { className: 'is-gallery-cat' }, item.category),
                ),
              )),
            ),
            h('div', { className: 'is-gallery-foot' },
              h('span', {}, `共 ${galleryVisible.length} 张${galleryHiddenCount > 0 ? `（已隐藏 ${galleryHiddenCount} 条敏感内容）` : ''} · 已显示 ${Math.min(galleryLimit, galleryVisible.length)}`),
              galleryLimit < galleryVisible.length
                ? h('button', { className: 'is-btn is-btn-ghost is-btn-sm', onClick: () => setGalleryLimit((current) => current + 120) }, '加载更多')
                : null,
              h('button', {
                className: 'is-btn is-btn-ghost is-btn-sm' + (sfwOnly ? ' is-toggle-on' : ''),
                onClick: () => setSfwOnly((current) => !current),
                title: '开启后隐藏姿势「性感系」与服装「内衣/性感/泳装」分类',
              }, sfwOnly ? 'SFW 开' : 'SFW 关'),
              galleryOffline ? null : h('a', {
                className: 'is-btn is-btn-quiet is-btn-sm',
                href: 'https://ai-pose-gallery.anhao.app/',
                target: '_blank',
                rel: 'noopener noreferrer',
              }, '在浏览器打开'),
              galleryOffline ? null : h('a', {
                className: 'is-btn is-btn-quiet is-btn-sm is-github-link',
                href: 'https://github.com/anhao/ai-pose-gallery-zh',
                target: '_blank',
                rel: 'noopener noreferrer',
                title: '源项目 GitHub：anhao/ai-pose-gallery-zh',
              }, githubIcon(14)),
            ),
          ),
        ) : null,

        offlineOpen ? h('div', {
          className: 'is-gallery-layer is-offline-layer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '离线资源包',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setOfflineOpen(false)
          },
        },
          h('div', { className: 'is-gallery-modal is-offline-modal' },
            h('div', { className: 'is-gallery-head' },
              h('div', {},
                h('div', { className: 'is-gallery-title' }, '离线资源包'),
                h('div', { className: 'is-gallery-sub' }, '把爬取好的提示词或参考图接入工作台；图片留在本地，不占用工作台缓存'),
              ),
              h('button', {
                className: 'is-camera-close',
                onClick: () => setOfflineOpen(false),
                'aria-label': '关闭离线资源包',
              }, closeIcon(14)),
            ),
            h('div', { className: 'is-gallery-tabs' },
              [['prompts', '提示词库'], ['gallery', '参考图库']].map(([id, label]) => h('button', {
                key: id,
                type: 'button',
                className: 'is-gallery-tab' + (offlineKind === id ? ' active' : ''),
                onClick: () => {
                  setOfflineKind(id)
                  setOfflineNotice({ kind: '', text: '' })
                },
              }, `${label} · ${(offlinePacks[id] || []).length} 个包`)),
            ),
            offlineNotice.text !== ''
              ? h('div', { className: `is-banner ${offlineNotice.kind === 'error' ? 'error' : ''}` }, offlineNotice.text)
              : null,
            h('div', { className: 'is-offline-body' },
              h('div', { className: 'is-offline-section' },
                h('div', { className: 'is-offline-section-title' }, `已导入的${offlineKind === 'prompts' ? '提示词' : '参考图'}包`),
                (offlinePacks[offlineKind] || []).length === 0
                  ? h('div', { className: 'is-offline-empty' }, '还没有离线包。填写下方清单路径即可导入。')
                  : (offlinePacks[offlineKind] || []).map((pack) => h('div', { key: pack.id, className: 'is-offline-pack' },
                    h('div', { className: 'is-offline-pack-main' },
                      h('div', { className: 'is-offline-pack-name' }, pack.label || pack.id),
                      h('div', { className: 'is-offline-pack-meta' }, `${pack.itemCount || 0} 条${pack.home ? ` · ${pack.home}` : ''}`),
                    ),
                    h('button', {
                      type: 'button',
                      className: 'is-btn is-btn-quiet is-btn-sm',
                      disabled: offlineBusy,
                      onClick: () => removeOfflinePackById(pack.id),
                    }, '删除'),
                  )),
              ),
              h('form', { className: 'is-offline-form', onSubmit: submitOfflineImport },
                h('div', { className: 'is-offline-section-title' }, '导入新资源包'),
                h('label', { className: 'is-field' },
                  h('span', { className: 'is-field-label' }, '清单路径'),
                  h('input', {
                    className: 'is-input',
                    value: offlineManifestPath,
                    onChange: (event) => setOfflineManifestPath(event.target.value),
                    placeholder: 'D:\\爬取资源\\manifest.json，或包含 manifest.json 的目录',
                  }),
                ),
                h('label', { className: 'is-field' },
                  h('span', { className: 'is-field-label' }, '图片根目录（可选）'),
                  h('input', {
                    className: 'is-input',
                    value: offlineBaseDir,
                    onChange: (event) => setOfflineBaseDir(event.target.value),
                    placeholder: '默认使用清单文件所在目录',
                  }),
                ),
                h('button', {
                  type: 'submit',
                  className: 'is-btn is-btn-primary is-btn-sm',
                  disabled: offlineBusy,
                }, offlineBusy ? '导入中…' : '导入资源包'),
              ),
              h('div', { className: 'is-offline-note' },
                h('div', {}, '清单格式：{ "id": "my-pack", "label": "我的资源", "home": "https://来源", "items": [...] }'),
                h('div', {}, '提示词条目：id、prompt、image 必填；title、category、styles、scenes 可选。'),
                h('div', {}, '参考图条目：id、thumb 或 full 必填；title、category、group、tags 可选，也支持中文键名。'),
                h('div', {}, '图片路径相对于清单目录，且必须位于该目录内；单包最多 20000 条，单图最大 32MB。'),
                h('div', {}, '开发者接口：POST /image-studio/offline/import · GET /image-studio/offline/packs · POST /image-studio/offline/remove。'),
              ),
            ),
          ),
        ) : null,

        cameraOpen ? h('div', {
          className: 'is-camera-layer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '相机控制',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setCameraOpen(false)
          },
        },
          h('div', { className: 'is-camera-modal' },
            h('div', { className: 'is-camera-head' },
              h('div', {},
                h('div', { className: 'is-camera-title' }, '相机控制'),
                h('div', { className: 'is-camera-sub' }, '选择机身、镜头、焦段和光圈，确认后追加到提示词末尾'),
              ),
              h('button', {
                className: 'is-camera-close',
                onClick: () => setCameraOpen(false),
                'aria-label': '关闭相机控制',
              }, closeIcon(14)),
            ),
            h('div', { className: 'is-camera-grid' },
              h('label', { className: 'is-camera-field' },
                h('span', {}, '相机'),
                h('select', {
                  className: 'is-select',
                  value: cameraDraft.camera,
                  onChange: (event) => setCameraDraft({ ...cameraDraft, camera: event.target.value }),
                }, CAMERA_PROFILES.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
              ),
              h('label', { className: 'is-camera-field' },
                h('span', {}, '镜头'),
                h('select', {
                  className: 'is-select',
                  value: cameraDraft.lens,
                  onChange: (event) => setCameraDraft({ ...cameraDraft, lens: event.target.value }),
                }, LENS_PROFILES.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
              ),
              h('label', { className: 'is-camera-field' },
                h('span', {}, '焦段'),
                h('select', {
                  className: 'is-select',
                  value: String(cameraDraft.focal),
                  onChange: (event) => setCameraDraft({ ...cameraDraft, focal: Number(event.target.value) }),
                }, CAMERA_FOCALS.map((mm) => h('option', { key: mm, value: String(mm) }, `${mm}mm`))),
              ),
              h('label', { className: 'is-camera-field' },
                h('span', {}, '光圈'),
                h('select', {
                  className: 'is-select',
                  value: String(cameraDraft.aperture),
                  onChange: (event) => setCameraDraft({ ...cameraDraft, aperture: Number(event.target.value) }),
                }, CAMERA_APERTURES.map((f) => h('option', { key: f, value: String(f) }, `f/${f}`))),
              ),
            ),
            h('div', { className: 'is-camera-preview' },
              h('div', { className: 'is-camera-preview-title' }, '将追加到提示词'),
              h('div', { className: 'is-camera-preview-text' }, buildCameraPrompt(cameraDraft)),
            ),
            h('div', { className: 'is-camera-actions' },
              h('button', { className: 'is-btn is-btn-ghost', onClick: () => setCameraOpen(false) }, '取消'),
              h('button', { className: 'is-btn is-btn-primary', onClick: applyCamera }, '确认并追加'),
            ),
          ),
        ) : null,

        imageLightbox ? h('div', {
          className: 'is-gallery-layer is-preview-layer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '参考图预览',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setImageLightbox(null)
          },
        },
          h('div', { className: 'is-lightbox' },
            h('button', {
              className: 'is-viewer-close',
              onClick: () => setImageLightbox(null),
              'aria-label': '关闭预览',
            }, closeIcon(14)),
            h('img', { src: imageLightbox.src, alt: imageLightbox.title || '参考图' }),
          ),
        ) : null,

        viewerOpen && result ? h('div', {
          className: 'is-viewer',
          ref: viewerRef,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '全屏查看生成图片',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setViewerOpen(false)
          },
        },
          h('div', { className: 'is-viewer-frame', ref: viewerFrameRef },
            h('button', {
              className: 'is-viewer-close',
              onClick: () => setViewerOpen(false),
              'aria-label': '关闭全屏',
            }, closeIcon(14)),
            h('img', {
              ref: viewerImgRef,
              src: result.url,
              alt: result.prompt || '生成的图片',
              className: viewerZoomed ? 'is-zoomed' : '',
              title: '滚轮缩放 · 拖动平移 · 双击复位',
              onDoubleClick: () => applyViewerTransform({ zoom: 1, x: 0, y: 0 }),
              onMouseDown: (event) => {
                event.stopPropagation()
                const start = viewerTransformRef.current
                if (start.zoom <= 1) return
                event.preventDefault()
                const startX = event.clientX
                const startY = event.clientY
                const onMove = (moveEvent) => {
                  applyViewerTransform({
                    zoom: start.zoom,
                    x: start.x + moveEvent.clientX - startX,
                    y: start.y + moveEvent.clientY - startY,
                  })
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              },
              onContextMenu: (event) => openImageMenu(event, result.url, result.prompt),
            }),
          ),
          h('div', { className: 'is-viewer-bar' },
            h('div', { className: 'is-viewer-meta' },
              result.prompt || '',
              h('span', { ref: viewerZoomTextRef }, ''),
            ),
            h('div', { className: 'is-viewer-hint' }, '滚轮缩放 · 拖动平移 · 双击复位'),
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flex: 'none' } },
              referenceSupported && result.outputFormat !== 'gif'
                ? h('button', {
                  type: 'button',
                  className: 'is-btn is-btn-sm is-btn-annotate',
                  onClick: () => {
                    setViewerOpen(false)
                    openAnnotateEditor()
                  },
                }, annotatePinIcon(13), '标注编辑')
                : null,
              h('button', {
                className: 'is-btn is-btn-quiet is-btn-sm',
                onClick: () => deleteImage(result.id),
                disabled: deletingId !== '',
                title: '删除这张图',
              }, deletingId === result.id ? '删除中…' : '删除'),
              h('a', {
                className: 'is-btn is-btn-primary is-btn-sm',
                href: result.url + '?download=1',
                download: true,
              }, downloadIcon(14), '下载原图'),
            ),
          ),
        ) : null,

        annotateOpen && result ? h('div', {
          className: 'is-annotate-layer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '气泡标注编辑',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !annotateBusy) setAnnotateOpen(false)
          },
        },
          h('div', { className: 'is-annotate-modal' },
            h('div', { className: 'is-annotate-head' },
              h('div', {},
                h('div', { className: 'is-annotate-title' },
                  annotatePinIcon(16),
                  '气泡标注编辑',
                  annotateMarkers.length > 0
                    ? h('span', { className: 'is-tag' }, `已标 ${annotateMarkers.length} 处`)
                    : null,
                ),
                h('div', { className: 'is-annotate-sub' }, '在左侧放大图上点击要修改的位置放置序号气泡，填写每处的修改提示词；点「完成标注」自动生成带序号的参考图并填入提示词。'),
              ),
              h('div', { className: 'is-annotate-head-actions' },
                annotateMarkers.length > 0
                  ? h('button', {
                    type: 'button',
                    className: 'is-btn is-btn-quiet is-btn-sm',
                    onClick: () => {
                      setAnnotateMarkers([])
                      setAnnotateActiveId('')
                    },
                    disabled: annotateBusy,
                  }, '清空标记')
                  : null,
                h('button', {
                  type: 'button',
                  className: 'is-camera-close',
                  onClick: () => { if (!annotateBusy) setAnnotateOpen(false) },
                  'aria-label': '关闭标注编辑',
                }, closeIcon(14)),
              ),
            ),
            h('div', { className: 'is-annotate-body' },
              h('div', { className: 'is-annotate-stage' },
                h('div', {
                  className: 'is-annotate-canvas-wrap',
                  style: { cursor: ANNOTATE_CURSOR },
                  onClick: addAnnotateMarker,
                  title: '点击图像任意位置添加气泡序号标记',
                },
                  h('img', {
                    src: result.url,
                    alt: result.prompt || '待标注图片',
                    draggable: false,
                  }),
                  annotateMarkers.map((marker, idx) => h('div', {
                    key: marker.id,
                    className: 'is-annotate-pin' + (annotateActiveId === marker.id ? ' is-active' : ''),
                    style: {
                      left: `${(marker.x * 100).toFixed(3)}%`,
                      top: `${(marker.y * 100).toFixed(3)}%`,
                    },
                    onClick: (event) => {
                      event.stopPropagation()
                      setAnnotateActiveId(marker.id)
                      const input = annotateInputRefs.current[marker.id]
                      if (input && typeof input.focus === 'function') input.focus()
                    },
                    title: marker.text ? `${idx + 1}. ${marker.text}` : `标记 ${idx + 1}（点击编辑或右上角 × 删除）`,
                  },
                    h('div', { className: 'is-annotate-pin-head' },
                      String(idx + 1),
                      h('button', {
                        type: 'button',
                        className: 'is-annotate-pin-del',
                        title: '删除该标记',
                        onClick: (event) => {
                          event.stopPropagation()
                          removeAnnotateMarker(marker.id)
                        },
                      }, closeIcon(8)),
                    ),
                    h('div', { className: 'is-annotate-pin-tail' }),
                  )),
                ),
              ),
              h('div', { className: 'is-annotate-side' },
                h('div', { className: 'is-annotate-side-head' },
                  h('span', { className: 'is-annotate-side-title' }, '修改说明（按序号排列）'),
                  h('span', { className: 'is-count' }, `${annotateMarkers.length} 处`),
                ),
                h('div', { className: 'is-annotate-list' },
                  annotateMarkers.length === 0
                    ? h('div', { className: 'is-annotate-empty' }, '点击左侧画面任意位置，放置第 1 个气泡标记，并输入该位置想怎么改（例如「把包包换成白色链条包」「去掉路人」「眼神看向镜头」）。')
                    : annotateMarkers.map((marker, idx) => h('div', {
                      key: marker.id,
                      className: 'is-annotate-item' + (annotateActiveId === marker.id ? ' is-active' : ''),
                      onClick: () => setAnnotateActiveId(marker.id),
                    },
                      h('div', { className: 'is-annotate-item-top' },
                        h('span', { className: 'is-annotate-badge' }, String(idx + 1)),
                        h('span', { className: 'is-annotate-item-title' }, `标记 ${idx + 1}`),
                        h('span', { className: 'is-annotate-coord' }, `${Math.round(marker.x * 100)}%, ${Math.round(marker.y * 100)}%`),
                        h('button', {
                          type: 'button',
                          className: 'is-annotate-del',
                          onClick: (event) => {
                            event.stopPropagation()
                            removeAnnotateMarker(marker.id)
                          },
                        }, '删除'),
                      ),
                      h('textarea', {
                        ref: (node) => {
                          if (node) annotateInputRefs.current[marker.id] = node
                          else delete annotateInputRefs.current[marker.id]
                        },
                        rows: 2,
                        placeholder: `描述标记 ${idx + 1} 处要修改的内容…`,
                        value: marker.text,
                        onFocus: () => setAnnotateActiveId(marker.id),
                        onChange: (event) => updateAnnotateMarkerText(marker.id, event.target.value),
                      }),
                    )),
                ),
              ),
            ),
            h('div', { className: 'is-annotate-foot' },
              h('div', { className: 'is-annotate-foot-hint' }, '完成后自动生成带序号的参考图，并按序号把修改说明填入提示词。'),
              h('div', { className: 'is-annotate-foot-actions' },
                h('button', {
                  type: 'button',
                  className: 'is-btn is-btn-ghost',
                  onClick: () => setAnnotateOpen(false),
                  disabled: annotateBusy,
                }, '取消'),
                h('button', {
                  type: 'button',
                  className: 'is-btn is-btn-primary',
                  onClick: finishAnnotation,
                  disabled: annotateMarkers.length === 0 || annotateBusy,
                }, annotateBusy ? '正在合成参考图…' : `完成标注（${annotateMarkers.length}）`),
              ),
            ),
          ),
        ) : null,

        contextMenu ? h('div', {
          className: 'is-context-menu',
          style: { left: `${contextMenu.x}px`, top: `${contextMenu.y}px` },
          role: 'menu',
          onMouseDown: (event) => event.stopPropagation(),
          onClick: (event) => event.stopPropagation(),
        },
          contextMenu.kind === 'image'
            ? h('button', {
              className: 'is-context-item',
              role: 'menuitem',
              onClick: () => copyImage(contextMenu.url),
            }, '复制图片')
            : null,
          h('button', {
            className: 'is-context-item',
            role: 'menuitem',
            disabled: !contextMenu.text || contextMenu.text.trim() === '',
            onClick: () => {
              const text = contextMenu.text
              setContextMenu(null)
              copyText(text, '提示词已复制')
            },
          }, '复制提示词'),
        ) : null,

        toast ? h('div', { className: 'is-copy-toast', role: 'status', 'aria-live': 'polite' }, toast) : null,
      )
    }

    /* ---------------------------------------------------------------- */
    /* /image result card                                                */
    /* ---------------------------------------------------------------- */

    function ImageCommandView(props) {
      const node = props && props.node ? props.node : null
      const outcome = node && node.outcome ? node.outcome : null
      const text = outcome && typeof outcome.text === 'string' ? outcome.text : ''
      const markdown = /!\[[^\]]*\]\(([^)]+)\)/.exec(text)
      const plain = /图片地址：\s*(\S+)/.exec(text)
      const source = markdown ? markdown[1] : (plain ? plain[1] : null)
      const summary = text.split('\n')[0] || '生图完成'
      if (source === null) {
        return h('div', { className: 'is-command' },
          h('div', { className: 'is-command-title' }, '生图工作台'),
          h('div', { className: 'is-command-sub' }, text || '没有可显示的结果。'),
        )
      }
      return h('div', { className: 'is-command' },
        h('div', { className: 'is-command-title' }, '生图工作台'),
        h('img', { src: source, alt: '生图结果', loading: 'lazy' }),
        h('div', { className: 'is-command-sub' }, summary),
        h('div', { className: 'is-command-hint' }, '继续 /image 修改上一张；/image --new 重新生成'),
      )
    }

    function ImageToolView(props) {
      const block = props && props.block ? props.block : null
      const parts = block && Array.isArray(block.content) ? block.content : []
      const text = parts.map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part.text === 'string') return part.text
        return ''
      }).filter(Boolean).join('\n')
      const markdown = /!\[[^\]]*\]\(([^)]+)\)/.exec(text)
      const fileUrl = /(\/image-studio\/files\/[A-Za-z0-9._-]+)/.exec(text)
      const source = markdown ? markdown[1] : (fileUrl ? fileUrl[1] : null)
      const pathLine = /本地文件：(.+)/.exec(text)
      const localPath = pathLine ? pathLine[1].trim() : ''
      if (source === null) {
        const finished = block !== null && (Array.isArray(block.content) || block.kind !== undefined)
        return h('div', { className: 'is-tool-image is-tool-image-empty' },
          h('div', { className: 'is-tool-image-title' }, '生图工作台'),
          h('div', { className: 'is-tool-image-meta' }, finished ? (text || '生图完成，但没有返回图片。') : '正在生成图片…'),
        )
      }
      return h('div', { className: 'is-tool-image' },
        h('div', { className: 'is-tool-image-title' }, '生图工作台'),
        h('img', { src: source, alt: '生图结果', loading: 'lazy' }),
        h('div', { className: 'is-tool-image-meta' }, localPath ? `本地文件：${localPath}` : '图片已生成'),
        h('div', { className: 'is-tool-image-actions' },
          localPath && props && typeof props.openFile === 'function'
            ? h('button', {
              className: 'is-btn is-btn-quiet is-btn-sm',
              onClick: () => props.openFile(localPath),
              title: '用系统默认方式打开本地图片',
            }, '打开本地文件')
            : null,
          h('a', {
            className: 'is-btn is-btn-ghost is-btn-sm',
            href: source,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: '在浏览器中打开原图',
          }, '打开原图'),
        ),
        h('div', { className: 'is-tool-image-hint' }, '继续在对话里说修改；要重新生成一张可以说「新图」。'),
      )
    }

    /* ---------------------------------------------------------------- */
    /* Plugin entry                                                      */
    /* ---------------------------------------------------------------- */

    function apply(ctx) {
      ensureStyles()

      ctx.inject(['slots'], (slotsCtx) => {
        const slots = slotsCtx.slots
        return slots.inject('sidebar.panellist', () => {
          try {
            return slots.register({
              name: 'sidebar.panellist',
              id: 'image-studio',
              order: 30,
              label: () => '生图工作台',
            }, StudioIcon)
          } catch {
            return () => {}
          }
        })
      })

      ctx.inject(['slots'], (slotsCtx) => {
        const slots = slotsCtx.slots
        return slots.inject('main', () => {
          try {
            return slots.register({
              name: 'main',
              key: 'image-studio',
            }, (props) => h(PluginErrorBoundary, null, h(StudioPage, props)))
          } catch {
            return () => {}
          }
        })
      })

      ctx.inject(['slots'], (slotsCtx) => {
        const slots = slotsCtx.slots
        return slots.inject('conversation.chat.commandview', () => {
          try {
            return slots.register({
              name: 'conversation.chat.commandview',
              key: 'image',
            }, ImageCommandView)
          } catch {
            return () => {}
          }
        })
      })

      ctx.inject(['slots'], (slotsCtx) => {
        const slots = slotsCtx.slots
        return slots.inject('tool.call.toolview', () => {
          try {
            return slots.register({
              name: 'tool.call.toolview',
              key: 'image_studio_generate',
            }, ImageToolView)
          } catch {
            return () => {}
          }
        })
      })
    }

    module.exports = { name: 'image-studio', apply, inject: [] }
    return module.exports
  },
})
