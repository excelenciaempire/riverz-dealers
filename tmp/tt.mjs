import fs from 'fs'; import crypto from 'crypto';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')];}));
function decrypt(t){const p=t.split(':');const iv=Buffer.from(p[0],'hex');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(env.ENCRYPTION_KEY,'hex'),iv);d.setAuthTag(Buffer.from(p[2],'hex'));return d.update(p[1],'hex','utf8')+d.final('utf8');}
const sb = async (q) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${q}`, {headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
  return r.json();
};
const [conn] = await sb('channel_connections?channel=eq.tiktok_comment&select=*');
const token = decrypt(conn.secrets.access_token);
const bid = conn.config.business_id;
const TT='https://business-api.tiktok.com/open_api/v1.3';
const vurl=`${TT}/business/video/list/?business_id=${encodeURIComponent(bid)}&fields=${encodeURIComponent(JSON.stringify(["item_id","caption","create_time"]))}&max_count=10`;
const vr = await fetch(vurl,{headers:{'Access-Token':token}});
const vj = await vr.json();
console.log('VIDEOS code', vj.code, vj.message, (vj.data?.videos||[]).length);
for (const v of (vj.data?.videos||[])) {
  const cu=`${TT}/business/comment/list/?business_id=${encodeURIComponent(bid)}&video_id=${encodeURIComponent(v.item_id)}&max_count=30`;
  const cr=await fetch(cu,{headers:{'Access-Token':token}});
  const cj=await cr.json();
  const cs=cj.data?.comments||[];
  console.log(`video ${v.item_id} (${new Date((v.create_time||0)*1000).toISOString()}) "${String(v.caption||'').slice(0,30)}" -> code=${cj.code} msg=${cj.message} comments=${cs.length}`);
  for (const c of cs.slice(0,5)) console.log('   ', c.comment_id, new Date((c.create_time||0)*1000).toISOString(), JSON.stringify(c.text||'').slice(0,50), 'owner='+c.owner, 'user='+c.username);
}
