import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Phone reaches this over USB via `adb reverse tcp:5173 tcp:5173`, so it
    // loads http://localhost:5173 on-device - no LAN exposure or HTTPS
    // cert needed, since mobile browsers treat localhost as a secure context
    // (required for getUserMedia/camera access).
    proxy: {
      // Same-origin proxy to the backend avoids CORS.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
