import * as THREE from 'three'
import { SUN_DIR, FILL_DIR } from './sun.js'

// 3D value noise: gives the painted layers something for the brush-stroke
// filter (PaintPass) to grab onto. Smooth gradients just stay smooth.
export const NOISE = /* glsl */ `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + 1.0), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * noise3(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      amp *= 0.5;
    }
    return sum;
  }
`

const VERTEX = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vPosL;
  varying vec3 vTint;
  void main() {
    mat4 model = modelMatrix;
    #ifdef USE_INSTANCING
      model = modelMatrix * instanceMatrix;
    #endif
    vec4 world = model * vec4(position, 1.0);
    vNormalW = normalize(mat3(model) * normal);
    vPosW = world.xyz;
    vPosL = position;
    vTint = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #endif
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

// Lit the way a background painter blocks things in: three values (shadow,
// mid, light) with ragged borders between them, and a warm rim where the low
// sun behind the scene catches an edge.
const FRAGMENT = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uSunDir;
  uniform vec3 uFillDir;
  uniform vec3 uShadow;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uRim;
  uniform float uRimAmount;
  uniform float uPatch;
  uniform float uPatchAmount;
  uniform float uRibs;
  uniform vec3 uFrame;
  uniform float uPanes;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vPosL;
  varying vec3 vTint;
  ${NOISE}

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);

    float v = 0.45 * dot(N, uFillDir) + 0.35 * N.y + 0.3;
    v += (fbm(vPosW * uPatch) - 0.5) * uPatchAmount;
    vec3 col = mix(uShadow, uMid, smoothstep(0.2, 0.3, v));
    col = mix(col, uLight, smoothstep(0.62, 0.72, v));

    #ifdef RIBS
      // Corrugated sheet: ribs run up the wall
      float along = abs(N.z) > abs(N.x) ? vPosW.x : vPosW.z;
      col *= 0.9 + 0.1 * smoothstep(0.3, 0.7, abs(fract(along * uRibs) - 0.5) * 2.0);
    #endif

    #ifdef GRIME
      // Dirt splashed up from the ground and rain streaks down the walls
      col *= mix(0.72, 1.0, smoothstep(0.0, 3.5, vPosW.y));
      float streak = noise3(vec3((vPosW.x + vPosW.z) * 1.7, vPosW.y * 0.08, 3.0));
      col *= 1.0 - 0.12 * smoothstep(0.55, 0.85, streak);
    #endif

    #ifdef GLASS
      // Tower cab: the sky reflects warmer toward grazing angles, and frames
      // split it into panes (one per facet, two rows)
      col = mix(col, uLight, pow(1.0 - max(dot(N, V), 0.0), 1.5));
      float facet = fract(atan(vPosL.x, vPosL.z) / (2.0 * PI) * uPanes);
      float frame = 1.0 - smoothstep(0.04, 0.08, min(facet, 1.0 - facet));
      frame = max(frame, 1.0 - smoothstep(0.08, 0.16, abs(vPosL.y)));
      col = mix(col, uFrame, frame);
    #endif

    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0) * smoothstep(-0.1, 0.5, dot(N, uSunDir));
    col = mix(col, uRim, rim * uRimAmount);

    gl_FragColor = vec4(col * vTint, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

// shadow/mid/light: the three values. patch: size of the paint patches
// (1 / metres), patchAmount: how ragged the borders are.
export function paintedMaterial({
  shadow,
  mid,
  light,
  rim = '#f6c98c',
  rimAmount = 0.5,
  patch = 0.25,
  patchAmount = 0.5,
  ribs = 0,
  grime = false,
  glass = false,
  frame = '#3a3a3a',
  panes = 8,
  side = THREE.FrontSide,
}) {
  const defines = {}
  if (ribs) defines.RIBS = ''
  if (grime) defines.GRIME = ''
  if (glass) defines.GLASS = ''
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines,
    side,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSunDir: { value: SUN_DIR },
        uFillDir: { value: FILL_DIR },
        uShadow: { value: new THREE.Color(shadow) },
        uMid: { value: new THREE.Color(mid) },
        uLight: { value: new THREE.Color(light) },
        uRim: { value: new THREE.Color(rim) },
        uRimAmount: { value: rimAmount },
        uPatch: { value: patch },
        uPatchAmount: { value: patchAmount },
        uRibs: { value: ribs },
        uFrame: { value: new THREE.Color(frame) },
        uPanes: { value: panes },
      },
    ]),
  })
}
