import { building, dev } from '$app/env';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { closeDatabase, getDatabase } from '#lib/server/db/runtime.ts';
import { verifyDatabase } from '#lib/server/db/verify.ts';
import { loadLocalEnv, readServerEnv } from '#lib/server/env.ts';
import { ApiError, errorResponse } from '#lib/server/http/api.ts';

export const init: ServerInit = async () => {
  if (building) return;
  loadLocalEnv();
  readServerEnv();
  await verifyDatabase(getDatabase());
  if (!dev) {
    process.once('sveltekit:shutdown', () => {
      void closeDatabase().catch(() => console.error('Could not close the Postgres pool.'));
    });
  }
};

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.url.pathname.startsWith('/api/')) return resolve(event);

  const requestId = crypto.randomUUID();
  event.locals.requestId = requestId;
  let response: Response;
  try {
    if (!safeMethods.has(event.request.method)) {
      const { origin } = readServerEnv();
      if (event.request.headers.get('origin') !== origin) {
        throw new ApiError(403, 'INVALID_ORIGIN', `Open ${origin} to make changes.`);
      }
    }
    response = await resolve(event);
    if (
      response.status === 404 &&
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      response = errorResponse(
        new ApiError(404, 'NOT_FOUND', 'API route was not found.'),
        requestId
      );
    }
  } catch (error) {
    response = errorResponse(error, requestId);
  }

  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
