/**
 * The review player as one standalone page: the timeline inlined, the film by
 * url or embedded, comments kept in the page's own store (a shared db when the
 * page is a claude.ai artifact, else localStorage), and everything an agent or
 * a computer-use model needs to operate it: an accessibility tree with stable
 * ids and labels, a keyboard for every gesture, and a text read-back of the
 * whole state (#mh-state, aria-live) that says what is on screen and what was
 * said about it. No external resources.
 */
import { readFileSync } from "node:fs";
import type { Compiled } from "../timeline/schema.ts";
import { timelineJson } from "../timeline/docs.ts";

export type ExportOpts = { film: string; format: string; c: Compiled; video: string; embed?: boolean; title?: string; /** body-only fragment (title, style, markup, script) for hosts that wrap the page themselves, e.g. a claude.ai artifact */ fragment?: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const reviewPage = (o: ExportOpts): string => {
  const T = JSON.parse(timelineJson(o.c)) as Record<string, unknown>;
  Object.assign(T, { film: o.film, format: o.format, videoName: o.video.split("/").pop() });
  const src = o.embed ? `data:video/mp4;base64,${readFileSync(o.video).toString("base64")}` : o.video;
  const title = o.title ?? `${o.film} ${o.format} review`;
  const head = o.fragment ? `<title>${esc(title)}</title>` : `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`;
  const tail = o.fragment ? "" : "</body></html>";
  return `${head}
<style>
  :root{--ink:#1c1a17;--bg:#f4f1e8;--card:#fff;--line:#e2ddd0;--acc:#d99a00;--trans:#e8871e;--ev:#2f6fde;color-scheme:light}
  body{margin:0;font:14px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
  header{display:flex;gap:16px;align-items:baseline;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card);flex-wrap:wrap}
  header h1{font-size:16px;margin:0}header .meta{color:#666}
  main{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:0;min-height:calc(100vh - 49px)}
  @media (max-width:900px){main{grid-template-columns:1fr}}
  .stage{padding:16px 20px;overflow:auto;min-width:0}
  video{width:100%;max-height:60vh;background:#000;border-radius:10px;display:block}
  .bar{position:relative;display:flex;height:44px;margin-top:10px;background:#dcd6c6;border-radius:6px;overflow:hidden}
  .bar button.scene{position:absolute;top:0;bottom:0;border:0;border-right:1px solid rgba(0,0,0,.25);font:11px/1.2 inherit;padding:3px 4px;overflow:hidden;white-space:nowrap;color:#222;background:#efe9d6;cursor:pointer;text-align:left}
  .bar button.scene.dark{background:#5b5348;color:#fff}.bar button.scene:focus-visible{outline:3px solid var(--acc);outline-offset:-3px}
  .bar .ev{position:absolute;bottom:2px;width:2px;height:8px;background:var(--ev);pointer-events:none}
  .bar .head{position:absolute;top:0;bottom:0;width:2px;background:var(--acc);pointer-events:none}
  .bar .pin{position:absolute;top:0;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:#c0392b;pointer-events:none}
  .loc{margin-top:10px;font-family:ui-monospace,Menlo,monospace;font-size:13px;display:flex;gap:18px;flex-wrap:wrap;align-items:center}
  .loc b{color:var(--acc)}
  .keys{margin-top:8px;color:#666;font-size:12px}
  kbd{background:#fff;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 5px;font-family:inherit}
  aside{border-left:1px solid var(--line);background:var(--card);display:flex;flex-direction:column;min-height:0}
  form{padding:12px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
  textarea{width:100%;box-sizing:border-box;min-height:64px;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;resize:vertical}
  .tags{display:flex;gap:6px;flex-wrap:wrap}
  .tags button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:3px 10px;font:inherit;cursor:pointer}
  .tags button[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
  form .send{align-self:flex-end;background:var(--acc);border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
  ul{list-style:none;margin:0;padding:8px 12px;overflow:auto;flex:1}
  li{padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;background:#fff}
  li .addr{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#333;background:none;border:0;padding:0;cursor:pointer;text-decoration:underline dotted}
  li .tag{display:inline-block;font-size:11px;background:#f1ecdd;border-radius:999px;padding:1px 8px;margin-left:6px}
  li .txt{margin-top:4px}li.done{opacity:.5}
  li .ops{float:right;font-size:12px}li .ops button{color:#888;margin-left:8px;cursor:pointer;background:none;border:0;font:inherit;text-decoration:underline}
  .state{padding:10px 12px;border-top:1px solid var(--line);font-size:12px;color:#666}
  .state pre{margin:6px 0 0;max-height:180px;overflow:auto;background:#faf8f1;border:1px solid var(--line);border-radius:6px;padding:8px;font-size:11px;white-space:pre-wrap}
  .state .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .state button{font:inherit;border:1px solid var(--line);background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer}
  .sr{position:absolute;left:-9999px}
</style>${o.fragment ? "" : "</head><body>"}
<header><h1 id="title">${esc(title)}</h1><span class="meta" id="meta"></span><span class="meta" id="store" aria-live="polite"></span></header>
<main>
  <section class="stage" aria-label="Film and timeline">
    <video id="v" controls preload="auto" playsinline aria-label="The film" src="${src}"></video>
    <div class="bar" id="bar" role="group" aria-label="Scenes: press a scene to jump to its first frame"><div class="head" id="head" aria-hidden="true"></div></div>
    <div class="loc" id="loc" aria-live="off"></div>
    <div class="keys" id="keys"><kbd>space</kbd> play <kbd>,</kbd> <kbd>.</kbd> frame <kbd>j</kbd> <kbd>l</kbd> 1s <kbd>c</kbd> comment <kbd>1</kbd> too fast <kbd>2</kbd> too slow <kbd>3</kbd> wrong place <kbd>4</kbd> bug <kbd>5</kbd> looks cheap <kbd>[</kbd> <kbd>]</kbd> scene</div>
  </section>
  <aside aria-label="Comments">
    <form id="f" aria-label="New comment at the current frame">
      <div id="at" aria-live="polite" style="font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#555"></div>
      <div class="tags" id="tags" role="group" aria-label="Tag"></div>
      <label class="sr" for="text">Comment text</label>
      <textarea id="text" name="text" placeholder="what is wrong here"></textarea>
      <button class="send" type="submit" id="save">Save at this frame</button>
    </form>
    <ul id="list" aria-label="Comments, in film order"></ul>
    <div class="state">
      <div class="row"><span>State, readable as text (also <code>window.mhState()</code>):</span><button type="button" id="copy">Copy comments as JSON</button><button type="button" id="copymd">Copy as markdown</button></div>
      <pre id="mh-state" aria-live="polite" aria-label="Current state as JSON"></pre>
    </div>
  </aside>
</main>
<script>
const T=${JSON.stringify(T)};
const TAGS=["too fast","too slow","wrong place","bug","looks cheap","cut here","hold longer","text","sound"];
const KEY="mh-review:"+T.film+":"+T.format;
let comments=[], tag=null, store="local", db=null;
const $=id=>document.getElementById(id);
const v=$("v");
const fmt=s=>{const m=Math.floor(s/60),r=s-m*60;return (m?m+":":"")+r.toFixed(2)+"s"};
const uid=()=>Math.random().toString(36).slice(2,10);
function locate(f){f=Math.max(0,Math.min(T.dur-1,Math.round(f)));const s=T.scenes.find(s=>f>=s.filmStart&&f<s.filmEnd)||T.scenes[T.scenes.length-1];const p=T.parts.find(p=>p.id===s.part);const local=f-s.filmStart;const ev=s.events.filter(e=>e.local<=local).sort((a,b)=>b.local-a.local)[0];return {f,s,p,local,partFrame:f-p.filmStart,ev,inTrans:local<(s.enter.dur||0)}}
function frame(){return Math.round(v.currentTime*T.fps)}
function state(){const L=locate(frame());return {film:T.film,format:T.format,fps:T.fps,frame:L.f,seconds:+v.currentTime.toFixed(3),scene:L.s.id,local:L.local,address:L.s.id+"+"+L.local,part:L.p.id,partFrame:L.partFrame,event:L.ev?{name:L.ev.name,after:L.local-L.ev.local}:null,inTransition:L.inTrans,playing:!v.paused,store,comments:comments.slice().sort((a,b)=>a.filmFrame-b.filmFrame).map(k=>({id:k.id,address:k.scene+"+"+k.local,seconds:+k.t.toFixed(2),tag:k.tag||null,text:k.text,done:!!k.done}))}}
window.mhState=state;
function render(){
  const L=locate(frame());
  $("head").style.left=(L.f/T.dur*100)+"%";
  $("loc").innerHTML="film <b>"+fmt(v.currentTime)+"</b> f"+L.f+" &nbsp; part <b>"+L.p.id+"</b> f"+L.partFrame+" &nbsp; scene <b>"+L.s.id+"+"+L.local+"</b>"+(L.ev?" &nbsp; after <b>"+L.ev.name+"</b>+"+(L.local-L.ev.local):"")+(L.inTrans?" &nbsp; <span style='color:#e8871e'>in transition</span>":"")+(L.s.why?" &nbsp; <span style='color:#777'>"+L.s.why+"</span>":"");
  $("at").textContent="at "+L.s.id+"+"+L.local+"  (film "+fmt(v.currentTime)+", "+L.p.id+" f"+L.partFrame+")";
  document.querySelectorAll("#bar button.scene").forEach(b=>b.setAttribute("aria-current",b.dataset.id===L.s.id?"true":"false"));
  $("mh-state").textContent=JSON.stringify(state(),null,1);
}
function buildBar(){const bar=$("bar");T.scenes.forEach(s=>{const d=document.createElement("button");d.type="button";d.className="scene "+(s.ground||"");d.dataset.id=s.id;d.style.left=(s.filmStart/T.dur*100)+"%";d.style.width=(s.dur/T.dur*100)+"%";d.title=s.id+" ("+s.dur+"f)";d.setAttribute("aria-label","scene "+s.id+", "+fmt(s.filmStart/T.fps)+" to "+fmt(s.filmEnd/T.fps)+(s.text?", text: "+[].concat(s.text).join(" "):""));d.textContent=s.id;s.events.forEach(e=>{const m=document.createElement("span");m.className="ev";m.style.left=(e.local/s.dur*100)+"%";m.title=e.name;d.appendChild(m)});d.onclick=()=>{v.pause();v.currentTime=s.filmStart/T.fps;render()};bar.appendChild(d)});}
function buildTags(){const t=$("tags");TAGS.forEach(x=>{const b=document.createElement("button");b.type="button";b.textContent=x;b.setAttribute("aria-pressed","false");b.onclick=()=>{tag=tag===x?null:x;[...t.children].forEach(c=>c.setAttribute("aria-pressed",c.textContent===tag?"true":"false"))};t.appendChild(b)})}
function seekBy(fr){v.pause();v.currentTime=Math.max(0,v.currentTime+fr/T.fps);render()}
function seekScene(d){const L=locate(frame());const i=Math.max(0,Math.min(T.scenes.length-1,T.scenes.findIndex(s=>s.id===L.s.id)+d));v.pause();v.currentTime=T.scenes[i].filmStart/T.fps;render()}
async function initStore(){
  try{ if(window.claude&&typeof window.claude.use==="function"){ db=await window.claude.use("db"); if(db){store="shared";} } }catch(e){db=null}
  if(db){ try{ db.collection("comments").onSnapshot(snap=>{comments=(snap.docs||snap||[]).map(d=>typeof d.data==="function"?{id:d.id,...d.data()}:d);drawComments();render()}); const first=await db.collection("comments").get(); comments=(first.docs||[]).map(d=>({id:d.id,...(typeof d.data==="function"?d.data():d.data)})); }catch(e){ db=null; store="local"; } }
  if(!db){ try{comments=JSON.parse(localStorage.getItem(KEY)||"[]")}catch(e){comments=[]} }
  $("store").textContent=store==="shared"?"comments are shared with everyone who opens this page":"comments stay in this browser (copy them out with the buttons below)";
}
async function persist(){ if(db) return; try{localStorage.setItem(KEY,JSON.stringify(comments))}catch(e){} }
async function put(k){ if(db){ await db.doc("comments/"+k.id).set(k); } else { comments=comments.filter(x=>x.id!==k.id).concat([k]); await persist(); } }
async function del(id){ if(db){ await db.doc("comments/"+id).delete(); } else { comments=comments.filter(x=>x.id!==id); await persist(); } }
function drawComments(){const ul=$("list");ul.innerHTML="";document.querySelectorAll(".pin").forEach(p=>p.remove());comments.slice().sort((a,b)=>a.filmFrame-b.filmFrame).forEach(k=>{const li=document.createElement("li");li.className=k.done?"done":"";li.id="comment-"+k.id;li.setAttribute("aria-label",(k.done?"done, ":"open, ")+k.scene+"+"+k.local+(k.tag?", "+k.tag:"")+": "+k.text);li.innerHTML='<span class="ops"><button type="button" data-d="'+k.id+'">'+(k.done?"reopen":"done")+'</button><button type="button" data-x="'+k.id+'">delete</button></span><button type="button" class="addr" aria-label="jump to '+k.scene+"+"+k.local+'">'+k.scene+"+"+k.local+" · "+fmt(k.t)+"</button>"+(k.tag?'<span class="tag">'+k.tag+"</span>":"")+'<div class="txt"></div>';li.querySelector(".txt").textContent=k.text;li.querySelector(".addr").onclick=()=>{v.pause();v.currentTime=k.t;render()};ul.appendChild(li);const pin=document.createElement("div");pin.className="pin";pin.style.left=(k.filmFrame/T.dur*100)+"%";$("bar").appendChild(pin)});ul.querySelectorAll("button[data-x]").forEach(a=>a.onclick=async()=>{await del(a.dataset.x);if(!db){drawComments();render()}});ul.querySelectorAll("button[data-d]").forEach(a=>a.onclick=async()=>{const k=comments.find(x=>x.id===a.dataset.d);if(!k)return;await put({...k,done:!k.done});if(!db){drawComments();render()}})}
async function save(text,tg){const L=locate(frame());const k={id:uid(),t:v.currentTime,filmFrame:L.f,part:L.p.id,scene:L.s.id,local:L.local,partFrame:L.partFrame,tag:tg||tag||undefined,text,at:new Date().toISOString(),done:false};await put(k);$("text").value="";tag=null;[...$("tags").children].forEach(c=>c.setAttribute("aria-pressed","false"));if(!db){drawComments();render()}}
$("f").addEventListener("submit",e=>{e.preventDefault();const t=$("text").value.trim();if(!t&&!tag)return;save(t||tag,tag)});
$("copy").onclick=async()=>{const s=JSON.stringify(state().comments,null,2);try{await navigator.clipboard.writeText(s)}catch(e){}$("store").textContent="copied "+state().comments.length+" comments as JSON"};
$("copymd").onclick=async()=>{const s=state().comments.map(k=>"- "+(k.done?"[x]":"[ ]")+" \`"+k.address+"\` ("+k.seconds+"s)"+(k.tag?" **"+k.tag+"**":"")+": "+k.text).join("\\n")||"no comments";try{await navigator.clipboard.writeText(s)}catch(e){}$("store").textContent="copied as markdown (mh feedback --from - reads it)"};
v.addEventListener("timeupdate",render);v.addEventListener("seeked",render);v.addEventListener("play",render);v.addEventListener("pause",render);
document.addEventListener("keydown",e=>{if(e.target.tagName==="TEXTAREA"){if(e.key==="Escape")e.target.blur();return}
 if(e.key===" "){e.preventDefault();v.paused?v.play():v.pause()}
 else if(e.key===",")seekBy(-1);else if(e.key===".")seekBy(1);else if(e.key==="j")seekBy(-T.fps);else if(e.key==="l")seekBy(T.fps);
 else if(e.key==="[")seekScene(-1);else if(e.key==="]")seekScene(1);
 else if(e.key==="c"){v.pause();$("text").focus()}
 else if(/^[1-5]$/.test(e.key)){v.pause();save(TAGS[+e.key-1],TAGS[+e.key-1])}});
$("meta").textContent=T.scenes.length+" scenes · "+T.seconds.toFixed(2)+"s · "+T.fps+" fps · "+T.videoName;
buildBar();buildTags();initStore().then(()=>{drawComments();render()});render();
</script>${tail}`;
};
