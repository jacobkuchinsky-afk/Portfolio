// Synthesized engine sound: no audio files to download.
// Each engine is a turbine whine (two detuned tones) plus a filtered rumble.
// Browsers only allow audio after a click, which is why init() is called
// from the "Begin pre-flight" button.

let ctx = null
let master = null
let noise = null
const engines = {}

function makeNoiseBuffer(context) {
  const length = context.sampleRate * 4
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < length; i++) {
    // Brown noise: deep and rumbly rather than hissy
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    data[i] = last * 3.5
  }
  return buffer
}

function makeEngine(detune) {
  const whineGain = ctx.createGain()
  whineGain.gain.value = 0
  const whineFilter = ctx.createBiquadFilter()
  whineFilter.type = 'lowpass'
  whineFilter.frequency.value = 3200
  const a = ctx.createOscillator()
  a.type = 'sine'
  const b = ctx.createOscillator()
  b.type = 'triangle'
  a.connect(whineFilter)
  b.connect(whineFilter)
  whineFilter.connect(whineGain).connect(master)
  a.start()
  b.start()

  const rumbleSource = ctx.createBufferSource()
  rumbleSource.buffer = noise
  rumbleSource.loop = true
  rumbleSource.playbackRate.value = 1 + detune * 0.01
  const rumbleFilter = ctx.createBiquadFilter()
  rumbleFilter.type = 'bandpass'
  rumbleFilter.Q.value = 0.7
  const rumbleGain = ctx.createGain()
  rumbleGain.gain.value = 0
  rumbleSource.connect(rumbleFilter).connect(rumbleGain).connect(master)
  rumbleSource.start()

  return { a, b, detune, whineGain, rumbleSource, rumbleFilter, rumbleGain }
}

export const engineAudio = {
  init() {
    if (ctx) {
      ctx.resume()
      return
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    ctx = new AudioContext()
    const compressor = ctx.createDynamicsCompressor()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(compressor).connect(ctx.destination)
    master.gain.setTargetAtTime(0.8, ctx.currentTime, 0.4)
    noise = makeNoiseBuffer(ctx)
    engines.L = makeEngine(-3)
    engines.C = makeEngine(0)
    engines.R = makeEngine(4)
  },

  update(sim) {
    if (!ctx) return
    const t = ctx.currentTime
    const roar = Math.min(1, sim.speed / 60)
    // Slow motion drags everything down to a low drone, like a tape slowing.
    // Pushing the throttle winds it back up while time is still frozen
    const live = Math.max(sim.timeScale, sim.lever)
    const pitch = 0.3 + 0.7 * live
    // ...and in space it dies away to nothing
    const level = (0.45 + 0.55 * live + 0.25 * sim.boost) * (1 - sim.silence)
    for (const [id, voice] of Object.entries(engines)) {
      const { started } = sim.engines[id]
      const n1 = Math.max(sim.engines[id].n1, sim.lever)
      const f = (160 + 2300 * Math.pow(n1, 0.8) + voice.detune) * pitch
      voice.a.frequency.setTargetAtTime(f, t, 0.05)
      voice.b.frequency.setTargetAtTime(f * 2.41, t, 0.05)
      voice.whineGain.gain.setTargetAtTime(started ? (0.012 + 0.04 * n1) * level : 0, t, 0.08)
      voice.rumbleSource.playbackRate.setTargetAtTime((1 + voice.detune * 0.01) * pitch, t, 0.08)
      voice.rumbleFilter.frequency.setTargetAtTime((110 + 900 * n1 + 300 * roar) * pitch, t, 0.08)
      voice.rumbleGain.gain.setTargetAtTime(started ? (0.06 + 0.45 * n1 * n1 + 0.15 * roar) * level : 0, t, 0.1)
    }
  },

  // A short mechanical "clack" for the toggle switches
  click() {
    if (!ctx) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1800
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
    src.connect(hp).connect(g).connect(master)
    src.start(t, Math.random() * 3, 0.06)

    const thunk = ctx.createOscillator()
    thunk.frequency.setValueAtTime(180, t)
    thunk.frequency.exponentialRampToValueAtTime(60, t + 0.06)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0.25, t)
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    thunk.connect(tg).connect(master)
    thunk.start(t)
    thunk.stop(t + 0.1)
  },

  // The lever clicking through a notch: small and dry
  tick() {
    if (!ctx) return
    burst({ hp: 2400, lp: 7000, level: 0.35, length: 0.04, thump: [320, 140], thumpLevel: 0.12 })
  },

  // The big red button going down: a heavy, damped thunk
  press() {
    if (!ctx) return
    burst({ hp: 0, lp: 1400, level: 0.9, length: 0.18, thump: [150, 45], thumpLevel: 0.7 })
  },

  // The throttle hits 100%: a deep thump as the boost lights
  boost() {
    if (!ctx) return
    burst({ hp: 0, lp: 900, level: 1.2, length: 0.9, thump: [120, 32], thumpLevel: 0.9 })
  },

  // A dying engine's cough: a muffled bang and a splutter of noise
  cough(strength = 1) {
    if (!ctx) return
    burst({ hp: 60, lp: 600, level: 0.9 * strength, length: 0.35, thump: [90, 28], thumpLevel: 0.6 * strength })
  },

  setMuted(muted) {
    if (!ctx) return
    master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.15)
  },
}

// A noise burst through a band of filters, with a falling low thump under it
function burst({ hp, lp, level, length, thump, thumpLevel }) {
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noise
  const high = ctx.createBiquadFilter()
  high.type = 'highpass'
  high.frequency.value = hp
  const low = ctx.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.setValueAtTime(lp, t)
  low.frequency.exponentialRampToValueAtTime(lp * 0.25, t + length)
  const g = ctx.createGain()
  g.gain.setValueAtTime(level, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + length)
  src.connect(high).connect(low).connect(g).connect(master)
  src.start(t, Math.random() * 3, length + 0.05)

  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(thump[0], t)
  osc.frequency.exponentialRampToValueAtTime(thump[1], t + length * 0.6)
  const og = ctx.createGain()
  og.gain.setValueAtTime(thumpLevel, t)
  og.gain.exponentialRampToValueAtTime(0.001, t + length * 0.7)
  osc.connect(og).connect(master)
  osc.start(t)
  osc.stop(t + length)
}
