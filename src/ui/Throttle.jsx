import { useEffect, useRef, useState } from 'react'
import { useFlight } from '../state/useFlight.js'
import { sim } from '../flight/sim.js'
import { engineAudio } from '../audio/engineAudio.js'

// Scene 3's one action: a lever beside the switches, pushed up to 100%.
// It's heavy (it can only travel so fast) and spring-loaded: let go short of
// the top and it slides back toward idle. It clicks through a notch every
// 25% on the way up, and at 100% it clunks into the BOOST detent and locks.
// Drag it, scroll on it, or hold W / ↑.

const PUSH_RATE = 1.6 // travel per second at most while dragged: it's a heavy lever
const KEY_RATE = 0.8 // travel per second while W / ↑ is held
const WHEEL_STEP = 0.0016 // travel per pixel scrolled
const RETURN_DELAY = 0.15 // seconds after letting go before it starts sliding back
const NOTCHES = 4 // a click every 25%

export const THROTTLE_PHASES = new Set(['paused', 'boost', 'climb', 'flameout', 'drift', 'enemy', 'fire', 'done'])

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const touch = typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches

export function Throttle() {
  const phase = useFlight((s) => s.phase)
  const root = useRef(null)
  const readout = useRef(null)
  const [percent, setPercent] = useState(0) // for screen readers only; the visuals update every frame
  const active = phase === 'paused'
  const state = active ? 'idle' : phase === 'boost' || phase === 'climb' ? 'boost' : 'failed'

  // Locked in the BOOST detent; once the engines die the lever stays up, the thrust doesn't
  useEffect(() => {
    if (state === 'idle') return
    root.current.style.setProperty('--t', '1')
    readout.current.textContent = state === 'failed' ? 0 : 100
  }, [state])

  useEffect(() => {
    const el = root.current
    if (!active) return
    const input = { pointer: null, startY: 0, startValue: 0, target: 0, keys: new Set(), wheel: 0, wheelAt: 0, idle: 0 }
    let raf = 0
    let last = performance.now()
    let shownPercent = -1
    let notch = 0

    const travel = () => Math.max(1, el.querySelector('.lever-slot').clientHeight)
    const render = (v) => {
      el.style.setProperty('--t', v.toFixed(4))
      const p = Math.round(v * 100)
      if (p !== shownPercent) {
        shownPercent = p
        readout.current.textContent = p
        setPercent(p)
      }
    }

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 20)
      last = now
      let v = sim.lever
      const wheeling = now - input.wheelAt < 200
      if (input.pointer !== null) v += Math.max(-PUSH_RATE * dt, Math.min(PUSH_RATE * dt, input.target - v))
      else if (input.keys.size) v += KEY_RATE * dt
      v += input.wheel
      input.wheel = 0
      if (input.pointer !== null || input.keys.size || wheeling) input.idle = 0
      else if ((input.idle += dt) > RETURN_DELAY) v -= dt * (0.25 + 0.9 * v) // the spring: quicker from high up
      v = clamp01(v)

      if (v >= 0.995) {
        sim.lever = 1
        render(1)
        engineAudio.click()
        useFlight.getState().boost()
        return
      }
      // A click (and a tap on phones that can) for each notch passed on the way up
      const reached = Math.floor(v * NOTCHES + 0.02)
      if (reached > notch) {
        engineAudio.tick()
        navigator.vibrate?.(8)
      }
      notch = reached
      sim.lever = v
      render(v)
      raf = requestAnimationFrame(frame)
    }

    const down = (e) => {
      if (e.button !== 0) return
      input.pointer = e.pointerId
      input.startY = e.clientY
      input.startValue = input.target = sim.lever
      el.dataset.held = ''
      el.setPointerCapture(e.pointerId)
      el.focus({ preventScroll: true })
    }
    const move = (e) => {
      if (e.pointerId !== input.pointer) return
      input.target = clamp01(input.startValue + (input.startY - e.clientY) / travel())
    }
    const up = (e) => {
      if (e.pointerId !== input.pointer) return
      input.pointer = null
      delete el.dataset.held
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    // Any scroll direction pushes it: trackpads and wheels disagree about which way is "up"
    const wheel = (e) => {
      e.preventDefault()
      const px = Math.abs(e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 33 : 1) // Firefox scrolls in lines
      input.wheel += Math.min(0.3, px * WHEEL_STEP)
      input.wheelAt = performance.now()
    }
    const PUSH_KEYS = new Set(['w', 'W', 'ArrowUp'])
    const keydown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !PUSH_KEYS.has(e.key)) return
      e.preventDefault()
      input.keys.add(e.key.toLowerCase())
    }
    const keyup = (e) => input.keys.delete(e.key.toLowerCase())
    const blur = () => input.keys.clear()

    sim.lever = 0
    render(0)
    raf = requestAnimationFrame(frame)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
      delete el.dataset.held
    }
  }, [active])

  return (
    <>
      <div
        ref={root}
        className="throttle"
        data-state={state}
        role="slider"
        tabIndex={active ? 0 : -1}
        aria-label="Lever: push to 100% to boost"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={active ? percent : 100}
        aria-hidden={!THROTTLE_PHASES.has(phase)}
      >
        <div className="lever">
          <span className="lever-mark" aria-hidden="true">
            BOOST
          </span>
          <i className="lever-notches" />
          <i className="lever-slot">
            <i className="lever-fill" />
          </i>
          <span className="lever-arm">
            <i className="lever-boot" />
            <i className="lever-shaft" />
            <i className="lever-knob" />
          </span>
        </div>
        <div className="throttle-readout" aria-hidden="true">
          <span className="throttle-pct">
            <span ref={readout}>0</span>%
          </span>
          <span className="throttle-label">{state === 'failed' ? 'FAIL' : 'THRUST'}</span>
        </div>
      </div>
      <p className={`go-hint throttle-hint${active ? ' is-shown' : ''}`} aria-hidden="true">
        {touch ? 'Drag the lever up to 100%' : 'Push the lever to 100% (drag, scroll or hold W)'}
      </p>
    </>
  )
}
