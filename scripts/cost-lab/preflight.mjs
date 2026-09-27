/** Offline-only cost baseline. No credentials, network, database or customer sends. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const recorded = read('scripts/eval-modelo/resultados.json');
const verdict = read('scripts/eval-modelo/veredicto.json');
const rates = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
};
const baseline = Object.entries(recorded.gasto).map(([model, usage]) => {
  const rate = rates[model];
  if (!rate) throw new Error(`Unknown model: ${model}`);
  // Historical fixture does not identify cache-write TTL. Do not guess a cost.
  const usd = usage.cacheW ? null :
    (usage.prompt * rate.input + usage.salida * rate.output + usage.cacheR * rate.input * 0.1) / 1e6;
  return {
    model, calls: usage.n, recordedTokenCostUsd: usd,
    meanLatencySeconds: usage.ms / usage.n / 1000,
    cacheWriteTokens: usage.cacheW,
    excludesCacheWarmup: usage.cacheW === 0,
    judgedCases: verdict.resumen[model]?.casos ?? null,
    casesWithSevereIssue: verdict.resumen[model]?.casos_con_grave ?? null,
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'offline_preflight',
  productionChanged: false,
  networkRequests: 0,
  merchantCharges: 0,
  newProviderSpendUsd: 0,
  baseline,
  limitations: [
    'Historical fixtures; not current merchant spend or a new quality evaluation.',
    'Timing/token totals and judged cases are different samples; do not merge denominators.',
    'Cache warm-up is absent. These costs are not production savings forecasts.',
  ],
  rollout: {
    enabled: false,
    requirements: [
      'Representative, de-identified cases for each merchant and channel.',
      'Separate Anthropic-only replay process with fixed spend cap and no production tool executors.',
      'Exact prompt-content preservation for cache-only changes.',
      'No new severe errors, forgotten corrections, unverified prices or unauthorized actions.',
      'Compare total cost including cache writes, extra calls, retries and latency.',
      'Merchant-specific pilot and immediate rollback before wider activation.',
    ],
  },
};
const directory = resolve(root, 'output/cost-lab');
mkdirSync(directory, { recursive: true });
const output = resolve(directory, 'preflight.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, mode: report.mode, productionChanged: false, baseline }));
