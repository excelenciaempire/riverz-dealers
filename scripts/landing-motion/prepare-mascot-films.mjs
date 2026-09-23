import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
const root = resolve(process.argv[2]);
const ff = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
function run(args) {
  const result = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr);
}
for (const scene of ['conversation', 'context', 'permissions', 'order', 'results']) {
  const source = resolve(root, scene + '.mp4');
  const record = JSON.parse(await readFile(resolve(root, scene + '.json'), 'utf8'));
  if (record.state !== 'success') throw Error(scene + ' not completed');
  const target = resolve('public/portada-b/workflow-mascot-' + scene);
  run(['-i', source, '-an', '-vf', 'scale=960:720:force_original_aspect_ratio=decrease,pad=960:720:(ow-iw)/2:(oh-ih)/2:color=0xf3f0eb,setsar=1', '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', target + '.mp4']);
  run(['-i', target + '.mp4', '-ss', '0', '-frames:v', '1', '-q:v', '2', '-y', target + '.jpg']);
  run(['-i', target + '.mp4', '-vf', 'fps=2/3,scale=320:240,tile=3x2', '-frames:v', '1', '-q:v', '2', '-y', resolve(root, scene + '-sheet.jpg')]);
  console.log(scene, (await stat(target + '.mp4')).size);
}
