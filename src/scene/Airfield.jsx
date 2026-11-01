import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { paintedMaterial } from './painted.js'
import { rng, Instanced } from './Instanced.jsx'

// Trees, hangars and the tower. They sit where PaintPass turns the scene into
// brush strokes, so they're built for that: clear shapes a few metres across
// (smaller detail just smears) and painted shading with real variation in it.

// A tree crown made of overlapping lumps, like the foliage masses in a
// painted background. Normals are bent out from the crown's centre so it
// shades as one rounded mass with lumps on it, not a pile of balls.
function crownGeometry(rand, { lumps, width, height, lumpSize }) {
  const half = new THREE.Vector3(width / 2, height / 2, width / 2)
  const center = new THREE.Vector3(0, height / 2, 0)
  const parts = [new THREE.IcosahedronGeometry(1, 1).scale(half.x * 0.75, half.y * 0.75, half.z * 0.75).translate(0, center.y, 0)]
  const p = new THREE.Vector3()
  for (let i = 0; i < lumps; i++) {
    do p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1)
    while (p.lengthSq() > 1)
    const r = lumpSize * (0.75 + rand() * 0.5)
    p.multiply(half).multiplyScalar(0.75).add(center)
    parts.push(new THREE.IcosahedronGeometry(r, 1).translate(p.x, p.y, p.z))
  }
  const geometry = mergeGeometries(parts)
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const n = new THREE.Vector3()
  const out = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    out.fromBufferAttribute(pos, i).sub(center).divide(half).normalize()
    n.fromBufferAttribute(nrm, i).multiplyScalar(0.45).addScaledVector(out, 0.55).normalize()
    nrm.setXYZ(i, n.x, n.y, n.z)
  }
  return geometry
}

// Low-poly shapes read as painted planes once they're flat-shaded
function faceted(geometry) {
  const g = geometry.toNonIndexed()
  g.computeVertexNormals()
  return g
}

const gauss = (rand) => rand() + rand() + rand() - 1.5

// Keep the hangar apron and the tower clear
const blocked = (x, z) => (x > -385 && x < 125 && z > -290 && z < -172) || (x > 30 && x < 90 && z > -180 && z < -120)

export function Trees() {
  const { geometries, materials, lists } = useMemo(() => {
    const rand = rng(21)
    const geometries = {
      round: crownGeometry(rand, { lumps: 6, width: 6.5, height: 5.8, lumpSize: 2 }),
      wide: crownGeometry(rand, { lumps: 7, width: 8.5, height: 5.2, lumpSize: 2.2 }),
      poplar: crownGeometry(rand, { lumps: 5, width: 2.6, height: 11, lumpSize: 1.2 }),
      trunk: new THREE.CylinderGeometry(0.22, 0.38, 1, 6).translate(0, 0.5, 0),
    }
    const tints = ['#ffffff', '#eef4dc', '#fff2d8', '#dfece4', '#f6f0d0']
    const lists = { round: [], wide: [], poplar: [], trunk: [] }

    const plant = (kind, x, z, s) => {
      if (blocked(x, z)) return
      const poplar = kind === 'poplar'
      const trunk = (poplar ? 1.4 : 2.2 + rand()) * s
      const yaw = rand() * Math.PI * 2
      lists.trunk.push({ p: [x, 0, z], s: [s, trunk, s] })
      lists[kind].push({
        p: [x, trunk * 0.75, z],
        s: [s, s * (0.9 + rand() * 0.25), s],
        r: [0, yaw, 0],
        c: tints[Math.floor(rand() * tints.length)],
      })
    }
    const broadleaf = () => (rand() < 0.55 ? 'round' : 'wide')

    // Hedgerow along the back of the field, in runs with gaps between them
    for (let x = -900; x < 2500; ) {
      const end = x + 40 + rand() * 140
      for (; x < end; x += 5 + rand() * 4) plant(broadleaf(), x, -80 - rand() * 8, 0.75 + rand() * 0.3)
      x += 25 + rand() * 70
    }
    // Copses further back, bigger trees in the middle of each
    for (let i = 0; i < 55; i++) {
      const cx = -900 + rand() * 3400
      const cz = -130 - rand() * rand() * 440
      const spread = 10 + rand() * 22
      const count = 5 + Math.floor(rand() * 14)
      for (let j = 0; j < count; j++) {
        const dx = gauss(rand) * spread
        const dz = gauss(rand) * spread * 0.6
        const s = 0.85 + 0.5 * Math.max(0, 1 - Math.hypot(dx, dz) / (spread * 1.5)) + rand() * 0.2
        plant(broadleaf(), cx + dx, cz + dz, s)
      }
    }
    // Poplar windbreaks, some along the field and some running away from it
    for (let i = 0; i < 8; i++) {
      const along = rand() < 0.6
      const x0 = -800 + rand() * 3100
      const z0 = -110 - rand() * 300
      const count = 8 + Math.floor(rand() * 10)
      for (let j = 0; j < count; j++) {
        const d = j * (5 + rand() * 1.2)
        plant('poplar', along ? x0 + d : x0 + rand() * 1.5, along ? z0 + rand() * 1.5 : z0 - d, 0.85 + rand() * 0.3)
      }
    }

    const leaves = { rim: '#f4cf8a', rimAmount: 0.7, patch: 0.35, patchAmount: 0.7 }
    const materials = {
      broadleaf: paintedMaterial({ shadow: '#34503a', mid: '#5f8a43', light: '#a8b85a', ...leaves }),
      poplar: paintedMaterial({ shadow: '#2f4936', mid: '#55803f', light: '#97ad55', ...leaves }),
      bark: paintedMaterial({ shadow: '#3e2c22', mid: '#5e4231', light: '#7d5a40', rimAmount: 0.3 }),
    }
    return { geometries, materials, lists }
  }, [])

  return (
    <>
      <Instanced geometry={geometries.trunk} material={materials.bark} transforms={lists.trunk} />
      <Instanced geometry={geometries.round} material={materials.broadleaf} transforms={lists.round} />
      <Instanced geometry={geometries.wide} material={materials.broadleaf} transforms={lists.wide} />
      <Instanced geometry={geometries.poplar} material={materials.poplar} transforms={lists.poplar} />
    </>
  )
}

function useAirfieldMaterials() {
  return useMemo(() => {
    const roof = { ribs: 1.4, patch: 0.1, patchAmount: 0.3 }
    return {
      wall: paintedMaterial({ shadow: '#a39582', mid: '#d8cab0', light: '#f0e4cb', ribs: 1.4, grime: true, patch: 0.12, patchAmount: 0.35 }),
      roofs: [
        paintedMaterial({ shadow: '#6e3a33', mid: '#a5574a', light: '#cf8a6c', ...roof }),
        paintedMaterial({ shadow: '#4c6360', mid: '#6f8a86', light: '#a3b6ad', ...roof }),
        paintedMaterial({ shadow: '#5d6670', mid: '#8a949c', light: '#b9c0c2', ...roof }),
      ],
      door: paintedMaterial({ shadow: '#46515b', mid: '#66737f', light: '#929da5', ribs: 0.9, grime: true, patch: 0.15 }),
      dark: paintedMaterial({ shadow: '#16191c', mid: '#24282c', light: '#353a3e', rimAmount: 0 }),
      trim: paintedMaterial({ shadow: '#6b6660', mid: '#8f8a82', light: '#b4aea4', patch: 0.2 }),
      window: paintedMaterial({ shadow: '#26343d', mid: '#3e515c', light: '#7c939b', rimAmount: 0.2 }),
      concrete: paintedMaterial({ shadow: '#a69a8a', mid: '#d6cbb9', light: '#efe6d6', grime: true, patch: 0.15, patchAmount: 0.35 }),
      rail: paintedMaterial({ shadow: '#6b6660', mid: '#8f8a82', light: '#b4aea4', side: THREE.DoubleSide }),
      cab: paintedMaterial({ shadow: '#1f3a45', mid: '#35596a', light: '#f3c7a3', glass: true, frame: '#e9e2d4', rimAmount: 0.3 }),
      sock: paintedMaterial({ shadow: '#b84a22', mid: '#ff7a2f', light: '#ffb070', side: THREE.DoubleSide }),
    }
  }, [])
}

const HANGAR = { width: 36, depth: 30, wall: 10, rise: 8 }

// Arched hangar: corrugated walls, a curved roof, sliding doors facing the
// runway, a row of side windows and roof vents
function Hangar({ m, roof, open, annex, ...props }) {
  const { width, depth, wall, rise } = HANGAR
  const g = useMemo(() => {
    const radius = width / 2
    return {
      roof: new THREE.CylinderGeometry(radius, radius, depth, 24, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, rise / radius, 1),
      gable: new THREE.CircleGeometry(radius, 24, 0, Math.PI).scale(1, rise / radius, 1),
    }
  }, [width, depth, rise])
  const front = depth / 2
  const panels = open
    ? [[-13.5, 0.2], [-12.5, 0.6], [12.5, 0.6], [13.5, 0.2]]
    : [[-13.5, 0.2], [-4.5, 0.55], [4.5, 0.2], [13.5, 0.55]]
  return (
    <group {...props}>
      <mesh position={[0, wall / 2, 0]} material={m.wall}>
        <boxGeometry args={[width, wall, depth]} />
      </mesh>
      <mesh position={[0, wall, 0]} geometry={g.roof} material={roof} />
      <mesh position={[0, wall, front]} geometry={g.gable} material={m.wall} />
      <mesh position={[0, wall, -front]} rotation-y={Math.PI} geometry={g.gable} material={m.wall} />
      {open && (
        <mesh position={[0, 4.5, front + 0.05]} material={m.dark}>
          <boxGeometry args={[18, 9, 0.1]} />
        </mesh>
      )}
      {panels.map(([x, z]) => (
        <mesh key={x} position={[x, 4.5, front + z]} material={m.door}>
          <boxGeometry args={[8.9, 9, 0.35]} />
        </mesh>
      ))}
      <mesh position={[0, 9.6, front + 0.5]} material={m.trim}>
        <boxGeometry args={[width + 1, 1.2, 0.9]} />
      </mesh>
      {[-1, 1].map((side) =>
        [-10, -5, 0, 5, 10].map((z) => (
          <mesh key={`${side}${z}`} position={[side * (width / 2 + 0.05), 7.4, z]} material={m.window}>
            <boxGeometry args={[0.15, 1.4, 2.8]} />
          </mesh>
        )),
      )}
      {[-9, 0, 9].map((z) => (
        <mesh key={z} position={[0, wall + rise + 0.3, z]} material={m.trim}>
          <boxGeometry args={[1.4, 1.2, 1.4]} />
        </mesh>
      ))}
      {annex && (
        // Lean-to office on the side
        <group position={[-(width / 2 + 4.5), 0, 6]}>
          <mesh position={[0, 2.5, 0]} material={m.wall}>
            <boxGeometry args={[9, 5, 14]} />
          </mesh>
          <mesh position={[0, 5.25, 0]} material={m.trim}>
            <boxGeometry args={[9.8, 0.5, 14.8]} />
          </mesh>
          {[-2.2, 2.2].map((x) => (
            <mesh key={x} position={[x, 3, 7.05]} material={m.window}>
              <boxGeometry args={[2.6, 1.5, 0.15]} />
            </mesh>
          ))}
          <mesh position={[3.4, 1.2, 7.05]} material={m.door}>
            <boxGeometry args={[1.3, 2.4, 0.15]} />
          </mesh>
        </group>
      )}
    </group>
  )
}

// Control tower: two-storey base, faceted shaft, a catwalk and a glass cab
function Tower({ m, ...props }) {
  const g = useMemo(
    () => ({
      shaft: faceted(new THREE.CylinderGeometry(2.4, 3, 22, 8)),
      band: faceted(new THREE.CylinderGeometry(1, 1, 0.6, 8)),
      deck: faceted(new THREE.CylinderGeometry(6.8, 6.4, 0.5, 8)),
      rail: new THREE.CylinderGeometry(6.7, 6.7, 1, 8, 1, true),
      cab: faceted(new THREE.CylinderGeometry(6, 5, 4.5, 8)),
      roof: faceted(new THREE.CylinderGeometry(6.3, 6.7, 0.8, 8)),
      mast: new THREE.CylinderGeometry(0.18, 0.25, 7, 6),
    }),
    [],
  )
  return (
    <group {...props}>
      <mesh position={[0, 3.5, 0]} material={m.concrete}>
        <boxGeometry args={[16, 7, 12]} />
      </mesh>
      <mesh position={[0, 7.2, 0]} material={m.trim}>
        <boxGeometry args={[16.6, 0.4, 12.6]} />
      </mesh>
      <mesh position={[-1, 4.6, 6.05]} material={m.window}>
        <boxGeometry args={[12, 1.4, 0.15]} />
      </mesh>
      <mesh position={[6, 1.5, 6.05]} material={m.door}>
        <boxGeometry args={[2, 3, 0.15]} />
      </mesh>
      <mesh position={[0, 18, 0]} geometry={g.shaft} material={m.concrete} />
      <mesh position={[0, 14, 0]} scale={[2.95, 1, 2.95]} geometry={g.band} material={m.trim} />
      <mesh position={[0, 22, 0]} scale={[2.75, 1, 2.75]} geometry={g.band} material={m.trim} />
      <mesh position={[0, 29.25, 0]} geometry={g.deck} material={m.trim} />
      <mesh position={[0, 30, 0]} geometry={g.rail} material={m.rail} />
      <mesh position={[0, 31.75, 0]} geometry={g.cab} material={m.cab} />
      <mesh position={[0, 34.4, 0]} geometry={g.roof} material={m.trim} />
      <mesh position={[0, 35.6, 0]} material={m.concrete}>
        <boxGeometry args={[3, 1.6, 3]} />
      </mesh>
      <mesh position={[0.6, 39.9, 0.6]} geometry={g.mast} material={m.trim} />
    </group>
  )
}

// Hangars, tower and a windsock: tells you "airport" at a glance
export function Airport() {
  const m = useAirfieldMaterials()
  return (
    <group>
      <Hangar m={m} roof={m.roofs[0]} annex position={[-340, 0, -230]} />
      <Hangar m={m} roof={m.roofs[1]} open position={[-255, 0, -230]} />
      <Hangar m={m} roof={m.roofs[2]} position={[-170, 0, -230]} />
      <Tower m={m} position={[60, 0, -150]} />
      <group position={[-110, 0, -36]}>
        <mesh position={[0, 3, 0]} material={m.trim}>
          <cylinderGeometry args={[0.08, 0.1, 6, 8]} />
        </mesh>
        <mesh position={[1.4, 5.8, 0]} rotation-z={Math.PI / 2 + 0.15} material={m.sock}>
          <coneGeometry args={[0.45, 2.8, 12, 1, true]} />
        </mesh>
      </group>
    </group>
  )
}
