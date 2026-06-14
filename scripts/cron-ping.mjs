#!/usr/bin/env node
/**
 * Cron-ping helper. Llamado por los Render Cron Jobs para hitear
 * endpoints internos del servicio web con el header de auth correcto.
 *
 * Uso:
 *   node scripts/cron-ping.mjs <ruta>
 *
 * Variables de entorno necesarias (definidas en el cron service de
 * Render):
 *   - BASE_URL: la URL pública del servicio web (https://...)
 *   - CRON_SECRET: el shared secret que valida la ruta (debe coincidir
 *     con el header `x-cron-secret` que el handler espera).
 *
 * Sale con exit code != 0 si el HTTP status no es 2xx, así Render
 * marca el run como fallido y el dashboard lo destaca.
 */

const path = process.argv[2];
if (!path) {
  console.error('cron-ping: falta argumento <ruta>');
  process.exit(2);
}

const base = process.env.BASE_URL;
const secret = process.env.CRON_SECRET;

if (!base) {
  console.error('cron-ping: falta BASE_URL en el environment');
  process.exit(2);
}
if (!secret) {
  console.error('cron-ping: falta CRON_SECRET en el environment');
  process.exit(2);
}

const url = base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
const t0 = Date.now();
try {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'x-cron-secret': secret },
  });
  const body = await res.text();
  const ms = Date.now() - t0;
  console.log(`[${res.status}] ${url} ${ms}ms`);
  console.log(body.slice(0, 800));
  if (!res.ok) process.exit(1);
} catch (err) {
  console.error('cron-ping: network error', err);
  process.exit(1);
}
