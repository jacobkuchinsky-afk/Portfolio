// Drives the boarding pass in index.html, which doubles as the loading screen.
// It's plain HTML so it paints before any JavaScript arrives; this module
// takes it over once the bundle runs.

const $ = (id) => document.getElementById(id)

let shown = 0

export const bootScreen = {
  // fraction 0–1. Never moves backwards, so the bar can't jitter.
  progress(fraction, label) {
    shown = Math.max(shown, Math.min(1, fraction))
    const pct = Math.round(shown * 100)
    $('boot-bar').style.transform = `scaleX(${shown})`
    $('boot-progress').setAttribute('aria-valuenow', String(pct))
    $('boot-status').textContent = `${label} · ${pct}%`
  },

  ready(onBegin) {
    $('boot-loader').hidden = true
    $('boot-progress').hidden = true
    $('boot-status').hidden = true
    $('boot-hint').hidden = false
    const button = $('boot-begin')
    button.hidden = false
    button.onclick = onBegin
  },

  failed() {
    $('boot-loader').hidden = true
    $('boot-status').textContent = "Couldn't load the flight. Check your connection and refresh."
  },

  hide() {
    $('boot').classList.add('is-gone')
    $('boot').setAttribute('aria-hidden', 'true')
  },
}
