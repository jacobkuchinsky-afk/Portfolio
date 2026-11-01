import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useFlight } from './state/useFlight.js'
import { engineAudio } from './audio/engineAudio.js'
import { loadScene1 } from './boot/assets.js'
import { bootScreen } from './boot/bootScreen.js'
import { DOWNLOAD_SHARE, Warmup, startBuilding } from './boot/Warmup.jsx'
import { Scene1 } from './scene/Scene1.jsx'
import { Dashboard } from './ui/Dashboard.jsx'
import { Preflight } from './ui/Preflight.jsx'
import { SceneEnd } from './ui/SceneEnd.jsx'
import { Showcase } from './ui/Showcase.jsx'
import { Enemy } from './ui/Enemy.jsx'

export default function App() {
  const modelUrl = useFlight((s) => s.modelUrl)
  const muted = useFlight((s) => s.muted)
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio, 1.5))

  useEffect(() => {
    loadScene1((fraction, label) => bootScreen.progress(fraction * DOWNLOAD_SHARE, label))
      .then(({ modelUrl }) => {
        startBuilding()
        useFlight.getState().setModelUrl(modelUrl)
      })
      .catch((error) => {
        console.error(error)
        bootScreen.failed()
      })
  }, [])

  useEffect(() => engineAudio.setMuted(muted), [muted])

  return (
    <div className="app">
      <main className="sky">
        <Canvas
          shadows
          dpr={dpr}
          camera={{ fov: 30, near: 0.5, far: 6000, position: [0, 3, 80] }}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
        >
          <PerformanceMonitor
            onDecline={() => setDpr(1)}
            onIncline={() => setDpr(Math.min(window.devicePixelRatio, 1.75))}
          />
          <Suspense fallback={null}>
            {modelUrl !== undefined && (
              <>
                <Scene1 />
                <Warmup canvas="sky" />
              </>
            )}
          </Suspense>
        </Canvas>
        <Showcase />
        <Enemy />
        <SceneEnd />
      </main>
      <Dashboard />
      <Preflight />
    </div>
  )
}
