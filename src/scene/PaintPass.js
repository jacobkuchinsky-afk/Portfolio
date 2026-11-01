import * as THREE from 'three'
import { Pass } from 'postprocessing'

// Turns the background into brush strokes with an anisotropic Kuwahara filter
// (Kyprianidis et al., "Anisotropic Kuwahara Filtering with Polynomial
// Weighting Functions"). Each pixel takes the calmest of eight wedge-shaped
// neighbourhoods, stretched along the local edge direction, so flat areas
// become solid dabs of paint and edges become strokes that follow them.
//
// Only things farther than `start` metres are painted; the plane, runway and
// grass stay as they are. The filter runs at a fixed height (PAINT_HEIGHT),
// so strokes are the same size on every screen and the cost doesn't grow on
// big displays.
//
// Two passes, so depth of field can sit between them: PaintPass paints the
// sharp image (color + depth mask -> structure tensor -> blur tensor x, y ->
// Kuwahara) and passes it through untouched; its `composite` pass, placed
// after depth of field, lays the painting over the background with a little
// canvas grain. The grass in front still gets its blur, the background stays
// crisp like a painted backdrop.

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

// Distance from the camera, 0..1 as it goes from start to end
const MASK = /* glsl */ `
  #include <packing>
  uniform highp sampler2D depthBuffer;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform vec2 maskRange;
  float paintMask(vec2 uv) {
    float viewZ = perspectiveDepthToViewZ(texture2D(depthBuffer, uv).r, cameraNear, cameraFar);
    return smoothstep(maskRange.x, maskRange.y, -viewZ);
  }
`

// The scene is HDR (the sun is far above 1), so the filter works on
// compressed values and the composite expands them again.
const PREP = /* glsl */ `
  uniform sampler2D inputBuffer;
  varying vec2 vUv;
  ${MASK}
  void main() {
    vec3 c = texture2D(inputBuffer, vUv).rgb;
    gl_FragColor = vec4(c / (1.0 + c), paintMask(vUv));
  }
`

// Which way the edges run, from Sobel gradients
const TENSOR = /* glsl */ `
  uniform sampler2D colorBuffer;
  uniform vec2 texel;
  varying vec2 vUv;
  vec3 s(float x, float y) { return texture2D(colorBuffer, vUv + vec2(x, y) * texel).rgb; }
  void main() {
    vec3 gx = (s(1.0, -1.0) + 2.0 * s(1.0, 0.0) + s(1.0, 1.0) - s(-1.0, -1.0) - 2.0 * s(-1.0, 0.0) - s(-1.0, 1.0)) * 0.25;
    vec3 gy = (s(-1.0, 1.0) + 2.0 * s(0.0, 1.0) + s(1.0, 1.0) - s(-1.0, -1.0) - 2.0 * s(0.0, -1.0) - s(1.0, -1.0)) * 0.25;
    gl_FragColor = vec4(dot(gx, gx), dot(gy, gy), dot(gx, gy), 1.0);
  }
`

const BLUR = /* glsl */ `
  uniform sampler2D tensorBuffer;
  uniform vec2 blurStep;
  varying vec2 vUv;
  void main() {
    // Gaussian, sigma 2, 9 taps
    const float w[5] = float[](0.2042, 0.1802, 0.1238, 0.0663, 0.0276);
    vec4 sum = texture2D(tensorBuffer, vUv) * w[0];
    for (int i = 1; i < 5; i++) {
      sum += texture2D(tensorBuffer, vUv + blurStep * float(i)) * w[i];
      sum += texture2D(tensorBuffer, vUv - blurStep * float(i)) * w[i];
    }
    gl_FragColor = sum;
  }
`

const KUWAHARA = /* glsl */ `
  #define MAX_R 12
  uniform sampler2D colorBuffer;
  uniform sampler2D tensorBuffer;
  uniform vec2 texel;
  uniform float radius;
  uniform float hardness;
  uniform float sharpness;
  varying vec2 vUv;

  void main() {
    vec4 center = texture2D(colorBuffer, vUv);
    if (center.a <= 0.0) {
      gl_FragColor = center;
      return;
    }

    // Edge direction and how strongly the area has one
    vec3 t = texture2D(tensorBuffer, vUv).xyz;
    float root = sqrt((t.x - t.y) * (t.x - t.y) + 4.0 * t.z * t.z);
    float l1 = 0.5 * (t.x + t.y + root);
    float l2 = 0.5 * (t.x + t.y - root);
    vec2 d = vec2(l1 - t.x, -t.z);
    d = dot(d, d) > 0.0 ? normalize(d) : vec2(0.0, 1.0);
    float phi = -atan(d.y, d.x);
    float anisotropy = l1 + l2 > 0.0 ? (l1 - l2) / (l1 + l2) : 0.0;

    // Ellipse: long along the edge, short across it
    float a = clamp(radius * (1.0 + anisotropy), 1.0, float(MAX_R));
    float b = clamp(radius / (1.0 + anisotropy), 1.0, float(MAX_R));
    float cp = cos(phi), sp = sin(phi);
    mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, -sp, sp, cp);
    int maxX = int(sqrt(a * a * cp * cp + b * b * sp * sp));
    int maxY = int(sqrt(a * a * sp * sp + b * b * cp * cp));

    const float N = 8.0;
    const float PI = 3.14159265;
    float zeta = 2.0 / radius;
    float sinN = sin(PI / N);
    float eta = (zeta + cos(PI / N)) / (sinN * sinN);

    vec4 m[8];
    vec3 s[8];
    for (int k = 0; k < 8; k++) {
      m[k] = vec4(0.0);
      s[k] = vec3(0.0);
    }

    for (int y = -MAX_R; y <= MAX_R; y++) {
      if (y < -maxY || y > maxY) continue;
      for (int x = -MAX_R; x <= MAX_R; x++) {
        if (x < -maxX || x > maxX) continue;
        vec2 v = SR * vec2(float(x), float(y));
        if (dot(v, v) > 0.25) continue;
        vec4 sampled = texture2D(colorBuffer, vUv + vec2(float(x), float(y)) * texel);
        // Don't drag the plane or the grass into the painted background
        if (sampled.a <= 0.0) continue;
        vec3 c = sampled.rgb;

        // Polynomial weights for the eight sectors
        float w[8];
        float sum = 0.0;
        float vxx = zeta - eta * v.x * v.x;
        float vyy = zeta - eta * v.y * v.y;
        float z;
        z = max(0.0, v.y + vxx); w[0] = z * z;
        z = max(0.0, -v.x + vyy); w[2] = z * z;
        z = max(0.0, -v.y + vxx); w[4] = z * z;
        z = max(0.0, v.x + vyy); w[6] = z * z;
        vec2 r = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
        vxx = zeta - eta * r.x * r.x;
        vyy = zeta - eta * r.y * r.y;
        z = max(0.0, r.y + vxx); w[1] = z * z;
        z = max(0.0, -r.x + vyy); w[3] = z * z;
        z = max(0.0, -r.y + vxx); w[5] = z * z;
        z = max(0.0, r.x + vyy); w[7] = z * z;
        for (int k = 0; k < 8; k++) sum += w[k];
        if (sum <= 0.0) continue;

        float g = exp(-3.125 * dot(v, v)) / sum;
        for (int k = 0; k < 8; k++) {
          float wk = w[k] * g;
          m[k] += vec4(c * wk, wk);
          s[k] += c * c * wk;
        }
      }
    }

    // Blend the sectors, favouring the ones with the least variation
    vec4 result = vec4(0.0);
    for (int k = 0; k < 8; k++) {
      if (m[k].w <= 0.0) continue;
      vec3 mean = m[k].rgb / m[k].w;
      vec3 variance = abs(s[k] / m[k].w - mean * mean);
      float sigma2 = variance.r + variance.g + variance.b;
      float wk = 1.0 / (1.0 + pow(hardness * 1000.0 * sigma2, 0.5 * sharpness));
      result += vec4(mean * wk, wk);
    }
    gl_FragColor = vec4(result.w > 0.0 ? result.rgb / result.w : center.rgb, center.a);
  }
`

const COMPOSITE = /* glsl */ `
  uniform sampler2D inputBuffer;
  uniform sampler2D paintBuffer;
  uniform vec2 resolution;
  uniform float grain;
  varying vec2 vUv;
  ${MASK}

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
  }
  // Canvas: a fine woven tooth plus some uneven blotches, fixed to the screen
  float canvas(vec2 px) {
    float weave = sin(px.x * 1.9) * sin(px.y * 1.9) * 0.5;
    float tooth = noise(px * 0.9) - 0.5;
    float blotch = noise(px * 0.012) + 0.5 * noise(px * 0.035) - 0.75;
    return weave * 0.35 + tooth * 0.6 + blotch * 0.8;
  }

  void main() {
    vec3 original = texture2D(inputBuffer, vUv).rgb;
    float mask = paintMask(vUv);
    vec3 painted = texture2D(paintBuffer, vUv).rgb;
    painted = painted / max(1.0 - painted, 1e-3);
    vec3 col = mix(original, painted, mask);
    col *= 1.0 + canvas(vUv * resolution) * grain * mask;
    gl_FragColor = vec4(col, 1.0);
  }
`

const PAINT_HEIGHT = 540

function material(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader,
    uniforms,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
}

export class PaintPass extends Pass {
  constructor(camera, { start = 110, end = 190, radius = 6, hardness = 8, sharpness = 8, grain = 0.06 } = {}) {
    super('PaintPass')
    this.mainCamera = camera
    this.needsDepthTexture = true
    this.needsSwap = false

    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
    this.colorTarget = rt()
    this.tensorTarget = rt()
    this.blurTarget = rt()
    this.paintTarget = rt()

    this.prepMaterial = material(PREP, { inputBuffer: { value: null }, ...depthUniforms(start, end) })
    this.tensorMaterial = material(TENSOR, { colorBuffer: { value: this.colorTarget.texture }, texel: { value: new THREE.Vector2() } })
    this.blurMaterial = material(BLUR, { tensorBuffer: { value: null }, blurStep: { value: new THREE.Vector2() } })
    this.kuwaharaMaterial = material(KUWAHARA, {
      colorBuffer: { value: this.colorTarget.texture },
      tensorBuffer: { value: this.tensorTarget.texture },
      texel: { value: new THREE.Vector2() },
      radius: { value: radius },
      hardness: { value: hardness },
      sharpness: { value: sharpness },
    })
    this.fullscreenMaterial = this.prepMaterial
    this.composite = new PaintCompositePass(this.paintTarget.texture, camera, { start, end, grain })
  }

  set mainCamera(camera) {
    this.camera3 = camera
  }

  setDepthTexture(depthTexture) {
    this.prepMaterial.uniforms.depthBuffer.value = depthTexture
  }

  setSize(width, height) {
    const h = Math.min(height, PAINT_HEIGHT)
    const w = Math.max(1, Math.round((width * h) / height))
    for (const t of [this.colorTarget, this.tensorTarget, this.blurTarget, this.paintTarget]) t.setSize(w, h)
    this.tensorMaterial.uniforms.texel.value.set(1 / w, 1 / h)
    this.kuwaharaMaterial.uniforms.texel.value.set(1 / w, 1 / h)
    this.size = [w, h]
  }

  draw(renderer, mat, target) {
    this.fullscreenMaterial = mat
    renderer.setRenderTarget(target)
    renderer.render(this.scene, this.camera)
  }

  render(renderer, inputBuffer) {
    setCameraUniforms(this.prepMaterial, this.camera3)
    const [w, h] = this.size

    this.prepMaterial.uniforms.inputBuffer.value = inputBuffer.texture
    this.draw(renderer, this.prepMaterial, this.colorTarget)
    this.draw(renderer, this.tensorMaterial, this.tensorTarget)

    this.blurMaterial.uniforms.tensorBuffer.value = this.tensorTarget.texture
    this.blurMaterial.uniforms.blurStep.value.set(1 / w, 0)
    this.draw(renderer, this.blurMaterial, this.blurTarget)
    this.blurMaterial.uniforms.tensorBuffer.value = this.blurTarget.texture
    this.blurMaterial.uniforms.blurStep.value.set(0, 1 / h)
    this.draw(renderer, this.blurMaterial, this.tensorTarget)

    this.draw(renderer, this.kuwaharaMaterial, this.paintTarget)
  }
}

class PaintCompositePass extends Pass {
  constructor(paintTexture, camera, { start, end, grain }) {
    super('PaintCompositePass')
    this.camera3 = camera
    this.needsDepthTexture = true
    this.fullscreenMaterial = material(COMPOSITE, {
      inputBuffer: { value: null },
      paintBuffer: { value: paintTexture },
      resolution: { value: new THREE.Vector2() },
      grain: { value: grain },
      ...depthUniforms(start, end),
    })
  }

  set mainCamera(camera) {
    this.camera3 = camera
  }

  setDepthTexture(depthTexture) {
    this.fullscreenMaterial.uniforms.depthBuffer.value = depthTexture
  }

  setSize(width, height) {
    this.fullscreenMaterial.uniforms.resolution.value.set(width, height)
  }

  render(renderer, inputBuffer, outputBuffer) {
    setCameraUniforms(this.fullscreenMaterial, this.camera3)
    this.fullscreenMaterial.uniforms.inputBuffer.value = inputBuffer.texture
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
  }
}

function depthUniforms(start, end) {
  return {
    depthBuffer: { value: null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    maskRange: { value: new THREE.Vector2(start, end) },
  }
}

function setCameraUniforms(mat, camera) {
  mat.uniforms.cameraNear.value = camera.near
  mat.uniforms.cameraFar.value = camera.far
}
