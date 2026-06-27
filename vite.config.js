import { defineConfig } from 'vite'

export default defineConfig({
  base: '',
  plugins: [{
    name: 'no-crossorigin',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/\s+crossorigin/gi, '');
      },
    },
  }],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 3000,
  },
})
