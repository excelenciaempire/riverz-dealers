// `next build` con memoria suficiente para el paso «Running TypeScript».
//
// El 2026-08 se puso `node --max-old-space-size=4096 …/next build` y alcanzó
// hasta el 2026-09-18, cuando cinco deploys seguidos murieron en Render con
// "JavaScript heap out of memory … Failed to type check" (heap de ~2 GB). El
// motivo: `next build` corre la compilación y el chequeo de tipos en un
// PROCESO HIJO, y un proceso hijo no hereda las banderas de V8 de la línea
// de comandos del padre. Lo que sí hereda es NODE_OPTIONS. Este lanzador la
// fija y arranca Next; funciona igual en Render (Linux) y en Windows, donde
// `NODE_OPTIONS=… next build` en el script de npm no se puede escribir.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const next = require.resolve('next/dist/bin/next');
const heap = process.env.NEXT_BUILD_HEAP_MB || '4096';
const previas = (process.env.NODE_OPTIONS || '').replace(/--max-old-space-size=\d+/g, '').trim();

const r = spawnSync(process.execPath, [next, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: `${previas} --max-old-space-size=${heap}`.trim(),
  },
});
process.exit(r.status ?? 1);
