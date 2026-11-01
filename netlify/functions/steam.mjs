// Netlify: serves /api/steam (see api/_steam.js)
import { steamResponse } from '../../api/_steam.js'

export default (request, context) => steamResponse(context.geo?.country?.code)

export const config = { path: '/api/steam' }
