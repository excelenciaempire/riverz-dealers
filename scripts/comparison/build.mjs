import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const out = path.join(root, 'tmp/riverz-comparison');
const qa = path.join(path.dirname(root), '.b2-validation-0930');
const fixtures = path.join(root, 'scripts/comparison/fixtures.jsx');
// Read validated assets before changing the last usable preview. Never read env files.
const chunks = path.join(qa, '.next/static/chunks');
const styles = (await readdir(chunks)).filter(file => file.endsWith('.css'));
if (!styles.length) throw new Error('Validated Next CSS unavailable; finish validation first');
const media = path.join(qa, '.next/static/media');
const fonts = await readdir(media);
const css = await Promise.all(styles.map(async file => ({ file, text: await readFile(path.join(chunks, file), 'utf8') })));
const fontClasses = [...new Set(css.flatMap(({ text }) => [...text.matchAll(/\.([A-Za-z0-9_-]+)\{--font-[A-Za-z0-9-]+:/g)].map(match => match[1])))];
if (!fontClasses.some(value => value.startsWith('inter_tight_'))) throw new Error('Validated Riverz font variables unavailable');
const mocks = new Set(['next/link', 'next/image', 'next/navigation', '@/components/i18n/locale-link', '@/hooks/use-auth',
  '@/hooks/use-workspace', '@/hooks/use-total-unread', '@/hooks/use-timezone', '@/hooks/use-saldo', '@/hooks/use-feature-flags',
  '@/lib/api/fetch-with-csrf', '@/lib/ui/improvements-preview', '@/lib/supabase/client', '@/hooks/use-broadcast-sending']);
await mkdir(path.join(out, 'assets'), { recursive: true });
const result = await build({ entryPoints: [path.join(root, 'scripts/comparison/app.jsx')], outfile: path.join(out, 'assets/app.js'), write: false,
  bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', sourcemap: false,
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'comparison-isolation', setup(builder) {
    builder.onResolve({ filter: /^next\/(link|image|navigation)$|^@\// }, async args => {
      if (mocks.has(args.path)) return { path: fixtures };
      // Use one canonical module identity for alias AND relative imports.
      // Duplicate namespaces would create two LocaleContexts and wrong number formats.
      if (args.path.startsWith('@/')) return builder.resolve(path.join(root, 'src', args.path.slice(2)), { kind: args.kind, resolveDir: root });
    });
  } }], logLevel: 'warning' });
const bundle = result.outputFiles[0].text;
if (/SUPABASE_SERVICE_ROLE_KEY|RENDER_API_KEY|SUPABASE_ACCESS_TOKEN|sb_secret_|eyJhbGciOiJIUzI1NiIs/.test(bundle)) throw new Error('Private configuration must not enter the comparison bundle');
await mkdir(path.join(out, 'static/media'), { recursive: true });
await mkdir(path.join(out, 'static/chunks'), { recursive: true });
for (const file of fonts) await copyFile(path.join(media, file), path.join(out, 'static/media', file));
for (const file of styles) await copyFile(path.join(chunks, file), path.join(out, 'static/chunks', file));
await writeFile(path.join(out, 'assets/app.js'), bundle, 'utf8');
await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="es" class="${fontClasses.join(' ')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Riverz · Comparación privada</title>${styles.map(file => `<link rel="stylesheet" href="/_next/static/chunks/${file}">`).join('')}<style>body{margin:0}#root{min-height:100vh}iframe{border:0}button,summary,a,select{touch-action:manipulation}</style></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`, 'utf8');
await copyFile(path.join(root, 'scripts/comparison/review.js'), path.join(out, 'assets/review.js'));
await writeFile(path.join(out, 'compare.html'), `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Riverz · Actual / Mejoras</title><style>body{margin:0;background:#f5f5f5;color:#191919;font:15px system-ui}header{padding:16px}h1{margin:0 0 12px;font-size:22px}p{font-size:13px;margin:8px 0;color:#555}select,button,a{font:inherit;padding:7px;border:1px solid #ccc;border-radius:8px;background:white;color:inherit}label{display:inline-flex;gap:8px;align-items:center;margin:4px 12px 4px 0}.panes{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 12px 12px}.pane h2{font-size:16px;margin:8px}iframe{background:white;border:1px solid #ddd;border-radius:12px;width:100%;height:calc(100vh - 225px);min-height:550px;box-sizing:border-box}@media(max-width:800px){.panes{grid-template-columns:1fr}iframe{height:650px}}</style></head><body><header><h1 id="title">Riverz: actual y mejoras</h1><p id="scope"></p><label><span id="page-label"></span><select id="page"></select></label><label>Idioma / Language<select id="locale"><option value="es">Español</option><option value="en">English</option></select></label><button id="expand"></button><a id="single"></a></header><div class="panes"><section class="pane"><h2 id="current-title"></h2><iframe id="current" title="Riverz actual"></iframe></section><section class="pane"><h2 id="new-title"></h2><iframe id="new" title="Riverz mejoras"></iframe></section></div><script type="module" src="/assets/review.js"></script></body></html>`, 'utf8');
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ kind: 'real_components_with_fictional_fixtures',
  externalActions: false, rootCredentialsLoaded: false, styles, fontClasses, bundleSha256: createHash('sha256').update(bundle).digest('hex') }, null, 2));
console.log('Isolated real-component comparison built; no environment credentials loaded');
