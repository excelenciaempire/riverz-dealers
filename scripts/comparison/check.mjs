import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const origin = 'http://127.0.0.1:3107';
const homepage = await fetch(origin + '/');
assert.equal(homepage.status, 200);
assert.match(homepage.headers.get('content-security-policy'), /connect-src 'none'/);
assert.equal(homepage.headers.get('cache-control'), 'private, no-store');
assert.equal(homepage.headers.get('x-content-type-options'), 'nosniff');
const comparison = await fetch(origin + '/compare');
assert.equal(comparison.status, 200);
assert.match(comparison.headers.get('content-security-policy'), /frame-src 'self'/);
assert.equal(((await comparison.text()).match(/<iframe /g) ?? []).length, 2);
const results = [];
for (const [method, route, status] of [['GET', '/api/conversations', 403], ['POST', '/api/whatsapp/send', 403], ['GET', '/.env.local', 404], ['GET', '/.claude/secrets.env', 404], ['GET', '/assets/%2e%2e/%2e%2e/.env.local', 404]]) {
  const response = await fetch(origin + route, { method });
  assert.equal(response.status, status, method + ' ' + route);
  results.push({ method, route, status: response.status });
}
const hostStatus = await new Promise((resolve, reject) => {
  const req = request(origin, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); });
  req.on('error', reject); req.end();
});
assert.equal(hostStatus, 403);
const manifest = JSON.parse(await readFile(path.join(root, 'tmp/riverz-comparison/manifest.json'), 'utf8'));
assert.equal(manifest.rootCredentialsLoaded, false);
assert.equal(manifest.externalActions, false);
const bundle = await readFile(path.join(root, 'tmp/riverz-comparison/assets/app.js'), 'utf8');
assert.doesNotMatch(bundle, /SUPABASE_SERVICE_ROLE_KEY|RENDER_API_KEY|SUPABASE_ACCESS_TOKEN|sb_secret_|eyJhbGciOiJIUzI1NiIs/);
console.log(JSON.stringify({ localServer: 'isolated', apiAndWriteRoutes: 'blocked', privateFiles: 'not_served', externalConnections: 'blocked_by_csp', hostStatus, bundleSha256: manifest.bundleSha256, results }, null, 2));
