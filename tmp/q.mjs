import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')];}));
const ref = 'ozurxrnujkgjqmilttln';
const sql = process.argv.slice(2).join(' ');
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method:'POST', headers:{ Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type':'application/json'},
  body: JSON.stringify({query: sql})
});
console.log(JSON.stringify(await r.json(), null, 2));
