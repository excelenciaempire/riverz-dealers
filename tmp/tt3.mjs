import fs from 'fs'; import crypto from 'crypto';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')];}));
function decrypt(t){const p=t.split(':');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(env.ENCRYPTION_KEY,'hex'),Buffer.from(p[0],'hex'));d.setAuthTag(Buffer.from(p[2],'hex'));return d.update(p[1],'hex','utf8')+d.final('utf8');}
const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/channel_connections?channel=eq.tiktok_comment&select=*`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
const [conn]=await r.json(); const token=decrypt(conn.secrets.access_token); const bid=conn.config.business_id;
const TT='https://business-api.tiktok.com/open_api/v1.3';
let cursor=0, all=[];
for(let p=0;p<5;p++){
  const u=`${TT}/business/video/list/?business_id=${encodeURIComponent(bid)}&fields=${encodeURIComponent(JSON.stringify(["item_id","create_time"]))}&max_count=20&cursor=${cursor}`;
  const j=await (await fetch(u,{headers:{'Access-Token':token}})).json();
  all.push(...(j.data?.videos||[])); if(!j.data?.has_more) break; cursor=j.data.cursor;
}
let total=0; const rows=[];
for(const v of all){
  const u=`${TT}/business/comment/list/?business_id=${encodeURIComponent(bid)}&video_id=${v.item_id}&max_count=30`;
  const j=await (await fetch(u,{headers:{'Access-Token':token}})).json();
  const cs=j.data?.comments||[]; total+=cs.length;
  if(cs.length) rows.push([v.item_id, new Date((v.create_time||0)*1000).toISOString().slice(0,10), cs.length, cs.map(c=>c.comment_id)]);
}
console.log('videos:', all.length, 'comentarios totales via API:', total);
for(const r of rows) console.log(r[0], r[1], r[2]);
fs.writeFileSync('tmp/tt-ids.json', JSON.stringify(rows.flatMap(r=>r[3])));
