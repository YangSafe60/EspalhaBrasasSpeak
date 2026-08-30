import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
