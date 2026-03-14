import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Usage:
//   npm run dev                                  → localhost:5173, API on 8080
//   VITE_PORT=5174 VITE_API_PORT=8081 npm run dev → localhost:5174, API on 8081
//   (Windows cmd: set VITE_PORT=5174 && set VITE_API_PORT=8081 && npm run dev)
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    strictPort: true,
  },
})