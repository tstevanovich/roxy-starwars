import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom cannot play media. Individual playback tests can spy on this no-op;
// cleanup and non-playback UI tests should not emit unsupported-platform errors.
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: () => undefined
});

afterEach(cleanup);
