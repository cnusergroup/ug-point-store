# Bug Condition B Exploration — Full Backend Suite Reproduction

## Summary

**FATAL ERROR REPRODUCED** — `npx vitest --run packages/backend` aborts with heap exhaustion
before printing any aggregate summary. The dying process is a **pool worker** (tinypool fork),
not the parent coordinator.

---

## 1. Baseline Run (no heap override)

**Command**: `npx vitest --run packages/backend`

**Result**: FATAL ERROR at ~4050 MB heap

```
<--- Last few GCs --->
[66120:0000023E1D8DA000]    17116 ms: Scavenge (interleaved) 4041.8 (4060.1) -> 4036.5 (4098.3) MB
[66120:0000023E1D8DA000]    18606 ms: Mark-Compact (reduce) 4053.6 (4100.1) -> 4045.5 (4049.6) MB

FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

**Parent-side symptom**: `Unhandled Rejection: Error: Channel closed` with
`{ code: 'ERR_IPC_CHANNEL_CLOSED' }` — confirms the **worker process** crashed and the parent
received a broken-channel notification from tinypool.

**No aggregate summary printed** — the run ends with exit code 1 but no "Test Files: X passed | Y failed" line.

---

## 2. Run with NODE_OPTIONS=--max-old-space-size=8192

**Command**: `$env:NODE_OPTIONS="--max-old-space-size=8192"; npx vitest --run packages/backend`

**Result**: FATAL ERROR at ~8141 MB heap

```
<--- Last few GCs --->
[38724:000001EB21101000]    27808 ms: Scavenge (interleaved) 8133.1 (8151.5) -> 8127.9 (8190.0) MB
[38724:000001EB21101000]    30114 ms: Mark-Compact (reduce) 8154.8 (8192.7) -> 8141.6 (8145.7) MB

FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

**Analysis**: The 8 GB setting **DID reach the worker process** (it used 8141 MB before dying,
vs 4050 MB without the override). This **partially refutes hypothesis B.2** (which claimed
`NODE_OPTIONS` does not reach pool children). The setting IS inherited via environment, but
8 GB is still insufficient for the full 210-file suite in a single worker.

The correct fix is to set `poolOptions.forks.execArgv` in `vitest.config.ts` to explicitly
pass `--max-old-space-size` to workers, AND/OR limit `maxForks` to spread files across
more workers with less memory pressure per worker.

---

## 3. Sharded Runs with --logHeapUsage (4096 MB limit)

| Shard | Files | Tests | Outcome | Duration |
|-------|-------|-------|---------|----------|
| 1/4   | 53    | 635   | ✅ Completed | 8.12s |
| 2/4   | ~53   | —     | ❌ OOM (first attempt) / ✅ (second attempt, non-deterministic) | — |
| 3/4   | 53    | 720   | ✅ Completed | 32.25s |
| 4/4   | 51    | 924   | ✅ Completed | 4.19s |

**Key insight**: The OOM is **non-deterministic at the shard level** — shard 2/4 crashed on the
first attempt but succeeded on the second. This is consistent with Vitest's `forks` pool
assigning files to workers in a non-deterministic order. When many high-memory property test
files land in the same worker, accumulation crosses the threshold.

### Per-file Heap Usage (top consumers from shard 2 successful run)

| File | Heap Used | Tests |
|------|-----------|-------|
| `travel/apply.property.test.ts` | **172 MB** | 20 |
| `content/tags.property.test.ts` | 61 MB | 10 |
| `admin/order-admin-access.property.test.ts` | 55 MB | 3 |
| `email/notifications.property.test.ts` | 49 MB | 15 |
| `redemptions/code-redemption-address.property.test.ts` | 49 MB | 7 |
| `settings/feature-toggles.property.test.ts` | 46 MB | 21 |
| `reports/employee-engagement.property.test.ts` | 42 MB | 9 |
| `reports/employee-filter.property.test.ts` | 39 MB | 10 |
| `email/code-distribution-email.property.test.ts` | 35 MB | 4 |
| `reports/formatters.test.ts` | 34 MB | 52 |
| `admin/batch-points.property.test.ts` | 34 MB | 23 |

**Dominant file**: `travel/apply.property.test.ts` at 172 MB is the single largest consumer —
3x the next file. It contains the un-awaited async property assertions from Defect A, which
may be generating orphaned executions that retain memory.

Most other files consume 12–55 MB individually, which is manageable. The problem is
**cumulative retention**: when 50+ files run in a single worker, their module-scope closures
and fast-check shrink histories accumulate.

---

## 4. Backend File Count

| Metric | Count |
|--------|-------|
| Total test files under `packages/backend/src` | **210** |
| Property test files (`*.property.test.ts`) | **106** |
| Non-property test files | 104 |
| Total discovered by Vitest (sum of shards) | **210** (53+53+53+51) |

Note: The design doc estimated 204 / 104. The current count is 210 / 106 (6 additional files
have been added since the analysis was written).

---

## 5. Root Cause Determination

| Hypothesis | Status | Evidence |
|-----------|--------|----------|
| B.1: Heap accumulation in reused workers | **CONFIRMED** | Per-file heap is modest (12–172 MB) but 53+ files in one worker accumulate to >4 GB |
| B.2: NODE_OPTIONS not reaching workers | **PARTIALLY REFUTED** | The 8 GB setting DID reach the worker (it hit 8141 MB). But the setting is insufficient. |
| B.3: Module-scope retention | **LIKELY** | `apply.property.test.ts` at 172 MB has 20 tests with large generated arrays and un-awaited properties that may retain shrink history |
| B.4: Parent-process aggregation | **REFUTED** | The parent survives; only the worker dies (ERR_IPC_CHANNEL_CLOSED from parent side) |
| B.5: Oversized generated values in specific files | **CONFIRMED** | `apply.property.test.ts` alone uses 172 MB |

**Primary cause**: Worker heap accumulation across 210 files with no `maxForks` cap and no
explicit `execArgv` heap setting. The default V8 heap limit (~4 GB) is insufficient when many
property test files (especially `travel/apply.property.test.ts` at 172 MB) land in the same
worker.

---

## 6. Fix Strategy Implications (for task 6.4)

Based on these measurements:

1. **Set `poolOptions.forks.execArgv: ['--max-old-space-size=4096']`** — Explicitly pass the
   heap limit to workers (don't rely on parent `NODE_OPTIONS` inheritance which is fragile
   across different CI environments).

2. **Cap `maxForks`** — Limit concurrent workers so the machine doesn't run out of total RAM.
   With 4 GB per worker and typical 16 GB machines, `maxForks: 3` is safe.

3. **Consider `isolate: true` (default) with file-level isolation** — Already the default,
   but the accumulation suggests GC is not reclaiming module-scope closures between files
   within the same worker.

4. **If worker tuning alone is insufficient**: Use a sharded sequential run script
   (`test:backend`) with `--shard=i/4` and blob merging. The shard approach already works
   (shards 1, 3, 4 complete; shard 2 completes non-deterministically at 4 GB).

5. **Targeted fix for `travel/apply.property.test.ts`**: After Defect A is fixed (awaiting the
   assertions), the orphaned properties that retain shrink history should be eliminated,
   potentially reducing its 172 MB footprint significantly.

---

## 7. Key Observations

- The crash is **non-deterministic** at any given shard boundary because Vitest assigns files
  to workers dynamically. The same shard can succeed or fail depending on worker assignment.
- The `--logHeapUsage` flag reports heap usage AFTER each file completes, not the peak during
  execution. Actual peak heap during property execution (especially with shrinking) may be
  significantly higher than reported.
- No aggregate pass/fail summary is ever produced when the run crashes — confirming requirement
  1.6 that CI gets no full-suite signal.
- The `property-await-hidden-verdict.test.ts` test (from task 2) succeeded in shard 2's run,
  taking 16507ms — these longer-running integration tests also contribute to worker pressure.
