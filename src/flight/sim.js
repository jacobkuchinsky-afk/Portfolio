// Mutable flight state, stepped once per frame by <FlightDirector>.
// Kept outside React on purpose: it changes every frame, and only the
// moments that matter (switch flips, phase changes) go through the store.

export const IDLE_N1 = 0.25
export const START_X = -175 // where the plane is when the scene opens
export const HOLD_X = -20 // where it stops and waits if GO hasn't been flipped
export const TAXI_SPEED = 5 // m/s, about 10 knots
export const VR = 72 // rotation speed, m/s (~140 knots)
const TAKEOFF_ACCEL = 21 // m/s², squeezed so the roll lasts ~5.5 s instead of ~40
const START_RATE = 1.6 // how fast an engine spools from 0 to idle
const PITCH_RATE = 0.07 // rad/s, about 4°/s like a real rotation
const MAX_PITCH = 0.16 // ~9°
const GEAR_DELAY = 1 // seconds after liftoff before the gear comes up
const GEAR_TIME = 2.6 // the doors open, the legs fold, the doors close: tucked away before the cards appear

// Scene 2: a knife-edge bank to the left (right wing up, belly toward the
// camera), frozen until the visitor pushes the throttle up
export const BANK = -1.5 // ~86°
const ROLL_TIME = 4 // sim seconds from liftoff to full bank
const SLOW_TIME = 1.56 // then this much plays in slow motion (twice as long in real time) to the freeze
const BANK_TIME = ROLL_TIME + SLOW_TIME
export const SLOW_FROM = ROLL_TIME / BANK_TIME // how far along time starts slowing down
// It rolls the whole way up and reaches full bank exactly as time starts
// slowing and the cards appear, so the wing is already between them; the
// slow motion then holds it there
export const KNIFE_PITCH = 0.02 // on its side the wing isn't lifting, so the nose settles near the horizon
const KNIFE_FROM = 0.65 // ...from this far into the roll, once it's steep

// Scene 3: throttle to 100% and boost into space. Sim seconds after the boost
export const ROLL_OUT_TIME = 1.4 // snaps out of the knife edge as the power comes in...
const PULL_FROM = 0.7 // ...and once it's mostly level, pulls up...
const PULL_TIME = 2.6
const BOOST_PITCH = 1.0 // ...to ~57°: steep, but the plane still reads side-on
const BOOST_ACCEL = 42 // m/s² at full boost thrust
export const SPACE_FROM = 2.2 // the sky starts turning to space...
export const SPACE_TIME = 7 // ...and is space this long after
const BOOST_SPOOL = 1.4 // engine response (1/s) under power
// Engine failure, then zero g
const WINDMILL_RATE = 0.4 // the fans run down slowly once the engines die
const STOP_RATE = 3.5 // 1/s: the climb dies in about a second (cinematic, not physics)
const FLOAT_UP = 1.4 // m/s, the drift it's left with
const SPIN_PITCH = 0.07 // rad/s of slow tumble, nose over...
const SPIN_ROLL = -0.045 // ...and a lazy roll
const SPIN_IN = 2.5 // seconds for the tumble to build up
// The engines' last coughs: seconds after they quit, and how hard
export const COUGHS = [
  [0, 1],
  [0.42, 0.7],
  [0.95, 0.45],
]

const smooth = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.min(1, Math.max(0, t))

const makeEngine = () => ({ n1: 0, target: 0, started: false, starting: false, rate: BOOST_SPOOL })

export const sim = {}

export function resetSim() {
  Object.assign(sim, {
    clock: 0,
    engines: { L: makeEngine(), C: makeEngine(), R: makeEngine() },
    x: START_X,
    y: 0,
    speed: 0,
    pitch: 0,
    vy: 0,
    gear: 0, // 0 = down, 1 = up
    taxi: false,
    airborne: false,
    airborneAt: 0,
    timeScale: 1, // 1 = normal, 0 = frozen. Set by <FlightDirector>, applied to dt
    roll: 0,
    bank: 0, // 0 → 1 from liftoff to the freeze
    climbPitch: 0, // the nose-up the climb asks for, before the bank takes some away
    vx: 0, // m/s along x once boosting (before that the plane moves at sim.speed)
    lever: 0, // the throttle's position, 0 → 1. Written by <Throttle>
    boostAt: null, // sim clock when the throttle hit 100%
    boost: 0, // 0 → 1, how hard it's boosting right now (smoke, shake, blur)
    space: 0, // 0 → 1, sky to space (linear; ease where it's used)
    flameoutAt: null, // sim clock when the engines died
    silence: 0, // 0 → 1, the engine sound dying away in space
    tumble: { pitch: 0, roll: 0 },
  })
}
resetSim()

export function startEngine(id) {
  const e = sim.engines[id]
  if (e.started) return
  e.started = true
  e.starting = true
}

export const isIdle = (id) => {
  const e = sim.engines[id]
  return e.started && !e.starting
}

export function setThrust(target) {
  for (const e of Object.values(sim.engines)) e.target = target
}

// 0 at idle, 1 at full takeoff thrust
export function thrust() {
  const es = Object.values(sim.engines)
  return es.reduce((sum, e) => sum + Math.max(0, (e.n1 - IDLE_N1) / (1 - IDLE_N1)), 0) / es.length
}

export function stepSim(dt, phase) {
  sim.clock += dt

  for (const e of Object.values(sim.engines)) {
    if (e.starting) {
      // Starts slow and catches: ~1 s from 0 to idle
      e.n1 = Math.min(IDLE_N1, e.n1 + dt * START_RATE * (0.06 + e.n1))
      if (e.n1 >= IDLE_N1) {
        e.starting = false
        e.target = Math.max(e.target, IDLE_N1)
      }
    } else if (e.started) {
      e.n1 += (e.target - e.n1) * (1 - Math.exp(-dt * e.rate))
    }
  }

  const rolling = phase !== 'preflight' && phase !== 'armed' && phase !== 'go'
  if (rolling) {
    const a = TAKEOFF_ACCEL * thrust() - 0.0006 * sim.speed * sim.speed
    sim.speed += a * dt
  } else if (sim.taxi) {
    // Roll toward the hold point and brake smoothly onto it
    const remaining = HOLD_X - sim.x
    const target = remaining > 0 ? Math.min(TAXI_SPEED, Math.sqrt(2 * 0.6 * remaining)) : 0
    sim.speed += Math.max(-1.2 * dt, Math.min(0.8 * dt, target - sim.speed))
  }
  if (sim.boostAt !== null) return stepBoost(dt)
  sim.x += sim.speed * dt

  if (rolling && sim.speed > VR) sim.climbPitch = Math.min(MAX_PITCH, sim.climbPitch + PITCH_RATE * dt)
  sim.pitch = sim.climbPitch
  // From the moment the wheels leave the runway it eases into the bank
  if (sim.airborne) {
    sim.bank = Math.min(1, sim.bank + dt / BANK_TIME)
    const rolled = Math.min(1, sim.bank / SLOW_FROM)
    sim.roll = BANK * smooth(rolled)
    const knife = smooth(Math.min(1, Math.max(0, (rolled - KNIFE_FROM) / (1 - KNIFE_FROM))))
    sim.pitch += (KNIFE_PITCH - sim.pitch) * knife
  }
  if (!sim.airborne && sim.pitch > 0.1 && sim.speed > VR + 3) {
    sim.airborne = true
    sim.airborneAt = sim.clock
  }
  if (sim.airborne) {
    const vyTarget = sim.speed * Math.sin(sim.pitch) * 0.85
    sim.vy += (vyTarget - sim.vy) * (1 - Math.exp(-dt * 1.5))
    sim.y += sim.vy * dt
    if (sim.clock - sim.airborneAt > GEAR_DELAY) sim.gear = Math.min(1, sim.gear + dt / GEAR_TIME)
  }
}

// How fast time runs at a given point in the bank: full speed for the first
// part of the roll, then slowing to a stop exactly as the roll completes.
// (The square root makes it reach zero in finite time instead of creeping.)
export const bankTimeScale = (bank) => (bank < SLOW_FROM ? 1 : Math.sqrt((1 - bank) / (1 - SLOW_FROM)))

// Scene 3. The throttle hit 100%: full power, roll out, pull up, go
export function startBoost() {
  sim.boostAt = sim.clock
  sim.vx = sim.speed
  setThrust(1)
}

// The engines quit in space: one last cough each, then they run down
export function flameout() {
  sim.flameoutAt = sim.clock
  sim.lever = 0 // so the sound follows the fans running down
  for (const e of Object.values(sim.engines)) {
    e.target = 0
    e.rate = WINDMILL_RATE
  }
}

export const boostTime = () => sim.clock - sim.boostAt
export const sinceFlameout = () => (sim.flameoutAt === null ? 0 : sim.clock - sim.flameoutAt)

function stepBoost(dt) {
  const t = boostTime()
  sim.roll = BANK * (1 - smooth(clamp01(t / ROLL_OUT_TIME))) + sim.tumble.roll

  if (sim.flameoutAt === null) {
    sim.pitch = KNIFE_PITCH + (BOOST_PITCH - KNIFE_PITCH) * smooth(clamp01((t - PULL_FROM) / PULL_TIME))
    sim.speed += BOOST_ACCEL * thrust() * dt
    // It goes where the nose points now (the takeoff code fudges this for small angles)
    sim.vx = sim.speed * Math.cos(sim.pitch)
    sim.vy += (sim.speed * Math.sin(sim.pitch) - sim.vy) * (1 - Math.exp(-dt * 3))
    sim.space = clamp01((t - SPACE_FROM) / SPACE_TIME)
    sim.boost = smooth(clamp01(t / 0.5))
  } else {
    const f = sinceFlameout()
    // Nothing pushing any more: the climb dies, and it's left floating gently up, turning over
    const stop = Math.exp(-dt * STOP_RATE)
    sim.vx *= stop
    sim.vy = FLOAT_UP + (sim.vy - FLOAT_UP) * stop
    sim.speed = Math.hypot(sim.vx, sim.vy)
    const spin = smooth(clamp01(f / SPIN_IN))
    sim.tumble.pitch += SPIN_PITCH * spin * dt
    sim.tumble.roll += SPIN_ROLL * spin * dt
    sim.pitch = BOOST_PITCH + sim.tumble.pitch
    sim.boost *= Math.exp(-dt * 4)
    sim.silence = clamp01(f / 3.5)
  }
  sim.x += sim.vx * dt
  sim.y += sim.vy * dt
}

