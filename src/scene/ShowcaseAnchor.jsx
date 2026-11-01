import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sim, BANK } from '../flight/sim.js'
import { planePose } from './Plane.jsx'
import { edgePoint, BAND_LOW, BAND_LOW_NARROW, BAND_HIGH, KEEP_CLEAR } from './wing.js'
import { showcaseLayout } from '../ui/Showcase.jsx'

const MARGIN = 20 // px from the screen edges
const GAP = 14 // px of sky between a card and the wing, all the way up
const MAX_CONTENT_W = 360 // px, widest a card's content gets
const STROKE = 3 // outline width, so the content sits inside it
const MIN_H = 330 // px, shortest a card gets when the screen has room

const pose = new THREE.Matrix4()
const v = new THREE.Vector3()
const a = new THREE.Vector3()

// Lays the two cards out around where the wing is right now, every frame,
// so it's always in the gap between them, whatever the camera does. (The
// plane is at full bank by the time they appear.) Each card leans with the wing:
// its inner side follows the wing's edge (trailing edge on the left, leading
// edge on the right) and its outer side runs parallel. Both get the same
// content width, sized to whichever side has less room.
export function ShowcaseAnchor() {
  useFrame(({ camera, size }) => {
    const layout = showcaseLayout
    // Only once the wing is well up; level, it's edge-on and there's no gap to lay out
    if (!layout.el || sim.roll / BANK < 0.5) return
    camera.updateMatrixWorld()
    planePose(pose, sim.x, sim.y, sim.pitch, sim.roll)
    const toScreen = (p) => {
      v.copy(p).applyMatrix4(pose).project(camera)
      return [(v.x * 0.5 + 0.5) * size.width, (0.5 - v.y * 0.5) * size.height]
    }
    const edge = (name) => {
      const [x1, y1] = toScreen(edgePoint(name, BAND_LOW, a))
      const [x2, y2] = toScreen(edgePoint(name, BAND_HIGH, a))
      // Above the tip there's no more wing: the edge holds the tip's x
      return { y1, y2, at: (y) => x1 + ((x2 - x1) * (Math.max(y, y2) - y1)) / (y2 - y1) }
    }
    const le = edge('le')
    const te = edge('te')
    const floor = size.width < size.height ? BAND_LOW_NARROW : BAND_LOW
    const bottom = (toScreen(edgePoint('le', floor, a))[1] + toScreen(edgePoint('te', floor, a))[1]) / 2
    // On tall narrow screens the wing is short on screen; the cards then
    // grow up past the tip rather than get too small to read
    const minH = Math.min(MIN_H, size.height * 0.62)
    const top = Math.max(MARGIN, Math.min((le.y2 + te.y2) / 2, bottom - minH))

    // Each card's inner side runs along the wing edge, GAP off it; its outer
    // side is parallel, so the card leans with the wing
    const leftIn = (y) => te.at(y) - GAP
    const rightIn = (y) => le.at(y) + GAP
    const leftSlant = Math.abs(leftIn(top) - leftIn(bottom))
    const rightSlant = Math.abs(rightIn(top) - rightIn(bottom))

    // Widest the content can be (the same in both cards): the screen edges,
    // and the tail, fuselage and engine wherever they rise into the band
    let content = MAX_CONTENT_W
    for (const y of [top, bottom]) {
      content = Math.min(content, leftIn(y) - MARGIN - leftSlant, size.width - MARGIN - rightIn(y) - rightSlant)
    }
    for (const line of KEEP_CLEAR) {
      for (let i = 0; i < line.length - 1; i++) {
        for (let k = 0; k <= 8; k++) {
          const [x, y] = toScreen(a.lerpVectors(line[i], line[i + 1], k / 8))
          if (y < top - GAP || y > bottom + GAP) continue
          if (x < te.at(y)) content = Math.min(content, leftIn(y) - x - GAP - leftSlant)
          else if (x > le.at(y)) content = Math.min(content, x - GAP - rightIn(y) - rightSlant)
        }
      }
    }
    content = Math.max(0, content)

    const [lt, lb] = [leftIn(top), leftIn(bottom)]
    const lw = content + leftSlant
    place(layout.cards[0], top, bottom, [lt - lw, lt, lb, lb - lw])
    const [rt, rb] = [rightIn(top), rightIn(bottom)]
    const rw = content + rightSlant
    place(layout.cards[1], top, bottom, [rt, rt + rw, rb + rw, rb])
  })
  return null
}

// Writes one card straight to the DOM. xs are the corners' x, clockwise from
// top left: top-left, top-right, bottom-right, bottom-left. The content sits
// in the upright rectangle that fits inside the leaning shape.
function place(card, top, bottom, xs) {
  if (!card) return
  const key = xs.map((x) => x | 0).join() + `,${top | 0},${bottom | 0}`
  if (card.key === key) return
  card.key = key
  const x0 = Math.min(...xs)
  const w = Math.max(...xs) - x0
  const h = bottom - top
  const s = card.root.style
  s.transform = `translate(${x0}px, ${top}px)`
  s.width = `${w}px`
  s.height = `${h}px`
  const ys = [0, 0, h, h]
  const d = `M${xs.map((x, i) => `${(x - x0).toFixed(1)},${ys[i]}`).join('L')}Z`
  card.svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  for (const path of card.paths) path.setAttribute('d', d)
  card.body.style.left = `${Math.max(xs[0], xs[3]) - x0 + STROKE}px`
  card.body.style.right = `${x0 + w - Math.min(xs[1], xs[2]) + STROKE}px`
}
