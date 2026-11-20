import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content-Security-Policy for every page (main window, pop-outs, voice host,
 * screen hosts). The point is that only the app's own scripts can run: even if
 * a message ever slipped markup through, it could not execute code with access
 * to the preload API (E2E keys, tokens, uploads).
 *
 * Network and media stay open (http/https/ws/wss) because the API and LiveKit
 * hosts are configured at runtime and images/files come from several hosts.
 * Dev additionally allows inline scripts, which Vite's HMR/React refresh inject.
 */
function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob: https: http:",
    "connect-src 'self' data: blob: https: http: wss: ws:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

function cspPlugin(): Plugin {
  return {
    name: "speakapp-csp",
    transformIndexHtml(_html, ctx) {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: contentSecurityPolicy(Boolean(ctx.server)),
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  clearScreen: false,
  base: "./",
  server: {
    port: 1420,
    strictPort: true,
    open: false,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_"],
  build: {
    outDir: "dist",
    target: "esnext",
    // livekit-client ~531 kB minified, loaded only on voice join.
    // Vite 8 reporter currently treats this value as bytes (not kB).
    chunkSizeWarningLimit: 600_000,
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        voiceHost: path.resolve(__dirname, "voice-host.html"),
        screenHost: path.resolve(__dirname, "screen-host.html"),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "livekit",
              test: /node_modules[\\/]livekit-client/,
            },
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom)\b/,
            },
          ],
        },
      },
    },
  },
});
