import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/demo-api': 'http://localhost:3001',
    },
  },
  build: { sourcemap: false },
});
