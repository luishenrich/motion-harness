/**
 * The editor: the film's data with hands, in a browser. The native engine's
 * host page renders any frame of the film on a stage; this page wraps it with a
 * scrubber, a layer list, an inspector and a keyboard, and every change is
 * written to film.mograph.json at once, linted, and re-rendered without a
 * reload (the stage is remounted with the new data as input props). A
 * computer-use agent gets labels on everything, a text read-back of the whole
 * state (#mh-state, window.mhEdit.state()) and a keyboard path for each gesture.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoadedConfig } from "../config.ts";
import { compile } from "../timeline/schema.ts";
import { timelineJson } from "../timeline/docs.ts";
import { mographTimeline } from "./timeline.ts";
import type { MgFilm } from "./schema.ts";
import { loadFilm, saveFilm, setValue, unsetValue, setKey, unsetKey, addLayer, addScene, remove, move, duplicate, rename, lintFilm, autoLayout, type MgFinding } from "./edit.ts";

type Op =
  | { op: "set"; addr: string; value: unknown }
  | { op: "unset"; addr: string }
  | { op: "key"; addr: string; at: number; v: number; ease?: string }
  | { op: "unkey"; addr: string; at: number }
  | { op: "add-layer"; scene: string; layer: Record<string, unknown>; after?: string; before?: string }
  | { op: "add-scene"; scene: Record<string, unknown>; after?: string; before?: string }
  | { op: "remove"; addr: string }
  | { op: "move"; addr: string; after?: string; before?: string }
  | { op: "dup"; addr: string; as?: string }
  | { op: "rename"; addr: string; id: string }
  | { op: "layout"; scene?: string }
  | { op: "replace"; film: MgFilm };

export const applyOp = (film: MgFilm, o: Op): MgFilm => {
  switch (o.op) {
    case "set":
      setValue(film, o.addr, o.value);
      return film;
    case "unset":
      unsetValue(film, o.addr);
      return film;
    case "key":
      setKey(film, o.addr, o.at, o.v, o.ease);
      return film;
    case "unkey":
      unsetKey(film, o.addr, o.at);
      return film;
    case "add-layer":
      addLayer(film, o.scene, o.layer as never, { after: o.after, before: o.before });
      return film;
    case "add-scene":
      addScene(film, o.scene as never, { after: o.after, before: o.before });
      return film;
    case "remove":
      remove(film, o.addr);
      return film;
    case "move":
      move(film, o.addr, { after: o.after, before: o.before });
      return film;
    case "dup":
      duplicate(film, o.addr, o.as);
      return film;
    case "rename":
      rename(film, o.addr, o.id);
      return film;
    case "layout":
      autoLayout(film, o.scene);
      return film;
    case "replace":
      return o.film;
  }
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

export type EditServer = { film: () => MgFilm; findings: () => MgFinding[]; log: string[] };

/** GET /__mh/film (the film, its compiled timeline), POST /__mh/film (an op), GET /__mh/edit (the page) */
export const editMiddleware = (cfg: LoadedConfig, filmName: string, filmPath: string, opts: { log?: (s: string) => void } = {}): { handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>; state: EditServer } => {
  const log = opts.log ?? (() => {});
  let film = loadFilm(filmPath);
  let findings = lintFilm(film, cfg.projectDir);
  const history: string[] = [];
  const snapshot = () => ({ film, timeline: JSON.parse(timelineJson(compile(mographTimeline(film, { film: filmName })))), findings, path: filmPath, name: filmName, formats: film.formats, fps: film.fps });
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/__mh/edit" || url === "/__mh/edit/") {
      res.setHeader("Content-Type", "text/html");
      res.end(editorPage({ title: `${film.title} (${filmName})` }));
      return;
    }
    if (url !== "/__mh/film") return next();
    if (req.method === "GET") return json(res, 200, snapshot());
    if (req.method === "POST") {
      try {
        const o = JSON.parse(await readBody(req)) as Op;
        const before = JSON.stringify(film);
        const next = applyOp(JSON.parse(before) as MgFilm, o);
        film = next;
        findings = lintFilm(film, cfg.projectDir);
        saveFilm(filmPath, film);
        history.push(before);
        if (history.length > 200) history.shift();
        log(`${o.op}${"addr" in o ? ` ${o.addr}` : "scene" in o && typeof o.scene === "string" ? ` ${o.scene}` : ""}${"value" in o ? ` = ${JSON.stringify(o.value)}` : ""}  (${findings.filter((f) => f.level === "error").length} errors)`);
        return json(res, 200, { ok: true, ...snapshot() });
      } catch (e) {
        return json(res, 400, { ok: false, error: String((e as Error).message ?? e), ...snapshot() });
      }
    }
    next();
  };
  return { handler, state: { film: () => film, findings: () => findings, log: [] } };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const editorPage = (o: { title: string }): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)} edit</title>
<style>
  :root{--ink:#1c1a17;--bg:#f1efe9;--card:#fff;--line:#dcd8cc;--acc:#d99a00;--err:#c0392b;--warn:#b26a00;color-scheme:light}
  body{margin:0;font:13px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);height:100vh;display:flex;flex-direction:column}
  header{display:flex;gap:14px;align-items:baseline;padding:8px 16px;border-bottom:1px solid var(--line);background:var(--card);flex-wrap:wrap}
  header h1{font-size:15px;margin:0}header .meta{color:#666}header .save{color:#2c7a3f}header .save.err{color:var(--err)}
  main{display:grid;grid-template-columns:minmax(0,1fr) 400px;flex:1;min-height:0}
  .stage{display:flex;flex-direction:column;min-width:0;padding:12px 16px;gap:10px;overflow:hidden}
  .view{flex:1;min-height:240px;position:relative;background:#111;border-radius:8px;overflow:hidden}
  @media (max-width:900px){main{grid-template-columns:1fr;overflow:auto}aside{border-left:0;border-top:1px solid var(--line)}}
  .view iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;background:#000}
  .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .bar button,.bar select,aside button,aside select,aside input{font:inherit}
  .bar button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer}
  .bar button[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
  .bar input[type=range]{flex:1;min-width:160px}
  .scenes{display:flex;gap:4px;flex-wrap:wrap}
  .scenes button.cur{outline:2px solid var(--acc)}
  .loc{font-family:ui-monospace,Menlo,monospace;font-size:12px}
  .keys{color:#666;font-size:12px}kbd{background:#fff;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 5px;font-family:inherit}
  aside{border-left:1px solid var(--line);background:var(--card);display:flex;flex-direction:column;min-height:0;overflow:auto}
  section{padding:10px 12px;border-bottom:1px solid var(--line)}
  section h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:0 0 6px}
  .layers{list-style:none;margin:0;padding:0}
  .layers li{display:flex;gap:8px;align-items:center;padding:3px 6px;border-radius:6px;cursor:pointer}
  .layers li[aria-selected="true"]{background:#fdf1cf}
  .layers li .t{color:#888;font-size:11px;min-width:52px}.layers li .a{font-family:ui-monospace,Menlo,monospace;font-size:12px}
  .grid{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center}
  .grid label{color:#555}.grid input,.grid select{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:4px 6px}
  textarea{width:100%;box-sizing:border-box;min-height:140px;border:1px solid var(--line);border-radius:6px;padding:6px;font:12px/1.4 ui-monospace,Menlo,monospace}
  .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .row button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer}
  .row button.primary{background:var(--acc);border-color:var(--acc);font-weight:600}
  .findings{margin:0;padding:0;list-style:none;font-size:12px}.findings li{padding:2px 0}.findings .error{color:var(--err)}.findings .warn{color:var(--warn)}
  pre{margin:0;max-height:220px;overflow:auto;background:#faf8f1;border:1px solid var(--line);border-radius:6px;padding:8px;font-size:11px;white-space:pre-wrap}
  .sr{position:absolute;left:-9999px}
</style></head><body>
<header><h1 id="title">${esc(o.title)}</h1><span class="meta" id="path"></span><span class="save" id="save" aria-live="polite">loaded</span></header>
<main>
  <section class="stage" aria-label="Stage">
    <div class="bar">
      <label>Format <select id="format" aria-label="Format"></select></label>
      <div class="scenes" id="scenes" role="group" aria-label="Scenes"></div>
    </div>
    <div class="view" id="view"><iframe id="stage" title="The film at the current frame" src="/__mh/"></iframe></div>
    <div class="bar">
      <button id="play" type="button" aria-pressed="false" aria-label="Play or pause">play</button>
      <button id="prev" type="button" aria-label="One frame back">&lt;</button>
      <input id="scrub" type="range" min="0" max="1" value="0" step="1" aria-label="Frame">
      <button id="next" type="button" aria-label="One frame forward">&gt;</button>
      <span class="loc" id="loc" aria-live="off"></span>
    </div>
    <div class="keys"><kbd>click</kbd> select a layer <kbd>arrows</kbd> nudge (<kbd>shift</kbd> coarse) <kbd>[</kbd> <kbd>]</kbd> in earlier/later <kbd>-</kbd> <kbd>=</kbd> smaller/larger <kbd>,</kbd> <kbd>.</kbd> frame <kbd>j</kbd> <kbd>l</kbd> second <kbd>space</kbd> play <kbd>d</kbd> duplicate <kbd>Backspace</kbd> remove <kbd>z</kbd> undo <kbd>Esc</kbd> deselect</div>
  </section>
  <aside aria-label="Layers and inspector">
    <section><h2>Layers</h2><ul class="layers" id="layers" role="listbox" aria-label="Layers of the current scene"></ul>
      <div class="row"><button type="button" id="addText">+ text</button><button type="button" id="addShape">+ shape</button><button type="button" id="addCounter">+ counter</button><button type="button" id="addList">+ list</button><button type="button" id="layout">layout</button></div></section>
    <section><h2>Scene</h2><div class="grid" id="sceneForm"></div></section>
    <section><h2 id="selTitle">Layer</h2><div class="grid" id="quick"></div>
      <label class="sr" for="json">Layer as JSON</label><textarea id="json" spellcheck="false" placeholder="select a layer"></textarea>
      <div class="row"><button type="button" class="primary" id="apply">Apply JSON</button><button type="button" id="dup">duplicate</button><button type="button" id="remove">remove</button></div></section>
    <section><h2>Lint</h2><ul class="findings" id="findings" aria-live="polite"></ul></section>
    <section><h2>State (also window.mhEdit.state())</h2><pre id="mh-state" aria-live="polite"></pre></section>
  </aside>
</main>
<script>
const $=id=>document.getElementById(id);
let F=null, T=null, findings=[], format=null, sceneId=null, frame=0, selected=null, playing=null, comps=[], compId=null, undo=[], busy=Promise.resolve();
const stage=$("stage"); let W=null;
const fmt=s=>{const m=Math.floor(s/60),r=s-m*60;return (m?m+":":"")+r.toFixed(2)+"s"};
const scene=()=>F.scenes.find(s=>s.id===sceneId)||F.scenes[0];
const tScene=()=>T.scenes.find(s=>s.id===scene().id);
const layer=()=>selected?scene().layers.find(l=>l.id===selected):null;
async function load(){const r=await fetch("/__mh/film");const j=await r.json();F=j.film;T=j.timeline;findings=j.findings;$("path").textContent=j.path;if(!format)format=Object.keys(F.formats)[0];if(!sceneId)sceneId=F.scenes[0].id;}
async function stageReady(){W=stage.contentWindow;await W.__mh.ready;comps=W.__mh.compositions();}
function compFor(){const s=F.formats[format];return (comps.find(c=>c.width===s.width&&c.height===s.height)||comps[0]).id}
async function mount(){compId=compFor();await W.__mh.select(compId,{film:F,format});fitStage();injectStyle();await show();}
function fitStage(){const s=F.formats[format];const box=$("view").getBoundingClientRect();const k=Math.min(box.width/s.width,box.height/s.height);stage.style.width=s.width+"px";stage.style.height=s.height+"px";stage.style.transform="scale("+k+")";stage.style.left=((box.width-s.width*k)/2)+"px";stage.style.top=((box.height-s.height*k)/2)+"px";}
function injectStyle(){const d=stage.contentDocument;let st=d.getElementById("mh-edit-style");if(!st){st=d.createElement("style");st.id="mh-edit-style";d.head.appendChild(st);d.addEventListener("click",e=>{const el=e.target.closest&&e.target.closest("[data-mg]");if(!el){selected=null;injectStyle();render();return}const [sc,l]=el.dataset.mg.split(".");sceneId=sc;select(l);});d.addEventListener("keydown",onKey);}
  st.textContent=selected?'[data-mg="'+scene().id+"."+selected+'"]{outline:3px solid #F2B441;outline-offset:6px}':"";}
async function show(){const ts=tScene();const abs=ts.start+Math.max(0,Math.min(scene().dur-1,frame));await W.__mh.frame(abs,0);render();}
function locate(){const ts=tScene();const local=frame;const ev=ts.events.filter(e=>e.local<=local).sort((a,b)=>b.local-a.local)[0];return {scene:ts.id,local,filmFrame:ts.filmStart+local,seconds:(ts.filmStart+local)/F.fps,event:ev?ev.name+"+"+(local-ev.local):null}}
function render(){const L=locate();const s=scene();$("scrub").max=s.dur-1;$("scrub").value=frame;$("loc").textContent=s.id+"+"+frame+"  film f"+L.filmFrame+" "+fmt(L.seconds)+(L.event?"  after "+L.event:"");
  const sc=$("scenes");sc.innerHTML="";F.scenes.forEach(x=>{const b=document.createElement("button");b.type="button";b.textContent=x.id+" "+x.dur+"f";b.className=x.id===s.id?"cur":"";b.setAttribute("aria-current",x.id===s.id?"true":"false");b.onclick=()=>{sceneId=x.id;frame=0;selected=null;injectStyle();show();};sc.appendChild(b)});
  const ul=$("layers");ul.innerHTML="";s.layers.forEach(l=>{const li=document.createElement("li");li.setAttribute("role","option");li.setAttribute("aria-selected",l.id===selected?"true":"false");li.tabIndex=0;li.innerHTML='<span class="t">'+l.type+'</span><span class="a">'+s.id+"."+l.id+'</span><span style="color:#888;font-size:11px;margin-left:auto">in @'+(l.in&&l.in.at!==undefined?l.in.at:0)+"</span>";li.onclick=()=>select(l.id);li.onkeydown=e=>{if(e.key==="Enter")select(l.id)};ul.appendChild(li)});
  sceneForm();inspector();drawFindings();$("mh-state").textContent=JSON.stringify(state(),null,1);}
function state(){const l=layer();return {film:F.title,path:$("path").textContent,format,scene:scene().id,frame,address:scene().id+"+"+frame,locate:locate(),selected:l?scene().id+"."+l.id:null,layer:l||null,errors:findings.filter(f=>f.level==="error").length,findings}}
function field(id,label,value,type,opts){const l=document.createElement("label");l.htmlFor=id;l.textContent=label;let i;if(opts){i=document.createElement("select");opts.forEach(o=>{const op=document.createElement("option");op.value=o;op.textContent=o;if(o===value)op.selected=true;i.appendChild(op)})}else{i=document.createElement("input");i.type=type||"text";if(type==="number")i.step="any";i.value=value===undefined||value===null?"":value}i.id=id;return [l,i]}
function sceneForm(){const s=scene();const g=$("sceneForm");g.innerHTML="";const add=(id,label,val,type,opts,path)=>{const [l,i]=field(id,label,val,type,opts);i.onchange=()=>post({op:"set",addr:s.id+"."+path,value:type==="number"?parseFloat(i.value):i.value});g.append(l,i)};
  add("s-dur","dur (frames)",s.dur,"number");add("s-ground","ground",s.ground||"ink","text");add("s-exit","exit fade (frames)",s.exit&&s.exit.dur!==undefined?s.exit.dur:(s.exit==="fade"?8:0),"number",null,"exit.dur");
  const [l1,i1]=field("s-why","why",s.why||"","text");i1.onchange=()=>post({op:"set",addr:s.id+".why",value:i1.value});g.append(l1,i1);}
function inspector(){const l=layer();const q=$("quick");q.innerHTML="";$("selTitle").textContent=l?"Layer "+scene().id+"."+l.id+" ("+l.type+")":"Layer (none selected)";$("json").value=l?JSON.stringify(l,null,2):"";if(!l)return;
  const at=l.at||{x:0.5,y:0.5};const put=(id,label,val,type,opts,path,parse)=>{const [a,i]=field(id,label,val,type,opts);i.onchange=()=>post({op:"set",addr:scene().id+"."+l.id+"."+path,value:parse?parse(i.value):i.value});q.append(a,i)};
  const num=v=>parseFloat(v);
  put("q-x","x",at.x,"number",null,"at.x",num);put("q-y","y",at.y,"number",null,"at.y",num);
  if("size" in l||l.type==="text"||l.type==="counter"||l.type==="list")put("q-size","size (u)",l.size||"","number",null,"size",num);
  if(l.type==="text")put("q-text","text",l.text,"text",null,"text");
  put("q-inp","in preset",(l.in&&l.in.preset)||"rise","text",["cut","fade","rise","drop","pop","slide","wipe","grow","blur","typewriter","mask"],"in.preset");
  put("q-inat","in at",(l.in&&l.in.at)||0,"number",null,"in.at",num);put("q-indur","in dur",(l.in&&l.in.dur)||14,"number",null,"in.dur",num);put("q-inease","in ease",(l.in&&l.in.ease)||"out","text",null,"in.ease");
  put("q-outp","out preset",(l.out&&l.out.preset)||"","text",["","fade","sink","lift","shrink","slide","wipe","blur","cut"],"out.preset");put("q-outat","out at (neg = from end)",l.out&&l.out.at!==undefined?l.out.at:"","number",null,"out.at",num);
  if(l.type==="text"||l.type==="counter"||l.type==="list")put("q-color","color",l.color||"","text",null,"color");
  if(l.type==="shape")put("q-fill","fill",l.fill||"","text",null,"fill");}
function drawFindings(){const ul=$("findings");ul.innerHTML="";if(!findings.length){ul.innerHTML="<li>clean</li>";return}findings.forEach(f=>{const li=document.createElement("li");li.className=f.level;li.textContent=f.level+" "+f.rule+" at "+f.where+": "+f.message;ul.appendChild(li)})}
function select(id){selected=id;injectStyle();render();}
async function post(opOrFn){busy=busy.then(async()=>{const op=typeof opOrFn==="function"?opOrFn():opOrFn;if(!op)return;const prev=JSON.stringify(F);$("save").textContent="saving";const r=await fetch("/__mh/film",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(op)});const j=await r.json();if(!j.ok){$("save").textContent=j.error;$("save").className="save err";return}undo.push(prev);F=j.film;T=j.timeline;findings=j.findings;$("save").textContent="saved "+new Date().toLocaleTimeString()+(findings.filter(f=>f.level==="error").length?" with errors":"");$("save").className="save"+(findings.some(f=>f.level==="error")?" err":"");if(!F.scenes.some(s=>s.id===sceneId))sceneId=F.scenes[0].id;if(selected&&!scene().layers.some(l=>l.id===selected))selected=null;await W.__mh.select(compId,{film:F,format});injectStyle();await show();});return busy}
function nudge(dx,dy){post(()=>{const l=layer();if(!l)return null;const at=l.at||{x:0.5,y:0.5};const x=Math.round((at.x+dx)*1000)/1000,y=Math.round((at.y+dy)*1000)/1000;return {op:"set",addr:scene().id+"."+l.id+".at",value:{x,y}}})}
function shiftIn(d){post(()=>{const l=layer();if(!l)return null;return {op:"set",addr:scene().id+"."+l.id+".in.at",value:Math.max(0,((l.in&&l.in.at)||0)+d)}})}
function resize(d){post(()=>{const l=layer();if(!l)return null;const cur=l.size||(l.type==="counter"?160:l.type==="list"?48:72);return {op:"set",addr:scene().id+"."+l.id+".size",value:Math.max(8,cur+d)}})}
function seek(d){frame=Math.max(0,Math.min(scene().dur-1,frame+d));show()}
function togglePlay(){if(playing){clearInterval(playing);playing=null;$("play").setAttribute("aria-pressed","false");$("play").textContent="play";return}$("play").setAttribute("aria-pressed","true");$("play").textContent="pause";playing=setInterval(()=>{frame=(frame+1)%scene().dur;show()},1000/F.fps)}
$("scrub").oninput=()=>{frame=parseInt($("scrub").value,10);show()};$("prev").onclick=()=>seek(-1);$("next").onclick=()=>seek(1);$("play").onclick=togglePlay;
$("format").onchange=()=>{format=$("format").value;mount()};
$("apply").onclick=()=>{const l=layer();if(!l)return;let v;try{v=JSON.parse($("json").value)}catch(e){$("save").textContent="json: "+e.message;$("save").className="save err";return}post({op:"remove",addr:scene().id+"."+l.id}).then(()=>post({op:"add-layer",scene:scene().id,layer:v})).then(()=>select(v.id))};
$("dup").onclick=()=>{const l=layer();if(l)post({op:"dup",addr:scene().id+"."+l.id})};$("remove").onclick=()=>{const l=layer();if(l){post({op:"remove",addr:scene().id+"."+l.id});selected=null}};
$("layout").onclick=()=>post({op:"layout",scene:scene().id});
const newId=p=>{let i=1;while(scene().layers.some(l=>l.id===p+"-"+i))i++;return p+"-"+i};
$("addText").onclick=()=>{const id=newId("text");post({op:"add-layer",scene:scene().id,layer:{id,type:"text",text:"New line",size:72,color:scene().ground==="paper"?"ink":"paper",at:{x:0.5,y:0.5},in:{preset:"rise",at:0,dur:14}}}).then(()=>select(id))};
$("addShape").onclick=()=>{const id=newId("shape");post({op:"add-layer",scene:scene().id,layer:{id,type:"shape",shape:"line",w:220,thickness:6,fill:"accent",at:{x:0.5,y:0.6},in:{preset:"grow",at:0,dur:14}}}).then(()=>select(id))};
$("addCounter").onclick=()=>{const id=newId("counter");post({op:"add-layer",scene:scene().id,layer:{id,type:"counter",from:0,to:100,size:200,color:scene().ground==="paper"?"ink":"paper",at:{x:0.5,y:0.45},in:{preset:"pop",at:0,dur:14}}}).then(()=>select(id))};
$("addList").onclick=()=>{const id=newId("list");post({op:"add-layer",scene:scene().id,layer:{id,type:"list",items:["one","two","three"],marker:"dot",size:52,color:scene().ground==="paper"?"ink":"paper",at:{x:0.5,y:0.5},in:{preset:"rise",at:0,dur:14,stagger:{by:"item",each:6}}}}).then(()=>select(id))};
function onKey(e){const tag=e.target&&e.target.tagName;if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"){if(e.key==="Escape")e.target.blur();return}
  const k=e.key,c=e.shiftKey?0.02:0.005;
  if(k==="ArrowLeft"){e.preventDefault();nudge(-c,0)}else if(k==="ArrowRight"){e.preventDefault();nudge(c,0)}else if(k==="ArrowUp"){e.preventDefault();nudge(0,-c)}else if(k==="ArrowDown"){e.preventDefault();nudge(0,c)}
  else if(k==="[")shiftIn(-2);else if(k==="]")shiftIn(2);else if(k==="-")resize(-4);else if(k==="=")resize(4);
  else if(k===",")seek(-1);else if(k===".")seek(1);else if(k==="j")seek(-F.fps);else if(k==="l")seek(F.fps);else if(k===" "){e.preventDefault();togglePlay()}
  else if(k==="d"){const l=layer();if(l)post({op:"dup",addr:scene().id+"."+l.id})}
  else if(k==="Backspace"||k==="Delete"){const l=layer();if(l){post({op:"remove",addr:scene().id+"."+l.id});selected=null}}
  else if(k==="z"){const p=undo.pop();if(p)post({op:"replace",film:JSON.parse(p)})}
  else if(k==="Escape"){selected=null;injectStyle();render()}}
document.addEventListener("keydown",onKey);
window.addEventListener("resize",()=>F&&fitStage());
window.mhEdit={state,select:(addr)=>{const [s,l]=addr.split(".");if(s!==sceneId){sceneId=s;frame=0}select(l);return show()},set:(addr,value)=>post({op:"set",addr,value}),op:post,frame:(n)=>{frame=n;return show()},play:togglePlay,reload:async()=>{await load();await mount()}};
(async()=>{await load();const fs=$("format");Object.keys(F.formats).forEach(f=>{const o=document.createElement("option");o.value=f;o.textContent=f;fs.appendChild(o)});fs.value=format;await new Promise(r=>{if(stage.contentWindow&&stage.contentWindow.__mh)r();else stage.addEventListener("load",r,{once:true})});await stageReady();await mount();})();
</script></body></html>`;
