// Generate each approved mascot scene once. No retries of uncertain submissions.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2]);
const mode = process.argv[3] || 'status';
const key = process.env.RIVERZ_VIDEO_KEY;
if (!key) throw Error('RIVERZ_VIDEO_KEY required');
await mkdir(root, { recursive: true });
const scenes = {
  conversation: 'The robot looks toward the large solid cream speech-bubble PROP, tilts its head attentively, types naturally with alternating hands for three seconds, then turns back toward the viewer and gives a reassuring small wave with one hand. Both physical speech-bubble props remain EXACTLY UNCHANGED throughout the entire shot: the cream one has only three dark raised dots, the lime one is blank. They are solid ceramic props, NOT screens. Do not create any interface, screen content, notification, white rectangle, text, avatars, chat window or new object. Only animate the robot hands, head and eyes. Locked camera. Clear attentive listening, working, friendly acknowledgement.',
  context: 'The robot carefully moves its magnifying glass across the perfume bottle, lowers the glass to inspect the folded shirt, then checks its tablet and nods confidently. Product shapes remain stable on the shelf. Its gaze tracks each inspected product. Camera gently tracks sideways a few centimeters. A deliberate look up, compare, verify action; no floating message bubbles.',
  permissions: 'For the FIRST TWO SECONDS the robot and parcel remain stopped; its raised open palm clearly signals waiting. Then the HUMAN HAND presses the round approval button once, releasing it and withdrawing. Only AFTER that human approval, the robot lowers its waiting palm, nods, and gently slides the parcel forward a short distance. The robot NEVER presses the approval button itself. Locked camera. Clear stop, human approval, proceed story.',
  order: 'The robot carefully lowers the perfume bottle into the open shipping box, releases the bottle, folds the two top flaps shut with both hands, then gently pushes the closed parcel onto the short outgoing track. The checked order card stays on the table. Camera arcs very subtly around the packing station. Coherent pick, pack, dispatch action, no magic transformations or duplicate boxes.',
  results: 'The robot carefully gathers the three checked task tiles into a neat stack on the left. It then picks up the separate task tile with the human silhouette and sets it apart in the right tray, turning its open palm toward that tray to request human attention. It looks up and nods. Slight overhead camera holds steady. Completed tasks versus one human-review case, no statistics and no charts.',
};
const style = 'Animate the supplied FIRST FRAME into a polished 8-second Riverz mascot brand film. Preserve the EXACT robot identity, cream ceramic body, petrol face, lime eyes, temple tab and small existing r chest badge, props, lighting and cream/green/sand/lime palette. Natural articulated hand and head movement, expressive eyes, smooth deliberate timing. One continuous shot, no cuts. NO new text, numbers, words, extra logos, people or robots. Do not morph limbs or duplicate objects. Hold the completed action for the last second. Silent. ';
for (const [name, action] of Object.entries(scenes)) {
  const path = resolve(root, name + '.json');
  let job = await readFile(path, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
  if (mode === 'create' && !job) {
    const frame = await readFile(resolve(root, name + '.jpg'));
    const upload = await fetch('https://kieai.redpandaai.co/api/file-base64-upload', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data: 'data:image/jpeg;base64,' + frame.toString('base64'), uploadPath: 'riverz-mascot', fileName: name + '-' + Date.now() + '.jpg' }),
    }).then(r => r.json());
    if (!upload.data?.downloadUrl) throw Error('Frame upload failed: ' + upload.msg);
    const body = { model: 'bytedance/seedance-1.5-pro', input: { prompt: style + action, input_urls: [upload.data.downloadUrl], duration: 8, aspect_ratio: '4:3', resolution: '720p', generate_audio: false, fixed_lens: name === 'permissions' || name === 'results', nsfw_checker: true } };
    job = { name, body, state: 'submitting', submittedAt: new Date().toISOString() };
    await writeFile(path, JSON.stringify(job, null, 2));
    const result = await fetch('https://api.kie.ai/api/v1/jobs/createTask', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    job.receipt = result; job.taskId = result.data?.taskId; job.state = job.taskId ? 'submitted' : 'rejected';
    await writeFile(path, JSON.stringify(job, null, 2));
  }
  if (job?.taskId) {
    const response = await fetch('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=' + job.taskId, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
    if (response.code === 200 && response.data) { job.result = response.data; job.state = response.data.state; await writeFile(path, JSON.stringify(job, null, 2)); }
    if (job.state === 'success') {
      const out = resolve(root, name + '.mp4');
      if (!(await access(out).then(() => true).catch(() => false))) {
        const url = JSON.parse(job.result.resultJson).resultUrls[0];
        const download = await fetch(url);
        if (!download.ok) throw Error('Video download failed ' + download.status);
        await writeFile(out, Buffer.from(await download.arrayBuffer()));
      }
    }
  }
  console.log(JSON.stringify({ name, state: job?.state, taskId: job?.taskId, credits: job?.result?.creditsConsumed, error: job?.result?.failMsg || (job?.state === 'rejected' ? job.receipt?.msg : undefined) }));
}
