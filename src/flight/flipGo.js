import { useFlight } from '../state/useFlight.js'
import { engineAudio } from '../audio/engineAudio.js'

// The visitor's one big action. Used by the 3D switch and its keyboard button.
export function flipGo() {
  if (useFlight.getState().phase !== 'armed') return
  engineAudio.click()
  useFlight.getState().flipGo()
}
