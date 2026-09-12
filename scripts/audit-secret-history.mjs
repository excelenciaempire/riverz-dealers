/** Read-only, streaming history scan. Reports locations, never matched values.
 * Pattern coverage is deliberately explicit; this is not a proof of no secrets.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
const patterns = [
  ['supabase_management_token', /\bsbp_[a-f0-9]{40}\b/g],
  ['anthropic_key', /\bsk-ant-api03-[A-Za-z0-9_-]{40,}\b/g],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];
const child = spawn('git', ['log', '--all', '--format=SECURITY_COMMIT:%H', '-p', '--no-ext-diff', '--no-textconv'], { stdio: ['ignore', 'pipe', 'pipe'] });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
let commit = '', file = '', lineNumber = 0, commits = 0, addedLines = 0;
const findings = [];
const seen = new Set();
function report(rule) {
  const id = `${commit}:${file}:${lineNumber}:${rule}`;
  if (!seen.has(id)) { seen.add(id); findings.push({ commit, file, line: lineNumber, rule }); }
}
lines.on('line', line => {
  if (line.startsWith('SECURITY_COMMIT:')) { commit = line.slice(16); commits++; return; }
  if (line.startsWith('+++ b/')) { file = line.slice(6); return; }
  const hunk = line.match(/^@@ .*?\+(\d+)(?:,\d+)? @@/);
  if (hunk) { lineNumber = Number(hunk[1]); return; }
  if (line.startsWith('+') && !line.startsWith('+++')) {
    addedLines++;
    for (const [rule, pattern] of patterns) { pattern.lastIndex = 0; if (pattern.test(line)) report(rule); }
    for (const match of line.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
      try { if (JSON.parse(Buffer.from(match[1], 'base64url').toString()).role === 'service_role') report('supabase_service_role_jwt'); } catch { /* not a JWT */ }
    }
    lineNumber++;
  } else if (line.startsWith(' ')) lineNumber++;
});
child.stderr.on('data', () => {});
child.on('close', code => {
  const report = { completed: code === 0, commits, addedLines, patterns: [...patterns.map(p => p[0]), 'supabase_service_role_jwt'], findings };
  mkdirSync('output', { recursive: true });
  writeFileSync('output/secret-history-audit.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completed: report.completed, commits, addedLines, findings: findings.length, output: 'output/secret-history-audit.json' }));
  process.exitCode = code !== 0 || findings.length ? 1 : 0;
});
