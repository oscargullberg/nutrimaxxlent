import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { loadLocalEnv, readListenConfig } from './src/lib/server/env.ts';

loadLocalEnv();

export default defineConfig({
  server: { ...readListenConfig(), strictPort: true },
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter()
    })
  ]
});
