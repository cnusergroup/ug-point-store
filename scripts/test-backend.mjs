/**
 * test-backend.mjs — Documented single command for running the full backend test suite.
 *
 * Runs `vitest --run packages/backend` across N sequential shards using the blob
 * reporter, then merges them into one aggregate summary. Propagates a non-zero exit
 * code if any shard fails.
 *
 * Usage:
 *   node scripts/test-backend.mjs
 *
 * Or via the package.json script:
 *   npm run test:backend
 *
 * Why sharding? The full backend suite (210+ test files, 106 property tests) exhausts
 * a single worker's JS heap due to cumulative module-scope retention across files.
 * NODE_OPTIONS=--max-old-space-size=8192 reaches the worker but is insufficient.
 * Sequential sharding isolates memory pressure per shard while still reporting one
 * aggregate result.
 *
 * The vitest.config.ts also sets poolOptions.forks.execArgv with --max-old-space-size=8192
 * and maxForks=3 to give each worker more heap room within each shard.
 *
 * Requirements satisfied: 1.5, 1.6, 2.5, 2.6, 3.5, 3.6
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SHARD_COUNT = 12;
const BLOB_DIR = join(__dirname, '..', '.vitest-blob');
const ROOT = join(__dirname, '..');

function main() {
  // Clean previous blob output
  if (existsSync(BLOB_DIR)) {
    rmSync(BLOB_DIR, { recursive: true, force: true });
  }
  mkdirSync(BLOB_DIR, { recursive: true });

  let anyShardFailed = false;
  const shardResults = [];

  console.log(`\n🧪 Running backend test suite in ${SHARD_COUNT} shards...\n`);

  for (let i = 1; i <= SHARD_COUNT; i++) {
    const blobFile = join(BLOB_DIR, `shard-${i}.blob`);

    const cmd = [
      'npx vitest --run',
      `--shard=${i}/${SHARD_COUNT}`,
      '--reporter=blob',
      `--outputFile.blob=${blobFile}`,
      'packages/backend',
    ].join(' ');

    console.log(`━━━ Shard ${i}/${SHARD_COUNT} ━━━`);
    console.log(`  Command: ${cmd}\n`);

    try {
      execSync(cmd, {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env },
      });
      shardResults.push({ shard: i, exitCode: 0 });
      console.log(`\n  ✅ Shard ${i}/${SHARD_COUNT} completed successfully\n`);
    } catch (err) {
      const exitCode = err.status ?? 1;
      shardResults.push({ shard: i, exitCode });
      anyShardFailed = true;
      console.log(`\n  ❌ Shard ${i}/${SHARD_COUNT} failed (exit code ${exitCode})\n`);
    }
  }

  // Merge blob reports into an aggregate summary
  console.log(`\n━━━ Merging shard reports ━━━\n`);
  try {
    execSync(`npx vitest --merge-reports=${BLOB_DIR}`, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
  } catch {
    // merge-reports exits non-zero when there are test failures — that's expected
    anyShardFailed = true;
  }

  // Summary
  console.log('\n━━━ Aggregate Summary ━━━\n');
  for (const { shard, exitCode } of shardResults) {
    const icon = exitCode === 0 ? '✅' : '❌';
    console.log(`  ${icon} Shard ${shard}/${SHARD_COUNT}: exit code ${exitCode}`);
  }

  if (anyShardFailed) {
    console.log('\n❌ Backend suite FAILED (one or more shards had failures)\n');
    process.exit(1);
  } else {
    console.log('\n✅ Backend suite PASSED (all shards green)\n');
    process.exit(0);
  }
}

main();
