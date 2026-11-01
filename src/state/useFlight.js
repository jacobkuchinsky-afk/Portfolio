import { create } from 'zustand'

// Scene 1 phases, in order:
// loading   → assets are loading behind the boarding pass
// ready     → boarding pass shows "Begin pre-flight"
// preflight → MY and PORTFOLIO flip themselves, engines 1 + 3 start, plane taxis
// armed     → GO is unlocked and waiting for the visitor
// go        → GO flipped, engine 2 (tail) is starting
// takeoff   → full thrust, takeoff roll
// airborne  → wheels up, climbing, and slowly rolling into the bank
// Scene 2:
// slowmo    → the portfolio cards fade in and time slows to a stop
// paused    → frozen mid-bank; the throttle appears and waits to be pushed to 100%
// Scene 3:
// boost     → cards fade, smoke pours out, the plane snaps level and surges
// climb     → pulls up hard while the sky turns to space
// flameout  → in space the engines cough and die
// drift     → zero g: it floats up and slowly tumbles in silence; the Constellar card fades in
// enemy     → an enemy from Constellar flies in on the right and patrols up and down
// fire      → a big red button appears in the dashboard, waiting to be pressed
// done      → scene over (scene 4 will pick up from here)
export const useFlight = create((set, get) => ({
  phase: 'loading',
  switches: { my: false, go: false, portfolio: false },
  muted: false,
  // undefined while we check for the real model, null = use the stand-in
  modelUrl: undefined,

  setModelUrl: (modelUrl) => set({ modelUrl }),
  setPhase: (phase) => set({ phase }),
  setSwitch: (name, on) => set((s) => ({ switches: { ...s.switches, [name]: on } })),
  markReady: () => {
    if (get().phase === 'loading') set({ phase: 'ready' })
  },
  begin: () => set({ phase: 'preflight', switches: { my: false, go: false, portfolio: false } }),
  flipGo: () => {
    if (get().phase !== 'armed') return
    set((s) => ({ phase: 'go', switches: { ...s.switches, go: true } }))
  },
  boost: () => {
    if (get().phase === 'paused') set({ phase: 'boost' })
  },
  // The big red button. What it sets off comes next; for now it ends the scene
  pressRed: () => {
    if (get().phase === 'fire') set({ phase: 'done' })
  },
  replay: () => set({ phase: 'preflight', switches: { my: false, go: false, portfolio: false } }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
}))
