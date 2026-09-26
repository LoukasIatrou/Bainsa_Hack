import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Where /api goes. Default: a backend on this laptop. To use a teammate's laptop:
  //   VITE_BACKEND_URL=http://192.168.1.23:8000 npx pnpm@10 dev
  // (or put the line in frontend/.env.local). See frontend/README.md.
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_BACKEND_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      // Phone reaches this over USB via `adb reverse tcp:5173 tcp:5173`, so it
      // loads http://localhost:5173 on-device - no LAN exposure or HTTPS
      // cert needed, since mobile browsers treat localhost as a secure context
      // (required for getUserMedia/camera access).
      // `adb reverse` connects to 127.0.0.1 on the host - bind IPv4 explicitly,
      // since Vite's default `localhost` binding can resolve to the IPv6
      // loopback only.
      host: '127.0.0.1',
      // Person 3's engine lives in ../audio-haptics; let the dev server serve it.
      fs: { allow: ['..'] },
      proxy: {
        // Same-origin proxy to the backend avoids CORS.
        '/api': {
          target: backend,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
