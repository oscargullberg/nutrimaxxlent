import { loadLocalEnv, readServerEnv } from '../src/lib/server/env.ts';

loadLocalEnv();
const { host, origin, port } = readServerEnv();
process.env.HOST = host;
process.env.PORT = String(port);
process.env.ORIGIN = origin;
await import(new URL('../build/index.js', import.meta.url).href);
