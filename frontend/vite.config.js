import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev proxy is what lets the frontend call a same-origin "/api/parse".
//
// In production, the root vercel.json rewrites /api/* to api/index.js (which runs backend/server.js), so
// the browser never makes a cross-origin request and no CORS applies. Proxying
// in dev makes localhost behave the same way - same path, same relative fetch -
// so a bug in the routing shows up locally instead of only after deploy.
//
// Note the difference between the two modes: with the proxy, api.js may call
// "/api/parse" with no VITE_API_URL set. Without a backend, leave VITE_API_URL
// empty and the app scores offline in the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Source maps make a production stack trace readable; they are not served to
    // the browser unless the deploy opts in.
    sourcemap: true,
  },
})
