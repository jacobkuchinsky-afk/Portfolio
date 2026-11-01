import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sim, sinceFlameout, COUGHS } from '../flight/sim.js'
import { planePose } from './Plane.jsx'
import { SUN_DIR } from './sun.js'

// Scene 3's boost smoke: yellow, orange, grey and blue puffs pouring
// out of all three engines. One instanced draw. Each puff is written once,
// when it's emitted (where, when, how fast, what colour); the GPU works out
// where it's drifted to and how big it's grown from its age, so the CPU only
// touches new puffs. Puffs are solid, alpha-tested shapes with ragged edges
// and three flat values of shading like the painted hills, not soft sprites;
// far down the trail the brush-stroke pass paints them.
//
// So the trail reads as one plume, not a string of beads: young puffs are
// stretched along the trail and overlap a lot, they're shaded as a tube
// (across the trail only) rather than as balls, and their lumps come from
// noise in world space, so neighbouring puffs share one texture. They relax
// into round billows as they age.

const MAX = 4096

// Exhaust nozzles in model space (nose +X): the wing engines and the tail engine
const NOZZLES = [
  new THREE.Vector3(3.2, 2.7, -8.25),
  new THREE.Vector3(-27.6, 9.9, 0),
  new THREE.Vector3(3.2, 2.7, 8.25),
]

// Yellow → orange → grey → blue: warm out of the engine, cooling along the bands
const PALETTE = ['#ffd84d', '#ff9a3c', '#a8a6a3', '#5f9cf0'].map((c) => new THREE.Color(c))
const BAND_RATE = 1.7 // colour bands per second along each trail
const SPACING = 0.9 // metres between puffs near the nozzle...
const MAX_PER_FRAME = 8 // ...until the plane's too fast to see them that close anyway
const STRETCH = 2.6 // how long a fresh puff is along the trail, in widths

const VERTEX = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  attribute vec4 aStart; // xyz where, w when
  attribute vec4 aVel; // xyz initial velocity, w lifetime
  attribute vec4 aShape; // seed, start size, end size, drag
  attribute vec4 aDir; // xyz which way the trail runs, w how stretched it starts
  attribute vec3 aColor;
  varying vec2 vUv;
  varying vec2 vAlong;
  varying float vRound;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying float vLife;
  varying float vSeed;
  void main() {
    float age = uTime - aStart.w;
    vLife = age / aVel.w;
    if (age < 0.0 || vLife > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // dead: off screen
      return;
    }
    float k = aShape.w;
    vec3 p = aStart.xyz + aVel.xyz * (1.0 - exp(-k * age)) / k;
    // Billows out fast, then slowly
    float size = mix(aShape.y, aShape.z, 1.0 - exp(-age * 3.5 / aVel.w));
    // Long along the trail on screen while it's fresh, relaxing to round as it billows
    vec2 along = (viewMatrix * vec4(aDir.xyz, 0.0)).xy;
    float onScreen = length(along); // short when the trail points at the camera
    along = onScreen > 0.05 ? along / onScreen : vec2(1.0, 0.0);
    float stretch = 1.0 + (aDir.w - 1.0) * smoothstep(0.05, 0.5, onScreen) * (1.0 - smoothstep(0.0, 0.55, vLife));
    vec2 across = vec2(-along.y, along.x);
    vec2 offset = (along * position.x * stretch + across * position.y) * size;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    mvPosition.xy += offset;
    gl_Position = projectionMatrix * mvPosition;
    vUv = position.xy * 2.0;
    vAlong = along;
    vRound = 1.0 / stretch;
    vWorld = p + (vec4(offset, 0.0, 0.0) * viewMatrix).xyz; // back to world: the view rotation's inverse
    vColor = aColor;
    vSeed = aShape.x;
    #include <fog_vertex>
  }
`

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uSunView;
  uniform vec3 uShade;
  varying vec2 vUv;
  varying vec2 vAlong;
  varying float vRound;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying float vLife;
  varying float vSeed;

  float hash2(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + 1.0), f.x), f.y);
  }
  float lumps(vec2 p) {
    return 0.55 * noise2(p) + 0.3 * noise2(p * 2.1 + 7.0) + 0.15 * noise2(p * 4.3 + 3.0);
  }
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + 1.0), f.x), f.y),
      f.z);
  }

  void main() {
    float r = length(vUv);
    float n = lumps(vUv * 1.7 + vSeed * 37.0);
    // Lumps shared by every puff, fixed in the world, so the plume has one texture
    float w = 0.65 * noise3(vWorld * 0.28) + 0.35 * noise3(vWorld * 0.7 + 11.0);
    // A lumpy outline that erodes away as the puff dies, instead of fading
    float erode = smoothstep(0.45, 1.0, vLife) * 1.05;
    if (1.0 - r + (n - 0.5) * 0.8 + (w - 0.5) * 0.55 - erode < 0.0) discard;

    // Fresh, it's lit like a tube (round across the trail, flat along it);
    // aged, like a ball. Roughed up by the shared lumps, in three flat values
    vec2 across = vec2(-vAlong.y, vAlong.x);
    vec2 nxy = across * vUv.y + vAlong * vUv.x * vRound;
    vec3 N = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
    float l = dot(N, uSunView) * 0.5 + 0.5 + (w - 0.5) * 0.95 + (n - 0.5) * 0.2;
    // Kept light: the sun is often behind the plume, and dark shadows turn the colours muddy
    vec3 shadow = mix(vColor * 0.66, uShade, 0.22);
    vec3 col = mix(shadow, vColor, smoothstep(0.36, 0.42, l));
    col = mix(col, vColor * 1.18 + 0.06, smoothstep(0.7, 0.76, l));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

const rand = (a, b) => a + Math.random() * (b - a)
const blendColor = new THREE.Color()

export function Smoke() {
  const { mesh, attrs, material } = useMemo(() => {
    const geometry = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    geometry.index = quad.index
    geometry.setAttribute('position', quad.attributes.position)
    const attrs = {
      aStart: new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4).fill(-1e6), 4),
      aVel: new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4).fill(1), 4),
      aShape: new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4).fill(1), 4),
      aDir: new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4).fill(1), 4),
      aColor: new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3),
    }
    for (const [name, a] of Object.entries(attrs)) {
      a.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute(name, a)
    }
    geometry.instanceCount = MAX
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uSunView: { value: new THREE.Vector3() }, uShade: { value: new THREE.Color('#4a4f63') } },
      ]),
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false // the puffs are placed in the shader
    return { mesh, attrs, material }
  }, [])
  useEffect(() => () => (mesh.geometry.dispose(), material.dispose()), [mesh, material])

  const emitter = useMemo(
    () => ({
      next: 0,
      dirtyFrom: Infinity,
      dirtyTo: -1,
      wrapped: false,
      clock: -1,
      boostAt: null,
      coughs: 0,
      prev: NOZZLES.map(() => new THREE.Vector3()),
      acc: [0, 0, 0],
      pose: new THREE.Matrix4(),
      cur: new THREE.Vector3(),
      at: new THREE.Vector3(),
      nose: new THREE.Vector3(),
      planeVel: new THREE.Vector3(),
      trail: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(({ camera }) => {
    const e = emitter
    // Replay: sim time went backwards, so every puff's birthday is in the future. Clear them
    if (sim.clock < e.clock || sim.boostAt !== e.boostAt) {
      attrs.aStart.array.fill(-1e6)
      attrs.aStart.clearUpdateRanges()
      attrs.aStart.needsUpdate = true
      e.boostAt = sim.boostAt
      e.coughs = 0
      e.acc.fill(0)
      e.clock = sim.clock
    }
    const dt = sim.clock - e.clock
    e.clock = sim.clock
    material.uniforms.uTime.value = sim.clock
    material.uniforms.uSunView.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse)
    if (sim.boostAt === null) return

    planePose(e.pose, sim.x, sim.y, sim.pitch, sim.roll)
    e.nose.set(1, 0, 0).transformDirection(e.pose)
    e.planeVel.set(sim.vx ?? sim.speed, sim.vy, 0)
    // The trail lies along the path the plane flew
    if (e.planeVel.lengthSq() > 1) e.trail.copy(e.planeVel).normalize()
    else e.trail.copy(e.nose)
    const firstFrame = dt <= 0 && e.acc.every((a) => a === 0)
    const flameoutAt = sim.flameoutAt === null ? Infinity : sinceFlameout()

    NOZZLES.forEach((nozzle, i) => {
      e.cur.copy(nozzle).applyMatrix4(e.pose)
      if (firstFrame || dt <= 0) {
        e.prev[i].copy(e.cur)
        if (dt <= 0) return
      }
      if (flameoutAt === Infinity && sim.boost > 0.01) {
        // Evenly along the path the nozzle took this frame, so the trail has no gaps
        const travelled = e.cur.distanceTo(e.prev[i])
        e.acc[i] += (travelled / SPACING + dt * 30) * sim.boost
        const n = Math.min(MAX_PER_FRAME, Math.floor(e.acc[i]))
        e.acc[i] -= Math.floor(e.acc[i])
        for (let k = 0; k < n; k++) {
          const f = (k + Math.random()) / n
          e.at.lerpVectors(e.prev[i], e.cur, f)
          emit(e.at, sim.clock - dt * (1 - f), i, {
            inherit: 0.12,
            jet: 14,
            spread: 3,
            life: rand(2.2, 3),
            size: [rand(2.6, 3.2), rand(11, 16)],
            drag: 1.4,
            jitter: 0.35,
            stretch: STRETCH,
          })
        }
      }
      e.prev[i].copy(e.cur)
    })

    // The last coughs: big puffs that carry on with the plane, then hang in zero g
    while (sim.flameoutAt !== null && e.coughs < COUGHS.length && flameoutAt >= COUGHS[e.coughs][0]) {
      const [, strength] = COUGHS[e.coughs++]
      NOZZLES.forEach((nozzle, i) => {
        e.cur.copy(nozzle).applyMatrix4(e.pose)
        for (let k = 0; k < Math.round(12 * strength); k++) {
          emit(e.cur, sim.clock, i, {
            inherit: 0.95,
            jet: 4,
            spread: 4 * strength,
            life: rand(16, 22),
            size: [rand(2, 3.2) * (0.6 + 0.4 * strength), rand(7, 11) * (0.6 + 0.4 * strength)],
            drag: 3.5, // same as the plane, so they come to rest around it
            jitter: 1.4,
            stretch: 1.4,
          })
        }
      })
      // Colour bands move on, so each cough is a different mix
      e.bandShift = (e.bandShift ?? 0) + 1.3
    }

    if (e.dirtyTo >= 0) {
      for (const a of Object.values(attrs)) {
        a.clearUpdateRanges()
        if (e.wrapped) a.addUpdateRange(0, MAX * a.itemSize)
        else a.addUpdateRange(e.dirtyFrom * a.itemSize, (e.dirtyTo - e.dirtyFrom + 1) * a.itemSize)
        a.needsUpdate = true
      }
      e.dirtyFrom = Infinity
      e.dirtyTo = -1
      e.wrapped = false
    }
  })

  function emit(at, time, engine, { inherit, jet, spread, life, size, drag, jitter, stretch }) {
    const e = emitter
    const j = e.next
    e.next = (e.next + 1) % MAX
    if (e.next === 0) e.wrapped = true
    e.dirtyFrom = Math.min(e.dirtyFrom, j)
    e.dirtyTo = Math.max(e.dirtyTo, j)

    attrs.aStart.setXYZW(j, at.x + rand(-jitter, jitter), at.y + rand(-jitter, jitter), at.z + rand(-jitter, jitter), time)
    // Out the back of the engine, slowed fast by the air, with a little of the plane's speed
    const v = e.planeVel
    attrs.aVel.setXYZW(
      j,
      v.x * inherit - e.nose.x * jet + rand(-spread, spread),
      v.y * inherit - e.nose.y * jet + rand(-spread, spread),
      v.z * inherit - e.nose.z * jet + rand(-spread, spread),
      life,
    )
    attrs.aShape.setXYZW(j, Math.random(), size[0], size[1], drag)
    attrs.aDir.setXYZW(j, e.trail.x, e.trail.y, e.trail.z, stretch)
    // Each trail runs through the colours in solid bands, the three engines
    // out of step, each band blending into the next over its last stretch
    const band = time * BAND_RATE + engine * 1.7 + (e.bandShift ?? 0) + rand(-0.06, 0.06)
    const i = Math.floor(band)
    const blend = THREE.MathUtils.smoothstep(band - i, 0.65, 1)
    const at0 = PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]
    const at1 = PALETTE[(((i + 1) % PALETTE.length) + PALETTE.length) % PALETTE.length]
    blendColor.copy(at0).lerp(at1, blend)
    attrs.aColor.setXYZ(j, blendColor.r, blendColor.g, blendColor.b)
  }

  return <primitive object={mesh} />
}
