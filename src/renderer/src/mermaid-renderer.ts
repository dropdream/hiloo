let queue: Promise<unknown> = Promise.resolve()
let sequence = 0

// Rendering is serialized because Mermaid shares configuration and diagram state.
export function renderMermaid(source: string): Promise<string> {
  const job = queue.then(async () => {
    if (source.length > 24000) throw new Error('El flujo supera el límite de 24 000 caracteres.')
    if (source.split(/[\n;]/).filter((line) => line.trim() && !line.trimStart().startsWith('%%')).length > 200) {
      throw new Error('El flujo supera el límite de 200 líneas o instrucciones.')
    }
    if (/%%\s*\{/.test(source) || /^\s*---(?:\r?\n|$)/.test(source)) {
      throw new Error('Las directivas y la configuración Mermaid no están permitidas.')
    }
    // Extended YAML node metadata can hide image keys behind quoted/escaped names.
    // Keep the supported flow syntax free of assets before Mermaid measures nodes.
    const cssTokens = source.replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, hex: string) => {
      const value = Number.parseInt(hex, 16)
      return value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd'
    }).replace(/\\([^\r\n])/g, '$1')
    if (/@\s*\{/.test(source) || /\burl\s*\(/i.test(cssTokens)) {
      throw new Error('Las imágenes, los iconos y los recursos externos Mermaid no están permitidos.')
    }
    const header = source.replace(/^\s*%%[^\n]*(?:\n|$)/gm, '').trimStart()
    if (!/^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/.test(header)) {
      throw new Error('Solo se muestran flujos Mermaid con flowchart o graph y una dirección TB, TD, BT, RL o LR.')
    }
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      maxTextSize: 24000,
      maxEdges: 200,
      theme: 'default',
      layout: 'dagre',
      fontFamily: 'Segoe UI, sans-serif',
      flowchart: { htmlLabels: false, useMaxWidth: true },
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels', 'flowchart', 'theme', 'themeVariables', 'themeCSS', 'fontFamily', 'layout', 'dompurifyConfig']
    })
    const staging = document.createElement('div')
    staging.className = 'mermaid-staging'
    staging.setAttribute('aria-hidden', 'true')
    staging.inert = true
    document.body.append(staging)
    try {
      const { svg } = await mermaid.render(`hiloo-mermaid-${++sequence}`, source, staging)
      // An image document cannot run diagram callbacks or navigate the editor.
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    } finally { staging.remove() }
  })
  queue = job.catch(() => {})
  return job
}
