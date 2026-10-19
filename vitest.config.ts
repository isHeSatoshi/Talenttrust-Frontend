import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror tsconfig.json's `"@/*": ["./src/*"]` so tests import the same way
    // application code does.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // A mocked fetch that leaks between tests hides real retry/abort bugs.
    restoreMocks: true,
    clearMocks: true,
  },
});
