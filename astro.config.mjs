import { defineConfig } from "astro/config";

/** @see https://astro.build/config */
export default defineConfig({
  site: "https://andreybolotov.ru",
  compressHTML: true,
  build: {
    inlineStylesheets: "auto",
  },
  vite: {
    build: {
      cssMinify: true,
      minify: "esbuild",
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3000",
          changeOrigin: true,
        },
        "/ws": {
          target: "http://127.0.0.1:3000",
          ws: true,
          changeOrigin: true,
        },
      },
    },
  },
});
