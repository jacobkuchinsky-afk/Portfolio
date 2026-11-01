import * as THREE from 'three'
import { Effect, EffectAttribute } from 'postprocessing'

// Scene 3's speed blur: the picture streaks outward from the plane, more the
// farther from it, and not at all close in, so the plane itself stays sharp.
// `center` is the plane on screen (0..1 uv), `strength` how far a pixel
// smears toward it (a fraction of its distance).

const FRAGMENT = /* glsl */ `
  uniform vec2 center;
  uniform float strength;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 toCenter = center - uv;
    float dist = length(toCenter * vec2(aspect, 1.0));
    float amount = strength * smoothstep(0.12, 0.7, dist);
    if (amount < 0.0005) {
      outputColor = inputColor;
      return;
    }
    // Jittered start hides the steps between samples
    float offset = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    vec4 sum = vec4(0.0);
    for (int i = 0; i < 12; i++) {
      float t = (float(i) + offset) / 12.0;
      sum += texture2D(inputBuffer, uv + toCenter * amount * t);
    }
    outputColor = sum / 12.0;
  }
`

export class ZoomBlurEffect extends Effect {
  constructor() {
    super('ZoomBlurEffect', FRAGMENT, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['center', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['strength', new THREE.Uniform(0)],
      ]),
    })
  }
}
