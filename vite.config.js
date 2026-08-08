/// <reference types="vitest" />
/* eslint-env node */
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// public/non-committed-art holds working artwork — .pdn sources, drafts,
// screenshots — that the app never references. Vite copies all of public/
// into dist/ with no built-in ignore, and electron-builder then packs
// dist/**/* into the installer, so without this the scratch art would ship
// to every user. Drop the folder after the copy step. It is also gitignored.
const stripNonCommittedArt = () => ({
  name: 'strip-non-committed-art',
  apply: 'build',
  closeBundle() {
    fs.rmSync(path.resolve(process.cwd(), 'dist/non-committed-art'), {
      recursive: true,
      force: true,
    })
  },
})

// Usage:
//   npm run dev                                  → localhost:5173, API on 8080
//   VITE_PORT=5174 VITE_API_PORT=8081 npm run dev → localhost:5174, API on 8081
//   (Windows cmd: set VITE_PORT=5174 && set VITE_API_PORT=8081 && npm run dev)
export default defineConfig({
  plugins: [react(), stripNonCommittedArt()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
