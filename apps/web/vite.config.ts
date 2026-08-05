import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app directory, in its long-path spelling.
//
// `realpathSync.native` is the load-bearing part on Windows. A launcher can
// start us from an 8.3 short path — "…\MYPROJ~1\BizPilot\apps\web" — because
// this repo lives under a folder with a space in its name. Vite resolves module
// ids through the same realpath call, so ids always come back long
// ("…\My Projects\…"). If `root` is still the short spelling the two strings do
// not match, Vite decides main.tsx sits outside the project, and serves it raw
// instead of transforming it: a blank page, no error in the console, and
// "Failed to load url /src/main.tsx" in the server log. Normalising both ends to
// the same spelling is what keeps them comparable.
const root = realpathSync.native(process.cwd());

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    // Proxying in dev means the app talks to a same-origin /api in every
    // environment, so there is no CORS special-casing and no base-URL switch.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Charts and the date library are heavy and only needed on a few
        // screens; splitting them keeps the first paint fast on a 3G phone.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
