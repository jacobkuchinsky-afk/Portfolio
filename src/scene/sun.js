import * as THREE from 'three'

// Golden hour, sun low in the shot behind the plane
export const SUN_DIR = new THREE.Vector3(-0.36, 0.2, -0.91).normalize()
export const SUN_COLOR = '#ffb070'

// Soft fill from the camera side, above and a little ahead. The sun is behind
// the plane, so without it the side we see is lit only by the pink sky.
export const FILL_DIR = new THREE.Vector3(0.3, 0.45, 1).normalize()
