import fs from 'fs'; import crypto from 'crypto';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')];}));
function decrypt(t){const p=t.split(':');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(env.ENCRYPTION_KEY,'hex'),Buffer.from(p[0],'hex'));d.setAuthTag(Buffer.from(p[2],'hex'));return d.update(p[1],'hex','utf8')+d.final('utf8');}
const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/channel_connections?channel=eq.tiktok_comment&select=*`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
const [conn]=await r.json(); const token=decrypt(conn.secrets.access_token); const bid=conn.config.business_id;
const TT='https://business-api.tiktok.com/open_api/v1.3';
// 1. full video list with pagination
let cursor=0, page=0, all=[];
while(page<5){
  const u=`${TT}/business/video/list/?business_id=${encodeURIComponent(bid)}&fields=${encodeURIComponent(JSON.stringify(["item_id","caption","create_time"]))}&max_count=20&cursor=${cursor}`;
  const j=await (await fetch(u,{headers:{'Access-Token':token}})).json();
  const vids=j.data?.videos||[]; all.push(...vids);
  console.log(`page ${page}: ${vids.length} videos, has_more=${j.data?.has_more} cursor=${j.data?.cursor}`);
  if(!j.data?.has_more) break; cursor=j.data.cursor; page++;
}
console.log('TOTAL VIDEOS', all.length);
for(const v of all) console.log(' ', v.item_id, new Date((v.create_time||0)*1000).toISOString().slice(0,10), 'comment_count='+v.comment_count, JSON.stringify(String(v.caption||'').slice(0,25)));
// 2. one video: full comment pagination + total
const target = all.sort((a,b)=>(b.comment_count||0)-(a.comment_count||0))[0];
if(target){
  console.log('\n--- comentarios de', target.item_id, 'comment_count segun TikTok =', target.comment_count);
  let cc=0,cur=0,p=0,tot=0;
  while(p<10){
    const u=`${TT}/business/comment/list/?business_id=${encodeURIComponent(bid)}&video_id=${target.item_id}&max_count=30&cursor=${cur}&include_replies=true`;
    const j=await (await fetch(u,{headers:{'Access-Token':token}})).json();
    if(j.code!==0){console.log('err',j.code,j.message);break;}
    const cs=j.data?.comments||[]; cc+=cs.length; tot=j.data?.total_count??tot;
    console.log(`  page ${p}: ${cs.length} comentarios has_more=${j.data?.has_more} cursor=${j.data?.cursor} total_count=${j.data?.total_count}`);
    if(!j.data?.has_more) break; cur=j.data.cursor; p++;
  }
  console.log('  comentarios traidos:', cc, ' / total segun API:', tot);
}
