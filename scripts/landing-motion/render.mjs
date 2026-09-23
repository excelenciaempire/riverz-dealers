import { spawn } from 'node:child_process';
import { writeFile, copyFile, stat, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || 'C:/tmp/riverz-ui-films');
const prefix = process.argv[3] || 'workflow-ui';
const posterTime = process.argv[4] || '7';
const ff = process.env.FFMPEG_PATH || 'ffmpeg';
const cache = resolve(process.env.LOCALAPPDATA, 'npm-cache/_npx');
let cli;
for (const folder of await readdir(cache)) {
  const base = resolve(cache, folder, 'node_modules/hyperframes');
  const pkg = await readFile(resolve(base, 'package.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (pkg?.version === '0.8.66') {
    cli = resolve(base, 'dist/cli.js');
    break;
  }
}
if (!cli) throw Error('Install hyperframes@0.8.66 before rendering');
async function run(command, args, log) {
  return new Promise((ok, fail) => {
    const proc = spawn(command, args, { env: process.env, windowsHide: true });
    let text = '';
    proc.stdout.on('data', (d) => (text += d));
    proc.stderr.on('data', (d) => (text += d));
    proc.on('error', fail);
    proc.on('exit', async (code) => {
      await writeFile(resolve(root, log), text);
      code === 0
        ? ok(text)
        : fail(Error(log + ' failed: ' + text.slice(-3000)));
    });
  });
}
for (const lang of ['es', 'en'])
  for (const scene of [
    'conversation',
    'context',
    'permissions',
    'order',
    'results',
  ]) {
    const name = scene + '-' + lang,
      dir = resolve(root, name),
      file = resolve(root, name + '.mp4');
    const command = (args, log) => run(process.execPath, [cli, ...args], log);
    await command(
      ['check', dir, '--at', '1,3,5,7,' + posterTime, '--snapshots', '--json'],
      name + '-check.log'
    );
    console.log('CHECK OK', name);
    const existing = await stat(file).catch(() => null);
    if (!existing?.size)
      await command(
        [
          'render',
          dir,
          '--workers',
          '1',
          '--quality',
          'high',
          '--output',
          file,
        ],
        name + '-render.log'
      );
    const target = resolve('public/portada-b/' + prefix + '-' + name);
    await copyFile(file, target + '.mp4');
    await run(
      ff,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        posterTime,
        '-i',
        file,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-y',
        target + '.jpg',
      ],
      name + '-poster.log'
    );
    console.log('RENDER OK', name, (await stat(file)).size);
  }
