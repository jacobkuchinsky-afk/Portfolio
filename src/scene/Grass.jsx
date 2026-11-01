import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { sim } from '../flight/sim.js'
import * as THREE from 'three'
import { SUN_DIR, SUN_COLOR } from './sun.js'
import { loadLog } from '../boot/loadLog.js'

// A meadow between the camera and the runway. Every blade is one instance of
// a tapered strip; the vertex shader sways it in the wind and wraps it around
// the camera's x, so a fixed patch of grass covers the whole takeoff run.

const RUNWAY_EDGE = 24
const lowPower = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
const DENSITY = lowPower ? 0.4 : 1

function rng(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Shared by grass and flowers: place an instance, wrap it around the camera,
// and work out how far the wind pushes its tip.
const PLACE = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec4 aParams; // height, width/size, yaw, tint
  uniform float uTime;
  uniform vec3 uCam;
  uniform float uWrap;
  uniform float uRelative; // 1: z is measured back from the camera
  uniform float uMaxZ;     // instances nearer than this are hidden
  vec3 placeBase(out float keep) {
    vec3 base = aOffset;
    base.x = uCam.x + mod(base.x - uCam.x + uWrap * 0.5, uWrap) - uWrap * 0.5;
    if (uRelative > 0.5) base.z = uCam.z - base.z;
    keep = step(base.z, uMaxZ);
    return base;
  }
  float windAt(vec3 base) {
    float gust = sin(uTime * 0.6 + base.x * 0.045) * 0.5 + 0.5;
    return sin(uTime * 1.9 + base.x * 0.4 + base.z * 0.25) * (0.3 + 0.7 * gust)
         + sin(uTime * 3.4 + base.x * 1.3) * 0.12;
  }
`

const GRASS_VERTEX = /* glsl */ `
  ${PLACE}
  varying float vH;
  varying float vTint;
  varying vec3 vWorld;
  void main() {
    float keep;
    vec3 base = placeBase(keep);
    float h = position.y;
    vec3 p = vec3(position.x * aParams.y, h * aParams.x, 0.0);
    float c = cos(aParams.z);
    float s = sin(aParams.z);
    p = vec3(p.x * c, p.y, p.x * s);
    float wind = windAt(base);
    float bend = h * h * aParams.x;
    p.x += (wind * 0.24 + 0.1) * bend;
    p.y -= abs(wind) * 0.06 * bend;
    vec3 world = base + p * keep;
    vH = h;
    vTint = aParams.w;
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const GRASS_FRAGMENT = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uTip;
  uniform vec3 uDry;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform vec3 uCam;
  varying float vH;
  varying float vTint;
  varying vec3 vWorld;
  void main() {
    vec3 col = mix(uBase, uMid, smoothstep(0.0, 0.5, vH));
    col = mix(col, uTip, smoothstep(0.45, 1.0, vH));
    col = mix(col, uDry, vTint * vH * 0.6);
    // Looking toward a low sun, thin blade tips let light through
    vec3 view = normalize(vWorld - uCam);
    float back = pow(max(dot(view, uSunDir), 0.0), 4.0);
    col += uSun * back * vH * vH * 0.55;
    col *= 0.7 + 0.3 * vH;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

const FLOWER_VERTEX = /* glsl */ `
  ${PLACE}
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    float keep;
    vec3 base = placeBase(keep);
    float h = aParams.x;
    float wind = windAt(base);
    vec3 head = vec3((wind * 0.24 + 0.1) * h * h, h - abs(wind) * 0.06 * h * h, 0.0);
    vec3 world = base + (head + position * aParams.y) * keep;
    vColor = aColor * (0.85 + 0.15 * position.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const FLOWER_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
    #include <colorspace_fragment>
  }
`

function bladeGeometry(segments = 4) {
  const positions = []
  const indices = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const w = 0.5 * (1 - Math.pow(t, 1.4))
    positions.push(-w, t, 0, w, t, 0)
    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(indices)
  return g
}

// Scatter instances over a band. For a relative band, z is distance back from the camera.
function scatter({ count, wrap, z0, z1, seed, make, bias = 0.5 }) {
  const rand = rng(seed)
  const offsets = new Float32Array(count * 3)
  const params = new Float32Array(count * 4)
  const extra = []
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = (rand() - 0.5) * wrap
    offsets[i * 3 + 2] = z0 + (z1 - z0) * Math.pow(rand(), bias) // bias < 1: denser toward z1
    const { params: p, extra: e } = make(rand)
    params.set(p, i * 4)
    if (e) extra.push(...e)
  }
  return { offsets, params, extra }
}

function instanced(base, { offsets, params, extra }, extraName) {
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.getAttribute('position'))
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
  g.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4))
  if (extraName) g.setAttribute(extraName, new THREE.InstancedBufferAttribute(new Float32Array(extra), 3))
  g.instanceCount = offsets.length / 3
  return g
}

function makeMaterial(vertexShader, fragmentShader, { wrap, relative }) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uWrap: { value: wrap },
      uRelative: { value: relative ? 1 : 0 },
      uMaxZ: { value: 1e5 },
      uBase: { value: new THREE.Color('#1c3112') },
      uMid: { value: new THREE.Color('#3c6024') },
      uTip: { value: new THREE.Color('#a3b553') },
      uDry: { value: new THREE.Color('#c9b06b') },
      uSun: { value: new THREE.Color(SUN_COLOR) },
      uSunDir: { value: SUN_DIR },
    },
  })
}

const FLOWER_COLORS = ['#f4f1e8', '#f2c94c', '#b9a3d8', '#f4f1e8', '#e98f6b'].map((c) => new THREE.Color(c))

// Built once per page, outside React: while the scene loads it suspends and
// remounts several times, and a useMemo would rebuild 180k blades each time.
let cachedLayers
function buildLayers() {
  if (cachedLayers) return cachedLayers
  const built = loadLog.start('build grass')
  const blade = bladeGeometry()
  // Near layer: tall, dense grass from 3 to 26 m in front of the camera
  const nearWrap = 80
  const near = scatter({
    count: Math.round(70000 * DENSITY),
    wrap: nearWrap,
    z0: 26,
    z1: 3,
    seed: 1,
    make: (r) => ({ params: [0.45 + r() * 0.55, 0.07 + r() * 0.05, r() * Math.PI, r() < 0.18 ? r() : 0] }),
  })
  // Far layer: shorter grass from 26 m back to the runway edge
  const farWrap = 260
  const far = scatter({
    count: Math.round(110000 * DENSITY),
    wrap: farWrap,
    z0: RUNWAY_EDGE,
    z1: 140,
    seed: 2,
    bias: 1,
    make: (r) => ({ params: [0.28 + r() * 0.3, 0.1 + r() * 0.06, r() * Math.PI, r() < 0.25 ? r() : 0] }),
  })
  const flowers = scatter({
    count: Math.round(2600 * DENSITY),
    wrap: nearWrap,
    z0: 26,
    z1: 4,
    seed: 3,
    make: (r) => ({
      params: [0.35 + r() * 0.4, 0.035 + r() * 0.03, 0, 0],
      extra: FLOWER_COLORS[Math.floor(r() * FLOWER_COLORS.length)].toArray(),
    }),
  })
  built()
  cachedLayers = [
    { key: 'near', geometry: instanced(blade, near), material: makeMaterial(GRASS_VERTEX, GRASS_FRAGMENT, { wrap: nearWrap, relative: true }) },
    { key: 'far', geometry: instanced(blade, far), material: makeMaterial(GRASS_VERTEX, GRASS_FRAGMENT, { wrap: farWrap }), far: true },
    {
      key: 'flowers',
      geometry: instanced(new THREE.IcosahedronGeometry(1, 0), flowers, 'aColor'),
      material: makeMaterial(FLOWER_VERTEX, FLOWER_FRAGMENT, { wrap: nearWrap, relative: true }),
    },
  ]
  return cachedLayers
}

export function Grass() {
  const layers = buildLayers()
  const time = useRef(0)

  useFrame(({ camera }, dt) => {
    // The wind slows and stops with the rest of the world
    time.current += Math.min(dt, 1 / 20) * sim.timeScale
    for (const l of layers) {
      const u = l.material.uniforms
      u.uTime.value = time.current
      u.uCam.value.copy(camera.position)
      // The far layer stops where the near layer begins
      if (l.far) u.uMaxZ.value = camera.position.z - 26
    }
  })

  return layers.map((l) => <mesh key={l.key} geometry={l.geometry} material={l.material} frustumCulled={false} />)
}
