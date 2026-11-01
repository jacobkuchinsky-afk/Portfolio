import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useFlight } from '../state/useFlight.js'
import { sim, startEngine, isIdle, setThrust, stepSim, bankTimeScale, SLOW_FROM } from './sim.js'
import { startBoost, flameout, boostTime, sinceFlameout, ROLL_OUT_TIME, SPACE_FROM, SPACE_TIME, COUGHS } from './sim.js'
import { engineAudio } from '../audio/engineAudio.js'

// Scene 1 timeline, in seconds after "Begin pre-flight"
const MY_AT = 0.8
const PORTFOLIO_AT = 1.5

// Scene 3. Time is stopped when the throttle hits 100%; it snaps back fast
const UNFREEZE_TIME = 0.35 // real seconds
const FLAMEOUT_AT = SPACE_FROM + SPACE_TIME + 0.6 // sim seconds after the boost: a beat once it's space
const DRIFT_AFTER = 1.6 // the coughs are over
const ENEMY_AFTER = 2.6 // about a second after the Constellar card has faded in
const BUTTON_AFTER = ENEMY_AFTER + 1.4 // once the enemy has flown in

const smooth = (t) => t * t * (3 - 2 * t)

// Dev only: the store and sim on window, for poking at from the console
if (import.meta.env.DEV) window.__flight = { store: useFlight, sim }

// Runs the scene: flips the automatic switches, starts engines,
// hands control to the visitor, then flies the takeoff, the bank and the boost.
export function FlightDirector() {
  const unfreeze = useRef(0)
  const coughs = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    // Dev only: window.__ff = 8 runs the scene 8× faster, to get to the later scenes quickly
    const steps = import.meta.env.DEV ? Math.max(1, Math.round(window.__ff ?? 1)) : 1
    for (let i = 0; i < steps; i++) step(dt)
  })

  function step(dt) {
    const store = useFlight.getState()
    const { phase, switches } = store
    if (phase === 'loading' || phase === 'ready') return

    if (phase === 'preflight') {
      if (!switches.my && sim.clock >= MY_AT) {
        store.setSwitch('my', true)
        startEngine('L')
        engineAudio.click()
      }
      if (!switches.portfolio && sim.clock >= PORTFOLIO_AT) {
        store.setSwitch('portfolio', true)
        startEngine('R')
        sim.taxi = true
        engineAudio.click()
      }
      if (isIdle('L') && isIdle('R')) store.setPhase('armed')
    }

    if (phase === 'go') {
      startEngine('C')
      if (isIdle('C')) {
        setThrust(1)
        store.setPhase('takeoff')
      }
    }

    if (phase === 'takeoff' && sim.airborne) store.setPhase('airborne')
    if (phase === 'airborne' && sim.bank >= SLOW_FROM) store.setPhase('slowmo')
    if (phase === 'slowmo') {
      sim.timeScale = bankTimeScale(sim.bank)
      if (sim.bank >= 1) {
        sim.timeScale = 0
        store.setPhase('paused')
      }
    }
    if (phase === 'paused') unfreeze.current = 0
    if (phase === 'boost' || phase === 'climb') {
      if (sim.boostAt === null) {
        startBoost()
        engineAudio.boost()
      }
      unfreeze.current = Math.min(1, unfreeze.current + dt / UNFREEZE_TIME)
      sim.timeScale = smooth(unfreeze.current)
      if (phase === 'boost' && boostTime() > ROLL_OUT_TIME) store.setPhase('climb')
      if (phase === 'climb' && boostTime() > FLAMEOUT_AT) {
        flameout()
        store.setPhase('flameout')
      }
    }
    if (sim.flameoutAt === null) coughs.current = 0
    else
      while (coughs.current < COUGHS.length && sinceFlameout() >= COUGHS[coughs.current][0])
        engineAudio.cough(COUGHS[coughs.current++][1])
    if (phase === 'flameout' && sinceFlameout() > DRIFT_AFTER) store.setPhase('drift')
    if (phase === 'drift' && sinceFlameout() > ENEMY_AFTER) store.setPhase('enemy')
    if (phase === 'enemy' && sinceFlameout() > BUTTON_AFTER) store.setPhase('fire')

    stepSim(dt * sim.timeScale, phase)
    engineAudio.update(sim)
  }
  return null
}
