import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sim, thrust, sinceFlameout, BANK, KNIFE_PITCH, COUGHS } from '../flight/sim.js'
import { planePose, planeCenter } from './Plane.jsx'
import { edgePoint, AIM_S } from './wing.js'

const { damp, degToRad, clamp, lerp } = THREE.MathUtils

const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// The banked shot, reached gradually as the plane rolls: a little closer,
// a little lower looking up, and banked partway with the plane like a chase
// camera. The wing still leans some; the cards lean with it.
const BANKED_FRAME_H = 31 // metres of sky top to bottom (landscape)
const BANKED_LOOK_UP = THREE.MathUtils.degToRad(8)
const BANKED_ROLL = THREE.MathUtils.degToRad(20)

// The shot sits a few degrees off dead side-on: swung toward the nose and
// raised slightly, so the plane reads as a solid rather than a flat profile.
const BASE_YAW = 3
const BASE_PITCH = 2.5
const DRAG_MAX = 4 // degrees the viewer can swing the camera off that origin, in any direction
const MIN_CAM_Y = 1.2 // never let a downward drag sink the lens into the grass

// Scene 3, the boost: a side-on chase, a little below and behind, looking up
// more and more as the sky turns to space so the horizon drops out of frame
const BOOST_FRAME_H = 84 // metres of sky top to bottom (landscape)...
const DRIFT_FRAME_H = 72 // ...in space, just enough for the whole plane to stay in frame as it tumbles
const BOOST_FRAME_W = 60 // ...or side to side, at least (portrait)
const BOOST_LOOK_UP = degToRad(8)
const SPACE_LOOK_UP = degToRad(22)
const BOOST_LEAD = 8 // metres the plane surges ahead in frame
const BOOST_SHAKE = 0.7 // metres of jitter at the look point at full boost
const LEVER_SHAKE = 0.18 // ...and while the throttle's being pushed
const COUGH_KICK = 1.1
// Once it's floating, the plane eases off to the left (up, on portrait
// screens) to make room for the Constellar card
const ASIDE_AFTER = 0.9 // seconds after the engines die: it's about stopped
const ASIDE_X = 0.25 // of the frame's width
const ASIDE_Y = 0.27 // of its height, portrait
const smooth = (t) => t * t * (3 - 2 * t)

// What the boost camera is aiming at this frame, including the shift that
// moves the floating plane aside. The Constellar card hangs off this, so it
// stays put in the shot however the camera drifts.
export const boostView = { look: new THREE.Vector3() }

// How far the boost camera sits from the plane, and how much of the world
// it sees at the plane's distance (metres). `space` 0 → 1 widens it from the
// climb to the floating shot. The Constellar card uses this to sit in the
// same shot.
export function boostFraming(fov, aspect, space = 1) {
  const t = Math.tan(degToRad(fov / 2))
  const frameH = lerp(BOOST_FRAME_H, DRIFT_FRAME_H, smooth(space))
  const dist = Math.max(frameH / (2 * t), (BOOST_FRAME_W * frameH) / BOOST_FRAME_H / (2 * t * aspect))
  const height = 2 * t * dist
  return { dist, height, width: height * aspect, asideX: ASIDE_X, asideY: ASIDE_Y, lookUp: SPACE_LOOK_UP }
}

const pose = new THREE.Matrix4()
const orbit = new THREE.Vector3()
const sph = new THREE.Spherical()
const aim = new THREE.Vector3()
const center = new THREE.Vector3()
const lead = new THREE.Vector3()
const pull = new THREE.Vector3()
const boostLook = new THREE.Vector3()
const boostPos = new THREE.Vector3()

// Scene 1: eye-level spectator at the runway edge, a little ahead of the
// plane so the engine fans are visible. On portrait phones it frames the
// front half of the plane instead of shrinking the whole thing.
// Scene 2: after liftoff it rises with the plane. Everything else it does is
// tied to the plane's roll, so there's no separate camera move to give the
// moment away: as the plane banks it drifts toward the raised wing and banks
// a little with it.
export function CameraRig() {
  const look = useRef(new THREE.Vector3())
  const lag = useRef(0)
  const follow = useRef(0) // 0 = runway spectator, 1 = climbing with the plane
  const offset = useRef({ cam: 0, look: 0 }) // heights above the plane, smoothed
  const drag = useRef({ yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, active: false })
  const boost = useRef({ w: 0, anchor: new THREE.Vector3(), velocity: new THREE.Vector3(), lead: new THREE.Vector3(), shakeT: 0, aside: 0 })
  const el = useThree((s) => s.gl.domElement)

  // Click-drag on the scene orbits the camera up to DRAG_MAX degrees; it eases home on release
  useEffect(() => {
    const d = drag.current
    let startX = 0
    let startY = 0
    const degPerPx = () => (2 * DRAG_MAX) / Math.min(el.clientWidth, el.clientHeight)
    const down = (e) => {
      if (e.button !== 0) return
      d.active = true
      startX = e.clientX + d.yaw / degPerPx() // pick up from wherever the ease-home has got to
      startY = e.clientY - d.pitch / degPerPx()
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const move = (e) => {
      if (!d.active) return
      // Grab-the-world, like OrbitControls: drag right swings the camera left, drag down raises it
      let yaw = (startX - e.clientX) * degPerPx()
      let pitch = (e.clientY - startY) * degPerPx()
      const r = Math.hypot(yaw, pitch)
      if (r > DRAG_MAX) {
        yaw *= DRAG_MAX / r
        pitch *= DRAG_MAX / r
      }
      d.targetYaw = yaw
      d.targetPitch = pitch
    }
    const up = (e) => {
      if (!d.active) return
      d.active = false
      d.targetYaw = d.targetPitch = 0
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      el.style.cursor = 'grab'
    }
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.style.cursor = ''
    }
  }, [el])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const cam = state.camera
    const aspect = state.size.width / state.size.height
    const portrait = aspect < 1
    const fov = portrait ? 46 : 30
    if (cam.fov !== fov) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }

    // Camera moves run on real time, so it settles and holds still when the sim freezes
    follow.current = damp(follow.current, sim.airborne ? 1 : 0, 0.7, dt)
    const f = follow.current
    // How far into the bank the plane is: 0 level, 1 at full bank (already eased).
    // Not the zero-g tumble: the camera doesn't roll with that
    const b = clamp((sim.roll - sim.tumble.roll) / BANK, 0, 1)

    const frameWidth = lerp(portrait ? 44 : clamp(40 * aspect, 70, 96), portrait ? 34 : BANKED_FRAME_H * aspect, b)
    const dist = frameWidth / (2 * Math.tan(degToRad(fov / 2)) * aspect)

    // The banked shot looks at the wing as it will be at full bank, so the
    // plane rolls into a frame that's already set
    planePose(pose, sim.x, sim.y, KNIFE_PITCH, BANK)
    edgePoint('mid', AIM_S, aim).applyMatrix4(pose)

    // The camera tracks the plane exactly in x (smoothing a fast-moving target
    // leaves it far behind); only this small drift is smoothed, so the plane
    // eases ahead in frame as it speeds up. Once the camera is flying with
    // the plane, it eases back to centre.
    lag.current = damp(lag.current, sim.speed * 0.12 * (1 - f), 1.2, dt)
    const tx = lerp(sim.x + (portrait ? 14 : 16) - lag.current, aim.x, b)
    const lx = lerp(sim.x + (portrait ? 10 : 3) - lag.current, aim.x, b)

    // Heights relative to the plane, so climbing never leaves the camera behind
    const groundCam = 3 + sim.y * 0.3 - sim.y
    const groundLook = (portrait ? 6 : 7) + sim.y * 0.85 - sim.y
    const lookUp = BANKED_LOOK_UP * b
    const camRise = lerp(lerp(groundCam, 2, f), aim.y - sim.y - dist * Math.sin(BANKED_LOOK_UP), b)
    const lookRise = lerp(lerp(groundLook, 8, f), aim.y - sim.y, b)

    if (Math.abs(cam.position.x - tx) > 150) {
      // First frame or replay: cut, don't swoop
      lag.current = 0
      follow.current = 0
      offset.current.cam = 3
      offset.current.look = portrait ? 6 : 7
      cam.position.set(tx, sim.y + offset.current.cam, dist)
      look.current.set(lx, sim.y + offset.current.look, 0)
    } else {
      offset.current.cam = damp(offset.current.cam, camRise, 2, dt)
      offset.current.look = damp(offset.current.look, lookRise, 2.5, dt)
      cam.position.x = tx
      look.current.x = lx
      cam.position.y = sim.y + offset.current.cam
      look.current.y = sim.y + offset.current.look
    }
    cam.position.z = dist * Math.cos(lookUp)

    // Scene 3: blend from the banked shot into the boost chase
    const bo = boost.current
    bo.w = sim.boostAt === null ? 0 : damp(bo.w, 1, 1.4, dt)
    if (bo.w > 0) {
      planeCenter(center)
      // What the camera follows: the plane exactly while it's under power.
      // Once the engines die it has momentum of its own, so when the plane
      // stops dead the camera carries on ~10 m past it and drifts back
      if (sim.flameoutAt === null) {
        bo.anchor.copy(center)
        bo.velocity.set(sim.vx, sim.vy, 0)
      } else {
        bo.velocity.multiplyScalar(Math.exp(-3.2 * dt)).addScaledVector(pull.subVectors(center, bo.anchor), 2.4 * dt)
        bo.anchor.addScaledVector(bo.velocity, dt)
      }
      // The plane surges ahead in frame as the boost hits
      lead.set(sim.vx, sim.vy, 0).normalize().multiplyScalar(BOOST_LEAD * sim.boost)
      bo.lead.x = damp(bo.lead.x, lead.x, 1.2, dt)
      bo.lead.y = damp(bo.lead.y, lead.y, 1.2, dt)

      const { dist: boostDist, height: frameHeight } = boostFraming(fov, aspect, sim.space)
      const up = lerp(BOOST_LOOK_UP, SPACE_LOOK_UP, smooth(sim.space))
      boostLook.copy(bo.anchor).sub(bo.lead)
      boostPos.set(boostLook.x - boostDist * 0.08, boostLook.y - boostDist * Math.sin(up), boostDist * Math.cos(up))
      bo.aside = sim.flameoutAt !== null && sinceFlameout() > ASIDE_AFTER ? damp(bo.aside, 1, 1.1, dt) : 0
      const aside = smooth(bo.aside)
      // Moving the camera, not turning it: the plane slides across the frame
      pull.set(portrait ? 0 : ASIDE_X * frameHeight * aspect * aside, portrait ? -ASIDE_Y * frameHeight * aside : 0, 0)
      boostLook.add(pull)
      boostPos.add(pull)
      boostView.look.copy(boostLook)
      const w = smooth(bo.w)
      cam.position.lerp(boostPos, w)
      look.current.lerp(boostLook, w)
    }

    // Swing the camera around what it's looking at: the fixed base angle plus the viewer's drag
    const d = drag.current
    d.yaw = damp(d.yaw, d.targetYaw, d.active ? 14 : 4, dt)
    d.pitch = damp(d.pitch, d.targetPitch, d.active ? 14 : 4, dt)
    orbit.subVectors(cam.position, look.current)
    sph.setFromVector3(orbit)
    sph.theta += degToRad(BASE_YAW + d.yaw)
    sph.phi -= degToRad(BASE_PITCH + d.pitch)
    cam.position.copy(look.current).add(orbit.setFromSpherical(sph))
    cam.position.y = Math.max(cam.position.y, MIN_CAM_Y)

    // Engine rumble while the wheels are on the runway (on sim time, so it freezes too)
    const shake = reducedMotion ? 0 : thrust() * (sim.airborne ? 0.15 : 1) * 0.05
    const t = sim.clock
    // Scene 3: the throttle's rumble and the boost's shake run on real time,
    // since the sim is still frozen while the lever's pushed. Coughs kick it
    let jolt = (sim.boostAt === null ? sim.lever * LEVER_SHAKE : 0) + sim.boost * BOOST_SHAKE
    for (const [at, strength] of COUGHS) {
      const since = sinceFlameout() - at
      if (sim.flameoutAt !== null && since >= 0) jolt += COUGH_KICK * strength * Math.exp(-since * 7)
    }
    if (reducedMotion) jolt = 0
    const st = (bo.shakeT += dt)
    const jx = (Math.sin(st * 31) * 0.5 + Math.sin(st * 17.3 + 1) * 0.3 + Math.sin(st * 7.1 + 2) * 0.2) * jolt
    const jy = (Math.sin(st * 27 + 3) * 0.5 + Math.sin(st * 19.7) * 0.3 + Math.sin(st * 5.3 + 1) * 0.2) * jolt
    cam.lookAt(look.current.x + Math.sin(t * 37) * shake + jx, look.current.y + Math.sin(t * 53 + 1) * shake + jy, look.current.z)

    // Bank partway with the plane (positive turns the picture clockwise, standing the wing up)
    cam.rotateZ(BANKED_ROLL * b + Math.sin(st * 23 + 5) * 0.004 * jolt)
  })
  return null
}
