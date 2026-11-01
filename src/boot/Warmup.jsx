import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useFlight } from '../state/useFlight.js'
import { bootScreen } from './bootScreen.js'
import { loadLog } from './loadLog.js'
import { loadLater } from './assets.js'

// Mounted inside each canvas's <Suspense>, so it runs once that canvas's
// files are in. Compiles every shader up front and draws a few frames behind
// the boarding pass. "Begin pre-flight" unlocks when every canvas listed in
// CANVASES is warm, so it never opens onto a freeze or a blank sky.

export const DOWNLOAD_SHARE = 0.85 // of the loading bar; the rest is warm-up
const CANVASES = ['sky']
const warm = new Set()

// Between "files downloaded" and the sky scene mounting: parsing the model,
// decoding textures and building the scene
let building = null
export const startBuilding = () => (building = loadLog.start('parse model + build scene'))

export function Warmup({ canvas }) {
  const { gl, scene, camera } = useThree()
  const frames = useRef(-1)
  const drawing = useRef(null)
  const main = canvas === 'sky'

  useEffect(() => {
    let cancelled = false
    if (main) {
      building?.()
      building = null
      bootScreen.progress(DOWNLOAD_SHARE, 'Preparing the aircraft')
    }
    const compiled = loadLog.start(`compile shaders (${canvas})`)
    Promise.resolve(gl.compileAsync?.(scene, camera))
      .catch(() => {})
      .then(() => {
        if (cancelled) return
        compiled()
        if (main) bootScreen.progress(0.95, 'Preparing the aircraft')
        drawing.current = loadLog.start(`draw first 3 frames (${canvas})`)
        frames.current = 0
      })
    return () => {
      cancelled = true
    }
  }, [gl, scene, camera, canvas, main])

  useFrame(() => {
    if (frames.current < 0 || ++frames.current !== 3) return
    drawing.current?.()
    warm.add(canvas)
    if (CANVASES.every((c) => warm.has(c))) {
      loadLog.done()
      bootScreen.progress(1, 'Ready')
      useFlight.getState().markReady()
      loadLater()
    }
  })
  return null
}
