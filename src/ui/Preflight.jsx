import { useEffect } from 'react'
import { useFlight } from '../state/useFlight.js'
import { resetSim } from '../flight/sim.js'
import { engineAudio } from '../audio/engineAudio.js'
import { bootScreen } from '../boot/bootScreen.js'

// The boarding pass itself lives in index.html (see bootScreen.js). This
// hooks its button up once the scene is ready, and dismisses it on begin.
// The click also unlocks audio, which browsers only allow after a gesture.
export function Preflight() {
  const phase = useFlight((s) => s.phase)

  useEffect(() => {
    if (phase !== 'ready') return
    bootScreen.ready(() => {
      engineAudio.init()
      engineAudio.setMuted(useFlight.getState().muted)
      resetSim()
      useFlight.getState().begin()
      bootScreen.hide()
    })
  }, [phase])

  return null
}
