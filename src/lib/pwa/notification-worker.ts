/** Push only: never intercept requests, cache authenticated pages or enable offline writes. */
export const notificationWorker=String.raw`
'use strict';
self.addEventListener('push', event => {
 let data;try{data=event.data.json();}catch{return;}
 if(!data||data.version!==1||!['mention','reminder','snooze'].includes(data.kind)||!['es','en'].includes(data.locale)
  ||typeof data.conversation_id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.conversation_id)
  ||Object.keys(data).some(key=>!['version','kind','conversation_id','locale'].includes(key)))return;
 const text=data.locale==='en'?'You have a team notice. Sign in to Riverz to review it.':'Tienes un aviso del equipo. Entra a Riverz para revisarlo.';
 event.waitUntil(self.registration.showNotification('Riverz',{body:text,icon:'/pwa/riverz-192.png',badge:'/pwa/riverz-192.png',
  tag:'riverz-'+data.conversation_id,renotify:false,data:{conversation_id:data.conversation_id,locale:data.locale}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const data=event.notification.data;
 if(!data||typeof data.conversation_id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.conversation_id))return;
 const path=(data.locale==='en'?'/inbox':'/bandeja')+'?c='+encodeURIComponent(data.conversation_id);
 event.waitUntil(self.clients.openWindow(new URL(path,self.location.origin).href));
});
`;
