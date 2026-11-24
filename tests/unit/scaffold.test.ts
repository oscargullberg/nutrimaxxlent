import { expect, test } from 'vitest';
import { ssr } from '../../src/routes/+layout';

test('runs tests in Node and keeps the app client-rendered', () => {
  expect(process.release.name).toBe('node');
  expect(typeof window).toBe('undefined');
  expect(ssr).toBe(false);
});
