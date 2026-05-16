import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind all interfaces so the Cloudflare tunnel (→ 192.168.x.x:5173) reaches us.
    host: true,
    // Vite rejects unknown Host headers; allow the public tunnel domain.
    // A leading dot allows the apex + every subdomain of andreinita.com,
    // so vortexml.andreinita.com (and any future subdomain) is accepted.
    allowedHosts: ['.andreinita.com', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': 'http://127.0.0.1:5050',
      '/socket.io': {
        target: 'http://127.0.0.1:5050',
        ws: true
      }
    }
  }
})

// Added to trigger Vite restart
