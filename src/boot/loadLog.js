// Timing for every loading stage, measured from the moment the page started
// navigating. Printed to the console as one summary plus a table (in dev, or in
// production with ?loadlog), and kept on window.__loadReport for testing.

const t0 = 0 // performance.now() is already relative to navigation start
const stages = []
const files = []
const open = new Map()

const now = () => performance.now()
const verbose = import.meta.env.DEV || new URLSearchParams(location.search).has('loadlog')

export const loadLog = {
  // A point in time, e.g. "bundle running"
  mark(name) {
    stages.push({ stage: name, at: Math.round(now() - t0) })
  },

  // A span, e.g. "compile shaders". Call the returned function when it ends.
  start(name) {
    const begin = now()
    open.set(name, begin)
    return () => {
      open.delete(name)
      stages.push({ stage: name, at: Math.round(begin - t0), took: Math.round(now() - begin) })
    }
  },

  file(url, { begin, end, bytes, skipped }) {
    files.push({
      file: url.split('/').pop(),
      at: Math.round(begin - t0),
      took: Math.round(end - begin),
      kb: Math.round(bytes / 1024),
      skipped: !!skipped,
    })
  },

  done() {
    const nav = performance.getEntriesByType('navigation')[0]
    const scripts = performance
      .getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'script' || /\.(js|jsx|mjs)(\?|$)/.test(e.name))
    const report = {
      total: Math.round(now() - t0),
      htmlReceived: nav ? Math.round(nav.responseEnd) : null,
      // When the boarding pass first appeared on screen
      firstPaint: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1),
      scripts: { count: scripts.length, kb: Math.round(scripts.reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0) / 1024) },
      stages: [...stages].sort((a, b) => a.at - b.at),
      files,
      downloadKb: files.reduce((s, f) => s + f.kb, 0),
    }
    window.__loadReport = report
    if (verbose) {
      console.groupCollapsed(
        `[load] ready in ${report.total} ms · ${report.downloadKb} KB of assets · ${report.scripts.count} scripts (${report.scripts.kb} KB)`,
      )
      console.table(report.stages)
      console.table(report.files)
      console.groupEnd()
    }
    return report
  },
}
