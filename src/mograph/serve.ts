/**
 * The editor: the film's data with hands, in a browser. The native engine's
 * host page renders any frame of the film on a stage; this page wraps it with a
 * scrubber, a timeline strip, a layer list, an inspector and a keyboard, and
 * every change is written to film.mograph.json at once, linted, and re-rendered
 * without a reload (the stage is remounted with the new data as input props). A
 * computer-use agent gets labels on everything, a text read-back of the whole
 * state (#mh-state, window.mhEdit.state()) and a keyboard path for each gesture.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoadedConfig } from "../config.ts";
import { compile } from "../timeline/schema.ts";
import { timelineJson } from "../timeline/docs.ts";
import { mographTimeline } from "./timeline.ts";
import type { Keyframe, Layer, MgFilm, TrackProp } from "./schema.ts";
import { loadFilm, saveFilm, setValue, unsetValue, setKey, unsetKey, addLayer, addScene, remove, move, duplicate, rename, lintFilm, autoLayout, resolveAddress, type MgFinding } from "./edit.ts";

type Op =
  | { op: "set"; addr: string; value: unknown }
  | { op: "unset"; addr: string }
  | { op: "key"; addr: string; at: number; v: number; ease?: string }
  | { op: "unkey"; addr: string; at: number }
  | { op: "move-key"; addr: string; from: number; to: number }
  | { op: "add-layer"; scene: string; layer: Record<string, unknown>; after?: string; before?: string }
  | { op: "add-scene"; scene: Record<string, unknown>; after?: string; before?: string }
  | { op: "remove"; addr: string }
  | { op: "move"; addr: string; after?: string; before?: string }
  | { op: "dup"; addr: string; as?: string }
  | { op: "rename"; addr: string; id: string }
  | { op: "layout"; scene?: string }
  | { op: "batch"; ops: Op[]; name?: string }
  | { op: "replace"; film: MgFilm };

type Nested = Layer & { layers?: Layer[] };

/**
 * A layer inside a group is addressed `scene.group.child.prop`; edit.ts digs
 * plain properties, so the address is rewritten to the index path it can dig
 * (`scene.group.layers.0.prop`). A normal address comes back unchanged.
 */
export const resolveNested = (film: MgFilm, addr: string): string => {
  const p = addr.split(".");
  if (p.length < 3) return addr;
  const scene = film.scenes.find((s) => s.id === p[0]);
  if (!scene) return addr;
  let layer = scene.layers.find((l) => l.id === p[1]) as Nested | undefined;
  if (!layer) return addr;
  const out = [p[0], p[1]];
  let i = 2;
  while (i < p.length && Array.isArray(layer?.layers)) {
    const j = layer!.layers!.findIndex((c) => c.id === p[i]);
    if (j < 0) break;
    out.push("layers", String(j));
    layer = layer!.layers![j] as Nested;
    i++;
  }
  return [...out, ...p.slice(i)].join(".");
};

/** the keyframes of a track, whatever the address depth */
const keysOf = (film: MgFilm, addr: string): Keyframe[] => {
  const t = resolveAddress(film, addr);
  if (t.kind !== "layer" || t.path.length !== 1) throw new Error("a keyframe address is scene.layer.prop");
  return t.layer!.tracks?.[t.path[0] as TrackProp] ?? [];
};

/**
 * The ops. Beyond what edit.ts offers the editor needs three things, built here
 * from the same functions: `batch` (many ops, one save and one undo step, what
 * align and a multi-selection nudge send), `move-key` (a keyframe dragged to
 * another frame keeps its value and its easing) and the nested addresses above.
 */
export const applyOp = (film: MgFilm, o: Op): MgFilm => {
  const addr = "addr" in o && typeof o.addr === "string" ? resolveNested(film, o.addr) : "";
  switch (o.op) {
    case "set":
      setValue(film, addr, o.value);
      return film;
    case "unset":
      unsetValue(film, addr);
      return film;
    case "key":
      setKey(film, addr, o.at, o.v, o.ease);
      return film;
    case "unkey":
      unsetKey(film, addr, o.at);
      return film;
    case "move-key": {
      const k = keysOf(film, addr).find((x) => x.at === o.from);
      if (!k) throw new Error(`no keyframe at ${o.from} on ${o.addr}`);
      unsetKey(film, addr, o.from);
      setKey(film, addr, o.to, k.v, k.ease);
      return film;
    }
    case "add-layer":
      addLayer(film, o.scene, o.layer as never, { after: o.after, before: o.before });
      return film;
    case "add-scene":
      addScene(film, o.scene as never, { after: o.after, before: o.before });
      return film;
    case "remove":
      // a group child is a member of its parent's layers array, not a scene layer
      if (/\.layers\.\d+$/.test(addr)) unsetValue(film, addr);
      else remove(film, addr);
      return film;
    case "move":
      move(film, addr, { after: o.after, before: o.before });
      return film;
    case "dup":
      duplicate(film, addr, o.as);
      return film;
    case "rename":
      rename(film, addr, o.id);
      return film;
    case "layout":
      autoLayout(film, o.scene);
      return film;
    case "batch": {
      let f = film;
      for (const x of o.ops) f = applyOp(f, x);
      return f;
    }
    case "replace":
      return o.film;
  }
};

const BODY_CAP = 4 * 1024 * 1024;
const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > BODY_CAP) {
        reject(new Error(`body over ${BODY_CAP} bytes`));
        req.destroy();
      }
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });

/** only a page served by this server may write: same origin (or no origin, the CLI) and a JSON body */
const allowedWrite = (req: IncomingMessage): string | null => {
  const ct = String(req.headers["content-type"] ?? "");
  if (!ct.includes("application/json")) return "the body must be application/json";
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host && !origin.endsWith(`//${host}`)) return `origin ${origin} may not write here`;
  return null;
};

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

/** what the log line for an op says */
export const opLabel = (o: Op): string =>
  o.op === "batch"
    ? `batch ${o.name ?? ""}(${o.ops.length})`
    : `${o.op}${"addr" in o && typeof o.addr === "string" ? ` ${o.addr}` : "scene" in o && typeof o.scene === "string" ? ` ${o.scene}` : ""}${"value" in o ? ` = ${JSON.stringify(o.value)}` : ""}`;

export type EditServer = { film: () => MgFilm; findings: () => MgFinding[]; log: string[] };

/** GET /__mh/film (the film, its compiled timeline), POST /__mh/film (an op), GET /__mh/edit (the page) */
export const editMiddleware = (cfg: LoadedConfig, filmName: string, filmPath: string, opts: { log?: (s: string) => void } = {}): { handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>; state: EditServer } => {
  const log = opts.log ?? (() => {});
  let film = loadFilm(filmPath);
  let findings = lintFilm(film, cfg.projectDir);
  const history: string[] = [];
  const snapshot = () => ({ film, timeline: JSON.parse(timelineJson(compile(mographTimeline(film, { film: filmName })))), findings, path: filmPath, name: filmName, formats: film.formats, fps: film.fps, ops: history.length });
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/__mh/edit" || url === "/__mh/edit/") {
      res.setHeader("Content-Type", "text/html");
      // the page is generated: a browser must never keep yesterday's editor
      res.setHeader("Cache-Control", "no-store");
      res.end(editorPage({ title: `${film.title} (${filmName})` }));
      return;
    }
    if (url !== "/__mh/film") return next();
    if (req.method === "GET") return json(res, 200, snapshot());
    if (req.method === "POST") {
      const refused = allowedWrite(req);
      if (refused) return json(res, 403, { ok: false, error: refused });
      try {
        const body = JSON.parse(await readBody(req)) as Op & { force?: boolean };
        const before = JSON.stringify(film);
        // apply, lint and save into locals: a bad op leaves the served film untouched
        const candidate = applyOp(JSON.parse(before) as MgFilm, body);
        if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.scenes)) throw new Error("the op did not produce a film");
        const nextFindings = lintFilm(candidate, cfg.projectDir);
        const errors = nextFindings.filter((f) => f.level === "error");
        if (errors.length && !body.force) return json(res, 422, { ok: false, error: `${errors.length} lint error${errors.length === 1 ? "" : "s"}; nothing saved (pass force to save anyway)`, findings: nextFindings });
        saveFilm(filmPath, candidate);
        film = candidate;
        findings = nextFindings;
        history.push(before);
        while (history.length > 100 || history.reduce((n, h) => n + h.length, 0) > 32 * 1024 * 1024) history.shift();
        log(`${opLabel(body)}  (${errors.length} errors)`);
        return json(res, 200, { ok: true, ...snapshot() });
      } catch (e) {
        return json(res, 400, { ok: false, error: String((e as Error).message ?? e) });
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
  .view{flex:1;min-height:200px;display:flex;gap:10px;align-items:center;justify-content:space-evenly}
  .pane{position:relative;flex:0 0 auto;background:#111;border-radius:8px;overflow:hidden}
  .pane[hidden]{display:none}
  .pane.act{outline:2px solid var(--acc)}
  .pane .tag{position:absolute;left:6px;top:6px;z-index:2;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:1px 6px;border-radius:4px}
  @media (max-width:900px){main{display:block;overflow:auto}aside{border-left:0;border-top:1px solid var(--line);overflow:visible}.stage{overflow:visible}.view{flex:0 0 auto;height:34vh}}
  .pane iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;background:#000}
  .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .bar button,.bar select,.bar input,aside button,aside select,aside input,aside textarea{font:inherit}
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
  .grid label{color:#555}.grid input,.grid select,.grid textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:4px 6px}
  textarea{width:100%;box-sizing:border-box;min-height:120px;border:1px solid var(--line);border-radius:6px;padding:6px;font:12px/1.4 ui-monospace,Menlo,monospace}
  .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .row button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer}
  .row button.primary{background:var(--acc);border-color:var(--acc);font-weight:600}
  .findings{margin:0;padding:0;list-style:none;font-size:12px}.findings li{padding:2px 0}.findings .error{color:var(--err)}.findings .warn{color:var(--warn)}
  pre{margin:0;max-height:220px;overflow:auto;background:#faf8f1;border:1px solid var(--line);border-radius:6px;padding:8px;font-size:11px;white-space:pre-wrap}
  .sr{position:absolute;left:-9999px}
  .strip{position:relative;border:1px solid var(--line);background:var(--card);border-radius:8px;max-height:210px;overflow:auto}
  .strip .head,.strip .row2{display:grid;grid-template-columns:132px minmax(0,1fr);align-items:stretch}
  .strip .head{position:sticky;top:0;z-index:3;background:var(--card);border-bottom:1px solid var(--line)}
  .strip .head .name{color:#666;font-size:11px;padding:2px 6px;font-family:inherit}
  .strip .ruler{position:relative;height:18px}
  .strip .ruler i{position:absolute;top:0;bottom:0;border-left:1px solid var(--line);padding-left:3px;font-size:10px;color:#999;font-style:normal}
  .strip .name{font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;background:none;border:0;text-align:left;color:var(--ink)}
  .strip .row2.sel .name{background:#fdf1cf;font-weight:600}
  .strip .track{position:relative;height:22px;border-top:1px solid #f4f1e9;cursor:crosshair}
  .strip .lbar{position:absolute;top:3px;height:16px;background:#cfc9b8;border-radius:4px;cursor:grab;min-width:5px;border:0;padding:0}
  .strip .row2.sel .lbar{background:var(--acc)}
  .strip .seg{position:absolute;top:0;bottom:0;background:rgba(255,255,255,.6);pointer-events:none}
  .strip .seg.o{border-radius:0 4px 4px 0}.strip .seg.i{border-radius:4px 0 0 4px}
  .strip .edge{position:absolute;top:1px;height:20px;width:11px;margin-left:-11px;background:transparent;border:0;padding:0;cursor:ew-resize}
  .strip .edge::after{content:"";position:absolute;right:2px;top:3px;width:2px;height:16px;background:#6f6a5c;border-radius:1px}
  .strip .kf{position:absolute;top:6px;width:9px;height:9px;margin-left:-5px;background:#fff;border:1.5px solid var(--ink);transform:rotate(45deg);padding:0;cursor:ew-resize;border-radius:1px}
  .strip .kf.sel{background:var(--acc)}
  .strip .phWrap{position:absolute;left:132px;right:0;top:0;bottom:0;pointer-events:none;z-index:2}
  .strip .ph{position:absolute;top:0;bottom:0;width:1px;background:var(--err)}
  .strip .ph::before{content:"";position:absolute;left:-4px;top:0;border:4px solid transparent;border-top-color:var(--err)}
  :focus-visible{outline:2px solid #1f6feb;outline-offset:1px}
  .strip .kf:focus-visible{outline-offset:2px}
  .ctl{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .ctl input[type=text],.ctl input[type=number]{flex:1;min-width:78px;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:4px 6px}
  .ctl button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
  .sw{width:20px;height:20px;border:1px solid rgba(0,0,0,.25);border-radius:5px;padding:0;cursor:pointer}
  .sw.on{outline:2px solid var(--ink);outline-offset:1px}
  .grad{grid-column:1/-1;display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;padding:4px 0 6px;border-bottom:1px dashed var(--line)}
  .gradPrev{grid-column:1/-1;height:14px;border-radius:4px;border:1px solid var(--line)}
  .sub{grid-column:1/-1;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
</style></head><body>
<header><h1 id="title">${esc(o.title)}</h1><span class="meta" id="path"></span><span class="save" id="save" aria-live="polite">loaded</span></header>
<main>
  <section class="stage" aria-label="Stage">
    <div class="bar">
      <label>Format <select id="format" aria-label="Format"></select></label>
      <label><input type="checkbox" id="fmtOnly" aria-label="Edit this format only: writes go to formats.&lt;format&gt; instead of the layer"> edit this format only</label>
      <div class="scenes" id="scenes" role="group" aria-label="Scenes"></div>
    </div>
    <div class="view" id="view"></div>
    <div class="bar">
      <button id="play" type="button" aria-pressed="false" aria-label="Play or pause">play</button>
      <button id="prev" type="button" aria-label="One frame back">&lt;</button>
      <input id="scrub" type="range" min="0" max="1" value="0" step="1" aria-label="Frame">
      <button id="next" type="button" aria-label="One frame forward">&gt;</button>
      <span class="loc" id="loc" aria-live="off"></span>
    </div>
    <div class="strip" id="strip" aria-label="Timeline of the current scene"></div>
    <div class="keys"><kbd>click</kbd> select <kbd>arrows</kbd> nudge (<kbd>shift</kbd> coarse) <kbd>[</kbd> <kbd>]</kbd> in earlier/later <kbd>{</kbd> <kbd>}</kbd> out earlier/later <kbd>-</kbd> <kbd>=</kbd> smaller/larger <kbd>,</kbd> <kbd>.</kbd> frame <kbd>j</kbd> <kbd>l</kbd> second <kbd>space</kbd> play <kbd>d</kbd> duplicate <kbd>Backspace</kbd> remove <kbd>z</kbd> undo <kbd>Esc</kbd> deselect. In the strip: <kbd>tab</kbd> to a bar, edge or keyframe, then <kbd>arrows</kbd> move it.</div>
  </section>
  <aside aria-label="Layers and inspector">
    <section><h2>Layers</h2><ul class="layers" id="layers" role="listbox" aria-label="Layers of the current scene"></ul>
      <div class="row"><button type="button" id="addText" aria-label="Add a text layer">+ text</button><button type="button" id="addShape" aria-label="Add a shape layer">+ shape</button><button type="button" id="addCounter" aria-label="Add a counter layer">+ counter</button><button type="button" id="addList" aria-label="Add a list layer">+ list</button><button type="button" id="addGroup" aria-label="Add a group with one child">+ group</button><button type="button" id="layout" aria-label="Lay the scene out: push stacked blocks apart">layout</button></div></section>
    <section><h2 id="selHead">Selection</h2><div class="loc" id="selList">none</div>
      <div class="row" role="group" aria-label="Align the selection"><button type="button" id="al-left" aria-label="Align left">left</button><button type="button" id="al-centre" aria-label="Align centre">centre</button><button type="button" id="al-right" aria-label="Align right">right</button><button type="button" id="al-top" aria-label="Align top">top</button><button type="button" id="al-middle" aria-label="Align middle">middle</button><button type="button" id="al-bottom" aria-label="Align bottom">bottom</button></div>
      <div class="row" role="group" aria-label="Distribute the selection"><button type="button" id="al-dist-h" aria-label="Distribute horizontally">distribute across</button><button type="button" id="al-dist-v" aria-label="Distribute vertically">distribute down</button><button type="button" id="selAll" aria-label="Select every layer of the scene">all</button><button type="button" id="selClear" aria-label="Clear the selection">none</button></div></section>
    <section><h2>Scene</h2><div class="grid" id="sceneForm"></div></section>
    <section><h2 id="selTitle">Layer</h2><div class="grid" id="quick"></div>
      <label class="sr" for="json">Layer as JSON</label><textarea id="json" spellcheck="false" placeholder="select a layer"></textarea>
      <div class="row"><button type="button" class="primary" id="apply" aria-label="Apply the layer JSON">Apply JSON</button><button type="button" id="dup" aria-label="Duplicate the selected layer">duplicate</button><button type="button" id="remove" aria-label="Remove the selected layers">remove</button></div></section>
    <section><h2>History</h2><div class="row"><button type="button" id="undoBtn" aria-label="Undo the last change">undo</button><button type="button" id="redoBtn" aria-label="Redo the change that was undone">redo</button><span class="keys" id="histCount"></span></div>
      <ul class="findings" id="history" aria-label="The changes made in this session, newest first"></ul></section>
    <section><h2>Lint</h2><ul class="findings" id="findings" aria-live="polite"></ul></section>
    <section><h2>State (also window.mhEdit.state())</h2><pre id="mh-state" aria-live="polite"></pre></section>
  </aside>
</main>
<datalist id="mh-tokens"></datalist>
<script>
const $=id=>document.getElementById(id);
const TRACKS=["opacity","x","y","scale","rotate","blur","progress","wipe","w","h"];
let F=null,T=null,findings=[],format=null,sceneId=null,frame=0,sel=[],playing=null,comps=[],undo=[],redo=[],hist=[],busy=Promise.resolve(),lastFocus=null,kfSel=null,formatOnly=false;
const stages=[];
const fmt=s=>{const m=Math.floor(s/60),r=s-m*60;return (m?m+":":"")+r.toFixed(2)+"s"};
const scene=()=>F.scenes.find(s=>s.id===sceneId)||F.scenes[0];
const tScene=()=>T.scenes.find(s=>s.id===scene().id);
const clampF=n=>Math.max(0,Math.min(scene().dur-1,n));

/* ---------- the layers of the scene, groups and all ---------- */
function rows(){const out=[];const walk=(list,prefix,depth)=>{(list||[]).forEach(l=>{const path=prefix?prefix+"."+l.id:l.id;out.push({l:l,path:path,depth:depth});if(Array.isArray(l.layers))walk(l.layers,path,depth+1)})};walk(scene().layers,"",0);return out}
function layerAt(path){if(!path)return null;const p=path.split(".");let list=scene().layers,l=null;for(let i=0;i<p.length;i++){if(!Array.isArray(list))return null;l=list.find(x=>x.id===p[i]);if(!l)return null;list=l.layers}return l}
function parentOf(path){const p=path.split(".");return p.length>1?layerAt(p.slice(0,-1).join(".")):null}
const layer=()=>sel.length?layerAt(sel[0]):null;
const addrOf=(path,prop)=>scene().id+"."+path+(prop?"."+prop:"");
const baseFormat=()=>Object.keys(F.formats)[0];
/** the layer as the active format shows it: its per format overrides merged over it, one level deep like layerFor */
function viewLayer(path){const l=layerAt(path);if(!l)return null;const o=l.formats&&l.formats[format];if(!o)return l;const out=Object.assign({},l);Object.keys(o).forEach(k=>{const cur=out[k],v=o[k];out[k]=cur&&typeof cur==="object"&&!Array.isArray(cur)&&v&&typeof v==="object"&&!Array.isArray(v)?Object.assign({},cur,v):v});return out}
/** where a value is written: the layer itself, or this format's override when "edit this format only" is on */
function writeAddr(path,prop){return formatOnly&&format!==baseFormat()?addrOf(path,"formats."+format+(prop?"."+prop:"")):addrOf(path,prop)}

/* ---------- timing, the same rules layerTiming applies ---------- */
function localFrame(at,dur,fb){const v=at===undefined||at===null?fb:at;return v<0?Math.max(0,dur+v):Math.min(dur-1,v)}
function timingOf(path){const l=layerAt(path);const s=scene();if(!l)return {inAt:0,inDur:0,outAt:null,outDur:0,end:s.dur};
  const dIn=Object.assign({preset:"rise",at:0,dur:14},(F.defaults&&F.defaults.layerIn)||{},l.in||{});
  const from=(l.span&&l.span[0])||0,to=(l.span&&l.span[1])!==undefined?l.span[1]:s.dur;
  let base=0;const p=path.split(".");if(p.length>1)base=timingOf(p.slice(0,-1).join(".")).inAt;
  const inAt=base+from+localFrame(dIn.at,to-from,0);
  const inDur=dIn.preset==="cut"?0:Math.max(0,dIn.dur===undefined?14:dIn.dur);
  const hasOut=!!l.out||!!(F.defaults&&F.defaults.layerOut);
  const dOut=Object.assign({preset:"fade",dur:8},(F.defaults&&F.defaults.layerOut)||{},l.out||{});
  const outDur=dOut.preset==="cut"?0:Math.max(0,dOut.dur===undefined?8:dOut.dur);
  const outAt=hasOut?base+from+localFrame(dOut.at===undefined?-outDur:dOut.at,to-from,to-from-outDur):null;
  return {inAt:inAt,inDur:inDur,outAt:outAt,outDur:outDur,end:outAt!==null?Math.min(s.dur,outAt+outDur):s.dur}}

/* ---------- load, stages ---------- */
async function load(){const r=await fetch("/__mh/film");const j=await r.json();F=j.film;T=j.timeline;findings=j.findings;$("path").textContent=j.path;if(!format)format=Object.keys(F.formats)[0];if(!sceneId||!F.scenes.some(s=>s.id===sceneId))sceneId=F.scenes[0].id}
/** one stage per format the pane can show: two side by side when there is room, one otherwise */
function buildStages(){const view=$("view");view.innerHTML="";stages.length=0;const fs=Object.keys(F.formats);
  const n=Math.min(2,fs.length);
  for(let i=0;i<n;i++){const pane=document.createElement("div");pane.className="pane";pane.id="pane-"+i;
    const tag=document.createElement("button");tag.type="button";tag.className="tag";tag.id="tag-"+i;tag.textContent=fs[i];
    const f=document.createElement("iframe");f.id="stage-"+i;f.title="The film at the current frame";f.src="/__mh/";
    pane.append(tag,f);view.appendChild(pane);const st={pane:pane,tag:tag,iframe:f,win:null,compId:null,format:fs[i],style:null};
    tag.onclick=()=>{if(st.format&&st.format!==format){format=st.format;layoutPanes();mount()}};
    stages.push(st)}
  layoutPanes()}
const wantSplit=()=>window.innerWidth>1300&&Object.keys(F.formats).length>1;
/** which pane shows which format, and which one the inspector speaks for */
function layoutPanes(){const fs=Object.keys(F.formats);const split=wantSplit();
  stages[0].format=split?fs[0]:format;
  if(stages[1]){stages[1].pane.hidden=!split;stages[1].format=split?(format!==fs[0]?format:fs[1]):null}
  stages.forEach(st=>{st.pane.classList.toggle("act",!st.pane.hidden&&st.format===format);st.tag.textContent=st.format||"";st.tag.setAttribute("aria-label","Make "+(st.format||"")+" the format the inspector edits")});
  $("format").value=format}
async function stageReady(st){st.win=st.iframe.contentWindow;await st.win.__mh.ready;if(!comps.length)comps=st.win.__mh.compositions()}
function compFor(fmtName){const s=F.formats[fmtName];return (comps.find(c=>c.width===s.width&&c.height===s.height)||comps[0]).id}
async function mount(){for(const st of stages){if(st.pane.hidden||!st.format)continue;st.compId=compFor(st.format);await st.win.__mh.select(st.compId,{film:F,format:st.format});wireStage(st)}fitStages();await show()}
async function remount(){for(const st of stages){if(st.pane.hidden||!st.win||!st.format)continue;await st.win.__mh.select(st.compId,{film:F,format:st.format});wireStage(st)}}
/** each pane is exactly the film's shape at the largest scale that fits the view */
function fitStages(){const box=$("view").getBoundingClientRect();const vis=stages.filter(st=>!st.pane.hidden&&st.format);if(!vis.length)return;
  const avail=(box.width-10*(vis.length-1))/vis.length;
  vis.forEach(st=>{const s=F.formats[st.format];const k=Math.min(avail/s.width,box.height/s.height);
    st.pane.style.width=Math.round(s.width*k)+"px";st.pane.style.height=Math.round(s.height*k)+"px";
    const f=st.iframe;f.style.width=s.width+"px";f.style.height=s.height+"px";f.style.transform="scale("+k+")";f.style.left="0px";f.style.top="0px"})}
function wireStage(st){const d=st.iframe.contentDocument;let style=d.getElementById("mh-edit-style");
  if(!style){style=d.createElement("style");style.id="mh-edit-style";d.head.appendChild(style);
    d.addEventListener("click",e=>{if(st.format&&st.format!==format){format=st.format;layoutPanes()}
      const el=e.target.closest&&e.target.closest("[data-mg]");if(!el){if(!e.shiftKey){sel=[];paint();render()}return}
      const parts=el.dataset.mg.split(".");if(parts[0]!==sceneId&&F.scenes.some(s=>s.id===parts[0])){sceneId=parts[0];frame=0}
      const path=pathFromMg(el.dataset.mg);pick(path,e.shiftKey)});
    d.addEventListener("keydown",onKey)}
  st.style=style;paintStage(st)}
function pathFromMg(mg){const parts=mg.split(".");const direct=parts.slice(1).join(".");if(layerAt(direct))return direct;const last=parts[parts.length-1];const hit=rows().find(r=>r.l.id===last);return hit?hit.path:direct}
function paintStage(st){if(!st.style)return;st.style.textContent=sel.map(p=>'[data-mg="'+scene().id+"."+p.split(".").pop()+'"]{outline:3px solid #F2B441;outline-offset:6px}').join("\\n")}
function paint(){stages.forEach(paintStage)}

async function show(){const ts=tScene();const abs=ts.start+clampF(frame);for(const st of stages){if(st.pane.hidden||!st.win)continue;await st.win.__mh.frame(abs,0)}render()}
function locate(){const ts=tScene();const local=frame;const ev=ts.events.filter(e=>e.local<=local).sort((a,b)=>b.local-a.local)[0];return {scene:ts.id,local:local,filmFrame:ts.filmStart+local,seconds:(ts.filmStart+local)/F.fps,event:ev?ev.name+"+"+(local-ev.local):null}}

/* ---------- render ---------- */
function render(){const L=locate();const s=scene();$("scrub").max=s.dur-1;$("scrub").value=frame;$("loc").textContent=s.id+"+"+frame+"  film f"+L.filmFrame+" "+fmt(L.seconds)+(L.event?"  after "+L.event:"");
  const sc=$("scenes");sc.innerHTML="";F.scenes.forEach(x=>{const b=document.createElement("button");b.type="button";b.textContent=x.id+" "+x.dur+"f";b.className=x.id===s.id?"cur":"";b.setAttribute("aria-label","Scene "+x.id+", "+x.dur+" frames");b.setAttribute("aria-current",x.id===s.id?"true":"false");b.onclick=()=>{sceneId=x.id;frame=0;sel=[];paint();show()};sc.appendChild(b)});
  $("selHead").textContent="Selection"+(sel.length?" ("+sel.length+")":"");
  ["left","centre","right","top","middle","bottom","dist-h","dist-v"].forEach(m=>{$("al-"+m).disabled=sel.length<2});
  $("selList").textContent=sel.length?sel.map(p=>s.id+"."+p).join("  "):"none";
  drawLayers();drawStrip();sceneForm();inspector();drawFindings();drawHistory();$("mh-state").textContent=JSON.stringify(state(),null,1);
  if(stages.length)fitStages();
  if(lastFocus&&(document.activeElement===document.body||document.activeElement===null)){const el=document.querySelector('[data-fk="'+lastFocus+'"]');if(el)el.focus()}}
function drawLayers(){const ul=$("layers");ul.innerHTML="";rows().forEach(r=>{const li=document.createElement("li");li.setAttribute("role","option");li.setAttribute("aria-selected",sel.indexOf(r.path)>=0?"true":"false");li.tabIndex=0;li.dataset.fk="li:"+r.path;li.style.paddingLeft=(6+r.depth*14)+"px";
  const t=timingOf(r.path);
  li.innerHTML='<span class="t">'+r.l.type+'</span><span class="a">'+scene().id+"."+r.path+'</span><span style="color:#888;font-size:11px;margin-left:auto">in @'+t.inAt+"</span>";
  li.setAttribute("aria-label","Layer "+scene().id+"."+r.path+", "+r.l.type+", in at "+t.inAt);
  li.onclick=e=>pick(r.path,e.shiftKey);li.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick(r.path,e.shiftKey)}};ul.appendChild(li)})}

function drawStrip(){const s=scene(),el=$("strip"),dur=s.dur;el.innerHTML="";
  const head=document.createElement("div");head.className="head";
  const hn=document.createElement("div");hn.className="name";hn.textContent=s.id+"  "+dur+"f";
  const ruler=document.createElement("div");ruler.className="ruler";
  const step=dur>240?60:dur>120?30:dur>60?15:10;
  for(let f=0;f<dur;f+=step){const i=document.createElement("i");i.style.left=(f/dur*100)+"%";i.textContent=f;ruler.appendChild(i)}
  head.append(hn,ruler);el.appendChild(head);
  rows().forEach(r=>{const t=timingOf(r.path);const row=document.createElement("div");row.className="row2"+(sel.indexOf(r.path)>=0?" sel":"");
    const nm=document.createElement("button");nm.type="button";nm.className="name";nm.style.paddingLeft=(6+r.depth*12)+"px";nm.textContent=(r.depth?"\\u2514 ":"")+r.path.split(".").pop();nm.setAttribute("aria-label","Select layer "+scene().id+"."+r.path);nm.dataset.fk="name:"+r.path;nm.onclick=e=>pick(r.path,e.shiftKey);
    const track=document.createElement("div");track.className="track";track.dataset.path=r.path;
    track.onpointerdown=e=>{if(e.target!==track)return;const box=track.getBoundingClientRect();frame=clampF(Math.round((e.clientX-box.left)/box.width*dur));show()};
    const end=t.end;const bar=document.createElement("button");bar.type="button";bar.className="lbar";bar.dataset.path=r.path;bar.dataset.fk="bar:"+r.path;
    bar.style.left=(t.inAt/dur*100)+"%";bar.style.width=(Math.max(1,end-t.inAt)/dur*100)+"%";
    bar.setAttribute("aria-label","Layer "+r.path+", in at "+t.inAt+(t.outAt!==null?", out at "+t.outAt:", to the end of the scene")+". Arrow keys move it, shift for five frames");
    const segI=document.createElement("span");segI.className="seg i";segI.style.left="0";segI.style.width=(t.inDur/Math.max(1,end-t.inAt)*100)+"%";bar.appendChild(segI);
    if(t.outAt!==null){const segO=document.createElement("span");segO.className="seg o";segO.style.right="0";segO.style.width=(t.outDur/Math.max(1,end-t.inAt)*100)+"%";bar.appendChild(segO)}
    bar.onpointerdown=e=>startDrag(e,"bar",r.path,track,bar);
    bar.onclick=e=>{if(bar.dataset.moved==="1"){bar.dataset.moved="";return}pick(r.path,e.shiftKey)};
    bar.onkeydown=e=>barKeys(e,r.path,"in");
    track.appendChild(bar);
    const edge=document.createElement("button");edge.type="button";edge.className="edge";edge.dataset.fk="edge:"+r.path;edge.style.left=(end/dur*100)+"%";
    edge.setAttribute("aria-label","Out edge of "+r.path+(t.outAt!==null?" at "+t.outAt:" (no out yet)")+". Arrow keys move it");
    edge.onpointerdown=e=>startDrag(e,"edge",r.path,track,edge);edge.onkeydown=e=>barKeys(e,r.path,"out");
    track.appendChild(edge);
    const tr=r.l.tracks||{};Object.keys(tr).forEach(prop=>{(tr[prop]||[]).forEach(k=>{const d=document.createElement("button");d.type="button";d.className="kf"+(kfSel&&kfSel.path===r.path&&kfSel.prop===prop&&kfSel.at===k.at?" sel":"");d.style.left=(k.at/dur*100)+"%";d.dataset.fk="kf:"+r.path+":"+prop+":"+k.at;
      d.setAttribute("aria-label","Keyframe "+prop+" = "+k.v+" at frame "+k.at+" on "+r.path+". Arrow keys move it");
      d.onpointerdown=e=>startDrag(e,"kf",r.path,track,d,{prop:prop,at:k.at});
      d.onclick=e=>{e.stopPropagation();kfSel={path:r.path,prop:prop,at:k.at};pick(r.path,false)};
      d.onkeydown=e=>kfKeys(e,r.path,prop,k.at);track.appendChild(d)})});
    row.append(nm,track);el.appendChild(row)});
  const w=document.createElement("div");w.className="phWrap";const ph=document.createElement("div");ph.className="ph";ph.style.left=(frame/dur*100)+"%";w.appendChild(ph);el.appendChild(w)}

/* ---------- dragging in the strip ---------- */
function startDrag(e,kind,path,track,el,extra){e.preventDefault();e.stopPropagation();const box=track.getBoundingClientRect();const dur=scene().dur;const x0=e.clientX;const t=timingOf(path);const left0=parseFloat(el.style.left);let d=0;
  const mv=ev=>{d=Math.round((ev.clientX-x0)/box.width*dur);if(!d)return;el.dataset.moved="1";
    if(kind==="bar")el.style.left=((t.inAt+d)/dur*100)+"%";
    else if(kind==="edge")el.style.left=(Math.max(0,(t.end+d))/dur*100)+"%";
    else el.style.left=(left0+d/dur*100)+"%"};
  const up=()=>{window.removeEventListener("pointermove",mv);window.removeEventListener("pointerup",up);if(!d){render();return}
    if(kind==="bar")shiftIn(d,[path]);
    else if(kind==="edge")setOutAt(path,t.outAt===null?Math.max(t.inAt+t.inDur,t.end+d-t.outDur):t.outAt+d);
    else post({op:"move-key",addr:addrOf(path,extra.prop),from:extra.at,to:Math.max(0,extra.at+d)},"move-key "+extra.prop).then(()=>{kfSel={path:path,prop:extra.prop,at:Math.max(0,extra.at+d)};render()})};
  window.addEventListener("pointermove",mv);window.addEventListener("pointerup",up)}
function barKeys(e,path,which){const d=e.key==="ArrowLeft"?-1:e.key==="ArrowRight"?1:0;if(!d)return;e.preventDefault();e.stopPropagation();const n=d*(e.shiftKey?5:1);
  if(which==="in")shiftIn(n,[path]);else{const t=timingOf(path);setOutAt(path,(t.outAt===null?Math.max(t.inAt+t.inDur,scene().dur-8):t.outAt)+n)}}
function kfKeys(e,path,prop,at){const d=e.key==="ArrowLeft"?-1:e.key==="ArrowRight"?1:0;if(!d)return;e.preventDefault();e.stopPropagation();const to=Math.max(0,at+d*(e.shiftKey?5:1));lastFocus="kf:"+path+":"+prop+":"+to;post({op:"move-key",addr:addrOf(path,prop),from:at,to:to},"move-key "+prop).then(()=>{kfSel={path:path,prop:prop,at:to};render()})}

/* ---------- ops, undo and redo ---------- */
function flash(msg,err){$("save").textContent=msg;$("save").className="save"+(err?" err":"")}
async function post(opOrFn,name,mode){busy=busy.then(async()=>{const op=typeof opOrFn==="function"?opOrFn():opOrFn;if(!op)return;const prev=JSON.stringify(F);$("save").textContent="saving";
  const r=await fetch("/__mh/film",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(op)});const j=await r.json();
  if(!j.ok){$("save").textContent=j.error;$("save").className="save err";return}
  const label=name||op.op;
  if(mode==="undo"){redo.push({film:prev,name:label});hist.unshift("undo "+label)}
  else if(mode==="redo"){undo.push({film:prev,name:label});hist.unshift("redo "+label)}
  else{undo.push({film:prev,name:label});redo.length=0;hist.unshift(label)}
  if(hist.length>60)hist.pop();
  F=j.film;T=j.timeline;findings=j.findings;
  const errs=findings.filter(f=>f.level==="error").length;
  $("save").textContent="saved "+new Date().toLocaleTimeString()+(errs?" with errors":"");$("save").className="save"+(errs?" err":"");
  if(!F.scenes.some(s=>s.id===sceneId))sceneId=F.scenes[0].id;
  sel=sel.filter(p=>layerAt(p));
  await remount();paint();await show()});return busy}
function undoOnce(){const e=undo.pop();if(!e){flash("nothing to undo",true);return busy}return post({op:"replace",film:JSON.parse(e.film)},e.name,"undo")}
function redoOnce(){const e=redo.pop();if(!e){flash("nothing to redo",true);return busy}return post({op:"replace",film:JSON.parse(e.film)},e.name,"redo")}
function drawHistory(){const ul=$("history");ul.innerHTML="";hist.slice(0,12).forEach(h=>{const li=document.createElement("li");li.textContent=h;ul.appendChild(li)});if(!hist.length)ul.innerHTML="<li>nothing changed yet</li>";
  $("histCount").textContent=undo.length+" to undo, "+redo.length+" to redo"}
function shiftIn(d,paths){const ps=paths||sel;if(!ps.length)return;post(()=>{const ops=[];ps.forEach(p=>{const l=layerAt(p);if(!l)return;const cur=(l.in&&l.in.at)||0;const to=Math.max(0,cur+d);ops.push({op:"set",addr:addrOf(p,"in.at"),value:to});if(l.out&&l.out.at!==undefined)ops.push({op:"set",addr:addrOf(p,"out.at"),value:l.out.at+(to-cur)})});return ops.length===1?ops[0]:{op:"batch",ops:ops,name:"in.at"}},"in.at "+(d>0?"+":"")+d)}
function setOutAt(path,at){const l=layerAt(path);const ops=[{op:"set",addr:addrOf(path,"out.at"),value:Math.round(at)}];if(!l.out)ops.push({op:"set",addr:addrOf(path,"out.dur"),value:8});post(ops.length===1?ops[0]:{op:"batch",ops:ops,name:"out.at"},"out.at "+Math.round(at))}
function nudge(dx,dy){if(!sel.length)return;post(()=>{const ops=sel.map(p=>{const l=viewLayer(p);if(!l)return null;const at=l.at||{x:0.5,y:0.5};return {op:"set",addr:writeAddr(p,"at"),value:{x:Math.round((at.x+dx)*1000)/1000,y:Math.round((at.y+dy)*1000)/1000}}}).filter(Boolean);return ops.length===1?ops[0]:{op:"batch",ops:ops,name:"at"}},"nudge")}
function resize(d){if(!sel.length)return;post(()=>{const ops=sel.map(p=>{const l=layerAt(p);if(!l)return null;const cur=l.size||(l.type==="counter"?160:l.type==="list"?48:72);return {op:"set",addr:addrOf(p,"size"),value:Math.max(8,cur+d)}}).filter(Boolean);return ops.length===1?ops[0]:{op:"batch",ops:ops,name:"size"}},"size "+(d>0?"+":"")+d)}
function pick(path,add){if(add){const i=sel.indexOf(path);if(i>=0)sel.splice(i,1);else sel.push(path)}else sel=[path];kfSel=null;paint();render()}
/** every selected layer's at, written in one batch: one save, one undo step */
function alignSel(mode){if(sel.length<2){$("save").textContent="align needs two or more layers selected (shift-click)";$("save").className="save err";return}
  post(()=>{const items=sel.map(p=>{const at=((viewLayer(p)||{}).at)||{x:0.5,y:0.5};return {p:p,x:at.x,y:at.y}});
    const xs=items.map(i=>i.x),ys=items.map(i=>i.y);
    const minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs),minY=Math.min.apply(null,ys),maxY=Math.max.apply(null,ys);
    const r=n=>Math.round(n*1000)/1000;let next;
    if(mode==="dist-h"){const s=items.slice().sort((a,b)=>a.x-b.x);const step=(maxX-minX)/(s.length-1);next=i=>({x:r(minX+step*s.indexOf(i)),y:i.y})}
    else if(mode==="dist-v"){const s=items.slice().sort((a,b)=>a.y-b.y);const step=(maxY-minY)/(s.length-1);next=i=>({x:i.x,y:r(minY+step*s.indexOf(i))})}
    else{const v=mode==="left"?minX:mode==="right"?maxX:mode==="centre"?(minX+maxX)/2:mode==="top"?minY:mode==="bottom"?maxY:(minY+maxY)/2;
      const horiz=mode==="left"||mode==="right"||mode==="centre";next=i=>horiz?{x:r(v),y:i.y}:{x:i.x,y:r(v)}}
    return {op:"batch",name:mode,ops:items.map(i=>({op:"set",addr:writeAddr(i.p,"at"),value:next(i)}))}},"align "+mode)}
function seek(d){frame=clampF(frame+d);show()}
function togglePlay(){if(playing){clearInterval(playing);playing=null;$("play").setAttribute("aria-pressed","false");$("play").textContent="play";return}$("play").setAttribute("aria-pressed","true");$("play").textContent="pause";playing=setInterval(()=>{frame=(frame+1)%scene().dur;show()},1000/F.fps)}

/* ---------- controls: one labelled widget per kind of value ---------- */
const IN_PRESETS=["cut","fade","rise","drop","pop","slide","wipe","grow","blur","typewriter","mask"];
const OUT_PRESETS=["","cut","fade","sink","lift","shrink","slide","wipe","blur"];
const EASES=["","linear","in","out","inOut","expo","quart","back","anticipate","smooth","spring","soft","bouncy","snappy"];
const CAMERA_PRESETS=["","none","push","pull","pan","tilt","drift","orbit"];
const TRANSITIONS=["","cut","dissolve","dip","push-left","push-right","push-up","push-down","wipe-left","wipe-right","wipe-up","wipe-down","zoom","blur"];
const COLOR_KEY=/^(color|fill|stroke|accent|ground|markerColor|labelColor|background)$/i;
const NUM_KEY=["size","w","h","d","thickness","radius","gap","opacity","scale","rotate","letterSpacing","lineHeight","maxWidth","from","to","dur","labelSize","progress","weight","lines","count"];
function hexOf(ref){const d=F.design;if(ref===undefined||ref===null||ref==="")return d.ink;if(ref==="ink")return d.ink;if(ref==="paper")return d.paper;if(ref==="accent")return d.accent;if(ref==="muted")return d.muted||"#6B6B6B";if(ref==="white")return "#FFFFFF";if(ref==="black")return "#000000";if(ref==="transparent")return "transparent";if(d.colors&&Object.prototype.hasOwnProperty.call(d.colors,ref))return d.colors[ref];return typeof ref==="string"?ref:d.ink}
function tokens(){const d=F.design;return ["ink","paper","accent"].concat(d.muted?["muted"]:[]).concat(Object.keys(d.colors||{}))}
function gradCss(v){const stops=(v.gradient||[]).map(s=>hexOf(s)).join(", ");return v.radial?"radial-gradient(circle at "+((v.at&&v.at.x!==undefined?v.at.x:0.5)*100)+"% "+((v.at&&v.at.y!==undefined?v.at.y:0.5)*100)+"%, "+stops+")":"linear-gradient("+(v.angle===undefined?180:v.angle)+"deg, "+stops+")"}
function ctl(kind,value,label,onSet,choices){let i;
  if(kind==="select"){i=document.createElement("select");(choices||[]).forEach(o=>{const op=document.createElement("option");op.value=o;op.textContent=o===""?"(none)":o;if(o===value||(value===undefined&&o===""))op.selected=true;i.appendChild(op)});i.onchange=()=>onSet(i.value===""?undefined:i.value)}
  else if(kind==="bool"){i=document.createElement("input");i.type="checkbox";i.checked=!!value;i.onchange=()=>onSet(i.checked)}
  else if(kind==="num"){i=document.createElement("input");i.type="number";i.step="any";i.value=value===undefined||value===null?"":value;i.onchange=()=>onSet(i.value===""?undefined:parseFloat(i.value))}
  else if(kind==="json"){const long=JSON.stringify(value||null).length>70;i=document.createElement(long?"textarea":"input");if(!long)i.type="text";if(long)i.style.minHeight="70px";i.value=value===undefined?"":JSON.stringify(value);i.spellcheck=false;
    i.onchange=()=>{if(i.value.trim()===""){onSet(undefined);return}try{onSet(JSON.parse(i.value))}catch(e){$("save").textContent=label+": "+e.message;$("save").className="save err"}}}
  else{i=document.createElement("input");i.type="text";i.value=value===undefined||value===null?"":value;i.onchange=()=>onSet(i.value===""?undefined:i.value)}
  i.setAttribute("aria-label",label);return i}
/** a colour: the design's colours as swatches, a hex or token input, and a gradient of two stops with an angle */
function ctlColor(value,label,onSet){const box=document.createElement("div");box.className="ctl";
  const isGrad=value&&typeof value==="object"&&Array.isArray(value.gradient);
  tokens().forEach(t=>{const b=document.createElement("button");b.type="button";b.className="sw"+(value===t?" on":"");b.style.background=hexOf(t);b.title=t;b.setAttribute("aria-label",label+": "+t);b.onclick=()=>onSet(t);box.appendChild(b)});
  const hex=ctl("text",isGrad?"":value,label+" as a colour name or hex",v=>onSet(v));hex.setAttribute("list","mh-tokens");hex.placeholder="token or #hex";box.appendChild(hex);
  const g=document.createElement("button");g.type="button";g.textContent=isGrad?"plain":"gradient";g.setAttribute("aria-label",isGrad?label+": back to one colour":label+": make it a gradient");
  g.onclick=()=>{const a=typeof value==="string"&&value?value:"accent";onSet(isGrad?value.gradient[0]:{gradient:[a,a==="ink"?"accent":"ink"],angle:160})};box.appendChild(g);
  if(isGrad){const gr=document.createElement("div");gr.className="grad";
    const put=(t,node)=>{const l=document.createElement("label");l.textContent=t;gr.append(l,node)};
    put("stop 1",ctl("text",value.gradient[0],label+" gradient stop 1",v=>onSet(Object.assign({},value,{gradient:[v||"accent",value.gradient[1]]}))));
    put("stop 2",ctl("text",value.gradient[1],label+" gradient stop 2",v=>onSet(Object.assign({},value,{gradient:[value.gradient[0],v||"ink"]}))));
    put("angle",ctl("num",value.angle===undefined?180:value.angle,label+" gradient angle",v=>onSet(Object.assign({},value,{angle:v===undefined?0:v}))));
    const p=document.createElement("div");p.className="gradPrev";p.style.background=gradCss(value);gr.appendChild(p);
    box.appendChild(gr)}
  return box}
/** one labelled row in a grid; fk restores the focus after the page redraws */
function row(g,label,node,fk){const l=document.createElement("label");l.textContent=label;if(node.tagName==="INPUT"||node.tagName==="SELECT"||node.tagName==="TEXTAREA"){const id="f-"+label.replace(/[^a-z0-9]+/gi,"-");node.id=id;l.htmlFor=id}if(fk)node.dataset.fk=fk;g.append(l,node)}
function sub(g,text){const d=document.createElement("div");d.className="sub";d.textContent=text;g.appendChild(d)}

/* ---------- the scene: its own fields, the camera and the transition ---------- */
function sceneForm(){const s=scene();const g=$("sceneForm");g.innerHTML="";
  const set=(prop,value)=>post(value===undefined?{op:"unset",addr:s.id+"."+prop}:{op:"set",addr:s.id+"."+prop,value:value},"scene."+prop);
  row(g,"dur (frames)",ctl("num",s.dur,"Scene duration in frames",v=>set("dur",v)),"sc:dur");
  row(g,"ground",ctlColor(s.ground===undefined?"ink":s.ground,"Ground",v=>set("ground",v)),"sc:ground");
  row(g,"exit fade (frames)",ctl("num",s.exit&&s.exit.dur!==undefined?s.exit.dur:(s.exit==="fade"?8:0),"Exit fade in frames",v=>set("exit.dur",v===undefined?0:v)),"sc:exit");
  row(g,"why",ctl("text",s.why,"Why this scene is here",v=>set("why",v)),"sc:why");
  sub(g,"camera");
  const cam=s.camera||{};
  const setCam=(k,v)=>{const next=Object.assign({},cam);if(v===undefined)delete next[k];else next[k]=v;if(!Object.keys(next).length)return set("camera",undefined);post({op:"set",addr:s.id+".camera",value:next},"scene.camera")};
  row(g,"preset",ctl("select",cam.preset,"Camera preset",v=>setCam("preset",v),CAMERA_PRESETS),"sc:cam.preset");
  row(g,"from",ctl("num",cam.from,"Camera from",v=>setCam("from",v)),"sc:cam.from");
  row(g,"to",ctl("num",cam.to,"Camera to",v=>setCam("to",v)),"sc:cam.to");
  row(g,"focus x",ctl("num",cam.focus&&cam.focus.x,"Camera focus x",v=>setCam("focus",{x:v===undefined?0.5:v,y:(cam.focus&&cam.focus.y)===undefined?0.5:cam.focus.y})),"sc:cam.fx");
  row(g,"focus y",ctl("num",cam.focus&&cam.focus.y,"Camera focus y",v=>setCam("focus",{x:(cam.focus&&cam.focus.x)===undefined?0.5:cam.focus.x,y:v===undefined?0.5:v})),"sc:cam.fy");
  row(g,"ease",ctl("select",cam.ease,"Camera easing",v=>setCam("ease",v),EASES),"sc:cam.ease");
  sub(g,"transition in");
  const tr=typeof s.transition==="string"?{type:s.transition}:(s.transition||{});
  row(g,"type",ctl("select",tr.type,"Transition into this scene",v=>{if(v===undefined)return set("transition",undefined);post({op:"set",addr:s.id+".transition",value:{type:v,dur:tr.dur===undefined?12:tr.dur}},"scene.transition")},TRANSITIONS),"sc:tr.type");
  row(g,"dur (frames)",ctl("num",tr.dur,"Transition duration in frames",v=>{if(!tr.type)return;post({op:"set",addr:s.id+".transition",value:{type:tr.type,dur:v===undefined?12:v}},"scene.transition")}),"sc:tr.dur")}

/* ---------- the layer: what it is, then every other field it carries ---------- */
const SKIP=["id","type","at","in","out","layers"];
function inspector(){const l=layer();const q=$("quick");q.innerHTML="";$("selTitle").textContent=l?"Layer "+scene().id+"."+sel[0]+" ("+l.type+")"+(sel.length>1?" +"+(sel.length-1)+" more":""):"Layer (none selected)";$("json").value=l?JSON.stringify(l,null,2):"";if(!l)return;
  const path=sel[0];const v=viewLayer(path);const at=v.at||{x:0.5,y:0.5};
  const set=(prop,value)=>post(value===undefined?{op:"unset",addr:writeAddr(path,prop)}:{op:"set",addr:writeAddr(path,prop),value:value},prop);
  row(q,"x",ctl("num",at.x,"Position x, a fraction of the frame",x=>set("at",{x:x===undefined?0.5:x,y:at.y})),"in:at.x");
  row(q,"y",ctl("num",at.y,"Position y, a fraction of the frame",y=>set("at",{x:at.x,y:y===undefined?0.5:y})),"in:at.y");
  row(q,"anchor",ctl("select",v.anchor,"Anchor",x=>set("anchor",x),["","center","left","right","top","bottom","top-left","top-right","bottom-left","bottom-right"]),"in:anchor");
  if(l.type==="text")row(q,"text",ctl("text",v.text,"Text",x=>set("text",x===undefined?"":x)),"in:text");
  sub(q,"in");
  row(q,"preset",ctl("select",(v.in&&v.in.preset)||"rise","In preset",x=>set("in.preset",x),IN_PRESETS),"in:in.preset");
  row(q,"at",ctl("num",(v.in&&v.in.at)===undefined?0:v.in.at,"In at, a local frame",x=>set("in.at",x===undefined?0:x)),"in:in.at");
  row(q,"dur",ctl("num",(v.in&&v.in.dur)===undefined?14:v.in.dur,"In duration in frames",x=>set("in.dur",x===undefined?14:x)),"in:in.dur");
  row(q,"ease",ctl("select",(v.in&&v.in.ease)||"","In easing",x=>set("in.ease",x),EASES),"in:in.ease");
  row(q,"stagger",ctl("json",v.in&&v.in.stagger,"In stagger as JSON",x=>set("in.stagger",x)),"in:in.stagger");
  sub(q,"out");
  row(q,"preset",ctl("select",(v.out&&v.out.preset)||"","Out preset",x=>set("out.preset",x),OUT_PRESETS),"in:out.preset");
  row(q,"at",ctl("num",v.out&&v.out.at,"Out at, negative counts from the end",x=>set("out.at",x)),"in:out.at");
  row(q,"dur",ctl("num",v.out&&v.out.dur,"Out duration in frames",x=>set("out.dur",x)),"in:out.dur");
  const skip=SKIP.concat(l.type==="text"?["text"]:[]);
  const rest=Object.keys(v).filter(k=>skip.indexOf(k)<0);
  if(rest.length)sub(q,l.type);
  rest.forEach(k=>{const val=v[k];
    const kind=COLOR_KEY.test(k)||(val&&typeof val==="object"&&Array.isArray(val.gradient))?"color":typeof val==="boolean"?"bool":typeof val==="number"||NUM_KEY.indexOf(k)>=0?"num":typeof val==="string"?"text":"json";
    const node=kind==="color"?ctlColor(val,k,x=>set(k,x)):ctl(kind,val,k+" of this layer"+(kind==="json"?" as JSON":""),x=>set(k,x));
    row(q,k,node,"in:"+k)})}
function drawFindings(){const ul=$("findings");ul.innerHTML="";if(!findings.length){ul.innerHTML="<li>clean</li>";return}findings.forEach(f=>{const li=document.createElement("li");li.className=f.level;li.textContent=f.level+" "+f.rule+" at "+f.where+": "+f.message;ul.appendChild(li)})}
function state(){const l=layer();return {film:F.title,path:$("path").textContent,format:format,formats:stages.filter(st=>!st.pane.hidden&&st.format).map(st=>st.format),formatOnly:formatOnly,writesTo:sel.length?writeAddr(sel[0],"at"):null,scene:scene().id,frame:frame,address:scene().id+"+"+frame,locate:locate(),selection:sel.map(p=>scene().id+"."+p),selected:sel.length?scene().id+"."+sel[0]:null,layer:l||null,timing:sel.length?timingOf(sel[0]):null,ops:undo.length,errors:findings.filter(f=>f.level==="error").length,findings:findings}}

/* ---------- wiring ---------- */
$("scrub").oninput=()=>{frame=parseInt($("scrub").value,10);show()};$("prev").onclick=()=>seek(-1);$("next").onclick=()=>seek(1);$("play").onclick=togglePlay;
$("format").onchange=()=>{format=$("format").value;layoutPanes();mount()};
$("fmtOnly").onchange=()=>{formatOnly=$("fmtOnly").checked;render()};
$("apply").onclick=()=>{const l=layer();if(!l)return;let v;try{v=JSON.parse($("json").value)}catch(e){$("save").textContent="json: "+e.message;$("save").className="save err";return}
  const path=sel[0];post({op:"batch",ops:[{op:"remove",addr:addrOf(path)},{op:"add-layer",scene:scene().id,layer:v}],name:"json"},"apply json").then(()=>{sel=[v.id];paint();render()})};
$("dup").onclick=()=>{if(sel.length)post({op:"dup",addr:addrOf(sel[0])},"duplicate")};
$("remove").onclick=()=>{if(!sel.length)return;const ops=sel.map(p=>({op:"remove",addr:addrOf(p)}));post(ops.length===1?ops[0]:{op:"batch",ops:ops,name:"remove"},"remove");sel=[]};
$("layout").onclick=()=>post({op:"layout",scene:scene().id},"layout");
["left","centre","right","top","middle","bottom","dist-h","dist-v"].forEach(m=>{$("al-"+m).onclick=()=>alignSel(m)});
$("selAll").onclick=()=>{sel=rows().map(r=>r.path);paint();render()};
$("selClear").onclick=()=>{sel=[];kfSel=null;paint();render()};
const newId=p=>{let i=1;while(scene().layers.some(l=>l.id===p+"-"+i))i++;return p+"-"+i};
const addLayerOp=l=>post({op:"add-layer",scene:scene().id,layer:l},"add "+l.type).then(()=>{sel=[l.id];paint();render()});
$("addText").onclick=()=>addLayerOp({id:newId("text"),type:"text",text:"New line",size:72,color:scene().ground==="paper"?"ink":"paper",at:{x:0.5,y:0.5},in:{preset:"rise",at:0,dur:14}});
$("addShape").onclick=()=>addLayerOp({id:newId("shape"),type:"shape",shape:"line",w:220,thickness:6,fill:"accent",at:{x:0.5,y:0.6},in:{preset:"grow",at:0,dur:14}});
$("addCounter").onclick=()=>addLayerOp({id:newId("counter"),type:"counter",from:0,to:100,size:200,color:scene().ground==="paper"?"ink":"paper",at:{x:0.5,y:0.45},in:{preset:"pop",at:0,dur:14}});
$("addList").onclick=()=>addLayerOp({id:newId("list"),type:"list",items:["one","two","three"],marker:"dot",size:52,color:scene().ground==="paper"?"ink":"paper",at:{x:0.5,y:0.5},in:{preset:"rise",at:0,dur:14,stagger:{by:"item",each:6}}});
$("addGroup").onclick=()=>addLayerOp({id:newId("group"),type:"group",w:900,h:520,at:{x:0.5,y:0.5},in:{preset:"pop",at:0,dur:14,stagger:{by:"item",each:4}},layers:[{id:"title",type:"text",text:"In a group",size:64,color:scene().ground==="paper"?"ink":"paper",at:{x:0.5,y:0.4},in:{preset:"rise",at:0,dur:12}}]});
function onKey(e){const tag=e.target&&e.target.tagName;if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"){if(e.key==="Escape")e.target.blur();return}
  if(e.target&&e.target.dataset&&e.target.dataset.fk&&/^(bar|edge|kf):/.test(e.target.dataset.fk)&&/^Arrow(Left|Right)$/.test(e.key))return;
  const k=e.key,c=e.shiftKey?0.02:0.005;
  if(k==="ArrowLeft"){e.preventDefault();nudge(-c,0)}else if(k==="ArrowRight"){e.preventDefault();nudge(c,0)}else if(k==="ArrowUp"){e.preventDefault();nudge(0,-c)}else if(k==="ArrowDown"){e.preventDefault();nudge(0,c)}
  else if(k==="[")shiftIn(-2);else if(k==="]")shiftIn(2);
  else if(k==="{"||k==="}"){const d=k==="{"?-2:2;sel.forEach(p=>{const t=timingOf(p);setOutAt(p,(t.outAt===null?Math.max(t.inAt+t.inDur,scene().dur-8):t.outAt)+d)})}
  else if(k==="-")resize(-4);else if(k==="=")resize(4);
  else if(k===",")seek(-1);else if(k===".")seek(1);else if(k==="j")seek(-F.fps);else if(k==="l")seek(F.fps);else if(k===" "){e.preventDefault();togglePlay()}
  else if(k==="d"){if(sel.length)post({op:"dup",addr:addrOf(sel[0])},"duplicate")}
  else if(k==="Backspace"||k==="Delete"){if(!sel.length)return;const ops=sel.map(p=>({op:"remove",addr:addrOf(p)}));post(ops.length===1?ops[0]:{op:"batch",ops:ops,name:"remove"},"remove");sel=[]}
  else if(k==="z"){e.preventDefault();undoOnce()}else if(k==="Z"){e.preventDefault();redoOnce()}
  else if(k==="Escape"){sel=[];kfSel=null;paint();render()}}
document.addEventListener("keydown",onKey);
document.addEventListener("focusin",e=>{const fk=e.target&&e.target.dataset&&e.target.dataset.fk;if(fk)lastFocus=fk});
let resizeT=null;
window.addEventListener("resize",()=>{if(!F)return;clearTimeout(resizeT);resizeT=setTimeout(()=>{const was=stages[1]&&!stages[1].pane.hidden;layoutPanes();const now=stages[1]&&!stages[1].pane.hidden;if(was!==now)mount();else fitStages()},150)});
$("undoBtn").onclick=undoOnce;$("redoBtn").onclick=redoOnce;
window.mhEdit={state:state,
  select:a=>{const p=a.split(".");let path=a;if(F.scenes.some(s=>s.id===p[0])){if(p[0]!==sceneId){sceneId=p[0];frame=0}path=p.slice(1).join(".")}pick(path,false);return show()},
  set:(addr,value)=>post({op:"set",addr:addr,value:value},"set "+addr),
  op:(o,name)=>post(o,name),
  frame:n=>{frame=clampF(n);return show()},
  play:togglePlay,
  reload:async()=>{await load();await mount()},
  selection:()=>sel.map(p=>scene().id+"."+p),
  undo:undoOnce,
  redo:redoOnce};
(async()=>{await load();const fs=$("format");Object.keys(F.formats).forEach(f=>{const o=document.createElement("option");o.value=f;o.textContent=f;fs.appendChild(o)});fs.value=format;
  const dl=$("mh-tokens");tokens().concat(["white","black","transparent"]).forEach(t=>{const o=document.createElement("option");o.value=t;dl.appendChild(o)});
  buildStages();
  await Promise.all(stages.map(st=>new Promise(r=>{if(st.iframe.contentWindow&&st.iframe.contentWindow.__mh)r();else st.iframe.addEventListener("load",r,{once:true})})));
  for(const st of stages)await stageReady(st);
  await mount()})();
</script></body></html>`;
