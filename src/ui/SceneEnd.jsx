import { useFlight } from '../state/useFlight.js'
import { resetSim } from '../flight/sim.js'

// Placeholder until scene 4 exists
export function SceneEnd() {
  const phase = useFlight((s) => s.phase)
  const replay = () => {
    resetSim()
    useFlight.getState().replay()
  }
  return (
    <div className={`scene-end${phase === 'done' ? ' is-shown' : ''}`} aria-hidden={phase !== 'done'}>
      <p>Scene 4 · coming soon</p>
      <button onClick={replay} tabIndex={phase === 'done' ? 0 : -1}>
        Replay takeoff
      </button>
    </div>
  )
}
