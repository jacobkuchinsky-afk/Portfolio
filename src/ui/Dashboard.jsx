import { useFlight } from '../state/useFlight.js'
import { flipGo } from '../flight/flipGo.js'
import { Throttle, THROTTLE_PHASES } from './Throttle.jsx'
import { RedButton } from './RedButton.jsx'

// Left to right matches the plane: engine 1 (left wing), 2 (tail), 3 (right wing)
const ENGINES = [
  { id: 'L', key: 'my', label: 'MY' },
  { id: 'C', key: 'go', label: 'GO' },
  { id: 'R', key: 'portfolio', label: 'PORTFOLIO' },
]

// One column per engine: its rocker switch, with its name underneath.
// Switches sit unlit red when off and light up banana yellow when flipped. MY and PORTFOLIO
// flip themselves; GO is grey until both are on, then it's the visitor's.
// In scene 3 a lever fades in to the left of the switches, then a big red
// button on their right.
export function Dashboard() {
  const phase = useFlight((s) => s.phase)
  const switches = useFlight((s) => s.switches)
  const muted = useFlight((s) => s.muted)
  const toggleMuted = useFlight((s) => s.toggleMuted)
  const armed = phase === 'armed'
  const throttle = THROTTLE_PHASES.has(phase)

  return (
    <footer className="dash" data-mode={throttle ? 'throttle' : 'switches'}>
      <div className="dash-row">
        {ENGINES.map(({ id, key, label }) => {
          const on = switches[key]
          const isGo = key === 'go'
          const state = on ? 'on' : isGo && !armed ? 'locked' : 'off'
          return (
            <div key={id} className="col" data-state={state}>
              <span className="rocker" {...(isGo ? {} : { role: 'switch', 'aria-checked': on, 'aria-readonly': true, 'aria-label': label })}>
                <span className="rocker-key">
                  <i className="light" />
                  <i className="dots" />
                  <i className="characters" />
                  <i className="shine" />
                  <i className="shadow" />
                </span>
                {/* Browsers flatten 3D inside a <button>, so GO's button lies over the switch instead of wrapping it */}
                {isGo && (
                  <button className="rocker-hit" type="button" role="switch" aria-checked={on} aria-label="GO: take off" disabled={!armed} onClick={flipGo} />
                )}
              </span>
              <span className="rocker-label">{label}</span>
            </div>
          )
        })}
      </div>

      <p className={`go-hint${armed ? ' is-shown' : ''}`} aria-hidden="true">
        Flip GO to take off
      </p>

      <Throttle />
      <RedButton />

      <button className="sound" onClick={toggleMuted} aria-pressed={!muted}>
        Sound {muted ? 'off' : 'on'}
      </button>
    </footer>
  )
}
