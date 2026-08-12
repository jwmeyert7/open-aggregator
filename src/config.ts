import fs from "node:fs";
import path from "node:path";
import type { EngineConfig, FeedConfig } from "./types";

const configDir = path.join(process.cwd(), "config");

/**
 * Read a config file off disk, falling back to its committed .example version
 * when the user has not created their own. This is what lets the engine run out
 * of the box: with no feeds.json present, feeds.example.json is used instead.
 */
function readConfigFile(name: string, exampleName: string): string {
  const primary = path.join(configDir, name);
  if (fs.existsSync(primary)) return fs.readFileSync(primary, "utf8");
  const example = path.join(configDir, exampleName);
  if (fs.existsSync(example)) return fs.readFileSync(example, "utf8");
  throw new Error(`Missing config: neither ${name} nor ${exampleName} exists in ${configDir}`);
}

export function loadFeeds(): FeedConfig[] {
  const parsed = JSON.parse(readConfigFile("feeds.json", "feeds.example.json")) as { feeds: FeedConfig[] };
  return parsed.feeds;
}

export function loadEngineConfig(): EngineConfig {
  return JSON.parse(readConfigFile("sections.json", "sections.example.json")) as EngineConfig;
}

export function loadPrompt(name: "cluster"): string {
  return readConfigFile(path.join("prompts", `${name}.md`), path.join("prompts", `${name}.example.md`));
}
