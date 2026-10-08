import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5174, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
