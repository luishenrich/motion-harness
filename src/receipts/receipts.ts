/**
 * Receipts: every command that writes something leaves a JSON record of what
 * went in (command, arguments, project, source hash) and what came out (files
 * with size and sha1), with status and duration. An agent that reads a receipt
 * knows whether the render it is about to trust came from the sources it is
 * looking at; a failed step is a receipt with status "failed", never silence.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, sha1File, stamp, writeJson } from "../util.ts";

export type Receipt = {
  id: string;
  command: string;
  args: Record<string, unknown>;
  positional: string[];
  project?: string;
  sourceHash?: string;
  engine?: string;
  startedAt: string;
  finishedAt?: string;
  ms?: number;
  status: "running" | "ok" | "failed";
  error?: string;
  outputs: { file: string; bytes: number; sha1: string }[];
  notes: string[];
};

let current: Receipt | null = null;
let dir: string | null = null;

export const startReceipt = (command: string, positional: string[], args: Record<string, unknown>): Receipt => {
  current = { id: `${stamp()}-${command}`, command, args, positional, startedAt: new Date().toISOString(), status: "running", outputs: [], notes: [] };
  return current;
};

/** where receipts go, once the project is known */
export const receiptDir = (cachePath: string, project: string, sourceHash?: string, engine?: string) => {
  dir = ensureDir(join(cachePath, "receipts"));
  if (current) {
    current.project = project;
    if (sourceHash) current.sourceHash = sourceHash;
    if (engine) current.engine = engine;
  }
};

/** a file this command produced; hashed when the receipt is written */
export const produced = (file: string) => {
  if (!current) return;
  if (!current.outputs.some((o) => o.file === file)) current.outputs.push({ file, bytes: 0, sha1: "" });
};

export const note = (s: string) => {
  current?.notes.push(s);
};

/** finish and write; returns the path, or null when no project was seen (nothing to file it under) */
export const endReceipt = (status: "ok" | "failed", error?: string): string | null => {
  if (!current) return null;
  const r = current;
  current = null;
  r.status = status;
  r.error = error;
  r.finishedAt = new Date().toISOString();
  r.ms = Date.parse(r.finishedAt) - Date.parse(r.startedAt);
  r.outputs = r.outputs.filter((o) => existsSync(o.file)).map((o) => ({ file: o.file, bytes: statSync(o.file).size, sha1: sha1File(o.file) }));
  if (!dir) return null;
  const file = join(dir, `${r.id}.json`);
  writeJson(file, r);
  return file;
};

export const currentReceipt = () => current;
