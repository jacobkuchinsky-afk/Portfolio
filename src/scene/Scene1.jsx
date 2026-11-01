import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer, Bloom, DepthOfField, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { World } from './World.jsx'
import { Plane } from './Plane.jsx'
import { CameraRig } from './CameraRig.jsx'
import { ShowcaseAnchor } from './ShowcaseAnchor.jsx'
import { FlightDirector } from '../flight/FlightDirector.jsx'
import { sim } from '../flight/sim.js'
import { PaintPass } from './PaintPass.js'
import { Smoke } from './Smoke.jsx'
import { GameCard3D } from './GameCard3D.jsx'
import { ZoomBlurEffect } from './ZoomBlur.js'
import { planeCenter } from './Plane.jsx'

const smooth = (t) => t * t * (3 - 2 * t)
const onScreen = new THREE.Vector3()

function Effects() {
  const dof = useRef()
  const camera = useThree((s) => s.camera)
  const paint = useMemo(() => new PaintPass(camera), [camera])
  const zoomBlur = useMemo(() => new ZoomBlurEffect(), [])
  useEffect(() => () => (paint.dispose(), zoomBlur.dispose()), [paint, zoomBlur])
  useFrame(() => {
    // Keep the plane in focus; the grass right in front of the lens goes soft
    planeCenter(onScreen)
    dof.current?.target?.copy(onScreen)
    // Speed blur, streaking out from the plane
    onScreen.project(camera)
    zoomBlur.uniforms.get('center').value.set(onScreen.x * 0.5 + 0.5, onScreen.y * 0.5 + 0.5)
    zoomBlur.uniforms.get('strength').value = sim.boost * THREE.MathUtils.smoothstep(sim.speed, 120, 420) * 0.07
    // Finer brush strokes in space, so the stars survive as dabs of paint
    paint.kuwaharaMaterial.uniforms.radius.value = 6 - 2.5 * smooth(sim.space)
  })
  return (
    <EffectComposer multisampling={4}>
      {/* Contact shadows: where wheels, nacelles and fuselage meet light and each other */}
      <N8AO aoRadius={2.5} distanceFalloff={1} intensity={2.2} halfRes />
      {/* Background only: hills, trees, clouds and sky become brush strokes.
          Painted from the sharp image, laid back on after depth of field */}
      <primitive object={paint} />
      <DepthOfField ref={dof} target={[0, 0, 0]} worldFocusRange={70} bokehScale={2.5} resolutionScale={0.5} />
      <primitive object={paint.composite} />
      <primitive object={zoomBlur} />
      <Bloom mipmapBlur intensity={0.7} luminanceThreshold={1} luminanceSmoothing={0.2} />
      {/* The composer turns off the renderer's tone mapping, so it's applied here */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.4} />
    </EffectComposer>
  )
}

// Scene 1: engine start, taxi and takeoff, seen from the runway edge.
// Scene 2 continues in the same world: the climb, the bank and the cards.
// Scene 3 too: the boost into space.
export function Scene1() {
  return (
    <>
      <World />
      <Plane />
      {/* Before the sim steps, so the trail starts exactly where the plane is drawn */}
      <Smoke />
      <CameraRig />
      {/* After the camera, so the card is placed in this frame's shot */}
      <GameCard3D />
      {/* After the camera, before the sim steps: lays the cards out for exactly this frame */}
      <ShowcaseAnchor />
      <FlightDirector />
      <Effects />
    </>
  )
}
