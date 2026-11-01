import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

export function rng(seed) {
  // mulberry32: same layout on every load
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// One draw call for many copies of the same mesh.
// transforms: [{ p: [x,y,z], s?: [x,y,z], r?: [x,y,z], c?: color }]
export function Instanced({ geometry, material, transforms, receiveShadow }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const mesh = ref.current
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const color = new THREE.Color()
    transforms.forEach((t, i) => {
      p.fromArray(t.p)
      s.fromArray(t.s ?? [1, 1, 1])
      q.setFromEuler(e.set(...(t.r ?? [0, 0, 0])))
      mesh.setMatrixAt(i, m.compose(p, q, s))
      if (t.c) mesh.setColorAt(i, color.set(t.c))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [transforms])
  return <instancedMesh ref={ref} args={[geometry, material, transforms.length]} receiveShadow={receiveShadow} />
}
