import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'highlight': ['highlight.js'],
          'marked': ['marked'],
          'solid-router': ['@solidjs/router'],
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'AgentOps Console',
        short_name: 'AgentOps',
        description: 'AgentOps Console — manage and interact with your AI agents',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            // SSE, streaming, and trace endpoints — always network, never cache
            urlPattern: /\/api\/v1\/(traces|events|watch|agents\/.*\/(stream|events))/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/api\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5,
              },
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: /\.(js|css|woff2?|png|svg|jpg|jpeg|gif|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
        navigateFallbackDenylist: [/\/api\/v1\/(events|agents\/.*\/(stream|events))/],
      },
    }),
  ],
  server: {
    // hostPath mounts on k3s don't reliably emit inotify events; force polling
    // so file edits inside the dev pod's mounted /workspace are picked up by HMR.
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      // SSE / streaming endpoints — disable proxy buffering
      '/api/v1/events': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/api/v1/watch': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // All other API requests
      '/api/v1': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        configure: (proxy) => {
          // Disable buffering for SSE/streaming responses so events flush immediately
          proxy.on('proxyRes', (proxyRes, req, res) => {
            const ct = proxyRes.headers['content-type'] || '';
            if (ct.includes('text/event-stream')) {
              // Ensure no buffering or compression interferes
              res.setHeader('X-Accel-Buffering', 'no');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
            }
          });
        },
      },
      // Auth (GitLab OIDC login/callback/me/logout — routes outside /api/v1)
      '/auth': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
