// Cloudflare Pages: serves /api/steam (see api/_steam.js)
import { steamResponse } from '../../api/_steam.js'

export const onRequestGet = ({ request }) => steamResponse(request.headers.get('cf-ipcountry'))
