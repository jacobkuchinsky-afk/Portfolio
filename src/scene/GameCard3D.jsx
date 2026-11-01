import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { sim } from '../flight/sim.js'
import { useFlight } from '../state/useFlight.js'
import { boostFraming, boostView } from './CameraRig.jsx'
import { GameCardBody, GAME_CARD_PHASES, useSteam } from '../ui/GameCard.jsx'
import { enemyLane } from '../ui/Enemy.jsx'

// The Constellar card, standing in space beside the floating plane at the
// same distance from the camera: a solid slab (lit by the sun, so its edges
// show its thickness) with the card's HTML face on the front, so the text
// stays crisp and the link clickable. Turned a little toward the camera, so
// it reads in perspective.
//
// It hangs where the floating shot leaves room for it: right of the plane
// (below it, portrait), and clear of the lane on the far right where the
// Constellar enemy will patrol. It's fixed to what the camera's aiming at,
// so it never drifts over the plane or out of frame: it only bobs in place.

const DEPTH = 2.6 // metres thick
const BOB = { x: 0.5, y: 0.9, turn: 0.02 } // metres, metres, radians of gentle floating
const FADE_TIME = 0.9 // seconds, same as the face's CSS fade
const TURN = { landscape: [0.2, -0.24], portrait: [0.26, 0] } // [x, y] radians: toward the camera, below and left

export function GameCard3D() {
  const phase = useFlight((s) => s.phase)
  const shown = GAME_CARD_PHASES.has(phase)
  const steam = useSteam()
  const group = useRef()
  const slab = useRef()
  const body = useRef()
  const placed = useRef(null)
  const [layout, setLayout] = useState({ portrait: false, width: 560, distanceFactor: 40 })
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2a2416', roughness: 0.85, transparent: true, opacity: 0 }),
    [],
  )

  useFrame(({ camera, size }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    if (!shown) {
      placed.current = null
      material.opacity = 0
      slab.current.visible = false
      return
    }
    // (Placed again if the window's resized)
    if (placed.current?.width !== size.width || placed.current?.height !== size.height) {
      const aspect = size.width / size.height
      const portrait = aspect < 1
      const frame = boostFraming(camera.fov, aspect)
      const pxPerMetre = size.height / frame.height // at the plane's distance: the face draws at about 1:1
      // Across: between the plane (which sits asideX left of centre) and the
      // enemy's lane; portrait, the full width bar the lane. Down: level with
      // the plane, or 66% down on portrait, below it
      const left = portrait ? 26 : size.width * (0.5 - frame.asideX + 0.12)
      const right = size.width - enemyLane(size.width)
      const width = Math.round(Math.min(portrait ? 420 : 520, right - left))
      const across = ((left + right) / 2 - size.width / 2) / pxPerMetre
      const offset = new THREE.Vector3(across, (portrait ? -0.16 : 0.02) * frame.height, 0)
      const since = placed.current?.since ?? sim.clock
      placed.current = { offset, since, pxPerMetre, turn: TURN[portrait ? 'portrait' : 'landscape'], width: size.width, height: size.height }
      setLayout({
        portrait,
        width,
        distanceFactor: 400 / pxPerMetre, // drei: CSS pixel → distanceFactor / 400 metres
      })
    }
    const p = placed.current
    const t = sim.clock - p.since
    group.current.position.copy(boostView.look).add(p.offset)
    group.current.position.x += BOB.x * Math.sin(t * 0.31 + 1)
    group.current.position.y += BOB.y * Math.sin(t * 0.55)
    group.current.rotation.set(p.turn[0], p.turn[1] + BOB.turn * Math.sin(t * 0.35), BOB.turn * 0.6 * Math.sin(t * 0.43 + 2))

    // The slab is the face's size, behind it
    const el = body.current
    if (el?.offsetWidth) {
      slab.current.scale.set(el.offsetWidth / p.pxPerMetre, el.offsetHeight / p.pxPerMetre, DEPTH)
      slab.current.visible = true
    }
    material.opacity = Math.min(1, material.opacity + dt / FADE_TIME)
  })

  return (
    <group ref={group}>
      <mesh ref={slab} material={material} position-z={-DEPTH / 2} visible={false}>
        <boxGeometry />
      </mesh>
      <Html transform distanceFactor={layout.distanceFactor} zIndexRange={[20, 0]}>
        <GameCardBody shown={shown && !!placed.current} bodyRef={body} {...layout} {...steam} />
      </Html>
    </group>
  )
}
