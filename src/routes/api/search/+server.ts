import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint } from '#lib/server/http/api.ts';
import { searchHistory } from '#lib/server/services/search.ts';
export const GET = endpoint(async ({ url }) =>
  json({
    matches: await searchHistory(
      getDatabase(),
      z
        .string()
        .max(250)
        .parse(url.searchParams.get('q') ?? '')
    )
  })
);
