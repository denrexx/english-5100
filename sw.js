'use strict';
const CORE='lexi-core-v2';
const AUDIO='lexi-audio-v1';
const files=['./','index.html','style.css','tokens.css','app.js','data.json','icon.svg','manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CORE).then(cache=>cache.addAll(files)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lexi-')&&k!==CORE&&k!==AUDIO).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin)return;
  if(url.pathname.includes('/audio/')) {
    event.respondWith(caches.open(AUDIO).then(async cache=>{
      const cached=await cache.match(event.request);if(cached)return cached;
      const response=await fetch(event.request);if(response.ok){await cache.put(event.request,response.clone());const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-80)))await cache.delete(key);}return response;
    }));
  } else {
    event.respondWith(fetch(event.request).then(async response=>{
      if(response.ok && files.some(file=>new URL(file,self.registration.scope).href===url.href)){const cache=await caches.open(CORE);await cache.put(event.request,response.clone());}
      return response;
    }).catch(async()=>{const cache=await caches.open(CORE);return await cache.match(event.request)||new Response('Offline',{status:503});}));
  }
});
