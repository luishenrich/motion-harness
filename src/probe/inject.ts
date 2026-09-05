/**
 * Source of the probe component that the wrapper entry mounts next to the
 * project's Root. Plain React, no JSX, no imports of its own: the wrapper file
 * provides React and remotion from the project's node_modules.
 *
 * When inputProps carry `__harnessProbe`, the probe waits for fonts and two
 * animation frames, measures the DOM and prints one JSON line to the browser
 * console, which the renderer hands back through `onBrowserLog`.
 *
 * Modes: "probe" (only [data-probe] elements), "text" (plus every element that
 * carries its own text), "all" (text plus img/svg/button/input).
 *
 * Every item carries an `id` and the `ancestors` ids of the other items that
 * contain it (so a lint can exclude parent/child pairs), its computed
 * `lineHeight`, the number of direct `<br>` children (`brs`) and the value of
 * an optional `data-lines` attribute (`lines`), the line count an author
 * declares for a text element.
 */
export const PROBE_MARK = "__HARNESS_PROBE__";

export const PROBE_SOURCE = `
import { delayRender, continueRender, getInputProps } from "remotion";
const __probeMark = ${JSON.stringify(PROBE_MARK)};
const __effectiveOpacity = (el) => {
  let o = 1;
  let n = el;
  while (n && n.nodeType === 1) {
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return 0;
    o *= parseFloat(cs.opacity || "1");
    n = n.parentElement;
  }
  return o;
};
const __ownText = (el) => {
  let t = "";
  for (const c of el.childNodes) if (c.nodeType === 3) t += c.textContent;
  return t.replace(/\\s+/g, " ").trim();
};
const __measure = (mode, settleMs) => {
  const W = window.innerWidth, H = window.innerHeight;
  const items = [];
  const els = [];
  const colors = new Map();
  const seen = new Map();
  const __inkRect = (el) => {
    // for text carriers, measure the glyph run instead of the box (a full-width centered line is not full-width ink)
    const own = [...el.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
    if (!own.length) return el.getBoundingClientRect();
    const range = document.createRange();
    range.setStartBefore(own[0]);
    range.setEndAfter(own[own.length - 1]);
    const r = range.getBoundingClientRect();
    return r.width > 0 ? r : el.getBoundingClientRect();
  };
  const add = (el, key, kind) => {
    if (seen.has(el)) return;
    const id = items.length;
    seen.set(el, id);
    els.push(el);
    const r = __inkRect(el);
    const cs = getComputedStyle(el);
    const op = __effectiveOpacity(el);
    const visible = op > 0.02 && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
    const linesAttr = el.getAttribute("data-lines");
    const lines = linesAttr !== null && linesAttr !== "" && !isNaN(parseInt(linesAttr, 10)) ? parseInt(linesAttr, 10) : undefined;
    let brs = 0;
    for (const c of el.childNodes) if (c.nodeType === 1 && c.tagName === "BR") brs++;
    items.push({
      id, ancestors: [], key, kind, tag: el.tagName.toLowerCase(),
      lineHeight: cs.lineHeight, lines, brs,
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      visible, opacity: Math.round(op * 100) / 100,
      color: cs.color, bg: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily.split(",")[0].replace(/"/g, ""),
      text: __ownText(el).slice(0, 80),
    });
  };
  document.querySelectorAll("[data-probe]").forEach((el) => add(el, el.getAttribute("data-probe"), "probe"));
  if (mode === "text" || mode === "all") {
    document.querySelectorAll("body *").forEach((el) => {
      if (/^(script|style|noscript|template|head|link|meta)$/i.test(el.tagName)) return;
      const t = __ownText(el);
      if (t && t.length <= 80) add(el, "text:" + t, "text");
      else if (mode === "all" && /^(img|svg|button|input|video|canvas)$/i.test(el.tagName)) add(el, el.tagName.toLowerCase() + ":" + (el.getAttribute("alt") || el.getAttribute("src") || "").split("/").pop().slice(0, 40), "media");
    });
  }
  items.forEach((it, i) => {
    let n = els[i].parentElement;
    while (n) {
      if (seen.has(n)) it.ancestors.push(seen.get(n));
      n = n.parentElement;
    }
  });
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (__effectiveOpacity(el) < 0.02) return;
    const cs = getComputedStyle(el);
    for (const [prop, val] of [["color", cs.color], ["bg", cs.backgroundColor], ["border", cs.borderTopColor]]) {
      if (!val || val === "rgba(0, 0, 0, 0)" || val === "transparent") continue;
      if (prop === "border" && cs.borderTopWidth === "0px") continue;
      if (prop === "color" && !__ownText(el)) continue;
      const k = prop + " " + val;
      const e = colors.get(k) || { prop, value: val, count: 0, example: "" };
      e.count++;
      if (!e.example) e.example = (el.getAttribute("data-probe") ? "probe:" + el.getAttribute("data-probe") : __ownText(el).slice(0, 40)) || el.tagName.toLowerCase();
      colors.set(k, e);
    }
  });
  return { viewport: { w: W, h: H }, items, colors: [...colors.values()], settleMs };
};
const HarnessProbe = () => {
  React.useEffect(() => {
    let props = null;
    try { props = getInputProps(); } catch (e) { props = null; }
    const mode = props && props.__harnessProbe;
    if (!mode) return;
    const settleMs = (props && props.__harnessSettleMs) || 150;
    const handle = delayRender("harness probe");
    const done = () => {
      try { console.debug(__probeMark + JSON.stringify(__measure(mode, settleMs))); }
      catch (e) { console.debug(__probeMark + JSON.stringify({ error: String(e) })); }
      finally { continueRender(handle); }
    };
    const go = () => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, settleMs)));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, go); else go();
  }, []);
  return null;
};
`;
