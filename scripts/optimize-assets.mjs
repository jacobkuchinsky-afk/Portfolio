// Turns the originals in assets-src/ into the small, web-ready files the site
// loads from public/. Rerun whenever a model or texture changes:
//
//   npm run optimize:assets
//
// Models: textures to WebP (each map sized to how large it shows on screen),
// geometry Draco-compressed. Draco rather than meshopt because meshopt's
// quantization moves node origins, which breaks the fans' and gear's pivots.

import fs from 'node:fs'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, draco, textureCompress } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import sharp from 'sharp'

const MODELS = [
  {
    src: 'assets-src/models/trijet.glb',
    out: 'public/models/trijet.glb',
    // [texture-name pattern, max size]. First match wins.
    textures: [
      [/_ORM$/, 1024], // shadowing / roughness / metalness: soft, low detail
      [/^T_Detail_/, 1024], // gear and engine parts: small on screen
      [/.*/, 2048], // paint and wing colors: the livery stays sharp
    ],
  },
  {
    src: 'assets-src/models/dashboard-kit.glb',
    out: 'public/models/dashboard-kit.glb',
    textures: [], // already small WebPs from Blender
    // The dial faces and label plates have no texture in Blender (the site
    // paints them), so their UVs look unused. Keep them.
    keepAttributes: true,
  },
]

// `size` resizes to that many pixels square; omit to keep the original size
const TEXTURES = [
  { src: 'assets-src/textures/asphalt/asphalt_track_diff_1k.jpg', out: 'public/textures/asphalt/asphalt_diff.webp', quality: 80 },
  { src: 'assets-src/textures/asphalt/asphalt_track_nor_gl_1k.jpg', out: 'public/textures/asphalt/asphalt_normal.webp', quality: 88 },
  { src: 'assets-src/textures/asphalt/asphalt_track_arm_1k.jpg', out: 'public/textures/asphalt/asphalt_arm.webp', quality: 85 },
  // Cockpit panel paint: a seamless tile, repeated every half metre
  { src: 'assets-src/textures/panel/panel_basecolor.jpg', out: 'public/textures/panel/panel_basecolor.webp', quality: 82, size: 1024 },
  { src: 'assets-src/textures/panel/panel_normal.png', out: 'public/textures/panel/panel_normal.webp', quality: 90, size: 1024 },
  { src: 'assets-src/textures/panel/panel_orm.jpg', out: 'public/textures/panel/panel_orm.webp', quality: 85, size: 1024 },
  // Scene 3's Constellar art: pixel art, so lossless (lossy smears the pixel edges)
  { src: 'assets-src/images/constellar.png', out: 'public/images/constellar.webp', lossless: true },
  // The enemy from Constellar: turned to face left, and its soft (resampled)
  // edges made solid so it scales up as crisp pixels
  { src: 'assets-src/images/enemy.png', out: 'public/images/enemy.webp', lossless: true, rotate: 90, hardAlpha: true },
]

// three.js's Draco decoder, served from our own site instead of Google's CDN
const DRACO_FILES = ['draco_decoder.wasm', 'draco_wasm_wrapper.js']

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
})

for (const model of MODELS) {
  const doc = await io.read(model.src)
  await doc.transform(dedup(), prune({ keepAttributes: !!model.keepAttributes }))
  for (const [pattern, size] of model.textures) {
    const remaining = doc
      .getRoot()
      .listTextures()
      .filter((t) => t.getMimeType() !== 'image/webp' && pattern.test(t.getName()))
    if (!remaining.length) continue
    const names = new Set(remaining.map((t) => t.getName()))
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        quality: 85,
        resize: [size, size],
        pattern: new RegExp(`^(${[...names].join('|')})$`),
      }),
    )
  }
  await doc.transform(draco({ method: 'edgebreaker' }))
  await io.write(model.out, doc)
  console.log(`${model.src} (${kb(fs.statSync(model.src).size)}) → ${model.out} (${kb(fs.statSync(model.out).size)})`)
}

for (const t of TEXTURES) {
  let image = sharp(t.src)
  if (t.hardAlpha) {
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= 128 ? 255 : 0
    image = sharp(data, { raw: info })
  }
  if (t.rotate) image.rotate(t.rotate)
  if (t.size) image.resize(t.size, t.size)
  await image.webp(t.lossless ? { lossless: true, effort: 6 } : { quality: t.quality }).toFile(t.out)
  console.log(`${t.src} (${kb(fs.statSync(t.src).size)}) → ${t.out} (${kb(fs.statSync(t.out).size)})`)
}

const dracoSrc = 'node_modules/three/examples/jsm/libs/draco/gltf'
fs.mkdirSync('public/draco', { recursive: true })
for (const f of DRACO_FILES) fs.copyFileSync(path.join(dracoSrc, f), path.join('public/draco', f))
console.log(`Draco decoder → public/draco/ (${kb(DRACO_FILES.reduce((s, f) => s + fs.statSync(path.join(dracoSrc, f)).size, 0))})`)
