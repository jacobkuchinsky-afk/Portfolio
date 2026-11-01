import * as THREE from 'three'

// The trijet's right wing in model space (nose +X, right wing +Z), measured
// from trijet.glb. In the scene 2 bank it's the raised wing, and the cards
// sit either side of it. s = distance out along the span (Z), in metres.

const WING_Y = 4.8 // height of the wing plane
const leX = (s) => -6.91 - 0.78 * (s - 23) // leading edge, outboard of the engine
const teX = (s) => -4.79 - 0.47 * (s - 11) // trailing edge, outboard of the flap kink

export const edgePoint = (edge, s, out = new THREE.Vector3()) =>
  out.set(edge === 'le' ? leX(s) : edge === 'te' ? teX(s) : (leX(s) + teX(s)) / 2, WING_Y, s)

// The cards span this much of the wing: clear of the engine below, and
// stopping short of the tip so the wing visibly runs past them.
export const BAND_LOW = 11.5
export const BAND_HIGH = 23.6
// On tall narrow screens the cards sit higher, over the outer wing, so the
// rear fuselage rising behind the wing doesn't squeeze them
export const BAND_LOW_NARROW = 18
// The banked shot is aimed here, a little below the middle of the band, so
// the fuselage stays in frame at the bottom
export const AIM_S = 15

// Outlines of the parts the cards must not cover, as polylines on the
// raised (right) side: fuselage edge with the tail cone, tailplane, engine
export const KEEP_CLEAR = [
  [
    [-28.5, 7, 0],
    [-24, 6, 2.4],
    [-18, 5.5, 3.2],
    [-8, 5.5, 3.3],
  ],
  [
    [-18, 5.5, 3.2],
    [-19, 7, 9.1],
    [-25.6, 7, 9.1],
    [-24, 6, 2.4],
  ],
  [
    [0, 2, 5.5],
    [9.9, 2, 5.5],
    [9.9, 2, 9.7],
    [0, 2, 9.7],
  ],
  [
    [6, 5.5, 3.3],
    [33, 5.5, 0],
  ],
].map((line) => line.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
