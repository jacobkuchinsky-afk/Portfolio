// Vercel: serves /api/steam (see _steam.js)
import { steamResponse } from './_steam.js'

export function GET(request) {
  return steamResponse(request.headers.get('x-vercel-ip-country'))
}
