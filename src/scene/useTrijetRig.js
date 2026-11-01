import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sim } from '../flight/sim.js'
import { useFlight } from '../state/useFlight.js'

// Drives the named parts of the plane. Works the same for the stand-in and the
// real trijet.glb, because both follow the naming contract in
// prompts/blender-hero-plane.md (Fan_L, Gear_Nose, Light_Nav_L, ...).

const FAN_MAX_SPEED = 32 // rad/s at full thrust

const LIGHT_COLORS = {
  Light_Nav_L: '#ff2a2a',
  Light_Nav_R: '#22ff66',
  Light_Strobe_Tail: '#ffffff',
  Light_Beacon_Top: '#ff2a1a',
  Light_Beacon_Bottom: '#ff2a1a',
  Light_Landing: '#fff2d6',
}

// Fallback retraction if the model has no GearRetract animation:
// nose and center gear swing forward, the mains fold inward.
const GEAR_SWING = {
  Gear_Nose: ['z', 1.6],
  Gear_Center: ['z', 1.6],
  Gear_Main_L: ['x', -1.6],
  Gear_Main_R: ['x', 1.6],
}

// GearRetract in trijet.glb: 0–0.5 s the main oleos extend as the weight comes
// off the wheels, 0.5 s to the end the gear folds and the doors cycle (already eased).
const OLEO_END = 0.5

const smooth = (t) => t * t * (3 - 2 * t)

export function useTrijetRig(rootRef, animations = []) {
  const rig = useRef(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const get = (name) => root.getObjectByName(name)

    const lights = []
    for (const [name, color] of Object.entries(LIGHT_COLORS)) {
      const obj = get(name)
      if (!obj) continue
      const materials = []
      obj.traverse((o) => {
        if (!o.isMesh) return
        o.material = o.material.clone()
        o.material.emissive = new THREE.Color(color)
        o.material.emissiveIntensity = 0
        o.castShadow = false
        materials.push(o.material)
      })
      lights.push({ name, materials })
    }

    const gear = Object.keys(GEAR_SWING)
      .map((name) => {
        const obj = get(name)
        return obj && { obj, name, rest: obj.rotation.clone() }
      })
      .filter(Boolean)

    let mixer = null
    let action = null
    const clip = animations.find((a) => a.name === 'GearRetract')
    if (clip) {
      mixer = new THREE.AnimationMixer(root)
      action = mixer.clipAction(clip)
      action.play()
      action.paused = true
    }

    rig.current = {
      fans: ['L', 'C', 'R'].map((id) => ({ id, obj: get(`Fan_${id}`), blur: get(`Fan_${id}`)?.getObjectByName('FanBlur') })),
      lights,
      gear,
      mixer,
      action,
      clip,
    }
    return () => mixer?.stopAllAction()
  }, [rootRef, animations])

  useFrame((_, rawDt) => {
    const r = rig.current
    if (!r) return
    const dt = Math.min(rawDt, 1 / 20)
    const { phase, switches } = useFlight.getState()

    for (const fan of r.fans) {
      if (!fan.obj) continue
      const n1 = sim.engines[fan.id].n1
      fan.obj.rotation.x -= n1 * FAN_MAX_SPEED * dt * sim.timeScale
      if (fan.blur) fan.blur.material.opacity = Math.max(0, Math.min(0.8, (n1 - 0.3) * 1.4))
    }

    if (r.action) {
      const oleo = sim.airborne ? Math.min(OLEO_END, sim.clock - sim.airborneAt) : 0
      r.action.time = sim.gear > 0 ? OLEO_END + sim.gear * (r.clip.duration - OLEO_END) : oleo
      r.mixer.update(0)
    } else {
      for (const g of r.gear) {
        const [axis, angle] = GEAR_SWING[g.name]
        g.obj.rotation[axis] = g.rest[axis] + angle * smooth(sim.gear)
        g.obj.visible = sim.gear < 0.98
      }
    }

    // Lights follow real airline practice: nav lights with power,
    // beacons once engines run, strobes + landing light for takeoff.
    const t = sim.clock
    const engineRunning = Object.values(sim.engines).some((e) => e.started)
    const onRunway = phase === 'go' || phase === 'takeoff' || phase === 'airborne' || phase === 'done'
    // No strobe flash frozen on screen in slow motion
    const strobePulse = sim.timeScale < 0.5 ? 1 : t % 1.2
    const levels = {
      Light_Nav_L: switches.my ? 3 : 0,
      Light_Nav_R: switches.my ? 3 : 0,
      Light_Beacon_Top: engineRunning && t % 1 < 0.12 ? 8 : 0,
      Light_Beacon_Bottom: engineRunning && (t + 0.5) % 1 < 0.12 ? 8 : 0,
      Light_Strobe_Tail: onRunway && (strobePulse < 0.05 || (strobePulse > 0.15 && strobePulse < 0.2)) ? 25 : 0,
      Light_Landing: onRunway ? 10 : 0,
    }
    for (const light of r.lights) {
      for (const m of light.materials) m.emissiveIntensity = levels[light.name]
    }
  })
}
