// Backend logic (storage-agnostic). `store` needs: get(key,{type}), set(key,val,{metadata}), delete(key), list({prefix}), getMetadata(key)
import crypto from "node:crypto";
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const sign=(pw,exp)=>crypto.createHmac("sha256","tok|"+pw).update(String(exp)).digest("hex");
const okTok=(pw,t)=>{if(!pw||!t)return false;const [e,h]=String(t).split(".");if(!e||!h||+e<Date.now())return false;
  const a=Buffer.from(sign(pw,e)),b=Buffer.from(h);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const COLS={gallery:1,reviews:1};
const DOCS={"site/profile":1,"site/config":1};
async function readAll(store,prefix){
 const l=await store.list({prefix});const out={};
 await Promise.all((l.blobs||[]).map(async b=>{const v=await store.get(b.key,{type:"json"});if(v)out[b.key.slice(prefix.length)]=v}));return out}
function reviewOk(r){
 if(!r||typeof r!=="object")return false;const k=Object.keys(r);
 if(k.some(x=>!["name","country","rating","text","ts"].includes(x)))return false;
 const s=(v,a,b)=>typeof v==="string"&&v.length>=a&&v.length<=b;
 return s(r.name,1,80)&&s(r.country,0,80)&&s(r.text,1,2000)&&typeof r.rating==="number"&&r.rating>=0&&r.rating<=5&&typeof r.ts==="number"}
export async function handle(req,store,env){
 const url=new URL(req.url),p=url.pathname.replace(/^\/api\/?/,""),m=req.method;
 const pw=env.ADMIN_PASSWORD||"";
 const authed=()=>okTok(pw,(req.headers.get("authorization")||"").replace(/^Bearer /,""));
 try{
  if(m==="GET"&&p==="data"){
   const [docs,gallery,reviews]=await Promise.all([readAll(store,"doc/site/"),readAll(store,"doc/gallery/"),readAll(store,"doc/reviews/")]);
   return J({site:docs,gallery,reviews})}
  if(m==="GET"&&p.startsWith("blob/")){
   const id=p.slice(5);if(!ID.test(id))return J({error:"bad id"},400);
   const buf=await store.get("blob/"+id,{type:"arrayBuffer"});if(!buf)return J({error:"nf"},404);
   const md=await store.getMetadata("blob/"+id);
   return new Response(buf,{headers:{"content-type":(md&&md.metadata&&md.metadata.type)||"image/jpeg","cache-control":"public, max-age=31536000, immutable"}})}
  if(m==="POST"&&p==="review"){
   const r=await req.json();if(!reviewOk(r))return J({error:"invalid"},400);
   const id=Date.now().toString(36)+crypto.randomBytes(4).toString("hex");
   await store.set("doc/reviews/"+id,JSON.stringify(r));return J({id})}
  if(m==="POST"&&p==="login"){
   const b=await req.json();
   const good=pw&&typeof b.password==="string"&&b.password.length===pw.length&&crypto.timingSafeEqual(Buffer.from(b.password),Buffer.from(pw));
   if(!good){await new Promise(r=>setTimeout(r,700));return J({error:"wrong"},401)}
   const exp=Date.now()+1000*60*60*24*14;return J({token:exp+"."+sign(pw,exp)})}
  if(m==="GET"&&p==="me")return J({admin:authed()});
  // ---- admin only below ----
  if(!authed())return J({error:"unauthorized"},401);
  if(m==="POST"&&p==="blob"){
   const b=await req.json();const mt=/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(b.d||"");
   if(!mt)return J({error:"photos only"},400);const buf=Buffer.from(mt[2],"base64");
   if(buf.length>4*1024*1024)return J({error:"too big"},413);
   const id=crypto.randomBytes(12).toString("hex");
   await store.set("blob/"+id,buf,{metadata:{type:mt[1]}});return J({id})}
  if(m==="DELETE"&&p.startsWith("blob/")){const id=p.slice(5);if(!ID.test(id))return J({error:"bad id"},400);await store.delete("blob/"+id);return J({ok:1})}
  if(m==="POST"&&p==="doc"){
   const b=await req.json();const raw=JSON.stringify(b.data||{});if(raw.length>400000)return J({error:"too big"},413);
   if(b.op==="add"){if(!COLS[b.collection])return J({error:"bad"},400);
     const id=Date.now().toString(36)+crypto.randomBytes(4).toString("hex");await store.set("doc/"+b.collection+"/"+id,raw);return J({id})}
   const path=String(b.path||"");const [c,id]=path.split("/");
   const okPath=DOCS[path]||(COLS[c]&&c!=="reviews"&&ID.test(id||""));if(!okPath)return J({error:"bad path"},400);
   const key="doc/"+path;
   if(b.op==="set"){await store.set(key,raw);return J({ok:1})}
   if(b.op==="update"){const cur=(await store.get(key,{type:"json"}))||{};await store.set(key,JSON.stringify(Object.assign(cur,b.data)));return J({ok:1})}
   if(b.op==="delete"){await store.delete(key);return J({ok:1})}
  }
  return J({error:"not found"},404);
 }catch(e){return J({error:"server"},500)}
}
