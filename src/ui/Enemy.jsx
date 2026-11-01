import { useEffect, useRef } from 'react'
import { useFlight } from '../state/useFlight.js'
import { assetUrl } from '../boot/assets.js'

// An enemy from Constellar, about a second after its card: flat pixel art
// laid over the 3D world, like Galaga's. It flies in from off the right edge,
// then patrols the right side, bouncing straight up and down between the top
// of the screen and the top of the dashboard at a steady speed. It's fixed
// to the screen, not the world, scaled up in whole pixels (about a tenth of
// the screen wide) and moves on its own pixel grid, so it stays crisp and
// steps like the game.

const SRC = '/images/enemy.webp' // already turned to face left
const SPRITE_W = 52
const SPRITE_H = 60
const SHOWN = new Set(['enemy', 'fire', 'done'])
const ENTRY = 1.1 // seconds to fly in
const CROSSING = 1.7 // seconds from top to bottom
const MARGIN = 0.03 // of the screen's width, off the right edge

// How wide it is on a screen this wide, in CSS pixels: about a tenth, in whole sprite pixels
export const enemyWidth = (screenWidth) => SPRITE_W * Math.max(1, Math.round((screenWidth * 0.1) / SPRITE_W))
// The lane it patrols, measured from the right edge: the Constellar card keeps out of it
export const enemyLane = (screenWidth) => enemyWidth(screenWidth) + screenWidth * MARGIN + 16

const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const easeOut = (t) => 1 - (1 - t) ** 3

export function Enemy() {
  const phase = useFlight((s) => s.phase)
  const shown = SHOWN.has(phase)
  const ref = useRef(null)

  // Warm the sprite up while the plane's still drifting
  useEffect(() => {
    if (phase === 'drift') new Image().src = assetUrl(SRC)
  }, [phase])

  useEffect(() => {
    if (!shown) return
    const el = ref.current
    const sky = el.parentElement
    const start = performance.now()
    let raf = 0
    const frame = (now) => {
      const t = (now - start) / 1000
      const W = sky.clientWidth
      const H = sky.clientHeight
      const w = enemyWidth(W)
      const scale = w / SPRITE_W
      const h = SPRITE_H * scale
      el.style.width = `${w}px`
      el.style.height = `${h}px`

      // In from off the right edge, easing onto its patrol line
      const restX = W - W * MARGIN - w
      const x = W + (restX - W) * easeOut(Math.min(1, t / ENTRY))

      // Up and down at a steady speed, turning sharply at each end. It
      // starts in the middle, heading up
      const pad = Math.max(8, H * 0.03)
      const travel = Math.max(1, H - h - 2 * pad)
      const speed = (travel / CROSSING) * (reducedMotion ? 0.4 : 1)
      const d = (1.5 * travel + t * speed) % (2 * travel) // 0 → travel heading down, travel → 2·travel heading up
      const y = pad + (d < travel ? d : 2 * travel - d)

      // On its own pixel grid
      el.style.transform = `translate3d(${Math.round(x / scale) * scale}px, ${Math.round(y / scale) * scale}px, 0)`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [shown])

  return <img ref={ref} className={`enemy${shown ? ' is-shown' : ''}`} src={assetUrl(SRC)} alt="" aria-hidden="true" decoding="async" />
}
