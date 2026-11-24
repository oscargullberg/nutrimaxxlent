import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { AgentError } from '../agent/provider.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiEvent = {
  request: Request;
  url: URL;
  params: Record<string, string | undefined>;
  locals: { requestId?: string };
};

const agentStatuses: Record<string, number> = {
  PROVIDER_NOT_CONNECTED: 503,
  PROVIDER_MODEL_UNAVAILABLE: 503,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  AGENT_TIMEOUT: 504,
  AGENT_STEP_LIMIT: 422,
  CATALOG_EMPTY: 422
};

export function errorDetails(error: unknown) {
  if (error instanceof ApiError)
    return { status: error.status, code: error.code, message: error.message };
  if (error instanceof AgentError)
    return {
      status: agentStatuses[error.code] ?? 422,
      code: error.code,
      message: error.message
    };
  if (error instanceof z.ZodError)
    return {
      status: 400,
      code: 'INVALID_INPUT',
      message: error.issues[0]?.message ?? 'Invalid input.'
    };
  if (error instanceof RangeError)
    return { status: 400, code: 'INVALID_INPUT', message: error.message };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'The request could not be completed.' };
}

export function errorResponse(error: unknown, requestId?: string) {
  const { status, code, message } = errorDetails(error);
  if (status === 500)
    console.error('Unexpected API error', {
      requestId,
      kind: error instanceof Error ? error.name : typeof error
    });
  return json({ error: { code, message, requestId } }, { status });
}

export function endpoint(handle: (event: ApiEvent) => Response | Promise<Response>) {
  return async (event: ApiEvent) => {
    try {
      return await handle(event);
    } catch (error) {
      return errorResponse(error, event.locals.requestId);
    }
  };
}

export async function readBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid JSON request body.');
  }
  return schema.parse(body);
}

export function pathId(params: ApiEvent['params'], name = 'id') {
  return z.uuid().parse(params[name]);
}

export function found<T>(value: T | null | false, noun: string): T {
  if (value === null || value === false)
    throw new ApiError(404, 'NOT_FOUND', `${noun} was not found.`);
  return value;
}

export function queryObject(url: URL) {
  return Object.fromEntries(url.searchParams);
}
