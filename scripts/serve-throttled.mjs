// Serves the production build (dist/) the way a real host would — gzipped
// text, correct content types — but over a slow, uncached connection, so you
// can feel and measure a first visit.
//
//   npm run build && npm run preview:slow            (20 Mbps, 40 ms latency)
//   MBPS=5 LATENCY=80 npm run preview:slow           (rough 4G)

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve('dist')
const PORT = Number(process.env.PORT || 4174)
const MBPS = Number(process.env.MBPS || 20)
const LATENCY = Number(process.env.LATENCY || 40)
const BYTES_PER_MS = (MBPS * 1e6) / 8 / 1000

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm'])

// One shared pipe: parallel downloads split the bandwidth like a real connection
let pipeFreeAt = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function send(res, body) {
  const CHUNK = 16 * 1024
  for (let i = 0; i < body.length; i += CHUNK) {
    const chunk = body.subarray(i, i + CHUNK)
    const start = Math.max(Date.now(), pipeFreeAt)
    pipeFreeAt = start + chunk.length / BYTES_PER_MS
    await sleep(pipeFreeAt - Date.now())
    if (!res.write(chunk)) await new Promise((r) => res.once('drain', r))
  }
  res.end()
}

http
  .createServer(async (req, res) => {
    await sleep(LATENCY)
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = path.join(ROOT, url)
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html') // SPA fallback, like Vite
    }
    const ext = path.extname(file)
    let body = fs.readFileSync(file)
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = zlib.gzipSync(body, { level: 6 })
      headers['Content-Encoding'] = 'gzip'
    }
    headers['Content-Length'] = body.length
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    await send(res, body)
  })
  .listen(PORT, () => console.log(`dist/ at ${MBPS} Mbps, ${LATENCY} ms latency → http://localhost:${PORT}`))
