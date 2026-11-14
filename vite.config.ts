import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const proxyTarget = 'http://localhost:8000'
const viteRoot = fileURLToPath(new URL('.', import.meta.url))
const publicRoot = path.resolve(viteRoot, 'public')

/** Serve `/data/...` from `public/` when the file is there; otherwise proxy to the backend. */
function dataFileBypass(url: string | undefined): string | undefined {
  if (!url) return undefined
  const pathOnly = url.split('?')[0] ?? ''
  if (!pathOnly.startsWith('/data/')) return undefined
  let decoded = pathOnly
  try {
    decoded = decodeURIComponent(pathOnly)
  } catch {
    return undefined
  }
  const relative = decoded.replace(/^\/+/, '')
  const file = path.resolve(publicRoot, relative)
  const fromRoot = path.relative(publicRoot, file)
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return undefined
  if (!existsSync(file)) return undefined
  return url
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/data': {
        target: proxyTarget,
        changeOrigin: true,
        bypass(req) {
          return dataFileBypass(req.url)
        },
      },
    },
  },
  build: {
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
