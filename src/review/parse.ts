/**
 * Free-text feedback, the way a reviewer writes it ("bei 1:09", "Sekunde 19-21",
 * "ab 44s", "bei New Lecture", "beim Klicken auf Check", "die Topic Map"), turned
 * into scene addresses. German and English. Every sentence gets the moments it
 * names; phrases that look like a reference but resolve to nothing are listed
 * so the agent asks instead of guessing.
 */
import { probeSpec, type Compiled, CompiledScene } from "../timeline/schema.ts";
import { resolve, locate, type Location } from "../timeline/resolve.ts";

export type Hit = {
  /** the words in the sentence that produced this hit */
  phrase: string;
  kind: "time" | "range" | "from" | "ref" | "scene" | "event" | "text" | "element";
  /** what matched: a scene id, "scene.event", the text or why fragment, a probe key */
  via: string;
  /** canonical reference the CLI accepts ("f1234", "card.click") */
  ref: string;
  location: Location;
  /** for ranges: the last frame */
  until?: Location;
  /** the seconds asked for lie past the film end; the location is clamped to the last frame */
  past?: number;
};

export type ParsedSentence = { text: string; hits: Hit[]; unresolved: string[] };

type Span = { start: number; end: number };
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

const UNIT = "(?:s|sec|sek|secs|seconds?|sekunden?)";
const NUM = "\\d+(?:[.,]\\d+)?";
const MSS = "\\d{1,3}:\\d{2}(?:[.,]\\d+)?";
const SEP = "(?:-|–|—|bis|to|until)";

const toSeconds = (s: string): number => {
  const t = s.replace(",", ".").trim();
  const m = t.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  return parseFloat(t);
};

/** split into sentences: newlines, bullets, and .!? followed by whitespace (a decimal like 20.5 has no space) */
export const splitSentences = (text: string): string[] =>
  text
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((s) => s.length > 1);

const camelWords = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").toLowerCase();

/** small bridge from reviewer verbs to event names, both languages */
const SYNONYMS: Record<string, string[]> = {
  click: ["klick", "klicken", "klickt", "geklickt", "clicking", "clicks", "clicked", "tap", "tippen"],
  hover: ["hovern", "hovert", "schwebt", "mouseover"],
  reveal: ["aufdecken", "aufgedeckt", "reveals", "revealed"],
  score: ["punkte", "punktzahl", "wertung", "scored"],
};

const wordRe = (w: string) => new RegExp(`(?<![\\w])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "gi");

/** every place a needle occurs in the sentence, as spans */
const findAll = (hay: string, needle: string, whole = true): Span[] => {
  if (!needle.trim()) return [];
  const re = whole ? wordRe(needle) : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const out: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
};

const STOP = new Set(["the", "and", "for", "with", "that", "this", "your", "you", "are", "not", "der", "die", "das", "und", "ein", "eine", "ist", "mit", "auf", "für", "von", "nicht", "now", "used", "one", "gets"]);

/** n-grams (2+ words) and long single words of a scene's text/why that occur in the sentence */
const phraseHits = (sentence: string, source: string): { span: Span; phrase: string }[] => {
  const words = camelWords(source).split(/[^a-z0-9äöüß]+/i).filter(Boolean);
  const out: { span: Span; phrase: string }[] = [];
  const hay = sentence;
  // longest n-grams first, so "topic map" wins over "map"
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (n === 1 && (gram[0].length < 5 || STOP.has(gram[0]))) continue;
      if (n > 1 && gram.every((w) => STOP.has(w))) continue;
      const needle = gram.join("\\s+");
      const re = new RegExp(`(?<![\\w])${needle}(?![\\w])`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(hay))) {
        const span = { start: m.index, end: m.index + m[0].length };
        if (!out.some((o) => overlaps(o.span, span))) out.push({ span, phrase: m[0] });
      }
    }
  }
  return out;
};

export const parseSentence = (c: Compiled, sentence: string): ParsedSentence => {
  const hits: (Hit & { span: Span })[] = [];
  const taken: Span[] = [];
  const claim = (span: Span) => {
    if (taken.some((t) => overlaps(t, span))) return false;
    taken.push(span);
    return true;
  };
  const time = (secs: number) => locate(c, Math.round(secs * c.fps));
  const past = (secs: number) => (Math.round(secs * c.fps) >= c.dur ? secs : undefined);
  const add = (span: Span, h: Omit<Hit, "phrase">) => {
    if (!claim(span)) return;
    hits.push({ ...h, phrase: sentence.slice(span.start, span.end), span });
  };
  const re = (src: string) => new RegExp(src, "gi");
  const each = (r: RegExp, fn: (m: RegExpExecArray, span: Span) => void) => {
    let m: RegExpExecArray | null;
    while ((m = r.exec(sentence))) fn(m, { start: m.index, end: m.index + m[0].length });
  };

  /* 1. ranges: "Sekunde 19-21", "19-21s", "1:09 bis 1:12", "from 19 to 21 seconds" */
  each(re(`(?:sekunden?|seconds?|secs?|sek)\\s*(${MSS}|${NUM})\\s*${SEP}\\s*(${MSS}|${NUM})\\s*${UNIT}?(?![\\w])`), (m, span) => {
    const a = toSeconds(m[1]), b = toSeconds(m[2]);
    add(span, { kind: "range", via: `${a}s-${b}s`, ref: `${a}s`, location: time(a), until: time(b), past: past(a) });
  });
  each(re(`(${MSS}|${NUM})\\s*${UNIT}?\\s*${SEP}\\s*(${MSS}|${NUM})\\s*(${UNIT})?(?![\\w])`), (m, span) => {
    const hasColon = m[1].includes(":") || m[2].includes(":");
    const unitA = /^(\d+(?:[.,]\d+)?)\s*(s|sec|sek|secs|seconds?|sekunden?)/i.test(sentence.slice(m.index));
    if (!hasColon && !m[3] && !unitA) return; // "3-4 Zeilen" is not a time range
    const a = toSeconds(m[1]), b = toSeconds(m[2]);
    if (b < a) return;
    add(span, { kind: "range", via: `${a}s-${b}s`, ref: `${a}s`, location: time(a), until: time(b), past: past(a) });
  });

  /* 2. open ranges: "ab 44s", "from 1:09", "after 20s" */
  each(re(`(?:ab|from|after|nach|since|seit)\\s+(?:sekunde|second|sec)?\\s*(${MSS}|${NUM}\\s*${UNIT})(?![\\w])`), (m, span) => {
    const a = toSeconds(m[1].replace(/[a-z]+$/i, ""));
    add(span, { kind: "from", via: `${a}s`, ref: `${a}s`, location: time(a), past: past(a) });
  });

  /* 3. single moments: "1:09", "Sekunde 19", "44s", "at 20 seconds" */
  each(re(`(?<![\\d:])(${MSS})(?![\\d:])`), (m, span) => {
    const a = toSeconds(m[1]);
    add(span, { kind: "time", via: `${a}s`, ref: `${a}s`, location: time(a), past: past(a) });
  });
  each(re(`(?:sekunde|second|sec|sek)\\s*(${NUM})(?![\\w:])`), (m, span) => {
    const a = toSeconds(m[1]);
    add(span, { kind: "time", via: `${a}s`, ref: `${a}s`, location: time(a), past: past(a) });
  });
  each(re(`(?<![\\w:.,])(${NUM})\\s*${UNIT}(?![\\w])`), (m, span) => {
    const a = toSeconds(m[1]);
    add(span, { kind: "time", via: `${a}s`, ref: `${a}s`, location: time(a), past: past(a) });
  });

  /* 4. explicit harness references: "card.click", "card+12", "card.click+4", "f616", "#7", "product:f120" */
  each(re(`(?<![\\w.])([A-Za-z_]\\w*(?:-[A-Za-z_]\\w*)*)(?:\\.([A-Za-z_]\\w*)|\\:f\\d+)?(?:[+-]\\d+)?(?![\\w-])`), (m, span) => {
    const raw = m[0];
    if (!/[.+:]|-\d/.test(raw)) return; // bare words are handled by the scene / event pass
    try {
      const L = resolve(c, raw);
      add(span, { kind: "ref", via: raw, ref: raw, location: L });
    } catch {
      /* not a reference */
    }
  });
  each(re(`(?<![\\w])(f\\d{2,}|#\\d+)(?![\\w])`), (m, span) => {
    try {
      const L = resolve(c, m[1]);
      add(span, { kind: "ref", via: m[1], ref: m[1], location: L });
    } catch {
      /* ignore */
    }
  });

  /* 5. scene ids, literal or as words ("topic-map" as "topic map") */
  const sceneHits = new Map<string, Span>();
  for (const s of c.scenes) {
    const forms = [s.id, camelWords(s.id)];
    for (const f of forms) {
      const spans = findAll(sentence, f, true);
      const sp = spans.find((x) => !taken.some((t) => overlaps(t, x)));
      if (sp) {
        add(sp, { kind: "scene", via: s.id, ref: s.id, location: resolve(c, s.id) });
        sceneHits.set(s.id, sp);
        break;
      }
    }
  }

  /* 6. event names, literal, camel-split, stemmed, or via a verb synonym; a scene named in the sentence wins */
  const eventOwners = new Map<string, CompiledScene[]>();
  for (const s of c.scenes) for (const e of s.events) eventOwners.set(e.name, [...(eventOwners.get(e.name) ?? []), s]);
  for (const [name, owners] of eventOwners) {
    const forms = new Set<string>([name, camelWords(name), ...(SYNONYMS[name.toLowerCase()] ?? [])]);
    const stems = [...forms].map((f) => `${f}(?:s|ed|ing|en|t|st)?`);
    let found: Span | null = null;
    for (const f of stems) {
      const r = new RegExp(`(?<![\\w])${f}(?![\\w])`, "gi");
      let m: RegExpExecArray | null;
      while ((m = r.exec(sentence))) {
        const sp = { start: m.index, end: m.index + m[0].length };
        if (!taken.some((t) => overlaps(t, sp))) {
          found = sp;
          break;
        }
      }
      if (found) break;
    }
    if (!found) continue;
    const named = owners.filter((o) => sceneHits.has(o.id));
    const targets = named.length ? named : owners;
    // one span, possibly several scenes: claim once, push one hit per owner
    if (!claim(found)) continue;
    for (const s of targets) {
      const ref = `${s.id}.${name}`;
      hits.push({ phrase: sentence.slice(found.start, found.end), kind: "event", via: ref, ref, location: resolve(c, ref), span: found });
    }
  }

  /* 7. words of a scene's text / why, and probe keys (elements) */
  for (const s of c.scenes) {
    if (sceneHits.has(s.id)) continue;
    const sources = [...(s.text ?? []), ...(s.why ? [s.why] : [])];
    for (const src of sources) {
      const ph = phraseHits(sentence, src).filter((p) => !taken.some((t) => overlaps(t, p.span)));
      if (!ph.length) continue;
      const best = ph.sort((a, b) => b.span.end - b.span.start - (a.span.end - a.span.start))[0];
      add(best.span, { kind: "text", via: `${s.id}: "${src.length > 40 ? src.slice(0, 40) + "…" : src}"`, ref: s.id, location: resolve(c, s.id) });
      sceneHits.set(s.id, best.span);
      break;
    }
  }
  for (const s of c.scenes) {
    for (const spec of s.probes) {
      const key = probeSpec(spec).key;
      const ph = phraseHits(sentence, key).filter((p) => !taken.some((t) => overlaps(t, p.span)));
      if (!ph.length) continue;
      add(ph[0].span, { kind: "element", via: `${s.id} probe ${key}`, ref: s.id, location: resolve(c, s.id) });
    }
  }

  /* 8. unresolved: quoted strings, Capitalised runs, and word.word / word+N tokens nothing claimed */
  const unresolved: string[] = [];
  const cand = (r: RegExp) =>
    each(r, (m, span) => {
      const phrase = (m[1] ?? m[0]).trim();
      if (phrase.length < 3) return;
      if (taken.some((t) => overlaps(t, span))) return;
      if (span.start === 0 && !/["„“']/.test(m[0]) && !/[.+]/.test(phrase)) return; // sentence-initial capital is grammar, not a name
      if (!unresolved.includes(phrase)) unresolved.push(phrase);
    });
  cand(/["„“']([^"“”']{3,60})["“”']/g);
  cand(/(?<![\w])((?:[A-ZÄÖÜ][\w-]+)(?:\s+[A-ZÄÖÜ][\w-]+)+)(?![\w])/g);
  cand(/(?<![\w.])([A-Za-z_][\w-]*(?:\.[A-Za-z_]\w*|\+\d+))(?![\w])/g);

  return { text: sentence, hits: hits.sort((a, b) => a.span.start - b.span.start).map(({ span: _s, ...h }) => h), unresolved };
};

export const parseFeedback = (c: Compiled, text: string): ParsedSentence[] => splitSentences(text).map((s) => parseSentence(c, s));

/** agent-readable report */
export const feedbackReport = (c: Compiled, parsed: ParsedSentence[], fmtTime: (frame: number, fps: number) => string): string => {
  const L: string[] = [];
  const nothing: string[] = [];
  for (const p of parsed) {
    L.push(`> ${p.text}`);
    if (!p.hits.length) L.push(`  (no address found)`);
    for (const h of p.hits) {
      const a = h.location;
      const at = `${a.scene.id}+${a.local}  film ${fmtTime(a.filmFrame, c.fps)} f${a.filmFrame}`;
      const to = h.until ? `  ..  ${h.until.scene.id}+${h.until.local}  film ${fmtTime(h.until.filmFrame, c.fps)} f${h.until.filmFrame}` : "";
      const tail = h.past !== undefined ? `  PAST FILM END (asked ${h.past}s, film ends ${fmtTime(c.dur, c.fps)})` : h.kind === "from" ? "  (from here on)" : a.inTransition && !h.until ? "  IN TRANSITION" : "";
      L.push(`  ${h.kind.padEnd(7)} "${h.phrase}"  ->  ${at}${to}${tail}   [${h.ref}]${h.via !== h.ref ? `  via ${h.via}` : ""}`);
    }
    for (const u of p.unresolved) {
      L.push(`  ??      "${u}"  resolved to nothing`);
      nothing.push(u);
    }
    L.push("");
  }
  const total = parsed.reduce((n, p) => n + p.hits.length, 0);
  L.push(`${parsed.length} sentence${parsed.length === 1 ? "" : "s"}, ${total} address${total === 1 ? "" : "es"}, ${nothing.length} unresolved${nothing.length ? `: ${nothing.map((u) => `"${u}"`).join(", ")}` : ""}`);
  return L.join("\n");
};
