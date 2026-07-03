import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    https: true as any,
    proxy: {
      '/api-playlist': {
        target: 'https://freem3u.xyz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-playlist/, ''),
        headers: {
          'User-Agent': 'OkHttp/4.9.2',
          Referer: 'https://freem3u.xyz',
        }
      },
      '/api-epg': {
        target: 'https://vnepg.site',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-epg/, ''),
        headers: {
          'User-Agent': 'OkHttp/4.9.2',
          Referer: 'https://vnepg.site',
        }
      }
    }
  }
})
