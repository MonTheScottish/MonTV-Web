import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api-playlist': {
        target: 'https://freem3u.xyz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-playlist/, ''),
        headers: {
          Referer: 'https://freem3u.xyz',
        }
      },
      '/api-epg': {
        target: 'https://vnepg.site',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-epg/, ''),
        headers: {
          Referer: 'https://vnepg.site',
        }
      }
    }
  }
})
