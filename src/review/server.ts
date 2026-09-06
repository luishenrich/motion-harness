/**
 * The review player: the film, a scene bar from the timeline, and comments that
 * land as scene + local frame instead of "second 19" or "picture 2".
 */
import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { LoadedConfig } from "../config.ts";
import type { Compiled } from "../timeline/schema.ts";
import { timelineJson } from "../timeline/docs.ts";
import { locate } from "../timeline/resolve.ts";
import { ensureDir, readJson, writeJson, stamp } from "../util.ts";

export type Comment = { id: string; t: number; filmFrame: number; part: string; scene: string; local: number; partFrame: number; tag?: string; text: string; at: string; done?: boolean };

export const commentsPath = (cfg: LoadedConfig, film: string, format: string) => join(ensureDir(join(cfg.cachePath, "review")), `${film}-${format}.json`);

export const loadComments = (cfg: LoadedConfig, film: string, format: string): Comment[] =>
  existsSync(commentsPath(cfg, film, format)) ? readJson<Comment[]>(commentsPath(cfg, film, format)) : [];

export const feedbackMarkdown = (c: Compiled, comments: Comment[]): string => {
  if (!comments.length) return "no comments";
  const byScene = new Map<string, Comment[]>();
  for (const k of comments) byScene.set(k.scene, [...(byScene.get(k.scene) ?? []), k]);
  const L: string[] = [];
  for (const s of c.scenes) {
    const ks = byScene.get(s.id);
    if (!ks) continue;
    L.push(`## ${s.id} (${s.part}, part frames ${s.start}-${s.end - 1}, film ${(s.filmStart / c.fps).toFixed(2)}s-${(s.filmEnd / c.fps).toFixed(2)}s)`);
    for (const k of ks.sort((a, b) => a.local - b.local)) {
      const ev = s.events.filter((e) => e.local <= k.local).sort((a, b) => b.local - a.local)[0];
      L.push(`- ${k.done ? "[x]" : "[ ]"} \`${s.id}+${k.local}\` (part f${k.partFrame}, film ${k.t.toFixed(2)}s${ev ? `, after ${ev.name}+${k.local - ev.local}` : ""})${k.tag ? ` **${k.tag}**` : ""}: ${k.text}`);
    }
    L.push("");
  }
  return L.join("\n");
};

const page = (title: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root{--ink:#1c1a17;--bg:#f4f1e8;--card:#fff;--line:#e2ddd0;--acc:#d99a00;--trans:#e8871e;--ev:#2f6fde}
  body{margin:0;font:14px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
  header{display:flex;gap:16px;align-items:baseline;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card)}
  header h1{font-size:16px;margin:0}header .meta{color:#666}
  main{display:grid;grid-template-columns:1fr 360px;gap:0;height:calc(100vh - 49px)}
  .stage{padding:16px 20px;overflow:auto}
  video{width:100%;max-height:62vh;background:#000;border-radius:10px;display:block}
  .bar{position:relative;height:44px;margin-top:10px;background:#dcd6c6;border-radius:6px;overflow:hidden;cursor:pointer}
  .bar .scene{position:absolute;top:0;bottom:0;border-right:1px solid rgba(0,0,0,.25);font-size:11px;padding:3px 4px;overflow:hidden;white-space:nowrap;color:#222}
  .bar .scene.dark{background:#5b5348;color:#fff}.bar .scene.cream,.bar .scene.light{background:#efe9d6}
  .bar .scene .ev{position:absolute;bottom:2px;width:2px;height:8px;background:var(--ev)}
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
  .tags button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  form .send{align-self:flex-end;background:var(--acc);border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
  ul{list-style:none;margin:0;padding:8px 12px;overflow:auto;flex:1}
  li{padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;background:#fff}
  li .addr{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#333;cursor:pointer}
  li .addr:hover{text-decoration:underline}
  li .tag{display:inline-block;font-size:11px;background:#f1ecdd;border-radius:999px;padding:1px 8px;margin-left:6px}
  li .txt{margin-top:4px}li.done{opacity:.5}
  li .ops{float:right;font-size:12px}li .ops a{color:#888;margin-left:8px;cursor:pointer}
  .export{padding:10px 12px;border-top:1px solid var(--line);font-size:12px;color:#666}
</style></head><body>
<header><h1 id="title"></h1><span class="meta" id="meta"></span></header>
<main>
  <section class="stage">
    <video id="v" controls preload="auto" src="/video"></video>
    <div class="bar" id="bar"><div class="head" id="head"></div></div>
    <div class="loc" id="loc"></div>
    <div class="keys"><kbd>space</kbd> play <kbd>,</kbd> <kbd>.</kbd> frame <kbd>j</kbd> <kbd>l</kbd> 1s <kbd>c</kbd> comment <kbd>1</kbd> too fast <kbd>2</kbd> too slow <kbd>3</kbd> wrong place <kbd>4</kbd> bug <kbd>5</kbd> looks cheap</div>
  </section>
  <aside>
    <form id="f">
      <div id="at" style="font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#555"></div>
      <div class="tags" id="tags"></div>
      <textarea id="text" placeholder="what is wrong here"></textarea>
      <button class="send" type="submit">Save at this frame</button>
    </form>
    <ul id="list"></ul>
    <div class="export">Agent reads this with <code>mh feedback</code>. Comments live in the project's cache dir.</div>
  </aside>
</main>
<script>
const TAGS=["too fast","too slow","wrong place","bug","looks cheap","cut here","hold longer","text","sound"];
let T=null, comments=[], tag=null;
const $=id=>document.getElementById(id);
const v=$("v");
const fmt=s=>{const m=Math.floor(s/60),r=s-m*60;return (m?m+":":"")+r.toFixed(2)+"s"};
function locate(f){f=Math.max(0,Math.min(T.dur-1,Math.round(f)));const s=T.scenes.find(s=>f>=s.filmStart&&f<s.filmEnd)||T.scenes[T.scenes.length-1];const p=T.parts.find(p=>p.id===s.part);const local=f-s.filmStart;const ev=s.events.filter(e=>e.local<=local).sort((a,b)=>b.local-a.local)[0];return {f,s,p,local,partFrame:f-p.filmStart,ev,inTrans:local<(s.enter.dur||0)}}
function frame(){return Math.round(v.currentTime*T.fps)}
function render(){
  const L=locate(frame());
  $("head").style.left=(L.f/T.dur*100)+"%";
  $("loc").innerHTML="film <b>"+fmt(v.currentTime)+"</b> f"+L.f+" &nbsp; part <b>"+L.p.id+"</b> f"+L.partFrame+" &nbsp; scene <b>"+L.s.id+"+"+L.local+"</b>"+(L.ev?" &nbsp; after <b>"+L.ev.name+"</b>+"+(L.local-L.ev.local):"")+(L.inTrans?" &nbsp; <span style='color:#e8871e'>in transition</span>":"")+(L.s.why?" &nbsp; <span style='color:#777'>"+L.s.why+"</span>":"");
  $("at").textContent="at "+L.s.id+"+"+L.local+"  (film "+fmt(v.currentTime)+", "+L.p.id+" f"+L.partFrame+")";
}
function buildBar(){const bar=$("bar");T.scenes.forEach(s=>{const d=document.createElement("div");d.className="scene "+(s.ground||"");d.style.left=(s.filmStart/T.dur*100)+"%";d.style.width=(s.dur/T.dur*100)+"%";d.title=s.id+" ("+s.dur+"f)";d.textContent=s.id;s.events.forEach(e=>{const m=document.createElement("div");m.className="ev";m.style.left=(e.local/s.dur*100)+"%";m.title=e.name;d.appendChild(m)});bar.appendChild(d)});bar.addEventListener("click",e=>{const r=bar.getBoundingClientRect();v.currentTime=((e.clientX-r.left)/r.width)*T.dur/T.fps;v.pause();render()});}
function buildTags(){const t=$("tags");TAGS.forEach(x=>{const b=document.createElement("button");b.type="button";b.textContent=x;b.onclick=()=>{tag=tag===x?null:x;[...t.children].forEach(c=>c.classList.toggle("on",c.textContent===tag))};t.appendChild(b)})}
function seekBy(fr){v.pause();v.currentTime=Math.max(0,v.currentTime+fr/T.fps);render()}
async function load(){T=await (await fetch("/timeline.json")).json();$("title").textContent=T.film+" · "+T.format;$("meta").textContent=T.scenes.length+" scenes · "+T.seconds.toFixed(2)+"s · "+T.fps+" fps · "+T.videoName;buildBar();buildTags();await loadComments();render();}
async function loadComments(){comments=await (await fetch("/comments")).json();drawComments()}
function drawComments(){const ul=$("list");ul.innerHTML="";document.querySelectorAll(".pin").forEach(p=>p.remove());comments.slice().sort((a,b)=>a.filmFrame-b.filmFrame).forEach(k=>{const li=document.createElement("li");li.className=k.done?"done":"";li.innerHTML='<span class="ops"><a data-d="'+k.id+'">'+(k.done?"reopen":"done")+'</a><a data-x="'+k.id+'">delete</a></span><span class="addr">'+k.scene+"+"+k.local+" · "+fmt(k.t)+"</span>"+(k.tag?'<span class="tag">'+k.tag+"</span>":"")+'<div class="txt"></div>';li.querySelector(".txt").textContent=k.text;li.querySelector(".addr").onclick=()=>{v.pause();v.currentTime=k.t;render()};ul.appendChild(li);const pin=document.createElement("div");pin.className="pin";pin.style.left=(k.filmFrame/T.dur*100)+"%";$("bar").appendChild(pin)});ul.querySelectorAll("a[data-x]").forEach(a=>a.onclick=async()=>{await fetch("/comments/"+a.dataset.x,{method:"DELETE"});loadComments()});ul.querySelectorAll("a[data-d]").forEach(a=>a.onclick=async()=>{await fetch("/comments/"+a.dataset.d+"/toggle",{method:"POST"});loadComments()})}
async function save(text,tg){const L=locate(frame());const body={t:v.currentTime,filmFrame:L.f,part:L.p.id,scene:L.s.id,local:L.local,partFrame:L.partFrame,tag:tg||tag||undefined,text};await fetch("/comments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});$("text").value="";tag=null;[...$("tags").children].forEach(c=>c.classList.remove("on"));loadComments()}
$("f").addEventListener("submit",e=>{e.preventDefault();const t=$("text").value.trim();if(!t&&!tag)return;save(t||tag,tag)});
v.addEventListener("timeupdate",render);v.addEventListener("seeked",render);
document.addEventListener("keydown",e=>{if(e.target.tagName==="TEXTAREA"){if(e.key==="Escape")e.target.blur();return}
 if(e.key===" "){e.preventDefault();v.paused?v.play():v.pause()}
 else if(e.key===",")seekBy(-1);else if(e.key===".")seekBy(1);else if(e.key==="j")seekBy(-T.fps);else if(e.key==="l")seekBy(T.fps);
 else if(e.key==="c"){v.pause();$("text").focus()}
 else if(/^[1-5]$/.test(e.key)){v.pause();save(TAGS[+e.key-1],TAGS[+e.key-1])}});
load();
</script></body></html>`;

export const startReviewServer = (cfg: LoadedConfig, c: Compiled, film: string, format: string, video: string, port: number) => {
  const tl = JSON.parse(timelineJson(c));
  const file = commentsPath(cfg, film, format);
  const read = (): Comment[] => (existsSync(file) ? readJson<Comment[]>(file) : []);
  const write = (v: Comment[]) => writeJson(file, v);
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/") return new Response(page(`${film} ${format} review`), { headers: { "content-type": "text/html; charset=utf-8" } });
      if (p === "/timeline.json") return Response.json({ ...tl, film, format, videoName: basename(video) });
      if (p === "/video") {
        const f = Bun.file(video);
        const range = req.headers.get("range");
        if (range) {
          const m = range.match(/bytes=(\d+)-(\d*)/);
          const start = m ? parseInt(m[1], 10) : 0;
          const end = m && m[2] ? parseInt(m[2], 10) : Math.min(f.size - 1, start + 4 * 1024 * 1024);
          return new Response(f.slice(start, end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${f.size}`, "accept-ranges": "bytes", "content-type": "video/mp4", "content-length": String(end - start + 1) } });
        }
        return new Response(f, { headers: { "content-type": "video/mp4", "accept-ranges": "bytes" } });
      }
      if (p === "/comments" && req.method === "GET") return Response.json(read());
      if (p === "/comments" && req.method === "POST") {
        const body = (await req.json()) as Partial<Comment>;
        const loc = locate(c, body.filmFrame ?? Math.round((body.t ?? 0) * c.fps));
        const k: Comment = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          t: body.t ?? loc.filmSeconds,
          filmFrame: loc.filmFrame,
          part: loc.part,
          scene: loc.scene.id,
          local: loc.local,
          partFrame: loc.partFrame,
          tag: body.tag,
          text: body.text ?? "",
          at: stamp(),
        };
        write([...read(), k]);
        return Response.json(k);
      }
      const del = p.match(/^\/comments\/([\w]+)$/);
      if (del && req.method === "DELETE") {
        write(read().filter((k) => k.id !== del[1]));
        return Response.json({ ok: true });
      }
      const tog = p.match(/^\/comments\/([\w]+)\/toggle$/);
      if (tog && req.method === "POST") {
        write(read().map((k) => (k.id === tog[1] ? { ...k, done: !k.done } : k)));
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
};

export const readSkill = () => readFileSync(join(import.meta.dir, "../../skill/SKILL.md"), "utf8");
