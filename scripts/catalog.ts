import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { connectDatabase } from '../src/lib/server/db/client.ts';
import { seedDatabase } from '../src/lib/server/db/seed.ts';
import { loadLocalEnv, readServerEnv } from '../src/lib/server/env.ts';
import { fdcAdapter, fdcDatasets } from '../src/lib/server/importers/fdc.ts';
import { offAdapter, offParquetUrl, prefilterOff } from '../src/lib/server/importers/off.ts';
import { downloadSlv, slvAdapter } from '../src/lib/server/importers/slv.ts';
import { runImport } from '../src/lib/server/importers/source.ts';
import { backfillCatalogDietary } from '../src/lib/server/services/entries.ts';

const adapters = { slv: slvAdapter, fdc: fdcAdapter, off: offAdapter };
type Source = keyof typeof adapters;

async function downloadFile(url: string, path: string, label: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_600_000) });
  if (!response.ok || !response.body) throw new Error(`${label}: HTTP ${response.status}.`);
  const megabyte = 1024 * 1024;
  const length = Number(response.headers.get('content-length') ?? 0);
  let downloaded = 0;
  let next = 100 * megabyte;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      if (downloaded >= next) {
        const total = length ? ` / ${Math.round(length / megabyte)} MiB` : '';
        console.log(`${label}: ${Math.round(downloaded / megabyte)} MiB${total}`);
        next = downloaded + 100 * megabyte;
      }
      callback(null, chunk);
    }
  });
  const reader = response.body.getReader();
  await pipeline(
    async function* () {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return;
          yield chunk.value;
        }
      } finally {
        await reader.cancel();
      }
    },
    meter,
    createWriteStream(path, { flags: 'wx' })
  );
  console.log(`${label}: downloaded ${(downloaded / megabyte).toFixed(1)} MiB.`);
}

async function downloadFdc(dataDir: string) {
  const dir = join(dataDir, 'fdc');
  await mkdir(dir, { recursive: true });
  const temporary = await mkdtemp(join(dir, '.download-'));
  try {
    for (const { archive, file } of fdcDatasets) {
      const path = join(temporary, archive);
      await downloadFile(`https://fdc.nal.usda.gov/fdc-datasets/${archive}`, path, file);
      const extracted = join(temporary, file);
      await mkdir(extracted);
      await promisify(execFile)('unzip', ['-q', '-j', path, '*.json', '-d', extracted]);
      const [entry, ...others] = await readdir(extracted);
      if (!entry || others.length) throw new Error(`Expected one JSON file in ${archive}.`);
      await rename(join(extracted, entry), join(temporary, `${file}.json`));
    }
    for (const { file } of fdcDatasets) {
      await rename(join(temporary, `${file}.json`), join(dir, `${file}.json`));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function downloadOff(dataDir: string) {
  const dir = join(dataDir, 'off');
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `food-${randomUUID()}.parquet`);
  try {
    await downloadFile(offParquetUrl, temporary, 'Open Food Facts');
    console.log('Filtering Swedish products with DuckDB.');
    await prefilterOff(dataDir, temporary);
    await rename(temporary, join(dir, 'food.parquet'));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function download(source: Source, dataDir: string) {
  if (source === 'slv') {
    const result = await downloadSlv(dataDir, {
      onProgress: (done, total) => console.log(`Livsmedelsverket: ${done}/${total} foods cached.`)
    });
    console.log(result);
    return;
  }
  if (source === 'fdc') await downloadFdc(dataDir);
  else await downloadOff(dataDir);
}

async function main() {
  const [command, name, ...args] = process.argv.slice(2);
  const backfill = args.length === 1 && args[0] === '--backfill-dietary' && command !== 'download';
  if (
    (args.length && !backfill) ||
    !name ||
    !Object.hasOwn(adapters, name) ||
    (command !== 'download' && command !== 'import' && command !== 'refresh')
  ) {
    console.error(
      'Usage: tsx scripts/catalog.ts <download|import|refresh> <slv|fdc|off> [--backfill-dietary]'
    );
    process.exitCode = 1;
    return;
  }
  const source = name as Source;
  loadLocalEnv();
  const dataDir = process.env.DATA_DIR?.trim() || './data';
  if (command !== 'import') await download(source, dataDir);
  if (command === 'download') return;

  const adapter = await adapters[source](dataDir);
  const { db, close } = connectDatabase(readServerEnv().databaseUrl);
  try {
    await seedDatabase(db);
    const stats = await runImport(db, adapter, ({ read }) =>
      console.log(`${name}: processed ${read} foods.`)
    );
    console.log(`${name} (${adapter.version})`, stats);
    if (backfill) {
      const updated = await backfillCatalogDietary(db, source);
      console.log(`${name}: filled missing dietary data for ${updated} logged items.`);
    }
  } finally {
    await close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
