import fs from "node:fs";
import path from "node:path";
import type { EngineState } from "./types";
import { emptyState } from "./types";

/**
 * Single local JSON file store. State lives in .data/state.json and is written
 * atomically (write a temp file, then rename over the target) so an interrupted
 * run can never leave a half-written file behind.
 */
const stateFile = path.join(process.cwd(), ".data", "state.json");

export function loadState(): EngineState {
  if (!fs.existsSync(stateFile)) return emptyState();
  const raw = fs.readFileSync(stateFile, "utf8");
  try {
    return JSON.parse(raw) as EngineState;
  } catch {
    // Never let a corrupt read wipe state implicitly. Surface it loudly.
    throw new Error("state.json exists but failed to parse. Refusing to overwrite it. Inspect it manually.");
  }
}

export function saveState(state: EngineState): void {
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}
