import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest runs with globals off, so RTL's auto-cleanup never hooks in —
// unmount every render explicitly or later tests see earlier tests' DOM.
afterEach(() => cleanup());
