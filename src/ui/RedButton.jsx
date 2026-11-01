import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFlight } from '../state/useFlight.js'
import { engineAudio } from '../audio/engineAudio.js'

// The big red button: fades in on the dashboard, right of the switches
// (mirroring the lever on the left), once the enemy has flown in. A domed
// cap sitting in a hole in a black bezel, seen head on, and spring-loaded
// like a real one: pressed, it travels into the hole (shrinking a little as
// it moves away, its side wall disappearing, the rim's shadow swallowing its
// edge) and registers with a thunk at the bottom; let go, it springs back
// out, overshooting a touch, with a clack.
//
// Narrow screens have no room beside the switches, so there the switches
// ease smaller and slide left to make room as it appears.

const TRAVEL_MS = 70 // in, before it registers
const NARROW = 760 // px: matches the CSS
const GAP = 16

const touch = typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches

export function RedButton() {
  const phase = useFlight((s) => s.phase)
  const armed = phase === 'fire'
  const shown = armed || phase === 'done'
  const root = useRef(null)
  const timer = useRef(0)
  const isDown = useRef(false) // pointerup and lostpointercapture both fire: act once
  const [down, setDown] = useState(false)

  useLayoutEffect(() => {
    const el = root.current
    const dash = el.parentElement
    const row = dash.querySelector('.dash-row')
    const layout = () => {
      if (!shown || window.innerWidth >= NARROW) {
        dash.style.removeProperty('--row-scale')
        dash.style.removeProperty('--row-shift')
        el.style.left = ''
        return
      }
      // [switches][gap][button], centred together, the switches scaled to fit
      const W = dash.clientWidth
      const R = row.offsetWidth
      const B = el.offsetWidth
      const scale = Math.min(1, (W - 32 - GAP - B) / R)
      dash.style.setProperty('--row-scale', scale.toFixed(3))
      dash.style.setProperty('--row-shift', `${-(GAP + B) / 2}px`)
      el.style.left = `${(W - (scale * R + GAP + B)) / 2 + scale * R + GAP}px`
    }
    layout()
    window.addEventListener('resize', layout)
    return () => window.removeEventListener('resize', layout)
  }, [shown])

  useEffect(() => () => clearTimeout(timer.current), [])

  const pressIn = () => {
    if (!armed || isDown.current) return
    isDown.current = true
    setDown(true)
    // Registers at the bottom of its travel
    timer.current = setTimeout(() => {
      engineAudio.press()
      navigator.vibrate?.(15)
      useFlight.getState().pressRed()
    }, TRAVEL_MS)
  }
  const release = () => {
    if (!isDown.current) return
    isDown.current = false
    setDown(false)
    engineAudio.click()
  }

  return (
    <>
      <div ref={root} className={`red${shown ? ' is-shown' : ''}`} data-state={armed ? 'armed' : 'pressed'} data-pos={down ? 'in' : 'out'}>
        <span className="red-bezel">
          <button
            className="red-cap"
            type="button"
            aria-label="The big red button"
            disabled={!armed && !down}
            tabIndex={armed ? 0 : -1}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.currentTarget.setPointerCapture(e.pointerId)
              pressIn()
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onClick={(e) => {
              // Keyboard (Enter / Space) and assistive tech: a full press and release
              if (e.detail !== 0) return
              pressIn()
              setTimeout(release, 160)
            }}
          />
        </span>
      </div>
      <p className={`go-hint red-hint${armed ? ' is-shown' : ''}`} aria-hidden="true">
        {touch ? 'Tap the red button' : 'Press the red button'}
      </p>
    </>
  )
}
