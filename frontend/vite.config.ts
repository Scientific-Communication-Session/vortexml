import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Where the Flask backend lives. Override (e.g. VORTEX_BACKEND_URL=http://127.0.0.1:5051)
// to run a second dev instance next to the live one.
const backend = process.env.VORTEX_BACKEND_URL || 'http://127.0.0.1:5050'

// The one public hostname. Must match VORTEX_PUBLIC_URL on the backend.
const publicHost = 'vortexml.ro'

// www.vortexml.ro is only an alias: send it to the apex so there is a single
// origin for the login cookie and for the sockets the backend accepts.
const redirectWww = (): Plugin => ({
  name: 'vortex-redirect-www',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.headers.host?.split(':')[0] !== `www.${publicHost}`) return next()
      res.writeHead(301, { Location: `https://${publicHost}${req.url ?? '/'}` })
      res.end()
    })
  }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), redirectWww()],
  server: {
    // Bind all interfaces so the Cloudflare tunnel (→ 192.168.x.x:5173) reaches us.
    host: true,
    // Vite rejects unknown Host headers; allow the public tunnel domain
    // (www only gets as far as the redirect above).
    allowedHosts: [publicHost, `www.${publicHost}`, 'localhost', '127.0.0.1'],
    proxy: {
      '/api': backend,
      '/socket.io': {
        target: backend,
        ws: true
      }
    }
  }
})

// Added to trigger Vite restart
