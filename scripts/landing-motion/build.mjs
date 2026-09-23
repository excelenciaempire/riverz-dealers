// Reproducible UI films. Generated HTML is build output; copy lives in i18n.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { landingV4 as messages } from '../../src/lib/i18n/messages/landingV4.ts';
const out = resolve(process.argv[2] || 'C:/tmp/riverz-ui-films');
await mkdir(out, { recursive: true });
for (const [name, url] of Object.entries({
  sans: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap',
  mono: 'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400&display=swap',
})) {
  const css = await (await fetch(url)).text();
  const font = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!font) throw Error('Font unavailable');
  await writeFile(
    resolve(out, name + '.ttf'),
    Buffer.from(await (await fetch(font)).arrayBuffer())
  );
}
await writeFile(
  resolve(out, 'gsap.js'),
  await (
    await fetch('https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js')
  ).text()
);
const css = `@font-face{font-family:Instrument;src:url('../sans.ttf')}@font-face{font-family:Mono;src:url('../mono.ttf')}*{box-sizing:border-box}body{margin:0;background:#f3f0eb;color:#12201f;font-family:Instrument,sans-serif}#film{width:800px;height:720px;position:relative;padding:28px;background:#f3f0eb}.window{height:664px;border:1px solid #d9d2c5;border-radius:28px;background:#faf7f1;overflow:hidden;box-shadow:0 14px 24px -20px #12201f55}.bar{height:76px;border-bottom:1px solid #ddd6c9;display:flex;align-items:center;gap:18px;padding:0 30px}.brand{font-size:30px;font-weight:600;letter-spacing:-1.5px}.label{font-family:Mono,monospace;font-size:15px;letter-spacing:1px;text-transform:uppercase;color:#3b4745}.live{margin-left:auto;background:#f7ff9e;border-radius:30px;padding:10px 15px;font-size:16px}.body{padding:28px 30px;position:relative;height:588px}.row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:23px;border:1px solid #ddd6c9;border-radius:18px;background:#fffdfa;font-size:25px}.small{font-size:20px;color:#3b4745;line-height:1.45}.bubble{font-size:29px;line-height:1.3;padding:22px 26px;border-radius:24px;max-width:91%;background:#f4eddf;margin-bottom:18px}.reply{background:#f7ff9e;margin-left:auto;border-bottom-right-radius:7px}.incoming{border-bottom-left-radius:7px}.tag{font-family:Mono,monospace;font-size:16px;letter-spacing:.4px}.status{position:absolute;bottom:28px;left:30px;right:30px;display:flex;align-items:center;gap:16px;border-radius:19px;border:1px solid #d9dec0;background:#f6f8e8;padding:23px;font-size:25px}.tick{display:inline-grid;place-items:center;background:#f7ff9e;color:#12201f;width:38px;height:38px;border-radius:50%;flex-shrink:0;font-size:24px}.stack{display:grid;gap:18px}.pill{border-radius:20px;padding:8px 14px;background:#f4eddf;font-size:20px;white-space:nowrap}.yellow{background:#f7ff9e}.dark{background:#12201f;color:#faf7f1}.heading{font-size:32px;font-weight:500;margin:0 0 24px}.split{display:grid;grid-template-columns:1fr 1fr;gap:16px}.metric{padding:24px;border:1px solid #ddd6c9;border-radius:20px;background:#fffdfa}.metric strong{font-size:52px;display:block;margin:12px 0}.dots{display:flex;gap:9px;margin:16px 0 26px auto;width:98px;padding:18px;background:#f7ff9e;border-radius:25px}.dot{width:9px;height:9px;background:#12201f;border-radius:50%}.connector{height:38px;width:2px;background:#cdbca0;margin:0 auto}.node{padding:22px;border:1px solid #ddd6c9;border-radius:20px;background:#fffdfa;font-size:27px;display:flex;justify-content:space-between}.selected{background:#f7ff9e}.approval{display:flex;align-items:center;justify-content:space-between;padding:24px;border-radius:20px;border:1px solid #cdbca0;background:#f4eddf}.button{background:#12201f;color:#faf7f1;padding:16px 24px;border-radius:35px;font-size:25px}.cursor{position:absolute;right:62px;bottom:112px;font-size:40px;color:#12201f}.note{font-size:17px;color:#3b4745;margin:18px 0}.line{height:5px;background:#f7ff9e;position:absolute;bottom:0;left:0;width:100%;transform-origin:left}`;
const scenes = ['conversation', 'context', 'permissions', 'order', 'results'];
for (const lang of ['es', 'en'])
  for (const scene of scenes) {
    const t = (k) => messages[k][lang];
    let content = '',
      motion = '';
    const row = (a, b, id) =>
      `<div class="row" id="${id}"><span>${a}</span><span class="pill">${b}</span></div>`;
    const status = (s) =>
      `<div class="status" id="done"><span class="tick">✓</span><span>${s}</span></div>`;
    const show = (id, time, x = 0) =>
      `tl.fromTo('#${id}',{opacity:0,x:${x},y:${x ? 0 : 18}},{opacity:1,x:0,y:0,duration:.55,ease:'power3.out'},${time});`;
    if (scene === 'conversation') {
      content = `<div class="label" style="margin-bottom:24px">WhatsApp · Alex</div><div class="bubble incoming" id="question">${t('uiFilmQuestion')}</div><div class="dots" id="typing"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div><div class="bubble reply" id="answer">${t('uiFilmAnswer')}</div><div class="bubble reply" id="checkout">${t('uiFilmCheckout')}</div>${status(t('motionCheckout'))}`;
      motion =
        show('question', 0.4, -24) +
        show('typing', 1.1) +
        `tl.to('#typing',{opacity:0,duration:.2},2.2);tl.fromTo('.dot',{y:0},{y:-5,stagger:.1,yoyo:true,repeat:3,duration:.2},1.3);` +
        show('answer', 2.5, 24) +
        show('checkout', 4.1, 24) +
        show('done', 5.7);
    } else if (scene === 'context') {
      content = `<p class="heading">${t('uiFilmCheck')}</p><div class="stack">${row(t('motionCatalog'), t('uiFilmProduct'), 'catalog')}${row(t('motionStock'), t('motionAvailable'), 'stock')}${row(t('motionDelivery'), t('uiFilmDestination'), 'shipping')}</div>${status(t('motionReady'))}`;
      motion =
        show('catalog', 0.4, -25) +
        show('stock', 1.8, -25) +
        show('shipping', 3.2, -25) +
        show('done', 5.4) +
        `tl.to('#catalog',{backgroundColor:'#f7ff9e',duration:.5},1.1);tl.to('#stock',{backgroundColor:'#f7ff9e',duration:.5},2.5);tl.to('#shipping',{backgroundColor:'#f7ff9e',duration:.5},3.9);`;
    } else if (scene === 'permissions') {
      content = `<div class="stack">${row(t('motionTracking'), t('motionAuto'), 'auto')}${row(t('motionAddress'), t('motionApproval'), 'approval')}${row(t('motionRefund'), t('motionHuman'), 'human')}</div><div class="approval" id="request" style="margin-top:24px"><span class="small">${t('uiFilmAddressRequest')}</span><span class="button" id="approve">${t('opApprove')}</span></div>${status(t('uiFilmApproved'))}`;
      motion =
        show('auto', 0.3) +
        show('approval', 0.9) +
        show('human', 1.5) +
        show('request', 2.6) +
        `tl.to('#approve',{scale:.94,duration:.15,yoyo:true,repeat:1},4.6);tl.to('#request',{opacity:0,duration:.3},5.1);` +
        show('done', 5.6);
    } else if (scene === 'order') {
      content = `<p class="heading">${t('motionOrder')}</p><div class="node" id="cart"><span>${t('motionLink')}</span><span class="tick">↗</span></div><div class="connector" id="line1"></div><div class="node" id="payment"><span>${t('motionPayment')}</span><span class="tick">✓</span></div><div class="connector" id="line2"></div><div class="node" id="order"><span>${t('motionOrderReady')}</span><span class="tick">✓</span></div>${status(t('motionDone'))}`;
      motion =
        show('cart', 0.4, -25) +
        show('line1', 1.5) +
        show('payment', 2.3, 25) +
        show('line2', 3.4) +
        show('order', 4.2, -25) +
        show('done', 5.9) +
        `tl.to('#order',{backgroundColor:'#f7ff9e',duration:.45},5.1);`;
    } else {
      content = `<p class="heading">${t('uiFilmToday')}</p><div class="split"><div class="metric" id="resolved"><span class="small">${t('uiFilmHandled')}</span><strong>24</strong><span class="tag">${t('motionResolved')}</span></div><div class="metric" id="review"><span class="small">${t('uiFilmReview')}</span><strong>3</strong><span class="tag">${t('motionHuman')}</span></div></div><p class="note">${t('uiFilmExample')}</p><div class="row" id="case"><span>${t('motionRefund')}</span><span class="pill yellow">${t('uiFilmReview')}</span></div>${status(t('motionTrace'))}`;
      motion =
        show('resolved', 0.4, -25) +
        show('review', 1.6, 25) +
        show('case', 3.2) +
        show('done', 5.4) +
        `tl.to('#review',{backgroundColor:'#f7ff9e',duration:.5},2.5);`;
    }
    const title = {
      conversation: 'motionInbox',
      context: 'motionContext',
      permissions: 'motionPermissions',
      order: 'motionOrders',
      results: 'motionResults',
    }[scene];
    const dir = resolve(out, `${scene}-${lang}`);
    await mkdir(dir, { recursive: true });
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="film" data-composition-id="film" data-width="800" data-height="720" data-duration="8"><div class="window"><div class="bar"><span class="brand">riverz</span><span class="label">${t(title)}</span><span class="live">${t('uiFilmDemo')}</span></div><div class="body">${content}</div></div></div><script src="../gsap.js"></script><script>const tl=gsap.timeline({paused:true});${motion}window.__timelines['film']=tl;</script></body></html>`;
    for (const asset of ['sans.ttf', 'mono.ttf', 'gsap.js'])
      await copyFile(resolve(out, asset), resolve(dir, asset));
    await writeFile(resolve(dir, 'index.html'), html.replaceAll('../', ''));
    await writeFile(
      resolve(dir, 'hyperframes.json'),
      JSON.stringify({ width: 800, height: 720, fps: 30 }, null, 2)
    );
  }
console.log(out);
