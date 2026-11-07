import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "pixel-press",
        short_name: "pixel-press",
        description:
          "Local-first, local-only video compression and project auditing in your browser.",
        theme_color: "#0b0b0f",
        background_color: "#0b0b0f",
        display: "standalone",
        orientation: "landscape-primary",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // FFmpeg wasm cores are large; keep the precache ceiling at 35 MB.
        maximumFileSizeToCacheInBytes: 35 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,wasm}"],
        // Never let the PWA service worker answer the COI worker request.
        navigateFallbackDenylist: [/^\/coi-serviceworker\.js$/],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});
