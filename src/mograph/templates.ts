/**
 * Templates: a scene of layers from a handful of parameters. A template is a
 * function `(params) => MgScene` plus a manifest that names its parameters, so
 * the CLI, the tests and the model that writes a film from a brief all read the
 * same list. A template writes plain layers: after `mh template add stat --param
 * value=40` the layers are the truth and every one of them is editable by
 * address. The scene keeps `template` and `params`, so `mh template apply`
 * builds it again from the same values.
 *
 * Units are the film's: positions are fractions of the frame, sizes are u
 * pixels (1 u = 1 px at a 1080 px short side), times are local frames. Every
 * template ships per format overrides for vertical, where a block sits high or
 * a line wraps.
 *
 * Colours come from the ground: a light ground gets ink text, a dark one paper
 * text, support lines are muted on both. Accent is a shape colour on every
 * ground and a text colour only on a dark one, because an accent lighter than
 * the ink fails the contrast lint on paper. `--param accent=accent` overrides
 * that when a film's accent is dark enough.
 */
import type { Layer, LayerBase, MgScene } from "./schema.ts";
import { isDark } from "./schema.ts";

/* ---------- manifests ---------- */

export type MgParamType = "string" | "number" | "boolean" | "color" | "list" | "pairs";
export type MgParamSpec = { type: MgParamType; default: unknown; help: string };
export type MgParams = Record<string, unknown>;
export type MgTemplate = {
  name: string;
  description: string;
  params: Record<string, MgParamSpec>;
  build: (p: MgParams) => MgScene;
};

/** a label and a number, the shape a bars layer wants */
export type Pair = { label: string; value: number };

const S = (p: MgParams, k: string): string => String(p[k] ?? "");
const N = (p: MgParams, k: string): number => (typeof p[k] === "number" ? (p[k] as number) : 0);
const B = (p: MgParams, k: string): boolean => p[k] === true;
const L = (p: MgParams, k: string): string[] => (Array.isArray(p[k]) ? (p[k] as unknown[]).map((x) => String(x)) : []);
const PR = (p: MgParams, k: string): Pair[] => (Array.isArray(p[k]) ? (p[k] as Pair[]).filter((v) => v && typeof v === "object") : []);

/** "a | b | c", "a, b, c" or an array; the pipe wins so copy may hold commas */
export const parseList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v ?? "");
  if (!s.trim()) return [];
  return (s.includes("|") ? s.split("|") : s.split(",")).map((x) => x.trim()).filter(Boolean);
};

/** "Manual=32 | Harness=78" or [{label, value}] */
export const parsePairs = (v: unknown): Pair[] => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x ? { label: String((x as Pair).label ?? ""), value: Number((x as Pair).value ?? 0) || 0 } : { label: String(x), value: 0 }));
  return parseList(v).map((item) => {
    const i = item.lastIndexOf("=");
    const j = i < 0 ? item.lastIndexOf(":") : i;
    if (j < 0) return { label: item, value: 0 };
    return { label: item.slice(0, j).trim(), value: parseFloat(item.slice(j + 1)) || 0 };
  });
};

const asNumber = (v: unknown, d: number): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : d;
};
const asBool = (v: unknown, d: boolean): boolean => {
  if (typeof v === "boolean") return v;
  if (v === undefined || v === null || v === "") return d;
  return !/^(false|no|off|0)$/i.test(String(v));
};

/** raw values (strings from the CLI, JSON from the model) typed the way the manifest says, defaults filled in */
export const coerceParams = (tpl: MgTemplate, raw: MgParams = {}): MgParams => {
  const out: MgParams = {};
  for (const [k, spec] of Object.entries(tpl.params)) {
    const v = raw[k];
    const d = spec.default;
    if (spec.type === "number") out[k] = asNumber(v === undefined ? d : v, asNumber(d, 0));
    else if (spec.type === "boolean") out[k] = asBool(v === undefined ? d : v, asBool(d, false));
    else if (spec.type === "list") out[k] = v === undefined ? parseList(d) : parseList(v);
    else if (spec.type === "pairs") out[k] = v === undefined ? parsePairs(d) : parsePairs(v);
    else out[k] = v === undefined ? String(d ?? "") : String(v);
  }
  return out;
};

/** the parameters a caller actually gave, typed and without the defaults: what a scene records */
export const givenParams = (tpl: MgTemplate, raw: MgParams = {}): MgParams => {
  const all = coerceParams(tpl, raw);
  const out: MgParams = {};
  for (const k of Object.keys(tpl.params)) if (raw[k] !== undefined) out[k] = all[k];
  return out;
};

/* ---------- colours, grounds, shorthands ---------- */

const LIGHT_TOKENS = new Set(["paper", "white", "accent"]);

/** a ground a viewer reads dark text on: paper, white, accent, or a light hex */
export const groundIsLight = (ground: string): boolean => LIGHT_TOKENS.has(ground) || (/^#[0-9a-fA-F]{3,8}$/.test(ground) && !isDark(ground));

export type Palette = { fg: string; dim: string; accentText: string; accent: string; light: boolean };

/** the colours a template paints with, from its ground */
export const paletteFor = (ground: string, accent = "auto"): Palette => {
  const light = groundIsLight(ground);
  return { fg: light ? "ink" : "paper", dim: "muted", accentText: accent && accent !== "auto" ? accent : light ? "ink" : "accent", accent: "accent", light };
};

/** per format overrides, the vertical ones a template always ships */
const V = (o: Record<string, unknown>) => ({ formats: { vertical: o } });
const at = (x: number, y: number) => ({ x, y });

const keep = (...xs: (Layer | null | false | undefined | "")[]): Layer[] => xs.filter((x): x is Layer => !!x && typeof x === "object");

/**
 * A group as section 1 of the roadmap writes it. The group runtime is built on
 * another branch, so `groups: false` writes the same children as flat scene
 * layers and every template that offers a group offers the fallback.
 */
export type GroupLayer = LayerBase & { type: "group"; w?: number; h?: number; layers: Layer[] };
export const group = (g: GroupLayer): Layer => g as unknown as Layer;

const exitOf = (p: MgParams): MgScene["exit"] => {
  const f = Math.round(N(p, "exit"));
  return f > 0 ? { type: "fade", dur: f } : undefined;
};

const sceneOf = (name: string, p: MgParams, why: string, layers: Layer[]): MgScene => ({
  id: name,
  dur: Math.max(20, Math.round(N(p, "dur"))),
  ground: S(p, "ground"),
  exit: exitOf(p),
  why,
  layers,
});

/* ---------- the shared parameters ---------- */

const pGround = (d: string): MgParamSpec => ({ type: "color", default: d, help: "the scene's ground: ink, paper, accent, a design colour or a hex" });
const pDur = (d: number): MgParamSpec => ({ type: "number", default: d, help: "the scene's length in frames" });
const pExit = (d = 8): MgParamSpec => ({ type: "number", default: d, help: "frames of the closing fade over the ground, 0 for none" });
const pAccent: MgParamSpec = { type: "color", default: "auto", help: "colour of the accented text; auto means accent on a dark ground and ink on a light one" };
const pGroups: MgParamSpec = { type: "boolean", default: true, help: "write one group layer instead of flat layers; false until the group runtime has landed" };

/* ---------- the templates ---------- */

const title: MgTemplate = {
  name: "title",
  description: "an opening card: a kicker, a headline word by word, an accent rule",
  params: {
    title: { type: "string", default: "Motion graphics as data", help: "the headline; \\n breaks a line, *word* takes the accent colour" },
    kicker: { type: "string", default: "", help: "the small line above the headline, empty for none" },
    size: { type: "number", default: 104, help: "headline size in u pixels" },
    rule: { type: "boolean", default: true, help: "the accent rule under the headline" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(90),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    return sceneOf("title", p, "the opening claim", keep(
      S(p, "kicker") && {
        id: "kicker", type: "text", text: S(p, "kicker"), role: "body", size: 30, weight: 600, uppercase: true, letterSpacing: 0.14, color: c.dim,
        at: at(0.5, 0.35), maxWidth: 0.7, in: { preset: "rise", at: 0, dur: 12, ease: "out" },
        ...V({ size: 26, at: at(0.5, 0.36) }),
      },
      {
        id: "headline", type: "text", text: S(p, "title"), size, weight: 700, color: c.fg, accent: c.accentText,
        at: at(0.5, 0.47), maxWidth: 0.76, in: { preset: "rise", at: 8, dur: 16, ease: "out", stagger: { by: "word", each: 3 } },
        ...V({ size: Math.round(size * 0.8), maxWidth: 0.86 }),
      },
      B(p, "rule") && {
        id: "rule", type: "shape", shape: "line", w: 240, thickness: 6, fill: c.accent,
        at: at(0.5, 0.62), in: { preset: "grow", at: 30, dur: 14, ease: "out" },
        ...V({ w: 200, at: at(0.5, 0.6) }),
      },
    ));
  },
};

const statement: MgTemplate = {
  name: "statement",
  description: "one claim and the line that carries it",
  params: {
    headline: { type: "string", default: "An agent cannot see its own video.", help: "the claim" },
    support: { type: "string", default: "So it renders a frame and looks at it.", help: "the line under the claim, empty for none" },
    size: { type: "number", default: 88, help: "headline size in u pixels" },
    ground: pGround("paper"),
    accent: pAccent,
    dur: pDur(120),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    return sceneOf("statement", p, "the claim and its support", keep(
      {
        id: "headline", type: "text", text: S(p, "headline"), size, weight: 700, color: c.fg, accent: c.accentText,
        at: at(0.5, 0.42), maxWidth: 0.72, in: { preset: "rise", at: 4, dur: 16, ease: "out", stagger: { by: "word", each: 3 } },
        ...V({ size: Math.round(size * 0.8), maxWidth: 0.86, at: at(0.5, 0.42) }),
      },
      S(p, "support") && {
        id: "support", type: "text", text: S(p, "support"), role: "body", size: 40, weight: 400, color: c.dim,
        at: at(0.5, 0.6), maxWidth: 0.6, in: { preset: "fade", at: 26, dur: 14, ease: "out" },
        ...V({ size: 34, maxWidth: 0.82, at: at(0.5, 0.57) }),
      },
    ));
  },
};

const stat: MgTemplate = {
  name: "stat",
  description: "one number that counts up, its label and a note",
  params: {
    value: { type: "number", default: 40, help: "the number counted to" },
    from: { type: "number", default: 0, help: "the number counted from" },
    format: { type: "string", default: "0", help: "0, 0,0, 0.0 or 0% (a percent of a fraction)" },
    prefix: { type: "string", default: "", help: "in front of the number" },
    suffix: { type: "string", default: "", help: "after the number" },
    label: { type: "string", default: "milliseconds a frame", help: "what the number counts" },
    note: { type: "string", default: "", help: "the small line under the label, empty for none" },
    size: { type: "number", default: 220, help: "the number's size in u pixels" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(100),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    return sceneOf("stat", p, "the number is the point", keep(
      {
        id: "value", type: "counter", from: N(p, "from"), to: N(p, "value"), format: S(p, "format") || "0", prefix: S(p, "prefix"), suffix: S(p, "suffix"),
        size, weight: 800, color: c.accentText, dur: 34, at: at(0.5, 0.42), in: { preset: "pop", at: 2, dur: 14, ease: "back" },
        ...V({ size: Math.round(size * 0.8), at: at(0.5, 0.42) }),
      },
      S(p, "label") && {
        id: "label", type: "text", text: S(p, "label"), size: 44, weight: 600, color: c.fg,
        at: at(0.5, 0.6), maxWidth: 0.66, in: { preset: "rise", at: 18, dur: 14, ease: "out" },
        ...V({ size: 38, maxWidth: 0.84, at: at(0.5, 0.56) }),
      },
      S(p, "note") && {
        id: "note", type: "text", text: S(p, "note"), role: "body", size: 30, weight: 400, color: c.dim,
        at: at(0.5, 0.71), maxWidth: 0.6, in: { preset: "fade", at: 32, dur: 12, ease: "out" },
        ...V({ size: 27, maxWidth: 0.82, at: at(0.5, 0.65) }),
      },
    ));
  },
};

const list: MgTemplate = {
  name: "list",
  description: "a kicker and items that arrive one after another, left aligned",
  params: {
    kicker: { type: "string", default: "What it does", help: "the small line above the items, empty for none" },
    items: { type: "list", default: "resolve the moment | frame it and look | edit the data", help: "the items, separated by | " },
    marker: { type: "string", default: "check", help: "dot, number, check, dash or none" },
    size: { type: "number", default: 50, help: "item size in u pixels" },
    ground: pGround("paper"),
    accent: pAccent,
    dur: pDur(140),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const items = L(p, "items");
    const size = N(p, "size");
    return sceneOf("list", p, "the steps, one after another", keep(
      S(p, "kicker") && {
        id: "kicker", type: "text", text: S(p, "kicker"), role: "body", size: 32, weight: 600, uppercase: true, letterSpacing: 0.12, color: c.dim,
        at: at(0.12, 0.3), anchor: "left", maxWidth: 0.6, in: { preset: "rise", at: 0, dur: 12, ease: "out" },
        ...V({ size: 28, at: at(0.09, 0.28), maxWidth: 0.84 }),
      },
      {
        id: "items", type: "list", items: items.length ? items : ["one", "two", "three"], marker: (S(p, "marker") || "check") as "dot" | "number" | "check" | "dash" | "none",
        size, weight: 500, color: c.fg, markerColor: c.accentText, gap: 22, maxWidth: 0.62, align: "left",
        at: at(0.12, 0.56), anchor: "left", in: { preset: "rise", at: 14, dur: 14, ease: "out", stagger: { by: "item", each: 8 } },
        ...V({ size: Math.round(size * 0.86), maxWidth: 0.84, at: at(0.09, 0.5), gap: 20 }),
      },
    ));
  },
};

const compare: MgTemplate = {
  name: "compare",
  description: "two columns with their own headline and items, a rule between them",
  params: {
    left: { type: "string", default: "Before", help: "the left headline" },
    leftItems: { type: "list", default: "guessing | re-rendering | hoping", help: "the left items, separated by |" },
    right: { type: "string", default: "After", help: "the right headline" },
    rightItems: { type: "list", default: "measuring | one frame | knowing", help: "the right items, separated by |" },
    marker: { type: "string", default: "dash", help: "dot, number, check, dash or none" },
    size: { type: "number", default: 40, help: "item size in u pixels" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(150),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    const marker = (S(p, "marker") || "dash") as "dot" | "number" | "check" | "dash" | "none";
    const col = (side: "left" | "right", head: string, items: string[], x: number, delay: number, vy: [number, number]): Layer[] => [
      {
        id: `${side}-head`, type: "text", text: head, size: 46, weight: 700, color: side === "right" ? c.accentText : c.fg, uppercase: true, letterSpacing: 0.08, align: "center",
        at: at(x, 0.3), maxWidth: 0.34, in: { preset: "rise", at: delay, dur: 12, ease: "out" },
        ...V({ size: 38, maxWidth: 0.8, at: at(0.5, vy[0]) }),
      },
      {
        id: `${side}-items`, type: "list", items: items.length ? items : ["one", "two"], marker, size, weight: 500, color: side === "right" ? c.fg : c.dim, markerColor: side === "right" ? c.accentText : c.dim,
        gap: 18, maxWidth: 0.34, align: "center", at: at(x, 0.52), in: { preset: "rise", at: delay + 8, dur: 14, ease: "out", stagger: { by: "item", each: 7 } },
        ...V({ size: Math.round(size * 0.92), maxWidth: 0.8, at: at(0.5, vy[1]) }),
      },
    ];
    return sceneOf("compare", p, "the two sides next to each other", [
      ...col("left", S(p, "left"), L(p, "leftItems"), 0.27, 2, [0.24, 0.36]),
      {
        id: "divider", type: "shape", shape: "rect", w: 3, h: 420, fill: c.dim, probe: false,
        at: at(0.5, 0.5), in: { preset: "fade", at: 10, dur: 12, ease: "out" },
        ...V({ w: 420, h: 3, at: at(0.5, 0.51) }),
      },
      ...col("right", S(p, "right"), L(p, "rightItems"), 0.73, 14, [0.63, 0.75]),
    ]);
  },
};

const quote: MgTemplate = {
  name: "quote",
  description: "a quote line by line, a rule and who said it",
  params: {
    quote: { type: "string", default: "The harness looks at the frame\nso the agent does not have to guess.", help: "the quote; \\n breaks a line" },
    attribution: { type: "string", default: "the readme", help: "who said it, empty for none" },
    size: { type: "number", default: 62, help: "quote size in u pixels" },
    ground: pGround("paper"),
    accent: pAccent,
    dur: pDur(145),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    return sceneOf("quote", p, "someone else says it", keep(
      {
        id: "mark", type: "text", text: "“", size: 130, weight: 700, color: c.accentText, probe: false,
        at: at(0.5, 0.26), maxWidth: 0.3, in: { preset: "pop", at: 0, dur: 12, ease: "back" },
        ...V({ size: 110, at: at(0.5, 0.28) }),
      },
      {
        id: "quote", type: "text", text: S(p, "quote"), size, weight: 500, lineHeight: 1.3, color: c.fg, accent: c.accentText,
        at: at(0.5, 0.47), maxWidth: 0.68, in: { preset: "mask", at: 6, dur: 16, ease: "out", stagger: { by: "line", each: 6 } },
        ...V({ size: Math.round(size * 0.82), maxWidth: 0.86, at: at(0.5, 0.46) }),
      },
      {
        id: "rule", type: "shape", shape: "line", w: 90, thickness: 4, fill: c.accent,
        at: at(0.5, 0.63), in: { preset: "grow", at: 30, dur: 10, ease: "out" },
        ...V({ at: at(0.5, 0.6) }),
      },
      S(p, "attribution") && {
        id: "who", type: "text", text: S(p, "attribution"), role: "body", size: 32, weight: 500, uppercase: true, letterSpacing: 0.1, color: c.dim,
        at: at(0.5, 0.71), maxWidth: 0.6, in: { preset: "fade", at: 36, dur: 12, ease: "out" },
        ...V({ size: 28, at: at(0.5, 0.66), maxWidth: 0.8 }),
      },
    ));
  },
};

const lowerThird: MgTemplate = {
  name: "lower-third",
  description: "a name and a role in the bottom left, behind an accent bar",
  params: {
    name: { type: "string", default: "Motion harness", help: "the name" },
    role: { type: "string", default: "eyes and hands for agents", help: "the role under it, empty for none" },
    size: { type: "number", default: 58, help: "the name's size in u pixels" },
    groups: pGroups,
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(100),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    const role = S(p, "role");
    const bar: Layer = { id: "bar", type: "shape", shape: "rect", w: 8, h: 150, radius: 4, fill: c.accent, at: at(0.07, 0.78), anchor: "left", in: { preset: "grow", at: 4, dur: 10, ease: "out" }, ...V({ h: 140, at: at(0.1, 0.74) }) };
    const name: Layer = {
      id: "name", type: "text", text: S(p, "name"), size, weight: 700, color: c.fg, align: "left",
      at: at(0.095, 0.745), anchor: "left", maxWidth: 0.42, in: { preset: "slide", from: "left", at: 8, dur: 14, ease: "out", distance: 60 },
      ...V({ size: Math.round(size * 0.85), at: at(0.13, 0.715), maxWidth: 0.74 }),
    };
    const roleLayer: Layer | null = role
      ? {
          id: "role", type: "text", text: role, role: "body", size: 30, weight: 400, color: c.dim, align: "left",
          at: at(0.095, 0.815), anchor: "left", maxWidth: 0.42, in: { preset: "slide", from: "left", at: 14, dur: 14, ease: "out", distance: 60 },
          ...V({ size: 27, at: at(0.13, 0.765), maxWidth: 0.74 }),
        }
      : null;
    if (!B(p, "groups")) return sceneOf("lower-third", p, "who is speaking", keep(bar, name, roleLayer));
    // one group: the bar and the lines travel in together, the children's at is a fraction of the group's box
    const card = group({
      id: "card", type: "group", at: at(0.07, 0.78), anchor: "left", w: 780, h: 170,
      in: { preset: "slide", from: "left", at: 4, dur: 16, ease: "out", stagger: { by: "item", each: 4 } },
      layers: keep(
        { ...bar, at: at(0.005, 0.5), in: { preset: "grow", at: 0, dur: 10, ease: "out" }, formats: undefined },
        { ...name, at: at(0.04, 0.32), in: { preset: "fade", at: 2, dur: 12, ease: "out" }, maxWidth: 0.95, formats: undefined },
        roleLayer ? { ...roleLayer, at: at(0.04, 0.74), in: { preset: "fade", at: 6, dur: 12, ease: "out" }, maxWidth: 0.95, formats: undefined } : null,
      ),
      ...V({ at: at(0.1, 0.74), w: 860 }),
    });
    return sceneOf("lower-third", p, "who is speaking", [card]);
  },
};

const chart: MgTemplate = {
  name: "chart",
  description: "a headline and bars that grow one after another",
  params: {
    headline: { type: "string", default: "Seconds for one still", help: "the headline over the bars" },
    values: { type: "pairs", default: "Remotion=0.57 | native=0.06", help: "label=value pairs, separated by |" },
    direction: { type: "string", default: "horizontal", help: "horizontal or vertical bars" },
    format: { type: "string", default: "0.0", help: "how a value reads: 0, 0,0, 0.0 or 0%" },
    note: { type: "string", default: "", help: "the small line under the bars, empty for none" },
    ground: pGround("paper"),
    accent: pAccent,
    dur: pDur(140),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const values = PR(p, "values");
    const horizontal = S(p, "direction") !== "vertical";
    return sceneOf("chart", p, "the numbers side by side", keep(
      {
        id: "headline", type: "text", text: S(p, "headline"), size: 56, weight: 700, color: c.fg,
        at: at(0.5, 0.22), maxWidth: 0.7, in: { preset: "rise", at: 0, dur: 12, ease: "out" },
        ...V({ size: 46, maxWidth: 0.86, at: at(0.5, 0.26) }),
      },
      {
        id: "bars", type: "bars", values: values.length ? values : [{ label: "one", value: 1 }, { label: "two", value: 2 }],
        direction: horizontal ? "horizontal" : "vertical", w: horizontal ? 1000 : 700, thickness: horizontal ? 40 : 90, gap: 26,
        color: c.accent, labelColor: c.fg, labelSize: 30, format: S(p, "format") || "0.0",
        at: at(0.5, 0.55), in: { preset: "grow", at: 16, dur: 20, ease: "out", stagger: { by: "item", each: 6 } },
        ...V({ w: horizontal ? 860 : 620, thickness: horizontal ? 36 : 80, labelSize: 28, at: at(0.5, 0.5) }),
      },
      S(p, "note") && {
        id: "note", type: "text", text: S(p, "note"), role: "body", size: 28, weight: 400, color: c.dim,
        at: at(0.5, 0.82), maxWidth: 0.66, in: { preset: "fade", at: 44, dur: 12, ease: "out" },
        ...V({ size: 26, maxWidth: 0.84, at: at(0.5, 0.72) }),
      },
    ));
  },
};

const logo: MgTemplate = {
  name: "logo",
  description: "a mark, a wordmark and a tagline; the mark is an image when the film has one",
  params: {
    wordmark: { type: "string", default: "motion harness", help: "the name under the mark" },
    tagline: { type: "string", default: "", help: "the line under the name, empty for none" },
    src: { type: "string", default: "", help: "an image under public/ for the mark; empty draws an accent ring" },
    size: { type: "number", default: 72, help: "the wordmark's size in u pixels" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(100),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const src = S(p, "src");
    const size = N(p, "size");
    const mark: Layer = src
      ? { id: "mark", type: "image", src, w: 220, at: at(0.5, 0.38), in: { preset: "pop", at: 0, dur: 16, ease: "back" }, ...V({ w: 190, at: at(0.5, 0.38) }) }
      : { id: "mark", type: "shape", shape: "ring", d: 160, thickness: 16, fill: c.accent, progress: 1, at: at(0.5, 0.38), in: { preset: "pop", at: 0, dur: 16, ease: "back" }, ...V({ d: 140, at: at(0.5, 0.38) }) };
    return sceneOf("logo", p, "the mark and the name", keep(
      mark,
      {
        id: "wordmark", type: "text", text: S(p, "wordmark"), size, weight: 700, letterSpacing: 0.01, color: c.fg,
        at: at(0.5, 0.58), maxWidth: 0.7, in: { preset: "mask", at: 12, dur: 16, ease: "out", stagger: { by: "word", each: 3 } },
        ...V({ size: Math.round(size * 0.82), maxWidth: 0.86, at: at(0.5, 0.54) }),
      },
      S(p, "tagline") && {
        id: "tagline", type: "text", text: S(p, "tagline"), role: "body", size: 32, weight: 400, color: c.dim,
        at: at(0.5, 0.68), maxWidth: 0.6, in: { preset: "fade", at: 28, dur: 12, ease: "out" },
        ...V({ size: 28, maxWidth: 0.82, at: at(0.5, 0.62) }),
      },
    ));
  },
};

const cta: MgTemplate = {
  name: "cta",
  description: "a headline, a button shaped rectangle with its label and a url line",
  params: {
    headline: { type: "string", default: "Try it on your own film", help: "the ask" },
    label: { type: "string", default: "mh new spot", help: "the label inside the button" },
    url: { type: "string", default: "github.com/motion-harness", help: "the line under the button, empty for none" },
    width: { type: "number", default: 520, help: "the button's width in u pixels" },
    groups: pGroups,
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(110),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const w = N(p, "width");
    const head: Layer = {
      id: "headline", type: "text", text: S(p, "headline"), size: 80, weight: 700, color: c.fg, accent: c.accentText,
      at: at(0.5, 0.34), maxWidth: 0.72, in: { preset: "rise", at: 2, dur: 14, ease: "out", stagger: { by: "word", each: 3 } },
      ...V({ size: 64, maxWidth: 0.86, at: at(0.5, 0.36) }),
    };
    // the button's plate is decoration: the label sits on it, so only the label is probed
    const plate: Layer = { id: "plate", type: "shape", shape: "rect", w, h: 108, radius: 54, fill: c.accent, probe: false, at: at(0.5, 0.6), in: { preset: "pop", at: 18, dur: 14, ease: "back" }, ...V({ w: Math.round(w * 0.92), at: at(0.5, 0.55) }) };
    const label: Layer = { id: "label", type: "text", text: S(p, "label"), size: 40, weight: 600, color: c.light ? "paper" : "ink", align: "center", at: at(0.5, 0.6), maxWidth: 0.4, in: { preset: "pop", at: 20, dur: 12, ease: "back" }, ...V({ size: 36, maxWidth: 0.7, at: at(0.5, 0.55) }) };
    const url: Layer | null = S(p, "url")
      ? { id: "url", type: "text", text: S(p, "url"), role: "mono", size: 30, weight: 400, color: c.dim, at: at(0.5, 0.76), maxWidth: 0.6, in: { preset: "fade", at: 34, dur: 12, ease: "out" }, ...V({ size: 27, maxWidth: 0.86, at: at(0.5, 0.65) }) }
      : null;
    if (!B(p, "groups")) return sceneOf("cta", p, "what to do next", keep(head, plate, label, url));
    const button = group({
      id: "button", type: "group", at: at(0.5, 0.6), anchor: "center", w, h: 108,
      in: { preset: "pop", at: 18, dur: 14, ease: "back" },
      layers: [
        { ...plate, at: at(0.5, 0.5), in: { preset: "cut", at: 0 }, formats: undefined },
        { ...label, at: at(0.5, 0.5), in: { preset: "cut", at: 0 }, formats: undefined },
      ],
      ...V({ at: at(0.5, 0.55), w: Math.round(w * 0.92) }),
    });
    return sceneOf("cta", p, "what to do next", keep(head, button, url));
  },
};

const steps: MgTemplate = {
  name: "steps",
  description: "numbered steps across the frame, stacked in vertical",
  params: {
    headline: { type: "string", default: "One round", help: "the headline over the steps, empty for none" },
    steps: { type: "list", default: "resolve | frame | edit", help: "the steps, separated by |" },
    size: { type: "number", default: 38, help: "step label size in u pixels" },
    connector: { type: "boolean", default: true, help: "the line the numbers sit on" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(150),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const items = L(p, "steps").slice(0, 4);
    const list3 = items.length ? items : ["one", "two", "three"];
    const size = N(p, "size");
    const xs = list3.length === 2 ? [0.32, 0.68] : list3.length === 4 ? [0.16, 0.39, 0.61, 0.84] : [0.22, 0.5, 0.78];
    const span = 0.52 / Math.max(1, list3.length);
    const layers: Layer[] = [];
    if (S(p, "headline")) {
      layers.push({
        id: "headline", type: "text", text: S(p, "headline"), size: 50, weight: 700, color: c.fg,
        at: at(0.5, 0.22), maxWidth: 0.7, in: { preset: "rise", at: 0, dur: 12, ease: "out" },
        ...V({ size: 44, maxWidth: 0.86, at: at(0.5, 0.18) }),
      });
    }
    if (B(p, "connector")) {
      layers.push({
        id: "track", type: "shape", shape: "line", w: 1120, thickness: 3, fill: c.dim, probe: false,
        at: at(0.5, 0.45), in: { preset: "grow", at: 8, dur: 20, ease: "out" },
        ...V({ w: 3, h: 3, at: at(0.5, 0.45) }),
      });
    }
    list3.forEach((item, i) => {
      const vy = 0.3 + i * 0.16;
      layers.push({
        id: `n${i + 1}`, type: "text", text: `0${i + 1}`, role: "mono", size: 42, weight: 700, color: c.accentText, align: "center",
        at: at(xs[i] ?? 0.5, 0.45), maxWidth: 0.16, in: { preset: "pop", at: 12 + i * 6, dur: 12, ease: "back" },
        ...V({ size: 36, maxWidth: 0.3, at: at(0.5, vy) }),
      });
      layers.push({
        id: `s${i + 1}`, type: "text", text: item, size, weight: 500, color: c.fg, align: "center",
        at: at(xs[i] ?? 0.5, 0.58), maxWidth: Math.max(0.18, span), in: { preset: "rise", at: 18 + i * 6, dur: 12, ease: "out" },
        ...V({ size: Math.round(size * 0.95), maxWidth: 0.7, at: at(0.5, vy + 0.055) }),
      });
    });
    return sceneOf("steps", p, "the round, step by step", layers);
  },
};

const split: MgTemplate = {
  name: "split",
  description: "two grounds: the text on one half, an image or a ring on the other",
  params: {
    headline: { type: "string", default: "Two halves", help: "the headline on the text side" },
    body: { type: "string", default: "One idea on the left, the picture on the right.", help: "the line under it, empty for none" },
    src: { type: "string", default: "", help: "an image under public/ for the panel; empty draws an accent ring" },
    panel: { type: "color", default: "ink", help: "the colour of the second half" },
    ground: pGround("paper"),
    accent: pAccent,
    dur: pDur(120),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const src = S(p, "src");
    const figure: Layer = src
      ? { id: "figure", type: "image", src, w: 420, radius: 16, at: at(0.75, 0.5), in: { preset: "pop", at: 14, dur: 16, ease: "back" }, ...V({ w: 380, at: at(0.5, 0.74) }) }
      : { id: "figure", type: "shape", shape: "ring", d: 280, thickness: 20, fill: c.accent, progress: 1, at: at(0.75, 0.5), in: { preset: "pop", at: 14, dur: 16, ease: "back" }, ...V({ d: 240, at: at(0.5, 0.74) }) };
    return sceneOf("split", p, "text on one side, the picture on the other", keep(
      {
        id: "panel", type: "shape", shape: "rect", w: 960, h: 1080, fill: S(p, "panel") || "ink", probe: false,
        at: at(0.75, 0.5), in: { preset: "wipe", from: "right", at: 0, dur: 16, ease: "out" },
        ...V({ w: 1080, h: 960, at: at(0.5, 0.75) }),
      },
      {
        id: "headline", type: "text", text: S(p, "headline"), size: 64, weight: 700, color: c.fg, align: "left",
        at: at(0.08, 0.42), anchor: "left", maxWidth: 0.34, in: { preset: "rise", at: 4, dur: 14, ease: "out" },
        ...V({ size: 54, at: at(0.09, 0.2), maxWidth: 0.82 }),
      },
      S(p, "body") && {
        id: "body", type: "text", text: S(p, "body"), role: "body", size: 34, weight: 400, color: c.dim, align: "left",
        at: at(0.08, 0.56), anchor: "left", maxWidth: 0.32, in: { preset: "fade", at: 20, dur: 14, ease: "out" },
        ...V({ size: 30, at: at(0.09, 0.32), maxWidth: 0.8 }),
      },
      figure,
    ));
  },
};

const kinetic: MgTemplate = {
  name: "kinetic",
  description: "one line word by word, filling the frame, with a slow camera push",
  params: {
    line: { type: "string", default: "Every frame\nis a *measurement*", help: "the line; \\n breaks a line, *word* takes the accent colour" },
    size: { type: "number", default: 112, help: "the line's size in u pixels" },
    camera: { type: "boolean", default: true, help: "a slow push over the scene (the camera runtime draws it)" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(110),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    const s = sceneOf("kinetic", p, "one line, word by word", [
      {
        id: "line", type: "text", text: S(p, "line"), size, weight: 800, lineHeight: 1.05, color: c.fg, accent: c.accentText,
        at: at(0.5, 0.5), maxWidth: 0.8, in: { preset: "mask", at: 2, dur: 12, ease: "out", stagger: { by: "word", each: 4 } },
        ...V({ size: Math.round(size * 0.76), maxWidth: 0.88 }),
      },
    ]);
    // section 2 of the roadmap: the camera runtime lands on another branch and ignores this until it does
    if (B(p, "camera")) (s as MgScene & { camera?: unknown }).camera = { preset: "push", from: 1, to: 1.08, focus: { x: 0.5, y: 0.5 }, ease: "linear" };
    return s;
  },
};

const countdown: MgTemplate = {
  name: "countdown",
  description: "a number counting down inside a ring that fills",
  params: {
    from: { type: "number", default: 3, help: "the number counted from" },
    to: { type: "number", default: 0, help: "the number counted to" },
    label: { type: "string", default: "starting", help: "the line under the ring, empty for none" },
    seconds: { type: "number", default: 3, help: "how long the count takes, in seconds" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(120),
    exit: pExit(),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const count = Math.max(12, Math.round(N(p, "seconds") * 30));
    const dur = Math.max(20, Math.round(N(p, "dur")));
    const end = Math.min(dur - 6, 8 + count);
    return sceneOf("countdown", p, "the wait, made visible", keep(
      {
        id: "ring", type: "shape", shape: "ring", d: 380, thickness: 14, fill: c.accent, stroke: c.dim, progress: 1, probe: false,
        at: at(0.5, 0.45), in: { preset: "fade", at: 0, dur: 8, ease: "out" },
        tracks: { progress: [{ at: 8, v: 0 }, { at: end, v: 1, ease: "linear" }] },
        ...V({ d: 330, at: at(0.5, 0.45) }),
      },
      {
        id: "number", type: "counter", from: N(p, "from"), to: N(p, "to"), format: "0", size: 190, weight: 800, color: c.fg, dur: count,
        at: at(0.5, 0.45), in: { preset: "pop", at: 8, dur: 12, ease: "back" },
        ...V({ size: 165, at: at(0.5, 0.45) }),
      },
      S(p, "label") && {
        id: "label", type: "text", text: S(p, "label"), role: "body", size: 36, weight: 500, uppercase: true, letterSpacing: 0.14, color: c.dim,
        at: at(0.5, 0.68), maxWidth: 0.6, in: { preset: "fade", at: 16, dur: 12, ease: "out" },
        ...V({ size: 32, at: at(0.5, 0.62), maxWidth: 0.84 }),
      },
    ));
  },
};

const endCard: MgTemplate = {
  name: "end-card",
  description: "the closing frame: the name, an accent rule and where to go",
  params: {
    title: { type: "string", default: "motion harness", help: "the name" },
    url: { type: "string", default: "github.com/motion-harness", help: "the line under the rule, empty for none" },
    size: { type: "number", default: 76, help: "the name's size in u pixels" },
    ground: pGround("ink"),
    accent: pAccent,
    dur: pDur(110),
    exit: pExit(0),
  },
  build: (p) => {
    const c = paletteFor(S(p, "ground"), S(p, "accent"));
    const size = N(p, "size");
    return sceneOf("end-card", p, "the last frame, held", keep(
      {
        id: "title", type: "text", text: S(p, "title"), size, weight: 700, color: c.fg, accent: c.accentText,
        at: at(0.5, 0.44), maxWidth: 0.74, in: { preset: "mask", at: 4, dur: 16, ease: "out", stagger: { by: "word", each: 3 } },
        ...V({ size: Math.round(size * 0.84), maxWidth: 0.86, at: at(0.5, 0.45) }),
      },
      {
        id: "rule", type: "shape", shape: "line", w: 180, thickness: 5, fill: c.accent,
        at: at(0.5, 0.56), in: { preset: "grow", at: 22, dur: 12, ease: "out" },
        ...V({ w: 160, at: at(0.5, 0.55) }),
      },
      S(p, "url") && {
        id: "url", type: "text", text: S(p, "url"), role: "mono", size: 32, weight: 400, color: c.dim,
        at: at(0.5, 0.66), maxWidth: 0.7, in: { preset: "fade", at: 32, dur: 12, ease: "out" },
        ...V({ size: 28, at: at(0.5, 0.63), maxWidth: 0.86 }),
      },
    ));
  },
};

/* ---------- the registry ---------- */

export const TEMPLATES: Record<string, MgTemplate> = Object.fromEntries(
  [title, statement, stat, list, compare, quote, lowerThird, chart, logo, cta, steps, split, kinetic, countdown, endCard].map((t) => [t.name, t]),
);

export const templateNames = (): string[] => Object.keys(TEMPLATES);

/** names a model or a person reaches for that mean one of ours */
const ALIASES: Record<string, string> = {
  headline: "title", cover: "title", opening: "title", hook: "title",
  claim: "statement", text: "statement", message: "statement",
  number: "stat", metric: "stat", kpi: "stat", stats: "stat",
  bullets: "list", points: "list", features: "list", checklist: "list",
  "vs": "compare", versus: "compare", "before-after": "compare", comparison: "compare",
  testimonial: "quote", pullquote: "quote",
  name: "lower-third", "name-tag": "lower-third", nametag: "lower-third", "lower-3rd": "lower-third",
  bars: "chart", "bar-chart": "chart", graph: "chart",
  brand: "logo", wordmark: "logo",
  "call-to-action": "cta", button: "cta",
  process: "steps", "how-it-works": "steps", timeline: "steps",
  hero: "split", feature: "split", "text-image": "split",
  typography: "kinetic", "kinetic-type": "kinetic",
  timer: "countdown",
  outro: "end-card", closing: "end-card", end: "end-card", "end-slate": "end-card",
};

export const resolveTemplate = (name: string): MgTemplate | undefined => {
  const k = String(name ?? "").trim().toLowerCase();
  return TEMPLATES[k] ?? TEMPLATES[ALIASES[k] ?? ""];
};

/* ---------- building a scene ---------- */

export const uniqueId = (base: string, taken: Iterable<string>): string => {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
};

/** the ground a scene takes when its params do not name one: ink and paper alternate so the film breathes */
export const alternateGround = (fallback: string, previous?: string): string => {
  if (!previous || previous !== fallback) return fallback;
  return fallback === "paper" ? "ink" : fallback === "ink" ? "paper" : fallback;
};

export type BuildOpts = {
  /** the scene's id; the template's name, made unique against `taken`, by default */
  id?: string;
  taken?: Iterable<string>;
  /** the ground of the scene before this one: an unset ground alternates away from it */
  previousGround?: string;
};

/**
 * A template and its parameters become a scene: layers, an id, and the record
 * of where it came from (`template`, `params`). The layers are the truth after
 * this; `mh template apply` builds them again from the recorded parameters.
 */
export const buildScene = (name: string, raw: MgParams = {}, opts: BuildOpts = {}): MgScene => {
  const tpl = resolveTemplate(name);
  if (!tpl) throw new Error(`no template "${name}" (have: ${templateNames().join(", ")})`);
  const params = { ...raw };
  if (params.ground === undefined && tpl.params.ground) params.ground = alternateGround(String(tpl.params.ground.default), opts.previousGround);
  const scene = tpl.build(coerceParams(tpl, params));
  scene.id = opts.id ?? uniqueId(tpl.name, opts.taken ?? []);
  scene.template = tpl.name;
  const given = givenParams(tpl, params);
  if (Object.keys(given).length) scene.params = given;
  else delete scene.params;
  return scene;
};

/** the scene a template writes with nothing but its defaults: what `mh template show` prints */
export const previewScene = (name: string): MgScene => buildScene(name);

type RawScene = Partial<MgScene> & { template?: string; params?: MgParams; layers?: Layer[] };

/**
 * Scenes given as `{ id, template, params }` become full scenes. The model may
 * answer with template scenes, `normalizeFilm` expands them, and a scene that
 * already has layers is left alone: after the first expansion the layers are
 * the truth.
 */
export const expandTemplates = <F extends { scenes?: unknown[] }>(film: F): F => {
  const raw = (Array.isArray(film.scenes) ? film.scenes : []) as RawScene[];
  if (!raw.some((s) => s && typeof s === "object" && s.template && !(Array.isArray(s.layers) && s.layers.length))) return film;
  const taken = new Set(raw.map((s) => (s && typeof s === "object" ? String(s.id ?? "") : "")).filter(Boolean));
  let previousGround: string | undefined;
  const scenes = raw.map((s) => {
    if (!s || typeof s !== "object") return s;
    const done = Array.isArray(s.layers) && s.layers.length > 0;
    if (done || !s.template || !resolveTemplate(s.template)) {
      previousGround = typeof s.ground === "string" ? s.ground : previousGround;
      return s;
    }
    // a scene may carry dur, ground and exit itself: they are the template's parameters by another name
    const params: MgParams = { ...(s.params ?? {}) };
    if (params.dur === undefined && typeof s.dur === "number") params.dur = s.dur;
    if (params.ground === undefined && typeof s.ground === "string") params.ground = s.ground;
    if (params.exit === undefined && s.exit && typeof s.exit === "object" && typeof (s.exit as { dur?: number }).dur === "number") params.exit = (s.exit as { dur: number }).dur;
    const id = s.id ? uniqueId(String(s.id), [...taken].filter((x) => x !== String(s.id))) : uniqueId(resolveTemplate(s.template)!.name, taken);
    taken.add(id);
    const scene = buildScene(s.template, params, { id, previousGround });
    if (typeof s.why === "string" && s.why.trim()) scene.why = s.why;
    if (typeof s.caption === "string" && s.caption.trim()) scene.caption = s.caption;
    previousGround = scene.ground;
    return scene;
  });
  return { ...film, scenes };
};

/** one line per template for a prompt or a help text: name, what it is, its parameters */
export const templateLines = (): string[] =>
  Object.values(TEMPLATES).map((t) => `${t.name}: ${t.description}. params: ${Object.entries(t.params).map(([k, s]) => `${k} (${s.type}${s.default === "" ? "" : `, default ${JSON.stringify(s.default)}`})`).join(", ")}`);

/** the compact list the film-writing model reads */
export const templatePromptBlock = (): string =>
  Object.values(TEMPLATES)
    .map((t) => `- ${t.name}: ${t.description}. params: ${Object.keys(t.params).filter((k) => k !== "exit" && k !== "accent" && k !== "groups").join(", ")}`)
    .join("\n");
