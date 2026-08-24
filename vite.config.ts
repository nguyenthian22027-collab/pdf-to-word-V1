import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleLicenseApi } from './src/services/licenseServerMiddleware';

function licenseMiddlewarePlugin(): Plugin {
  return {
    name: 'mathocr-license-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleLicenseApi(req, res);
          if (!handled) {
            next();
          }
        } catch {
          next();
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleLicenseApi(req, res);
          if (!handled) {
            next();
          }
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), licenseMiddlewarePlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
  },
  server: {
    proxy: {
      // Proxy /mathtype-api/* -> https://latex2mathtypeweb.onrender.com/*
      // Giải quyết CORS khi chạy dev (localhost)
      '/mathtype-api': {
        target: 'https://latex2mathtypeweb.onrender.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mathtype-api/, ''),
        secure: true,
      },
    },
  },
});

