import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { steamResponse } from './api/_steam.js'

// In dev there's no host to run api/, so the dev server answers /api/steam itself
const steamApi = {
  name: 'steam-api',
  configureServer(server) {
    server.middlewares.use('/api/steam', async (_req, res) => {
      const response = await steamResponse()
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      res.end(await response.text())
    })
  },
}

export default defineConfig({
  plugins: [react(), steamApi],
})
