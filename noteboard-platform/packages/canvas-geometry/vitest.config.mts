import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/canvas-geometry',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'canvas-geometry',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/packages/canvas-geometry',
      provider: 'v8' as const,
    },
  },
}));
