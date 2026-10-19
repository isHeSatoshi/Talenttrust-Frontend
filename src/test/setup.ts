import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React 19 + RTL: unmount between tests so a stray effect from one case cannot
// influence the next.
afterEach(() => {
  cleanup();
});
