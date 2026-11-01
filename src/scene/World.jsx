import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { sim } from '../flight/sim.js'
import { Grass } from './Grass.jsx'
import { assetUrl } from '../boot/assets.js'
import { loadLog } from '../boot/loadLog.js'
import { SUN_DIR, SUN_COLOR, FILL_DIR } from './sun.js'
import { NOISE } from './painted.js'
import { Instanced } from './Instanced.jsx'
import { Airport, Trees } from './Airfield.jsx'

// The plane is the only realistic (PBR) thing up close; the background is
// stylized. The sun sits low in the shot behind the plane, so the paint
// picks up a rim of sunlight and the grass tips light up.

const FOG_COLOR = '#f2c29c'
const SPACE_FOG = new THREE.Color('#2a2350')

const smooth = (t) => t * t * (3 - 2 * t)

const RUNWAY_START = -260
const RUNWAY_LENGTH = 3500
const RUNWAY_HALF_WIDTH = 22.5

let gradientMap
function toon(params) {
  if (!gradientMap) {
    gradientMap = new THREE.DataTexture(new Uint8Array([105, 175, 235, 255]), 4, 1, THREE.RedFormat)
    gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter
    gradientMap.needsUpdate = true
  }
  return new THREE.MeshToonMaterial({ gradientMap, ...params })
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizonSun;
  uniform vec3 uHorizonAway;
  uniform vec3 uBelt;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec3 uCloudRim;
  uniform float uSpace;
  uniform vec3 uSpaceLow;
  uniform vec3 uSpaceHigh;
  uniform vec3 uNebulaA;
  uniform vec3 uNebulaB;
  varying vec3 vDir;
  ${NOISE}

  // Cloud cover in a squashed direction space: long flat streaks low over
  // the horizon, and bigger heaped banks above them
  float cover(vec3 d) {
    float up = d.y;
    vec3 q = d * vec3(2.6, 11.0, 2.6);
    float streaks = fbm(q + 1.3 * fbm(q * 0.6 + 4.0));
    streaks *= smoothstep(0.025, 0.08, up) * (1.0 - smoothstep(0.12, 0.26, up));
    vec3 h = d * vec3(3.2, 5.5, 3.2) + 11.0;
    float heaps = fbm(h + 0.8 * fbm(h * 0.8));
    // Flat bases, round tops
    heaps *= smoothstep(0.1, 0.16, up) * (1.0 - smoothstep(0.32, 0.5, up));
    heaps *= 0.75 + 0.5 * fbm(d * 2.0 + 21.0);
    return max(streaks, heaps);
  }

  // Scene 3, space: deep violet-black, a nebula washed in the smoke's
  // colours, and stars as fat dots so the brush pass keeps them as dabs
  vec3 spaceSky(vec3 d) {
    vec3 col = mix(uSpaceLow, uSpaceHigh, smoothstep(-0.1, 0.6, d.y));
    float neb = fbm(d * 2.4 + 40.0 + 1.2 * fbm(d * 1.3 + 9.0));
    col = mix(col, uNebulaA, smoothstep(0.52, 0.78, neb) * 0.55);
    col = mix(col, uNebulaB, smoothstep(0.58, 0.84, fbm(d * 3.6 + 70.0)) * 0.4);
    vec3 g = d * 70.0;
    vec3 cell = floor(g);
    if (hash3(cell + 3.1) > 0.86) {
      vec3 off = vec3(hash3(cell + 1.7), hash3(cell + 5.3), hash3(cell + 9.1)) - 0.5;
      float size = mix(0.13, 0.3, pow(hash3(cell + 13.7), 3.0));
      float star = 1.0 - smoothstep(size * 0.7, size, length(fract(g) - 0.5 - off * 0.5));
      col = mix(col, vec3(1.25, 1.2, 1.1), star);
    }
    return col;
  }

  void main() {
    vec3 view = normalize(vDir);
    // Climbing, the horizon sinks away below...
    vec3 d = normalize(view + vec3(0.0, uSpace * 0.45, 0.0));
    // ...and the sky's colours squeeze into the thin band of air along it
    d.y /= mix(1.0, 0.3, uSpace);
    float up = clamp(d.y, 0.0, 1.0);
    float s = max(dot(d, uSunDir), 0.0);
    // How far round the horizon we are from the sun (1 = straight at it)
    float toward = dot(normalize(d.xz), normalize(uSunDir.xz)) * 0.5 + 0.5;
    vec3 horizon = mix(uHorizonAway, uHorizonSun, pow(toward, 3.0));
    vec3 col = mix(horizon, uMid, smoothstep(0.0, 0.22, up));
    col = mix(col, uZenith, smoothstep(0.18, 0.85, up));
    // Pink band low in the sky, away from the sun
    float band = smoothstep(0.01, 0.07, up) * (1.0 - smoothstep(0.07, 0.3, up));
    col = mix(col, uBelt, (1.0 - toward) * band * 0.5);
    // Uneven wash, like paint laid down in passes
    float wash = fbm(d * 5.0 + 7.0);
    col *= 0.94 + 0.12 * wash;
    col = mix(col, uBelt, smoothstep(0.55, 0.8, fbm(d * vec3(3.0, 8.0, 3.0))) * 0.18);

    // Clouds, lit from above and from the sun's side
    float c = cover(d);
    // Keep a clear patch round the sun so it still reads as the light source
    float cloud = smoothstep(0.3, 0.37, c) * (1.0 - smoothstep(0.996, 0.9993, s)) * (1.0 - smoothstep(0.35, 0.8, uSpace));
    float above = cover(normalize(d + vec3(0.0, 0.012, 0.0)));
    float lit = clamp(0.5 + (c - above) * 16.0, 0.0, 1.0);
    vec3 cloudCol = mix(uCloudShade, uCloudLit, lit);
    cloudCol = mix(cloudCol, uCloudRim, pow(s, 5.0) * 0.8);
    // Thinner edges let the sky through, like a dry brush
    cloudCol = mix(col, cloudCol, smoothstep(0.3, 0.38, c));
    col = mix(col, cloudCol, cloud);

    // Above the air: space, wherever the ray doesn't pass through much atmosphere
    float air = 1.0 - smoothstep(0.0, mix(1.5, 0.12, uSpace), d.y);
    col = mix(spaceSky(view), col, mix(1.0, air, smoothstep(0.0, 0.4, uSpace)));

    // Sun: wide warm haze, tighter halo, bright disc (bloom does the rest).
    // In space there's no air to scatter it: just a white disc
    s = max(dot(view, uSunDir), 0.0);
    col += uSunColor * (pow(s, 6.0) * 0.55 + pow(s, 60.0) * 1.4 * (1.0 - cloud * 0.6)) * (1.0 - 0.85 * uSpace);
    vec3 disc = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.95, 0.88), uSpace);
    col += disc * smoothstep(0.99982, 0.99988, s) * 7.0 * (1.0 - cloud);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#4f74c4') },
      uMid: { value: new THREE.Color('#b8a8cf') },
      uHorizonSun: { value: new THREE.Color('#ffa24a') },
      uHorizonAway: { value: new THREE.Color('#f4c3a6') },
      uBelt: { value: new THREE.Color('#efb0b8') },
      uSunColor: { value: new THREE.Color('#ff8f3a') },
      uSunDir: { value: SUN_DIR },
      uCloudLit: { value: new THREE.Color('#fff5e4') },
      uCloudShade: { value: new THREE.Color('#a983a3') },
      uCloudRim: { value: new THREE.Color('#ffc890') },
      uSpace: { value: 0 },
      uSpaceLow: { value: new THREE.Color('#251c4a') },
      uSpaceHigh: { value: new THREE.Color('#07060f') },
      uNebulaA: { value: new THREE.Color('#5b2f78') },
      uNebulaB: { value: new THREE.Color('#1f3f7a') },
    },
  })
}

function SkyDome({ radius = 5000, follow = true }) {
  const ref = useRef()
  const material = useMemo(makeSkyMaterial, [])
  useFrame(({ camera }) => {
    if (!follow) return
    ref.current.position.copy(camera.position)
    material.uniforms.uSpace.value = smooth(sim.space)
  })
  return (
    <mesh ref={ref} material={material} renderOrder={-1}>
      <sphereGeometry args={[radius, 48, 24]} />
    </mesh>
  )
}

const SUN_TINT = new THREE.Color(SUN_COLOR)
const SPACE_SUN = new THREE.Color('#fff4e6')

// The sun's shadow box follows the plane so the shadow stays crisp
function Sun() {
  const ref = useRef()
  useFrame(() => {
    const light = ref.current
    light.position.set(sim.x + SUN_DIR.x * 200, sim.y + SUN_DIR.y * 200, SUN_DIR.z * 200)
    light.target.position.set(sim.x, sim.y, 0)
    light.target.updateMatrixWorld()
    // Above the air the sunset's gone: plain white sunlight
    light.color.lerpColors(SUN_TINT, SPACE_SUN, smooth(sim.space))
  })
  return (
    <directionalLight
      ref={ref}
      castShadow
      intensity={3.8}
      color={SUN_COLOR}
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-60}
      shadow-camera-right={60}
      shadow-camera-top={60}
      shadow-camera-bottom={-60}
      shadow-camera-near={60}
      shadow-camera-far={460}
      shadow-bias={-0.0004}
      shadow-normalBias={0.05}
    />
  )
}

// Fill from the camera side (FILL_DIR). Without it the yellow paint turns
// mustard. No shadows, so the backlit look stays.

function Fill() {
  const ref = useRef()
  useFrame(() => {
    const light = ref.current
    light.position.set(sim.x + FILL_DIR.x * 100, sim.y + FILL_DIR.y * 100, FILL_DIR.z * 100)
    light.target.position.set(sim.x, sim.y, 0)
    light.target.updateMatrixWorld()
    light.intensity = 2.2 * (1 - 0.45 * smooth(sim.space))
  })
  return <directionalLight ref={ref} intensity={2.2} color="#fff2e0" />
}

// Climbing into space: the fog thins out, and there's less sky light and
// less sky in the reflections
function Atmosphere({ hemi }) {
  const scene = useThree((s) => s.scene)
  useFrame(() => {
    const s = smooth(sim.space)
    if (scene.fog) {
      scene.fog.color.set(FOG_COLOR).lerp(SPACE_FOG, s)
      scene.fog.near = 320 + 4000 * s
      scene.fog.far = 3200 + 40000 * s
    }
    scene.environmentIntensity = 1 - 0.55 * s
    if (hemi.current) hemi.current.intensity = 0.55 * (1 - 0.6 * s)
  })
  return null
}

export function Lighting() {
  const hemi = useRef()
  return (
    <>
      <hemisphereLight ref={hemi} args={['#c9d6f2', '#6b5a3c', 0.55]} />
      <Atmosphere hemi={hemi} />
      <Sun />
      <Fill />
      {/* What the plane's paint and metal reflect: the same sky, sun and ground
          you see, rendered once into a cube map. */}
      <Environment resolution={512} frames={1}>
        <SkyDome radius={600} follow={false} />
        <mesh rotation-x={-Math.PI / 2} position-y={-3}>
          <circleGeometry args={[500, 48]} />
          <meshBasicMaterial color="#58683a" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={-2.9}>
          <planeGeometry args={[900, 45]} />
          <meshBasicMaterial color="#3a3b3f" />
        </mesh>
      </Environment>
    </>
  )
}

function Ground() {
  const far = useMemo(() => toon({ color: '#86a24f' }), [])
  const near = useMemo(() => toon({ color: '#3f5a26' }), [])
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[1000, 0, -2000]} material={far} receiveShadow>
        <planeGeometry args={[14000, 8000]} />
      </mesh>
      {/* Dark soil under the grass field so gaps between blades read as depth */}
      <mesh rotation-x={-Math.PI / 2} position={[1000, 0.01, 122.5]} material={near} receiveShadow>
        <planeGeometry args={[14000, 200]} />
      </mesh>
    </>
  )
}

function Runway() {
  const tex = useTexture({
    map: assetUrl('/textures/asphalt/asphalt_diff.webp'),
    normalMap: assetUrl('/textures/asphalt/asphalt_normal.webp'),
    arm: assetUrl('/textures/asphalt/asphalt_arm.webp'),
  })
  useEffect(() => loadLog.mark('runway textures decoded'), [])
  const { asphalt, paint, lamp, box, bulb, marks, lights } = useMemo(() => {
    const TILE = 4 // meters per texture repeat
    for (const t of Object.values(tex)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(RUNWAY_LENGTH / TILE, (RUNWAY_HALF_WIDTH * 2) / TILE)
      t.anisotropy = 8
    }
    tex.map.colorSpace = THREE.SRGBColorSpace

    const marks = []
    for (let x = RUNWAY_START + 60; x < RUNWAY_START + RUNWAY_LENGTH - 40; x += 60) marks.push({ p: [x + 18, 0.05, 0], s: [36, 1, 0.9] })
    for (const z of [-RUNWAY_HALF_WIDTH + 0.9, RUNWAY_HALF_WIDTH - 0.9])
      marks.push({ p: [RUNWAY_START + RUNWAY_LENGTH / 2, 0.05, z], s: [RUNWAY_LENGTH, 1, 0.9] })
    for (let i = 0; i < 6; i++)
      for (const side of [-1, 1]) marks.push({ p: [RUNWAY_START + 25, 0.05, side * (3 + i * 3)], s: [30, 1, 1.8] })
    for (const side of [-1, 1]) marks.push({ p: [RUNWAY_START + 420, 0.05, side * 7], s: [45, 1, 9] })

    const lights = []
    for (let x = RUNWAY_START; x <= RUNWAY_START + RUNWAY_LENGTH; x += 60)
      for (const side of [-1, 1]) lights.push({ p: [x, 0.35, side * (RUNWAY_HALF_WIDTH + 1)] })

    return {
      asphalt: new THREE.MeshStandardMaterial({
        map: tex.map,
        normalMap: tex.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughnessMap: tex.arm,
        aoMap: tex.arm,
        color: '#b4b4b4',
      }),
      paint: new THREE.MeshStandardMaterial({ color: '#e6e2d6', roughness: 0.85 }),
      lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(3) }),
      box: new THREE.BoxGeometry(1, 0.02, 1),
      bulb: new THREE.SphereGeometry(0.25, 8, 6),
      marks,
      lights,
    }
  }, [tex])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[RUNWAY_START + RUNWAY_LENGTH / 2, 0.03, 0]} material={asphalt} receiveShadow>
        <planeGeometry args={[RUNWAY_LENGTH, RUNWAY_HALF_WIDTH * 2]} />
      </mesh>
      <Instanced geometry={box} material={paint} transforms={marks} receiveShadow />
      <Instanced geometry={bulb} material={lamp} transforms={lights} />
    </group>
  )
}

function hillGeometry(seed, base, amp) {
  const shape = new THREE.Shape()
  shape.moveTo(-3600, -40)
  for (let x = -3600; x <= 6600; x += 40) {
    const n = 0.55 * Math.sin(x * 0.0021 + seed) + 0.3 * Math.sin(x * 0.0057 + seed * 2.1) + 0.15 * Math.sin(x * 0.013 + seed * 3.7)
    shape.lineTo(x, Math.max(5, base + amp * n))
  }
  shape.lineTo(6600, -40)
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

const HILL_VERTEX = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const HILL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uShade;
  uniform vec3 uLit;
  uniform vec3 uHaze;
  uniform float uHeight;
  uniform float uScale;
  varying vec3 vPos;
  ${NOISE}
  void main() {
    vec3 p = vec3(vPos.xy * uScale, uScale * 37.0);
    // Patches of field, scrub and shadow
    float patches = fbm(p * vec3(1.0, 2.2, 1.0));
    vec3 col = mix(uShade, uColor, smoothstep(0.3, 0.62, patches));
    // Slopes facing the sun (it's off to the left) catch light near the ridge
    float ridge = smoothstep(0.55, 1.0, vPos.y / uHeight);
    float facing = smoothstep(0.45, 0.7, fbm(p * 0.5 + 3.0));
    col = mix(col, uLit, ridge * facing * 0.6);
    // Low haze pooling in the valleys
    col = mix(col, uHaze, (1.0 - smoothstep(0.0, uHeight * 0.6, vPos.y)) * 0.45);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function hillMaterial({ color, shade, lit, haze, height, scale }) {
  return new THREE.ShaderMaterial({
    vertexShader: HILL_VERTEX,
    fragmentShader: HILL_FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uShade: { value: new THREE.Color(shade) },
      uLit: { value: new THREE.Color(lit) },
      uHaze: { value: new THREE.Color(haze) },
      uHeight: { value: height },
      uScale: { value: scale },
    },
  })
}

// Painted layers, like a stage backdrop, hazier the farther back
function Hills() {
  const layers = useMemo(
    () => [
      {
        z: -2300,
        g: hillGeometry(4.2, 160, 140),
        m: hillMaterial({ color: '#d2b9b8', shade: '#b9a2b4', lit: '#f1cdb6', haze: '#f2c9b0', height: 300, scale: 0.006 }),
      },
      {
        z: -1350,
        g: hillGeometry(1.7, 85, 70),
        m: hillMaterial({ color: '#b4ae8e', shade: '#8f8b7e', lit: '#e3c99a', haze: '#ecc6a6', height: 155, scale: 0.01 }),
      },
      {
        z: -720,
        g: hillGeometry(0.4, 34, 28),
        m: hillMaterial({ color: '#7f9758', shade: '#5b7247', lit: '#b9b56a', haze: '#c9b98f', height: 62, scale: 0.02 }),
      },
    ],
    [],
  )
  return layers.map((l) => <mesh key={l.z} geometry={l.g} material={l.m} position={[0, 0, l.z]} />)
}

export function World() {
  return (
    <>
      <fog attach="fog" args={[FOG_COLOR, 320, 3200]} />
      <SkyDome />
      <Lighting />
      <Ground />
      <Runway />
      <Grass />
      <Trees />
      <Airport />
      <Hills />
    </>
  )
}
