import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useTrijetRig } from './useTrijetRig.js'

// A code-built DC-10-style trijet that follows the same contract as the real
// model (prompts/blender-hero-plane.md): real-world meters, nose +X, up +Y,
// right wing +Z, origin on the ground under the main gear, same part names.
// It exists so the scene can be built and timed before trijet.glb arrives.

const NOSE = 31
const TAIL = -24.5
const R = 3 // fuselage radius
const H = 5.2 // fuselage centerline height, gear down
const NO_ANIMATIONS = []

const WHITE = '#f2f1ec'
const NAVY = '#1e2a44'
const BELLY = '#8e959c'

function fuseR(x) {
  if (x >= NOSE) return 0
  if (x > 23) {
    const t = (NOSE - x) / (NOSE - 23)
    return R * Math.sqrt(1 - (1 - t) ** 2)
  }
  if (x > -12) return R
  if (x < TAIL + 0.4) return 0.55 * Math.max(0, (x - TAIL) / 0.4)
  const t = (x - TAIL) / (-12 - TAIL)
  return 0.55 + (R - 0.55) * (1 - (1 - t) ** 2)
}

// Centerline offset: flat-topped upswept tail, slight nose droop
function fuseLift(x) {
  const shrink = R - fuseR(x)
  if (x < -6) return shrink * 0.92
  if (x > 20) return -shrink * 0.3
  return 0
}

function fuselageGeometry() {
  const N = 180
  const points = []
  for (let i = 0; i <= N; i++) {
    const x = TAIL + (i / N) * (NOSE - TAIL)
    points.push(new THREE.Vector2(Math.max(fuseR(x), 0.0001), x))
  }
  // phiStart = π/2 puts the UV seam on the belly, out of the camera's sight
  const g = new THREE.LatheGeometry(points, 128, Math.PI / 2)
  g.rotateZ(-Math.PI / 2) // lathe axis → +X
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + fuseLift(pos.getX(i)))
  return g
}

// Fuselage UVs: u runs around (u = 0.5 is the top, 0.75 the +Z side), v runs tail → nose.
function liveryTexture() {
  const W = 1024
  const HT = 2048
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = HT
  const c = canvas.getContext('2d')
  const heightAt = (u) => -Math.cos(2 * Math.PI * u)
  const rowAt = (x) => (1 - (x - TAIL) / (NOSE - TAIL)) * HT
  // u on each side for a given height (−1 belly … 1 crown)
  const uSides = (h) => {
    const u = Math.acos(-h) / (2 * Math.PI)
    return [u, 1 - u]
  }

  for (let i = 0; i < W; i++) {
    const h = heightAt((i + 0.5) / W)
    c.fillStyle = h > 0.12 ? WHITE : h > 0.04 ? NAVY : h > -0.36 ? WHITE : BELLY
    c.fillRect(i, 0, 1, HT)
  }

  // Faint panel seams every 4 m
  c.fillStyle = 'rgba(0,0,0,0.07)'
  for (let x = -20; x < 24; x += 4) c.fillRect(0, rowAt(x), W, 2)

  const rect = (x0, x1, h0, h1, fill, stroke) => {
    for (const [ua, ub] of [[uSides(h0)[0], uSides(h1)[0]], [uSides(h1)[1], uSides(h0)[1]]]) {
      const left = Math.min(ua, ub) * W
      const width = Math.abs(ub - ua) * W
      const top = rowAt(x1)
      const height = rowAt(x0) - top
      if (fill) {
        c.fillStyle = fill
        c.fillRect(left, top, width, height)
      }
      if (stroke) {
        c.strokeStyle = stroke
        c.lineWidth = 2
        c.strokeRect(left, top, width, height)
      }
    }
  }

  // Cockpit windows: four panes per side
  const panes = [[27.0, 27.5], [27.58, 28.08], [28.16, 28.62], [28.7, 29.15]]
  for (const [x0, x1] of panes) rect(x0, x1, 0.3, 0.5, '#0b0f14')
  // Door outlines
  rect(23.4, 24.5, -0.25, 0.55, null, 'rgba(60,60,60,0.35)')
  rect(-6.6, -5.5, -0.25, 0.55, null, 'rgba(60,60,60,0.35)')

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function spinnerTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const c = canvas.getContext('2d')
  c.fillStyle = '#e9e9e6'
  c.fillRect(0, 0, 256, 256)
  // The painted spiral that makes a spinning fan readable
  c.strokeStyle = '#15181c'
  c.lineWidth = 22
  c.beginPath()
  for (let v = 0; v <= 1; v += 0.02) {
    const x = (0.15 + 0.6 * v) * 256
    const y = (1 - v) * 256
    v === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
  }
  c.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function smooth(g) {
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  const merged = mergeVertices(g, 1e-3)
  merged.computeVertexNormals()
  return merged
}

// A swept, tapered lifting surface. Span runs along +Z, thickness along Y.
function wingGeometry({ rootLE, sweep, rootChord, tipChord, span, thickness, taper = 0.6 }) {
  const le = (s) => rootLE - sweep * s
  const chord = (s) => rootChord + (tipChord - rootChord) * (s / span)
  const shape = new THREE.Shape()
  shape.moveTo(le(0), 0)
  shape.lineTo(le(span), span)
  shape.lineTo(le(span) - chord(span), span)
  shape.lineTo(le(0) - chord(0), 0)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.5,
    bevelSize: Math.min(0.35, thickness * 0.6),
    bevelSegments: 4,
    curveSegments: 1,
  })
  g.rotateX(Math.PI / 2)
  g.translate(0, thickness / 2, 0)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const f = 1 - taper * THREE.MathUtils.clamp(pos.getZ(i) / span, 0, 1)
    pos.setY(i, pos.getY(i) * f)
  }
  return smooth(g)
}

function finGeometry() {
  const v = (x, y) => new THREE.Vector2(x, y)
  const shape = new THREE.Shape([v(-14.4, 7.6), v(-15.8, 11.6), v(-20.9, 18.6), v(-23.9, 18.6), v(-23.4, 11.6), v(-24.0, 7.2)])
  const depth = 0.5
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 3, curveSegments: 1 })
  g.translate(0, 0, -depth / 2)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const f = 1 - 0.45 * THREE.MathUtils.clamp((pos.getY(i) - 8) / 10.6, 0, 1)
    pos.setZ(i, pos.getZ(i) * f)
  }
  return smooth(g)
}

// Engine nacelle, local x = 0 at the exhaust, inlet lip at x ≈ 6.9
function nacelleGeometries() {
  const lathe = (pts) => {
    const g = new THREE.LatheGeometry(pts.map(([r, x]) => new THREE.Vector2(r, x)), 64, Math.PI / 2)
    g.rotateZ(-Math.PI / 2)
    return g
  }
  const body = lathe([[0.88, 0], [1.05, 0.6], [1.25, 1.8], [1.38, 3.2], [1.42, 4.4], [1.4, 5.6], [1.36, 6.3]])
  const lip = lathe([[1.36, 6.3], [1.33, 6.75], [1.27, 6.92], [1.19, 6.85], [1.15, 6.6], [1.13, 5.7]])
  const core = new THREE.CylinderGeometry(0.86, 0.86, 0.7, 40, 1, true).rotateZ(Math.PI / 2)
  const coreCap = new THREE.CircleGeometry(0.86, 40).rotateY(-Math.PI / 2)
  const plug = new THREE.ConeGeometry(0.55, 1.6, 40).rotateZ(Math.PI / 2)
  const pylon = new THREE.BoxGeometry(4.4, 1.0, 0.36)

  const fanDisc = new THREE.CylinderGeometry(1.12, 1.12, 0.06, 48).rotateZ(Math.PI / 2)
  const blade = new THREE.BoxGeometry(0.04, 0.82, 0.3)
  const blades = mergeGeometries(
    Array.from({ length: 26 }, (_, i) =>
      blade.clone().rotateY(0.55).translate(0, 0.76, 0).rotateX((i / 26) * Math.PI * 2),
    ),
  )
  const spinner = new THREE.ConeGeometry(0.36, 0.75, 40).rotateZ(-Math.PI / 2).translate(0.4, 0, 0)
  const fanBlur = new THREE.CircleGeometry(1.12, 48).rotateY(Math.PI / 2).translate(0.06, 0, 0)
  return { body, lip, core, coreCap, plug, pylon, fanDisc, blades, spinner, fanBlur }
}

function gearGeometries() {
  const mainWheel = new THREE.CylinderGeometry(0.62, 0.62, 0.38, 28).rotateX(Math.PI / 2)
  const mainHub = new THREE.CylinderGeometry(0.32, 0.32, 0.4, 20).rotateX(Math.PI / 2)
  const noseWheel = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 24).rotateX(Math.PI / 2)
  const noseHub = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 16).rotateX(Math.PI / 2)
  const strut = (len, r) => new THREE.CylinderGeometry(r, r * 1.2, len, 14).translate(0, -len / 2, 0)
  return {
    mainWheel,
    mainHub,
    noseWheel,
    noseHub,
    mainStrut: strut(2.75, 0.17),
    centerStrut: strut(1.75, 0.15),
    noseStrut: strut(2.0, 0.12),
    bogie: new THREE.BoxGeometry(2.0, 0.22, 0.25),
    axle: new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8).rotateX(Math.PI / 2),
  }
}

function buildParts() {
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ map: liveryTexture(), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
    finPaint: new THREE.MeshPhysicalMaterial({ color: WHITE, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
    wing: new THREE.MeshStandardMaterial({ color: '#c9cdd1', roughness: 0.45, metalness: 0.25 }),
    polished: new THREE.MeshStandardMaterial({ color: '#e4e8ec', metalness: 1, roughness: 0.18, side: THREE.DoubleSide }),
    darkMetal: new THREE.MeshStandardMaterial({ color: '#2a2e33', metalness: 0.9, roughness: 0.45, side: THREE.DoubleSide }),
    titanium: new THREE.MeshStandardMaterial({ color: '#8a9098', metalness: 1, roughness: 0.35 }),
    spinner: new THREE.MeshStandardMaterial({ map: spinnerTexture(), metalness: 0.3, roughness: 0.35 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.92 }),
    strut: new THREE.MeshStandardMaterial({ color: '#9aa1a8', metalness: 0.85, roughness: 0.3 }),
  }
  materials.nacellePaint = materials.finPaint
  const wing = wingGeometry({ rootLE: 9, sweep: 0.7, rootChord: 12, tipChord: 2.7, span: 25.2, thickness: 0.55 })
  const stab = wingGeometry({ rootLE: -15.2, sweep: 0.75, rootChord: 6.6, tipChord: 2.6, span: 10.9, thickness: 0.32, taper: 0.5 })
  return {
    m: materials,
    g: { fuselage: fuselageGeometry(), wing, stab, fin: finGeometry(), nacelle: nacelleGeometries(), gear: gearGeometries() },
  }
}

function Engine({ id, position, parts, pylon }) {
  const { g, m } = parts
  const n = g.nacelle
  const blurMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#2a2e33', transparent: true, opacity: 0, depthWrite: false }),
    [],
  )
  return (
    <group position={position}>
      <mesh geometry={n.body} material={m.nacellePaint} />
      <mesh geometry={n.lip} material={m.polished} />
      <mesh geometry={n.core} material={m.darkMetal} position={[0.35, 0, 0]} />
      <mesh geometry={n.coreCap} material={m.darkMetal} position={[0.7, 0, 0]} />
      <mesh geometry={n.plug} material={m.darkMetal} position={[-0.5, 0, 0]} />
      {pylon && <mesh geometry={n.pylon} material={m.wing} position={[3.2, 1.55, 0]} />}
      <group name={`Fan_${id}`} position={[5.75, 0, 0]}>
        <mesh geometry={n.fanDisc} material={m.darkMetal} />
        <mesh geometry={n.blades} material={m.titanium} />
        <mesh geometry={n.spinner} material={m.spinner} />
        <mesh name="FanBlur" geometry={n.fanBlur} material={blurMaterial} />
      </group>
    </group>
  )
}

function Wheels({ geometry, hub, material, hubMaterial, positions }) {
  return positions.map((p, i) => (
    <group key={i} position={p}>
      <mesh geometry={geometry} material={material} />
      <mesh geometry={hub} material={hubMaterial} />
    </group>
  ))
}

function MainGear({ name, z, parts }) {
  const { g, m } = parts
  const axleY = 0.62 - 3.3
  return (
    <group name={name} position={[0, 3.3, z]}>
      <mesh geometry={g.gear.mainStrut} material={m.strut} />
      <mesh geometry={g.gear.bogie} material={m.strut} position={[0, axleY, 0]} />
      <Wheels
        geometry={g.gear.mainWheel}
        hub={g.gear.mainHub}
        material={m.rubber}
        hubMaterial={m.strut}
        positions={[[0.75, axleY, 0.42], [0.75, axleY, -0.42], [-0.75, axleY, 0.42], [-0.75, axleY, -0.42]]}
      />
    </group>
  )
}

function Light({ name, position, scale }) {
  return (
    <mesh name={name} position={position} scale={scale}>
      <sphereGeometry args={[0.2, 16, 12]} />
      <meshStandardMaterial color="#222222" roughness={0.3} />
    </mesh>
  )
}

export function StandInTrijet() {
  const ref = useRef()
  const parts = useMemo(buildParts, [])
  const { g, m } = parts
  useTrijetRig(ref, NO_ANIMATIONS)

  useLayoutEffect(() => {
    ref.current.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true
    })
  }, [])

  const wingY = 3.4
  const tipY = wingY + 25.2 * Math.sin(0.09)
  return (
    <group ref={ref} name="Trijet">
      <group name="Airframe">
        <mesh geometry={g.fuselage} material={m.paint} position={[0, H, 0]} />
        <mesh geometry={g.wing} material={m.wing} position={[0, wingY, 0]} rotation={[-0.09, 0, 0]} />
        <mesh geometry={g.wing} material={m.wing} position={[0, wingY, 0]} rotation={[0.09, 0, 0]} scale={[1, 1, -1]} />
        <mesh geometry={g.stab} material={m.wing} position={[0, 5.9, 0]} rotation={[-0.05, 0, 0]} />
        <mesh geometry={g.stab} material={m.wing} position={[0, 5.9, 0]} rotation={[0.05, 0, 0]} scale={[1, 1, -1]} />
        <mesh geometry={g.fin} material={m.finPaint} />
      </group>

      <Engine id="L" position={[-0.6, 2.05, -8.6]} parts={parts} pylon />
      <Engine id="R" position={[-0.6, 2.05, 8.6]} parts={parts} pylon />
      <Engine id="C" position={[-22.6, 10.1, 0]} parts={parts} />

      <group name="Gear_Nose" position={[25.2, 2.4, 0]}>
        <mesh geometry={g.gear.noseStrut} material={m.strut} />
        <mesh geometry={g.gear.axle} material={m.strut} position={[0, -1.95, 0]} />
        <Wheels
          geometry={g.gear.noseWheel}
          hub={g.gear.noseHub}
          material={m.rubber}
          hubMaterial={m.strut}
          positions={[[0, -1.95, 0.3], [0, -1.95, -0.3]]}
        />
        <Light name="Light_Landing" position={[0.25, -1.1, 0]} scale={[0.8, 0.8, 0.8]} />
      </group>
      <MainGear name="Gear_Main_L" z={-5.4} parts={parts} />
      <MainGear name="Gear_Main_R" z={5.4} parts={parts} />
      <group name="Gear_Center" position={[1.5, 2.3, 0]}>
        <mesh geometry={g.gear.centerStrut} material={m.strut} />
        <Wheels
          geometry={g.gear.mainWheel}
          hub={g.gear.mainHub}
          material={m.rubber}
          hubMaterial={m.strut}
          positions={[[0, -1.68, 0.42], [0, -1.68, -0.42]]}
        />
      </group>

      <Light name="Light_Nav_L" position={[-9.9, tipY, -25.25]} />
      <Light name="Light_Nav_R" position={[-9.9, tipY, 25.25]} />
      <Light name="Light_Strobe_Tail" position={[-24.75, 7.96, 0]} scale={[0.9, 0.9, 0.9]} />
      <Light name="Light_Beacon_Top" position={[6, 8.25, 0]} scale={[1.1, 0.6, 1.1]} />
      <Light name="Light_Beacon_Bottom" position={[3, 2.15, 0]} scale={[1.1, 0.6, 1.1]} />
    </group>
  )
}
