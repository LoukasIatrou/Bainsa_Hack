import { defineConfig } from 'vite';

// Dev-harness config only. The library itself is emitted by `tsc`
// (npm run build -> dist/), so Person 4 gets real .d.ts files without
// this package depending on a bundler plugin.
export default defineConfig({
  server: {
    // Bind 0.0.0.0 so the Android demo phone can reach the harness over
    // shared wifi. navigator.vibrate() cannot be tested on the laptop.
    host: true,
    port: 5173,
  },
});
