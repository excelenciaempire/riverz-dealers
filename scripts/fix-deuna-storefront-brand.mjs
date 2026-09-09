// Run after pulling these two files from live theme 191748309356 into the given directory.
// Push only the returned paths; never upload the rest of a partial theme pull.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? 'tmp/deuna-theme-fix');
const backup = join(root, `brand-backup-${Date.now()}`);
const paths = [1, 2].map(i => `snippets/riverz-landing-pniv0908a1-p${i}.liquid`);
const changes = paths.map(path => {
  const before = readFileSync(join(root, path), 'utf8');
  const after = before
    .replace(/(Animalitos Saltarines con luces LED\s*– )NIVEL SHOP(?=<\/title>)/g, '$1DeUNA Shop')
    .replaceAll('Bienvenido a NIVELSHOP', 'Bienvenido a DeUNA Shop')
    // Imported review widgets must not attribute another store's replies to DeUNA.
    .replaceAll("content:'NIVEL SHOP'", "content:''");
  if (/NIVEL\s?SHOP/i.test(after)) throw new Error(`Unrecognized brand reference in ${path}; review before editing.`);
  return { path, before, after };
});
mkdirSync(backup, { recursive: true });
for (const change of changes) {
  if (change.before === change.after) continue;
  writeFileSync(join(backup, change.path.split('/').at(-1)), change.before, 'utf8');
  writeFileSync(join(root, change.path), change.after, 'utf8');
  console.log(JSON.stringify({ path: change.path, beforeSha256: createHash('sha256').update(change.before).digest('hex'), backup }));
}
