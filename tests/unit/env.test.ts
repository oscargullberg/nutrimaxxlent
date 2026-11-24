import { expect, test } from 'vitest';
import { readServerEnv } from '../../src/lib/server/env';

test('names the missing database key', () => {
  expect(() => readServerEnv({})).toThrow('Missing DATABASE_URL');
});

test('uses localhost defaults and accepts an explicitly configured provider and port', () => {
  expect(
    readServerEnv({
      DATABASE_URL: 'postgresql://127.0.0.1/nutrimaxlent',
      LLM_PROVIDER: 'fake',
      PORT: '4173'
    })
  ).toMatchObject({
    host: '127.0.0.1',
    port: 4173,
    origin: 'http://127.0.0.1:4173',
    provider: 'fake'
  });
});
