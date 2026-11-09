/* Netlify adapter: gives the page the same db / user / assets interface it was built for. */
(function(){
"use strict";
var STATIC=window.STATIC_BLOBS||{},SEED=window.SEED_DOCS||{},SEEDG=window.SEED_GALLERY||[];
var TK="dk_admin_token";
function tok(){try{return localStorage.getItem(TK)||""}catch(e){return""}}
function api(path,opt){opt=opt||{};var h={"content-type":"application/json"};var t=tok();if(t)h.authorization="Bearer "+t;
 return fetch("/api/"+path,{method:opt.method||"GET",headers:h,body:opt.body?JSON.stringify(opt.body):undefined}).then(function(r){
  if(!r.ok){var e=new Error("http "+r.status);e.status=r.status;throw e}return r.json()})}

/* ---- images: "/_blob/<id>" -> static file or /api/blob/<id> ---- */
function blobSrc(id){return STATIC[id]?STATIC[id]:"/api/blob/"+id}
window.__blobUrl=function(id){return Promise.resolve(blobSrc(id))};
function patch(proto){
 var d=Object.getOwnPropertyDescriptor(proto,"src");if(!d||!d.set)return;
 Object.defineProperty(proto,"src",{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){
  if(typeof v==="string"&&v.indexOf("/_blob/")===0)v=blobSrc(v.slice(7));d.set.call(this,v)}});
}
patch(HTMLImageElement.prototype);patch(HTMLMediaElement.prototype);

/* ---- shrink photos before upload ---- */
function shrink(blob){
 if(!/^image\//.test(blob.type))return Promise.reject(new Error("photos only"));
 var LIM=1.5*1024*1024;
 return new Promise(function(res,rej){
  var img=new Image(),u=URL.createObjectURL(blob);
  img.onload=function(){var w=img.naturalWidth,h=img.naturalHeight,q=.85,sc=1,n=0;
   (function go(){var c=document.createElement("canvas");c.width=Math.max(1,Math.round(w*sc));c.height=Math.max(1,Math.round(h*sc));
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);
    c.toBlob(function(b){if(!b)return rej(new Error("encode"));
     if(b.size<=LIM||n>8){URL.revokeObjectURL(u);b.size<=LIM*2?res(b):rej(new Error("big"))}else{n++;q=Math.max(.55,q-.07);sc*=.85;go()}},"image/jpeg",q)})()};
  img.onerror=function(){rej(new Error("decode"))};img.src=u})}
function toDataUrl(b){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result)};r.onerror=rej;r.readAsDataURL(b)})}

var assets={
 upload:function(blob){return shrink(blob).then(toDataUrl).then(function(d){return api("blob",{method:"POST",body:{d:d}})}).then(function(r){return{id:r.id,url:"/_blob/"+r.id}})},
 "delete":function(id){if(STATIC[id])return Promise.resolve();return api("blob/"+id,{method:"DELETE"})}
};

/* ---- database (reads everything from /api/data, refreshes after writes and every 25s) ---- */
var state=null,subs=[],loading=null;
function load(){if(loading)return loading;loading=api("data").then(function(d){state=d;loading=null;fire()},function(){loading=null});return loading}
function fire(){subs.slice().forEach(function(f){f()})}
function docData(p){var parts=p.split("/");var d=state&&(parts[0]==="site"?state.site[parts[1]]:null);return d||SEED[p]||null}
function snapDoc(p){var d=docData(p);return{exists:!!d,data:function(){return JSON.parse(JSON.stringify(d))}}}
function sub(f){subs.push(f);if(state)setTimeout(f,0);else load();return function(){subs=subs.filter(function(x){return x!==f})}}
setInterval(function(){if(!document.hidden)load()},25000);
function after(p){return p.then(function(x){return load().then(function(){return x})})}
var db={
 doc:function(p){return{
  onSnapshot:function(ok,err){return sub(function(){ok(snapDoc(p))})},
  set:function(d){return after(api("doc",{method:"POST",body:{op:"set",path:p,data:d}}))},
  update:function(d){return after(api("doc",{method:"POST",body:{op:"update",path:p,data:d}}))},
  "delete":function(){return after(api("doc",{method:"POST",body:{op:"delete",path:p}}))}}},
 collection:function(c){return{
  add:function(d){return c==="reviews"?after(api("review",{method:"POST",body:d})):after(api("doc",{method:"POST",body:{op:"add",collection:c,data:d}}))},
  onSnapshot:function(ok,err){return sub(function(){var o=(state&&state[c])||{};
    ok({docs:Object.keys(o).map(function(k){return{id:k,data:function(){return JSON.parse(JSON.stringify(o[k]))}}})})})}}}
};

/* ---- first admin sign-in: copy starter content in ---- */
function seedOnce(){
 return load().then(function(){
  if(!state||state.site.config)return;
  var jobs=Object.keys(SEED).map(function(p){return api("doc",{method:"POST",body:{op:"set",path:p,data:SEED[p]}})});
  SEEDG.forEach(function(g){jobs.push(api("doc",{method:"POST",body:{op:"set",path:"gallery/"+g[0],data:g[1]}}))});
  return Promise.all(jobs).then(load)}).catch(function(){})}
var adminP=null;
function isAdmin(){if(adminP)return adminP;
 if(!tok())return adminP=Promise.resolve(false);
 return adminP=api("me").then(function(r){if(!r.admin){try{localStorage.removeItem(TK)}catch(e){}}return!!r.admin},function(){return false})}
var user={canEdit:function(){return isAdmin().then(function(v){if(v)seedOnce();return v})}};
window.claude={use:function(n){return Promise.resolve(n==="db"?db:n==="user"?user:n==="assets"?assets:null)}};

/* ---- admin sign-in link in the footer ---- */
function ui(){
 var f=document.querySelector("footer");if(!f)return;
 var a=document.createElement("a");a.href="#";a.id="admLink";a.textContent="Admin";a.style.cssText="color:inherit;opacity:.55;font-size:12px;text-decoration:none";f.appendChild(a);
 function modal(){
  var m=document.createElement("div");m.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
  m.innerHTML='<form style="background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:16px;padding:22px;width:min(360px,100%);display:grid;gap:10px;font:15px Inter,sans-serif"><b style="font-size:18px">Admin sign in</b><input id="am_p" type="password" autocomplete="current-password" placeholder="Admin password" required style="padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit"><div id="am_m" style="color:#b3261e;min-height:18px;font-size:13px"></div><div style="display:flex;gap:8px"><button type="submit" style="flex:1;padding:12px;border:0;border-radius:999px;background:var(--acc);color:#fff;font:600 15px Inter,sans-serif;cursor:pointer">Sign in</button><button type="button" id="am_x" style="padding:12px 16px;border:1px solid var(--line);border-radius:999px;background:none;color:var(--fg);font:15px Inter,sans-serif;cursor:pointer">Cancel</button></div></form>';
  document.body.appendChild(m);
  m.querySelector("#am_x").onclick=function(){m.remove()};
  m.querySelector("form").onsubmit=function(e){e.preventDefault();var t=m.querySelector("#am_m");t.textContent="Signing in…";
   api("login",{method:"POST",body:{password:m.querySelector("#am_p").value}}).then(function(r){try{localStorage.setItem(TK,r.token)}catch(x){}location.reload()},function(er){t.textContent=er.status===401?"Wrong password.":"Could not reach the server. Try again."})};
  m.querySelector("#am_p").focus()}
 isAdmin().then(function(ad){a.textContent=ad?"Sign out":"Admin";
  a.onclick=function(e){e.preventDefault();if(ad){try{localStorage.removeItem(TK)}catch(x){}location.reload()}else modal()}})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ui);else ui();
})();
