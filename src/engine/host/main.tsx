/**
 * The page the native engine drives. Mounts the project's Root once to collect
 * its compositions, then renders one composition at one frame on request.
 * Everything the renderer needs is on window.__mh: list, select, frame, probe.
 */
import React from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Root } from "virtual:mh-root";
// the same file the film reaches through the "remotion" alias, so contexts are shared
import { FrameContext, VideoConfigContext, __mh, type CompositionMeta } from "../shim/remotion.tsx";

declare global {
  interface Window {
    __mh: {
      ready: Promise<void>;
      compositions: () => Omit<CompositionMeta, "component">[];
      select: (id: string, inputProps?: Record<string, unknown>) => Promise<{ id: string; width: number; height: number; fps: number; durationInFrames: number }>;
      frame: (n: number, settleMs?: number) => Promise<{ frame: number; audioTags: number; ms: number }>;
      probe: (mode: "probe" | "text" | "all", settleMs?: number) => unknown;
      measure?: (mode: string, settleMs: number) => unknown;
    };
  }
}

const registryNode = document.getElementById("mh-registry")!;
const stageNode = document.getElementById("mh-stage")!;

let stage: ReactRoot | null = null;
let current: CompositionMeta | null = null;
let currentProps: Record<string, unknown> = {};
let frameNow = 0;

const raf2 = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const renderStage = () => {
  if (!stage || !current) return;
  const C = current.component;
  const cfg = { id: current.id, width: current.width, height: current.height, fps: current.fps, durationInFrames: current.durationInFrames, defaultProps: current.defaultProps, props: { ...current.defaultProps, ...currentProps } };
  flushSync(() => {
    stage!.render(
      <VideoConfigContext.Provider value={cfg}>
        <FrameContext.Provider value={frameNow}>
          <div style={{ position: "absolute", left: 0, top: 0, width: current!.width, height: current!.height, overflow: "hidden" }}>
            <C {...cfg.props} />
          </div>
        </FrameContext.Provider>
      </VideoConfigContext.Provider>,
    );
  });
};

const ready = (async () => {
  const b = __mh.bridge();
  const reg = createRoot(registryNode);
  flushSync(() => reg.render(<Root />));
  await __mh.settled();
  if (!b.registry.length) throw new Error("the Root registered no <Composition> or <Still>");
})();

window.__mh = {
  ready,
  compositions: () => __mh.bridge().registry.map(({ component, ...rest }) => rest),
  select: async (id, inputProps = {}) => {
    await ready;
    const meta = __mh.bridge().registry.find((c) => c.id === id);
    if (!meta) throw new Error(`no composition "${id}" (registered: ${__mh.bridge().registry.map((c) => c.id).join(", ")})`);
    if (stage) stage.unmount();
    stageNode.innerHTML = "";
    stage = createRoot(stageNode);
    current = meta;
    currentProps = inputProps;
    __mh.bridge().inputProps = inputProps;
    document.body.style.width = `${meta.width}px`;
    document.body.style.height = `${meta.height}px`;
    frameNow = 0;
    renderStage();
    await __mh.settled();
    return { id: meta.id, width: meta.width, height: meta.height, fps: meta.fps, durationInFrames: meta.durationInFrames };
  },
  frame: async (n, settleMs = 0) => {
    const t0 = performance.now();
    if (!current) throw new Error("select a composition first");
    frameNow = n;
    renderStage();
    await __mh.settled();
    if (document.fonts?.ready) await document.fonts.ready;
    await raf2();
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    return { frame: n, audioTags: __mh.bridge().audioTags, ms: Math.round(performance.now() - t0) };
  },
  probe: (mode, settleMs = 0) => {
    if (!window.__mh.measure) throw new Error("probe source not installed");
    return window.__mh.measure(mode, settleMs);
  },
};
