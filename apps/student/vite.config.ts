import { defineConfig, type Plugin } from 'vite';
import purgecss from 'vite-plugin-purgecss';

export default defineConfig({
  server: { port: 5174, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [
    purgecss({
      content: [
        './index.html',
        './public/**/*.html',
        './src/**/*.ts',
        '../../packages/ui/src/**/*.ts',
      ],
      safelist: {
        standard: [
          /^modal/,
          'show',
          'fade',
          'd-block',
          'collapse',
          'collapsing',
          'visually-hidden-focusable',
        ],
      },
    }) as unknown as Plugin,
  ],
});
