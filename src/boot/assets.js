// Everything a scene needs is downloaded here first, byte by byte, so the
// loading bar shows real progress. Each file is kept in memory as an object
// URL, and the 3D loaders read it from there instead of downloading again.

// Scene 1 has to be fully loaded before "Begin pre-flight" unlocks.
// `size` is only a guess for the bar until the server reports the real size.
// Files come out of `npm run optimize:assets`; edit the originals in assets-src/.
// Keep the <link rel="preload"> list in index.html in sync with this one.
const SCENE1 = [
  { url: '/models/trijet.glb', label: 'Loading aircraft', size: 1.7e6, optional: true },
  { url: '/textures/asphalt/asphalt_diff.webp', label: 'Loading runway', size: 200e3 },
  { url: '/textures/asphalt/asphalt_normal.webp', label: 'Loading runway', size: 205e3 },
  { url: '/textures/asphalt/asphalt_arm.webp', label: 'Loading runway', size: 16e3 },
]

// Later scenes download quietly in the background while scene 1 plays.
// Add each new scene's files here so the first wait never grows.
const LATER = []

import { DRACOLoader } from 'three-stdlib'
import { loadLog } from './loadLog.js'

// The plane's geometry is Draco-compressed. The decoder is served from our own
// site and starts loading alongside the files below, so it's ready to go.
export const dracoLoader = new DRACOLoader().setDecoderPath('/draco/')

const objectUrls = new Map()

// The URL a loader should use: the in-memory copy if we have one.
export const assetUrl = (url) => objectUrls.get(url) ?? url

// Resolves to the object URL, or null for an optional file that isn't there.
async function fetchAsset(asset, onBytes) {
  const begin = performance.now()
  const res = await fetch(asset.url)
  const type = res.headers.get('content-type') || ''
  // Vite answers missing files with index.html, so check the type too
  if (!res.ok || type.includes('text/html')) {
    res.body?.cancel()
    loadLog.file(asset.url, { begin, end: performance.now(), bytes: 0, skipped: true })
    if (asset.optional) return null
    throw new Error(`Failed to load ${asset.url} (${res.status})`)
  }
  const total = Number(res.headers.get('content-length')) || asset.size
  onBytes(0, total)
  const reader = res.body.getReader()
  const chunks = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onBytes(loaded, Math.max(total, loaded))
  }
  loadLog.file(asset.url, { begin, end: performance.now(), bytes: loaded })
  const objectUrl = URL.createObjectURL(new Blob(chunks, { type }))
  objectUrls.set(asset.url, objectUrl)
  return objectUrl
}

let scene1
// onProgress(fraction 0–1, label). Safe to call twice (React StrictMode does).
export function loadScene1(onProgress) {
  scene1 ??= (async () => {
    const downloaded = loadLog.start('download scene 1 files')
    dracoLoader.preload()
    const state = SCENE1.map((a) => ({ asset: a, loaded: 0, total: a.size, done: false }))
    const report = () => {
      const total = state.reduce((s, x) => s + x.total, 0)
      const loaded = state.reduce((s, x) => s + x.loaded, 0)
      const current = state.find((x) => !x.done)
      onProgress(total ? loaded / total : 1, current ? current.asset.label : 'Loading')
    }
    report()
    const results = await Promise.all(
      state.map(async (x) => {
        const url = await fetchAsset(x.asset, (loaded, total) => {
          x.loaded = loaded
          x.total = total
          report()
        })
        if (url === null) x.total = x.loaded = 0 // optional and missing: drop it from the bar
        x.done = true
        report()
        return url
      }),
    )
    downloaded()
    return { modelUrl: results[0] }
  })()
  return scene1
}

export function loadLater() {
  return Promise.allSettled(LATER.map((a) => fetchAsset(a, () => {})))
}
