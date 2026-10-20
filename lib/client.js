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
  id: 'dsh-image-studio',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const NS = 'image-studio'
    const API = '/image-studio'
    const STYLE_ID = 'dsh-image-studio-styles'
    const FALLBACK_PROVIDERS = ['agnes', 'openai', 'grok', 'openai-compatible']
    const MAX_REFERENCES = 5

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
  height: 100%; overflow: auto; box-sizing: border-box;
  display: flex; flex-direction: column;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 18px) 32px 24px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.is-page *, .is-page *::before, .is-page *::after { box-sizing: border-box; }
.is-shell { width: 100%; max-width: 1120px; margin: 0 auto; flex: 1 0 auto; display: flex; flex-direction: column; min-height: 0; }
.is-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.is-head-main { display: flex; align-items: flex-start; gap: 14px; min-width: 0; }
.is-logo {
  width: 42px; height: 42px; border-radius: 12px; flex: none; display: grid; place-items: center;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
}
.is-eyebrow { font-size: 10px; letter-spacing: .18em; font-weight: 700; color: var(--dsw-alias-label-secondary); margin: 1px 0 4px; }
.is-title { margin: 0; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.01em; }
.is-sub { margin: 5px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.is-head-actions { display: flex; align-items: center; gap: 8px; flex: none; padding-top: 2px; }
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
.is-providers {
  margin-top: 12px; width: max-content; max-width: 100%; display: flex; flex-wrap: wrap; gap: 4px; padding: 4px;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
}
.is-provider {
  border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary);
  height: 32px; padding: 0 10px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600;
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
.is-grid { margin-top: 14px; flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(300px, 390px) minmax(0, 1fr); gap: 16px; align-items: stretch; }
.is-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 16px; min-width: 0; display: flex; flex-direction: column; }
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
.is-select { cursor: pointer; }
.is-textarea { min-height: 110px; padding: 10px 12px; line-height: 1.6; resize: vertical; }
.is-prompt-card .is-prompt-field { flex: 0 0 auto; min-height: 0; display: flex; flex-direction: column; }
.is-prompt-card .is-textarea { flex: none; height: 90px; min-height: 90px; resize: none; }
.is-input:focus, .is-select:focus, .is-textarea:focus {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
}
.is-textarea::placeholder, .is-input::placeholder { color: var(--dsw-alias-state-idle-primary); }
.is-reference { flex: 0 0 auto; min-height: 0; margin-bottom: 11px; display: flex; flex-direction: column; }
.is-reference-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.is-reference-head .is-label { margin-bottom: 0; }
.is-reference-actions { display: flex; align-items: center; gap: 2px; }
.is-reference-stage {
  position: relative; flex: none; height: 82px; min-height: 82px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-base); overflow: hidden; display: flex; align-items: center; justify-content: center;
}
.is-reference-stage.has-images { border-style: solid; justify-content: flex-start; gap: 6px; padding: 6px 8px; overflow-x: auto; overflow-y: hidden; }
.is-reference-stage.is-disabled { opacity: .55; }
.is-reference-item { position: relative; flex: 0 0 auto; width: 56px; height: 56px; border-radius: 7px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.is-reference-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.is-reference-remove {
  position: absolute; top: 2px; right: 2px; width: 17px; height: 17px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; font-size: 12px; line-height: 1; color: #fff; background: rgba(0, 0, 0, .58); cursor: pointer;
}
.is-reference-add {
  flex: 0 0 auto; width: 56px; height: 56px; padding: 0; border-radius: 7px; border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-secondary); font-size: 20px; line-height: 1; cursor: pointer;
}
.is-reference-add:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l3); }
.is-reference-empty {
  width: 100%; height: 100%; min-height: 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px; padding: 0 10px; cursor: pointer; font: inherit; text-align: left;
}
.is-reference-empty:disabled { cursor: not-allowed; }
.is-reference-plus { width: 30px; height: 30px; border-radius: 50%; border: 1px dashed var(--dsw-alias-border-l2); display: grid; place-items: center; font-size: 18px; line-height: 1; color: var(--dsw-alias-label-secondary); }
.is-reference-empty-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.is-reference-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.is-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 9px; }
.is-fields .is-field { margin-bottom: 0; }
.is-span2 { grid-column: 1 / -1; }
.is-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.is-actions .is-btn-primary { flex: 1; height: 38px; }
.is-kbd { font-size: 10.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.is-studio { display: flex; flex-direction: column; min-height: 0; }
.is-result-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.is-result-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.is-tag { padding: 2px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.is-canvas {
  position: relative; flex: 1 1 auto; min-height: 260px;
  border-radius: 11px; display: flex; align-items: center; justify-content: center;
  padding: 12px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.is-canvas img { position: relative; z-index: 1; max-width: 100%; max-height: 100%; border-radius: 8px; display: block; box-shadow: 0 14px 44px rgba(0,0,0,.22); }
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
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1);
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary);
}
.is-tips-title { font-size: 11px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.is-tips-code { flex: none; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; line-height: 1.6; white-space: nowrap; }
.is-tips-note { color: var(--dsw-alias-label-secondary); }
.is-history { margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.is-history .is-card-head { margin-bottom: 7px; }
.is-history-list { display: flex; gap: 8px; overflow-x: auto; padding: 1px 1px 4px; }
.is-thumb { width: 58px; flex: none; padding: 0; border-radius: 9px; overflow: hidden; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); position: relative; aspect-ratio: 1; }
.is-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.is-thumb:hover { border-color: var(--dsw-alias-brand-primary); }
.is-thumb-time { position: absolute; right: 3px; bottom: 3px; font-size: 9px; padding: 1px 4px; border-radius: 5px; background: rgba(0,0,0,.55); color: #fff; }
.is-history-empty { font-size: 11.5px; color: var(--dsw-alias-label-secondary); padding: 3px 0 0; }
.is-modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 28px; background: rgba(8,10,16,.38); backdrop-filter: blur(3px); }
.is-modal-card { width: 480px; max-width: 100%; max-height: 88vh; overflow: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; padding: 20px; box-shadow: 0 26px 80px rgba(0,0,0,.32); }
.is-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.is-modal-title { margin: 0; font-size: 15px; font-weight: 650; }
.is-modal-sub { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.is-note { font-size: 10.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); margin: 4px 0 0; }
.is-key-link { display: flex; align-items: center; gap: 8px; margin-top: 7px; }
.is-key-link .is-note { margin: 0; text-decoration: underline; text-underline-offset: 2px; }
.is-modal-actions { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
.is-modal-actions .is-spacer { flex: 1; }
.is-close { width: 28px; height: 28px; border-radius: 8px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 18px; line-height: 1; }
.is-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.is-error-text { font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); margin: 10px 0 0; white-space: pre-wrap; }
.is-command { margin: 2px 0; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; padding: 12px; max-width: 560px; }
.is-command img { display: block; max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 8px; }
.is-command-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.is-command-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
.is-command-hint { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
@media (max-width: 900px) {
  .is-page { padding: calc(var(--dsh-frame-top-clearance, 0px) + 18px) 16px 30px; }
  .is-grid { grid-template-columns: 1fr; }
  .is-head { flex-direction: column; }
  .is-head-actions { width: 100%; }
  .is-canvas { min-height: 240px; }
}
@media (prefers-reduced-motion: reduce) {
  .is-skeleton { animation: none; }
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

    function loadImageElement(src) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('参考图解码失败，请换一张 PNG/JPEG/WebP。'))
        image.src = src
      })
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

    function StudioPage() {
      const [status, setStatus] = React.useState(null)
      const [statusError, setStatusError] = React.useState('')
      const [history, setHistory] = React.useState([])
      const [activeId, setActiveId] = React.useState(FALLBACK_PROVIDERS[0])
      const [prompt, setPrompt] = React.useState('')
      const [model, setModel] = React.useState('')
      const [size, setSize] = React.useState('')
      const [ratio, setRatio] = React.useState('')
      const [quality, setQuality] = React.useState('')
      const [generating, setGenerating] = React.useState(false)
      const [error, setError] = React.useState('')
      const [references, setReferences] = React.useState([])
      const [result, setResult] = React.useState(null)
      const [imageSize, setImageSize] = React.useState(null)
      const [setupOpen, setSetupOpen] = React.useState(false)
      const [setupProviderId, setSetupProviderId] = React.useState('')
      const [setupDraft, setSetupDraft] = React.useState({
        apiKey: '', baseUrl: '', endpointPath: '', model: '', size: '', ratio: '', quality: '',
      })
      const [setupBusy, setSetupBusy] = React.useState(false)
      const [setupError, setSetupError] = React.useState('')
      const [copied, setCopied] = React.useState('')
      const mounted = React.useRef(true)
      const fileInputRef = React.useRef(null)

      React.useEffect(() => () => { mounted.current = false }, [])

      const providers = status && Array.isArray(status.providers) ? status.providers : []
      const active = providers.find((item) => item.id === activeId) || providers[0]
      const versionLabel = status && status.version ? `IMAGE WORKBENCH · v${status.version}` : 'IMAGE WORKBENCH'

      const syncForm = React.useCallback((provider) => {
        if (!provider) return
        const nextModel = provider.model || (provider.models && provider.models[0]) || ''
        const sizes = sizesFor(provider, nextModel)
        const qualities = qualitiesFor(provider, nextModel)
        setModel(nextModel)
        setSize(sizes.includes(provider.size) ? provider.size : (sizes[0] || ''))
        setRatio(provider.supportsRatio ? (provider.ratio || (provider.ratios && provider.ratios[0]) || '') : '')
        setQuality(provider.supportsQuality ? (qualities.includes(provider.quality) ? provider.quality : (qualities[0] || '')) : '')
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
        const sizes = sizesFor(active, nextModel)
        if (!sizes.includes(size)) setSize(sizes[0] || '')
        const qualities = qualitiesFor(active, nextModel)
        if (qualities.length === 0) setQuality('')
        else if (!qualities.includes(quality)) setQuality(qualities[0])
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
        })
        setSetupError('')
        setSetupOpen(true)
      }, [status, activeId, active])

      const setupProvider = providerById(status, setupProviderId) || active

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
          if (setupProvider.supportsRatio) body.ratio = setupDraft.ratio
          if (setupProvider.supportsQuality) body.quality = setupDraft.quality
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
      }, [setupProvider, setupDraft, activeId, syncForm])

      const generate = React.useCallback(async () => {
        if (!active) return
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
          if (active.supportsRatio) body.ratio = ratio
          if (active.supportsQuality) body.quality = quality
          if (references.length > 0) body.referenceImages = references.map((item) => item.dataUrl)
          const value = await api('/generate', { method: 'POST', body: JSON.stringify(body) })
          if (!mounted.current) return
          setResult(value)
          setImageSize(null)
          refreshHistory()
        } catch (failure) {
          if (!mounted.current) return
          const message = failure instanceof Error ? failure.message : String(failure)
          setError(message)
          if (failure && failure.code === 'unconfigured') openSetup(failure.provider || active.id)
        } finally {
          if (mounted.current) setGenerating(false)
        }
      }, [active, prompt, model, size, ratio, quality, references, refreshHistory, openSetup])

      const onKeyDown = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          if (!generating) generate()
        }
      }

      const copyPath = async () => {
        if (!result || !result.filePath) return
        try {
          await navigator.clipboard.writeText(result.filePath)
          setCopied('已复制')
          window.setTimeout(() => setCopied(''), 1600)
        } catch {
          setCopied('复制失败')
        }
      }

      const referenceSupported = !(active && active.id === 'openai' && /^dall-e-3$/i.test(model))
      const loadReferences = async (files) => {
        const list = Array.from(files || []).filter((file) => file && typeof file === 'object')
        if (list.length === 0) return
        if (!referenceSupported) {
          setError('DALL·E 3 不支持参考图编辑，请切换到 gpt-image 系列模型。')
          return
        }
        const room = MAX_REFERENCES - references.length
        if (room <= 0) {
          setError(`参考图最多 ${MAX_REFERENCES} 张，先移除一张再添加。`)
          return
        }
        setError(list.length > room ? `参考图最多 ${MAX_REFERENCES} 张，只添加前 ${room} 张。` : '')
        const prepared = []
        for (const file of list.slice(0, room)) {
          try {
            prepared.push(await prepareReferenceFile(file))
          } catch (failure) {
            if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
          }
        }
        if (prepared.length > 0 && mounted.current) {
          setReferences((current) => [...current, ...prepared].slice(0, MAX_REFERENCES))
        }
      }
      const pickReference = () => {
        if (!referenceSupported) {
          setError('DALL·E 3 不支持参考图编辑，请切换到 gpt-image 系列模型。')
          return
        }
        if (references.length >= MAX_REFERENCES) {
          setError(`参考图最多 ${MAX_REFERENCES} 张，先移除一张再添加。`)
          return
        }
        if (fileInputRef.current) fileInputRef.current.click()
      }
      const onReferenceChange = async (event) => {
        const files = event.target.files
        event.target.value = ''
        await loadReferences(files)
      }
      const onReferenceDrop = async (event) => {
        event.preventDefault()
        await loadReferences(event.dataTransfer && event.dataTransfer.files)
      }
      const removeReference = (index) => setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))
      const clearReferences = () => setReferences([])

      if (statusError !== '') {
        return h('div', { className: 'is-page' },
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
        return h('div', { className: 'is-page' },
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

      const modelOptions = modelsFor(active)
      const sizeOptions = sizesFor(active, model)
      const qualityOptions = qualitiesFor(active, model)

      return h('div', { className: 'is-page' },
        h('div', { className: 'is-shell' },
          h('div', { className: 'is-head' },
            h('div', { className: 'is-head-main' },
              h('div', { className: 'is-logo' }, icon(22)),
              h('div', {},
                h('div', { className: 'is-eyebrow' }, versionLabel),
                h('h1', { className: 'is-title' }, '生图工作台'),
                h('p', { className: 'is-sub' }, 'Agnes / GPT Image / Grok / OpenAI 兼容 · 每个服务商独立 Key · 侧边栏与 /image 双入口'),
              ),
            ),
            h('div', { className: 'is-head-actions' },
              h('span', { className: 'is-chip', title: active.keySource === 'env' ? '来自环境变量' : '保存在本机插件目录' },
                h('span', { className: 'is-dot' + (active.configured ? ' ok' : '') }),
                active.configured ? `${active.shortLabel} Key 已配置 · ${active.masked}` : `${active.shortLabel} Key 未配置`,
              ),
              h('button', { className: 'is-btn is-btn-ghost', onClick: () => openSetup(active.id) }, '配置'),
            ),
          ),

          h('div', { className: 'is-providers' },
            providers.map((provider) => h('button', {
              key: provider.id,
              className: 'is-provider' + (provider.id === active.id ? ' active' : ''),
              onClick: () => selectProvider(provider.id),
              title: provider.description,
            },
              h('span', { className: 'is-provider-dot' + (provider.configured ? ' ok' : '') }),
              provider.shortLabel || provider.label,
            )),
          ),

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
                h('span', { className: 'is-card-hint' }, 'Ctrl / ⌘ + Enter 生成'),
              ),
              h('div', { className: 'is-field is-prompt-field' },
                h('div', { className: 'is-label' },
                  h('span', {}, '画面描述'),
                  h('span', { className: 'is-count' }, `${prompt.length} / 4000`),
                ),
                h('textarea', {
                  className: 'is-textarea',
                  value: prompt,
                  maxLength: 4000,
                  placeholder: '例如：雨夜的霓虹街道，湿润路面反射灯光，电影感广角，青橙色调，高细节',
                  onChange: (event) => setPrompt(event.target.value),
                  onKeyDown,
                  'aria-label': '画面描述',
                }),
              ),
              h('div', { className: 'is-reference' },
                h('div', { className: 'is-reference-head' },
                  h('div', { className: 'is-label' },
                    h('span', {}, '参考图'),
                    h('span', { className: 'is-count' },
                      !referenceSupported
                        ? 'DALL·E 3 不支持参考图'
                        : (references.length > 0
                          ? `图生图 · ${references.length}/${MAX_REFERENCES} 张`
                          : `可选 · 图生图 · 最多 ${MAX_REFERENCES} 张`)),
                  ),
                  h('div', { className: 'is-reference-actions' },
                    h('button', {
                      className: 'is-btn is-btn-ghost is-btn-sm',
                      onClick: pickReference,
                      disabled: !referenceSupported || references.length >= MAX_REFERENCES,
                      title: referenceSupported
                        ? (references.length >= MAX_REFERENCES ? `最多 ${MAX_REFERENCES} 张` : '选择一张或多张参考图')
                        : 'DALL·E 3 不支持参考图',
                    }, references.length > 0 ? '继续添加' : '添加参考图'),
                    references.length > 0 ? h('button', {
                      className: 'is-btn is-btn-quiet is-btn-sm',
                      onClick: clearReferences,
                    }, '清空') : null,
                  ),
                ),
                h('div', {
                  className: 'is-reference-stage' + (references.length > 0 ? ' has-images' : '') + (referenceSupported ? '' : ' is-disabled'),
                  onDragOver: (event) => event.preventDefault(),
                  onDrop: onReferenceDrop,
                },
                  references.length > 0
                    ? [
                      ...references.map((item, index) => h('div', {
                        className: 'is-reference-item',
                        key: `reference-${index}`,
                        title: `${item.name} · ${item.width}×${item.height}`,
                      },
                        h('img', { src: item.dataUrl, alt: item.name }),
                        h('button', {
                          className: 'is-reference-remove',
                          onClick: () => removeReference(index),
                          title: '移除此参考图',
                        }, '×'),
                      )),
                      referenceSupported && references.length < MAX_REFERENCES
                        ? h('button', {
                          className: 'is-reference-add',
                          key: 'reference-add',
                          onClick: pickReference,
                          title: '继续添加参考图',
                        }, '+')
                        : null,
                    ]
                    : h('button', {
                      className: 'is-reference-empty',
                      onClick: pickReference,
                      disabled: !referenceSupported,
                    },
                      h('div', { className: 'is-reference-plus' }, '+'),
                      h('div', { className: 'is-reference-empty-title' }, referenceSupported ? '添加参考图' : '当前模型不支持参考图'),
                      h('div', { className: 'is-reference-hint' }, referenceSupported ? `PNG / JPEG / WebP，可拖入；最多 ${MAX_REFERENCES} 张，用于图生图` : '切换到 gpt-image 系列模型'),
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
                h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '尺寸')),
                  h('select', {
                    className: 'is-select',
                    value: size,
                    onChange: (event) => setSize(event.target.value),
                    'aria-label': '尺寸',
                  }, sizeOptions.map((item) => h('option', { key: item, value: item }, item))),
                ),
                active.supportsRatio ? h('div', { className: 'is-field' },
                  h('div', { className: 'is-label' }, h('span', {}, '比例')),
                  h('select', {
                    className: 'is-select',
                    value: ratio,
                    onChange: (event) => setRatio(event.target.value),
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
              ),
              error === '' ? null : h('div', { className: 'is-banner error' },
                h('div', { className: 'is-banner-main' }, error),
                (error.includes('Key') || error.includes('鉴权') || error.includes('401'))
                  ? h('button', { className: 'is-btn is-btn-ghost', onClick: () => openSetup(active.id) }, '检查 Key')
                  : null,
              ),
              h('div', { className: 'is-actions' },
                h('button', {
                  className: 'is-btn is-btn-primary',
                  onClick: generate,
                  disabled: generating || prompt.trim() === '' || (references.length > 0 && !referenceSupported),
                  title: references.length > 0 && !referenceSupported ? 'DALL·E 3 不支持参考图，请切换模型或清空参考图' : undefined,
                }, generating ? '生成中…' : '生成图片'),
                h('span', { className: 'is-kbd' }, generating ? '通常需要 10–60 秒' : '结果会自动保存到本机'),
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
                h('div', { className: 'is-result-meta' },
                  result
                    ? [
                      h('span', { key: 'p', className: 'is-tag' }, result.providerLabel || result.provider || ''),
                      h('span', { key: 'm', className: 'is-tag' }, result.model),
                      h('span', { key: 's', className: 'is-tag' }, result.size),
                      result.ratio ? h('span', { key: 'r', className: 'is-tag' }, result.ratio) : null,
                      result.quality ? h('span', { key: 'q', className: 'is-tag' }, result.quality) : null,
                      result.referenceCount > 0 ? h('span', { key: 'ref', className: 'is-tag' }, `参考图 ${result.referenceCount}`) : null,
                      h('span', { key: 't' }, `${(result.elapsedMs / 1000).toFixed(1)}s`),
                      imageSize ? h('span', { key: 'd' }, `${imageSize.w} × ${imageSize.h}`) : null,
                    ].filter(Boolean)
                    : h('span', {}, '结果'),
                ),
                result
                  ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
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
                    h('div', { className: 'is-empty-title' }, '正在生成'),
                    h('div', { className: 'is-empty-text' }, `${active.label} 正在绘制，完成后会自动显示在这里。`),
                  )
                  : result
                    ? [
                      h(DotField, { key: 'static', animated: false }),
                      h('img', {
                        key: 'result',
                        src: result.url,
                        alt: result.prompt || '生成的图片',
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
                    history.map((item) => h('button', {
                      key: item.id,
                      className: 'is-thumb',
                      title: `${item.providerLabel || item.provider || ''} · ${item.prompt || item.id}`,
                      onClick: () => {
                        setResult(item)
                        setImageSize(null)
                      },
                    },
                      h('img', { src: item.url, alt: item.prompt || '历史图片', loading: 'lazy' }),
                      h('span', { className: 'is-thumb-time' }, formatTime(item.createdAt)),
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
              }, '×'),
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
                  })
                  setSetupError('')
                },
              },
                h('span', { className: 'is-provider-dot' + (provider.configured ? ' ok' : '') }),
                provider.shortLabel || provider.label,
              )),
            ),
            h('div', { style: { height: 14 } }),
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
              h('div', { className: 'is-label' }, h('span', {}, '默认模型')),
              h('input', {
                className: 'is-input',
                type: 'text',
                value: setupDraft.model,
                placeholder: setupProvider.modelDefault,
                onChange: (event) => setSetupDraft({ ...setupDraft, model: event.target.value }),
              }),
            ),
            h('div', { className: 'is-fields' },
              h('div', { className: 'is-field' },
                h('div', { className: 'is-label' }, h('span', {}, '默认尺寸')),
                h('select', {
                  className: 'is-select',
                  value: setupDraft.size,
                  onChange: (event) => setSetupDraft({ ...setupDraft, size: event.target.value }),
                }, sizesFor(setupProvider, setupDraft.model).map((item) => h('option', { key: item, value: item }, item))),
              ),
              setupProvider.supportsRatio ? h('div', { className: 'is-field' },
                h('div', { className: 'is-label' }, h('span', {}, '默认比例')),
                h('select', {
                  className: 'is-select',
                  value: setupDraft.ratio,
                  onChange: (event) => setSetupDraft({ ...setupDraft, ratio: event.target.value }),
                }, (setupProvider.ratios || []).map((item) => h('option', { key: item, value: item }, item))),
              ) : null,
              setupProvider.supportsQuality && qualitiesFor(setupProvider, setupDraft.model).length > 0 ? h('div', { className: 'is-field' },
                h('div', { className: 'is-label' }, h('span', {}, '默认质量')),
                h('select', {
                  className: 'is-select',
                  value: setupDraft.quality,
                  onChange: (event) => setSetupDraft({ ...setupDraft, quality: event.target.value }),
                }, qualitiesFor(setupProvider, setupDraft.model).map((item) => h('option', { key: item, value: item }, item))),
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
            }, StudioPage)
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
    }

    module.exports = { name: 'image-studio', apply, inject: [] }
    return module.exports
  },
})
