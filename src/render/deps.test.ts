import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { partDeps } from "./deps.ts";

test("partDeps walks relative imports and collects staticFile assets, ignores packages", () => {
  const d = mkdtempSync(join(tmpdir(), "deps-"));
  mkdirSync(join(d, "src/ui"), { recursive: true });
  writeFileSync(join(d, "src/A.tsx"), `import React from "react";\nimport { B } from "./ui/B";\nimport { staticFile } from "remotion";\nexport const A = () => staticFile("a.png");`);
  writeFileSync(join(d, "src/ui/B.tsx"), `import "./C";\nexport const B = 1; const x = staticFile('sfx/b.mp3');`);
  writeFileSync(join(d, "src/ui/C.ts"), `export const C = 2;`);
  const r = partDeps({ projectDir: d, publicPath: join(d, "public") } as any, join(d, "src/A.tsx"));
  expect(r.sources.map((s) => s.replace(d + "/", ""))).toEqual(["src/A.tsx", "src/ui/B.tsx", "src/ui/C.ts"]);
  expect(r.assets.map((s) => s.replace(d + "/", ""))).toEqual(["public/a.png", "public/sfx/b.mp3"]);
});
