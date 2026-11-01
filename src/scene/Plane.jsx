import { Component, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { sim } from '../flight/sim.js'
import { useFlight } from '../state/useFlight.js'
import { StandInTrijet } from './StandInTrijet.jsx'
import { useTrijetRig } from './useTrijetRig.js'
import { dracoLoader } from '../boot/assets.js'
import { loadLog } from '../boot/loadLog.js'

const useOurDraco = (loader) => loader.setDRACOLoader(dracoLoader)

function GltfTrijet({ url }) {
  const { scene, animations } = useGLTF(url, false, false, useOurDraco)
  useEffect(() => loadLog.mark('plane parsed'), [])
  const ref = useRef()
  useTrijetRig(ref, animations)
  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true
    })
  }, [scene])
  return <primitive ref={ref} object={scene} />
}

// If trijet.glb is broken, fall back to the stand-in instead of a blank sky
class FallbackToStandIn extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    console.warn('trijet.glb failed to load, using the stand-in plane.', error)
  }
  render() {
    return this.state.failed ? <StandInTrijet /> : this.props.children
  }
}

// The model's origin is on the ground under the main gear; it rolls about
// the fuselage's centre line instead, this high above that.
export const ROLL_AXIS_Y = 5.5

const toAxis = new THREE.Matrix4().makeTranslation(0, ROLL_AXIS_Y, 0)
const fromAxis = new THREE.Matrix4().makeTranslation(0, -ROLL_AXIS_Y, 0)
const turn = new THREE.Matrix4()

// Model space → world for a given pose: the same transform the groups in
// <Plane> build, for placing things around a pose the plane isn't in yet.
export function planePose(out, x, y, pitch, roll) {
  out.makeRotationZ(pitch).setPosition(x, y, 0)
  out.multiply(toAxis).multiply(turn.makeRotationX(roll)).multiply(fromAxis)
  return out
}

// Roughly the middle of the plane in model space: what the camera, focus and blur aim at
const CENTER = new THREE.Vector3(2, ROLL_AXIS_Y, 0)
const centerPose = new THREE.Matrix4()

// Where the middle of the plane is right now, in world space
export function planeCenter(out) {
  return out.copy(CENTER).applyMatrix4(planePose(centerPose, sim.x, sim.y, sim.pitch, sim.roll))
}

export function Plane() {
  const modelUrl = useFlight((s) => s.modelUrl)
  const ref = useRef()
  const rollRef = useRef()

  useFrame(() => {
    ref.current.position.set(sim.x, sim.y, 0)
    ref.current.rotation.z = sim.pitch // pitches about the main gear, like a real rotation
    rollRef.current.rotation.x = sim.roll // negative = right wing up, belly toward the camera
  })

  return (
    <group ref={ref}>
      <group ref={rollRef} position-y={ROLL_AXIS_Y}>
        <group position-y={-ROLL_AXIS_Y}>
          {modelUrl ? (
            <FallbackToStandIn>
              <GltfTrijet url={modelUrl} />
            </FallbackToStandIn>
          ) : (
            <StandInTrijet />
          )}
        </group>
      </group>
    </group>
  )
}
