import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { loadPrompt } from "./config";
import type { CandidateItem, Cluster } from "./types";
import { truncate } from "./util";

/**
 * Two supported auth paths:
 *  - AI_GATEWAY_API_KEY reaches Anthropic through the Vercel AI Gateway, using
 *    model strings like "anthropic/claude-haiku-4-5".
 *  - ANTHROPIC_API_KEY calls the Anthropic API directly.
 * The gateway wins when both are set. Override the model with LLM_MODEL.
 */
function editorModel(): LanguageModel {
  const configured = process.env.LLM_MODEL;
  if (process.env.AI_GATEWAY_API_KEY) return configured || "anthropic/claude-haiku-4-5";
  return anthropic(configured?.replace(/^anthropic\//, "") || "claude-haiku-4-5");
}

export function llmAvailable(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export interface EditorItemDecision {
  id: string;
  pass: boolean;
  rejectReason?: string;
  /** existing cluster id, or new:N for a new cluster. Required when pass is true. */
  clusterRef?: string;
}

export interface EditorClusterEntry {
  ref: string;
  headline: string;
  explainer: string;
  section: string;
  importance: number;
  keywords: string[];
}

export interface EditorOutput {
  items: EditorItemDecision[];
  clusters: EditorClusterEntry[];
}

/**
 * The output schema, built for the sections this deployment actually defines so
 * the model can only assign a real section id.
 */
function editorSchema(sectionIds: string[]) {
  const sectionType =
    sectionIds.length > 0 ? z.enum(sectionIds as [string, ...string[]]) : z.string();
  return z.object({
    items: z.array(
      z.object({
        id: z.string(),
        pass: z.boolean(),
        rejectReason: z.string().optional(),
        clusterRef: z
          .string()
          .optional()
          .describe("existing cluster id, or new:N for a new cluster; required when pass=true"),
      })
    ),
    clusters: z.array(
      z.object({
        ref: z.string().describe("new:N for new clusters, or an existing cluster id being updated"),
        headline: z.string(),
        explainer: z.string().describe("one standalone capitalized plain-language sentence on why the story matters"),
        section: sectionType,
        importance: z.number().min(1).max(5),
        keywords: z.array(z.string()).max(8),
      })
    ),
  });
}

/** Compact digest of active clusters so new items can join existing stories cheaply. */
export function clusterDigest(clusters: Cluster[]): Array<Record<string, unknown>> {
  return clusters.map((c) => ({
    id: c.id,
    headline: c.headline,
    section: c.section,
    keywords: c.keywords,
  }));
}

function itemPayload(items: Array<CandidateItem & { id: string }>) {
  return items.map((i) => ({
    id: i.id,
    title: i.title,
    excerpt: i.excerpt ? truncate(i.excerpt, 300) : undefined,
    engagement: i.engagement
      ? `${i.engagement.replies} replies, ${i.engagement.likes} likes, ${i.engagement.views} views`
      : undefined,
    url: i.url,
    source: i.sourceName,
    tier: i.tier,
    sectionHint: i.sectionHint,
    publishedAt: i.publishedAt,
  }));
}

/**
 * The single editorial call: gate, cluster, headline, explain, section, and
 * score a batch of new items against the active clusters. The prompt comes from
 * config/prompts/cluster.md and the valid section ids are handed to the model.
 */
export async function classifyAndCluster(
  newItems: Array<CandidateItem & { id: string }>,
  activeClusters: Cluster[],
  sectionIds: string[]
): Promise<EditorOutput> {
  const { object } = await generateObject({
    model: editorModel(),
    schema: editorSchema(sectionIds),
    system: loadPrompt("cluster"),
    prompt: JSON.stringify({
      todayUtc: new Date().toISOString().slice(0, 10),
      sections: sectionIds,
      activeClusters: clusterDigest(activeClusters),
      newItems: itemPayload(newItems),
    }),
  });
  return object as EditorOutput;
}

/**
 * No-LLM fallback (missing key or API failure): tier-1 items become their own
 * single-link clusters, tier-2 items are skipped because the editorial gate
 * cannot run. Keeps the page alive and degrades honestly.
 */
export function heuristicFallback(
  newItems: Array<CandidateItem & { id: string }>,
  defaultSection: string
): EditorOutput {
  const items: EditorItemDecision[] = [];
  const clusters: EditorClusterEntry[] = [];
  let n = 0;
  for (const item of newItems) {
    if (item.tier !== 1) {
      items.push({ id: item.id, pass: false, rejectReason: "tier-2 gate unavailable (LLM offline)" });
      continue;
    }
    n += 1;
    const ref = `new:${n}`;
    items.push({ id: item.id, pass: true, clusterRef: ref });
    clusters.push({
      ref,
      headline: truncate(item.title, 130),
      explainer: item.excerpt ? truncate(item.excerpt, 200) : "",
      section: item.sectionHint ?? defaultSection,
      importance: 2,
      keywords: [],
    });
  }
  return { items, clusters };
}
