import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  const destination = url.searchParams.has('thread') ? '/chat-history' : '/today';
  redirect(307, destination + url.search);
};
