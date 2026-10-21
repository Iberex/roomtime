import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'esnext', chunkSizeWarningLimit: 3000 },
  server: { port: 5192 },
});
