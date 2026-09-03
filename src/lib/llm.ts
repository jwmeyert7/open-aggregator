import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { loadPrompt, navSections, sectionIds } from "./config";
import type { CandidateItem, Cluster, SourceCandidate } from "./types";
import { truncate } from "./util";

/**
 * Two supported auth paths:
 *  - AI_GATEWAY_API_KEY → Vercel AI Gateway ("anthropic/claude-haiku-4-5" model strings)
 *  - ANTHROPIC_API_KEY  → direct Anthropic API
 * The gateway wins when both are set.
 */
function editorModel(): LanguageModel {
  const configured = process.env.LLM_MODEL;
  if (process.env.AI_GATEWAY_API_KEY) return configured || "anthropic/claude-haiku-4-5";
  return anthropic(configured?.replace(/^anthropic\//, "") || "claude-haiku-4-5");
}

/**
 * The stronger model for low-volume judgment calls: release-notes distillation,
 * chapter-to-story matching, and the day-in-review bullets. These run a few
 * times a day at most, so the quality tier costs cents a week. The 5-minute
 * editor call stays on the editor tier deliberately, that is where the LLM
 * budget lives.
 */
function qualityModel(): LanguageModel {
  const configured = process.env.QUALITY_LLM_MODEL;
  if (process.env.AI_GATEWAY_API_KEY) return configured || "anthropic/claude-sonnet-5";
  return anthropic(configured?.replace(/^anthropic\//, "") || "claude-sonnet-5");
}

/**
 * Section ids come from config at runtime, so every z.enum below is built
 * per call instead of hardcoded. z.enum needs a non-empty tuple type.
 */
function enumOf(ids: string[]) {
  return z.enum(ids as [string, ...string[]]);
}

/** One summary bullet, tagged with the section it belongs under so the UI can group them. */
function summaryBulletSchema(navIds: string[]) {
  return z.object({
    text: z.string().describe("ONE short standalone plain-language line under 120 characters"),
    section: enumOf(navIds).describe(
      "the section this bullet's story belongs to; for a cross-section thread pick where its weight sits"
    ),
    ref: z
      .string()
      .optional()
      .describe(
        "the id of the ONE story this line leans on most (an activeClusters/frontPageTop id, or the new:N ref of a cluster in this reply), so the site can link the line to it; omit when no single story anchors the line"
      ),
    why: z
      .string()
      .optional()
      .describe(
        "ONLY when this line is new or differs from the currentSummary line for its section: one short reason under 90 characters naming the item or story that changed it; omit when the line is carried over verbatim"
      ),
    moreRefs: z
      .array(
        z.object({
          phrase: z.string().describe("the EXACT words from this line's text that state the additional story, verbatim"),
          ref: z.string().describe("that story's id (an activeClusters/frontPageTop id, or a new:N ref)"),
        })
      )
      .optional()
      .describe(
        "when the line names MORE stories than the ref one (a comma-joined pair), each additional story's exact phrase plus its id, so the site links each mention to its own story"
      ),
  });
}

export interface SummaryBullet {
  text: string;
  section: string;
  ref?: string;
  /** the editor's short reason when the line is new or changed from the current box */
  why?: string;
  moreRefs?: Array<{ phrase: string; ref: string }>;
}

export interface EditorOutput {
  items: Array<{ id: string; pass: boolean; rejectReason?: string; clusterRef?: string }>;
  clusters: Array<{
    ref: string;
    headline: string;
    explainer: string;
    section: string;
    alsoIn?: string;
    importance: number;
    centrality?: number;
    keywords: string[];
    opinion?: boolean;
  }>;
  frontSummary?: SummaryBullet[];
}

function editorSchema(navIds: string[], allIds: string[]) {
  return z.object({
    items: z.array(
      z.object({
        id: z.string(),
        pass: z.boolean(),
        rejectReason: z.string().optional(),
        clusterRef: z.string().optional().describe("existing cluster id, or new:N for a new cluster; required when pass=true"),
      })
    ),
    clusters: z.array(
      z.object({
        ref: z.string().describe("new:N for new clusters, or an existing cluster id being updated"),
        headline: z.string(),
        explainer: z.string().describe("one standalone capitalized plain-language sentence on why the story matters"),
        section: enumOf(allIds),
        alsoIn: enumOf(navIds)
          .optional()
          .describe(
            "RARE: a second section only when the story genuinely belongs to two (judge by the section descriptions in `sections`: a product story whose subject is also a regulatory event, a research result that is also a shipped release). Omit for almost every story; never the same as section; never for general."
          ),
        importance: z.number().min(1).max(5),
        centrality: z
          .number()
          .min(1)
          .max(5)
          .describe(
            "how specifically about the site's topic: 5 = the topic is the subject, 3 = an ecosystem actor, 1 = tangential angle"
          ),
        keywords: z.array(z.string()).max(8),
        opinion: z
          .boolean()
          .optional()
          .describe("true ONLY when the story is an opinion essay admitted under the opinion exception; never for factual reporting"),
      })
    ),
    frontSummary: z
      .array(summaryBulletSchema(navIds))
      .max(4)
      .optional()
      .describe(
        "3 bullets (4 at the most) describing what the front page is leading with right now, top ranked story first; empty array if nothing substantial is active"
      ),
  });
}

export function llmAvailable(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.ANTHROPIC_API_KEY);
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

export async function classifyAndCluster(
  newItems: Array<CandidateItem & { id: string }>,
  activeClusters: Cluster[],
  prompt: "cluster" | "add-by-url" = "cluster",
  /**
   * What the front page is currently leading with, so the summary describes the
   * real page. In weekend mode the page leads with the week, so the summary is
   * written about weekTop instead.
   */
  ctx: {
    frontPageTop?: Cluster[];
    weekTop?: Cluster[];
    weekendMode?: boolean;
    /** the Latest in box as it shows now, so the editor carries lines over verbatim and explains what it changes */
    currentSummary?: Array<{ section: string; ref?: string; text: string }>;
  } = {}
): Promise<EditorOutput> {
  const sections = navSections();
  const headlines = (list?: Cluster[]) => (list ?? []).map((c) => ({ id: c.id, headline: c.headline, section: c.section }));
  const { object } = await generateObject({
    model: editorModel(),
    schema: editorSchema(
      sections.map((s) => s.id),
      sectionIds()
    ),
    messages: [
      {
        role: "system",
        content: loadPrompt(prompt),
        // The rulebook is byte-identical every run. Caching it means cron
        // runs that land inside the cache window read it at a tenth of the
        // input price instead of re-paying full freight. The editor only runs
        // when new items arrive, which can be well over five minutes apart,
        // so the one hour TTL keeps the cache warm between calls (the five
        // minute default was expiring between runs and losing money on
        // writes). The per-run payload below stays uncached. Harmless when
        // the prompt is below the model's cacheable minimum: it simply does
        // not cache.
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
      },
      {
        role: "user",
        content: JSON.stringify({
          todayUtc: new Date().toISOString().slice(0, 10),
          // the valid section ids with their meanings, so the prompt can stay generic
          sections: sections.map((s) => ({ id: s.id, title: s.title, description: s.description })),
          weekendMode: Boolean(ctx.weekendMode),
          frontPageTop: headlines(ctx.frontPageTop),
          weekTop: headlines(ctx.weekTop),
          currentSummary: ctx.currentSummary ?? [],
          activeClusters: clusterDigest(activeClusters),
          newItems: itemPayload(newItems),
        }),
      },
    ],
  });
  return object as EditorOutput;
}

/**
 * Reconsider the existing front summary against the page's current stories,
 * without a full editor pass. The prompt reuses still-accurate lines verbatim,
 * so a refresh only changes what the underlying stories no longer support.
 */
export async function refreshFrontSummary(
  current: SummaryBullet[],
  frontPageTop: Cluster[],
  weekend: boolean
): Promise<SummaryBullet[]> {
  const sections = navSections();
  const { object } = await generateObject({
    model: editorModel(),
    schema: z.object({
      frontSummary: z
        .array(summaryBulletSchema(sections.map((s) => s.id)))
        .max(4)
        .describe("the full summary: still-accurate lines verbatim, broken lines rewritten"),
    }),
    system: loadPrompt("summary-refresh"),
    prompt: JSON.stringify({
      todayUtc: new Date().toISOString().slice(0, 10),
      // the valid section ids with their meanings, so the prompt can stay generic
      sections: sections.map((s) => ({ id: s.id, title: s.title, description: s.description })),
      weekendMode: weekend,
      currentSummary: current,
      frontPageTop: frontPageTop.map((c) => ({ id: c.id, headline: c.headline, explainer: c.explainer, section: c.section })),
    }),
  });
  return object.frontSummary as SummaryBullet[];
}

/**
 * Which podcast chapters are about which current stories. Word overlap cannot
 * tell "Why EIP-8363 Is So Contentious" from a roundup that lists EIP-8363,
 * so this is a judgment call: one small batched call, "no match" the normal
 * answer, used by the show-notes linker for chapters that carry no URL.
 */
export async function matchChaptersToStories(
  episodes: Array<{ id: string; show: string; title: string; chapters: Array<{ at: number; label: string }> }>,
  stories: Array<{ id: string; headline: string }>
): Promise<Array<{ episodeId: string; at: number; storyId: string }>> {
  if (episodes.length === 0 || stories.length === 0) return [];
  const { object } = await generateObject({
    model: qualityModel(),
    schema: z.object({
      matches: z.array(
        z.object({
          episodeId: z.string(),
          at: z.number().describe("the chapter's time in seconds, exactly as given"),
          storyId: z.string().describe("the id of the ONE story this chapter is about"),
        })
      ),
    }),
    system: loadPrompt("chapter-match"),
    prompt: JSON.stringify({ episodes, stories }),
  });
  const storyIds = new Set(stories.map((s) => s.id));
  const episodeIds = new Set(episodes.map((e) => e.id));
  return object.matches.filter((m) => storyIds.has(m.storyId) && episodeIds.has(m.episodeId));
}

/** Distills a software release's notes into a themed headline and explainer. */
export async function summarizeRelease(input: { source: string; title: string; notes: string }): Promise<{ headline: string; explainer: string }> {
  const { object } = await generateObject({
    model: qualityModel(),
    schema: z.object({
      headline: z.string().describe("short declarative phrase, ten words or fewer, naming project, version, and the release's essence"),
      explainer: z.string().describe("one or two sentences under 60 words naming the major themes concretely"),
    }),
    system: loadPrompt("release-summary"),
    prompt: JSON.stringify(input),
  });
  return object;
}

/**
 * Compress digest-thread lines into complete phrases that fit a tweet. Each
 * input carries its own character budget; the output keeps the concrete
 * facts and never trails off.
 */
export async function compressTweetLines(lines: Array<{ text: string; max: number }>): Promise<string[]> {
  const { object } = await generateObject({
    model: editorModel(),
    schema: z.object({
      lines: z.array(z.string()).describe("one compressed line per input line, same order"),
    }),
    system: [
      "You compress news headlines for a social post. For each input return ONE complete phrase at or under its max characters, keeping the concrete facts (who did what).",
      "Never use an ellipsis or trail off mid-phrase. No em dashes, en dashes, or semicolons. Plain language, no hype. Return exactly one output line per input, in order.",
      "No headline jargon, even to save characters: probes, eyes, mulls, touts, slams, inks, taps, unveils, dubs, amid, poised, set to. Use the plain verb (examines, considers, announces) or drop the clause.",
    ].join("\n"),
    prompt: JSON.stringify(lines),
  });
  return object.lines;
}

/** Day-in-review bullets for a frozen daily digest: one small call, best-effort at the call site. */
export async function dayInReview(date: string, clusters: Cluster[]): Promise<SummaryBullet[]> {
  const sections = navSections();
  const { object } = await generateObject({
    model: qualityModel(),
    schema: z.object({
      summary: z
        .array(summaryBulletSchema(sections.map((s) => s.id)))
        .max(4)
        .describe("3 bullets (4 at the most) reviewing the day, each ONE short past-tense plain-language line under 120 characters"),
    }),
    system: loadPrompt("day-summary"),
    prompt: JSON.stringify({
      date,
      sections: sections.map((s) => ({ id: s.id, title: s.title, description: s.description })),
      stories: clusters.map((c) => ({
        headline: c.headline,
        explainer: c.explainer,
        section: c.section,
        importance: c.importance,
      })),
    }),
  });
  return object.summary as SummaryBullet[];
}

/** Week- or month-in-review bullets for a frozen rollup edition: one small call, best-effort at the call site. */
export async function periodInReview(period: string, clusters: Cluster[]): Promise<SummaryBullet[]> {
  const sections = navSections();
  const { object } = await generateObject({
    model: qualityModel(),
    schema: z.object({
      summary: z
        .array(summaryBulletSchema(sections.map((s) => s.id)))
        .max(5)
        .describe("one or two bullets per section reviewing the period, 5 at the most, each ONE short past-tense plain-language line under 120 characters"),
    }),
    system: loadPrompt("period-summary"),
    prompt: JSON.stringify({
      period,
      sections: sections.map((s) => ({ id: s.id, title: s.title, description: s.description })),
      stories: clusters.map((c) => ({
        headline: c.headline,
        explainer: c.explainer,
        section: c.section,
        importance: c.importance,
      })),
    }),
  });
  return object.summary as SummaryBullet[];
}

/**
 * The media gate: one batched yes/no read over new tier-2 episodes. Cheaper
 * and blunter than the news gate on purpose: an episode is either
 * substantially about the site's topic or it is not, and a wrong "no" costs
 * one invisible episode while a wrong "yes" puts noise on the shelf. The
 * rulebook (media-gate.md) therefore says to exclude when unsure.
 */
export interface MediaVerdict {
  onTopic: boolean;
  section?: string;
}

export async function gateMediaItems(
  episodes: Array<{ id: string; show: string; title: string; excerpt?: string }>
): Promise<Record<string, MediaVerdict>> {
  const sections = navSections();
  const { object } = await generateObject({
    model: editorModel(),
    schema: z.object({
      verdicts: z.array(
        z.object({
          id: z.string(),
          onTopic: z
            .boolean()
            .describe("true only when the episode is substantially about the site's topic"),
          section: enumOf(sections.map((s) => s.id))
            .optional()
            .describe("when onTopic is true: the one section from `sections` the episode fits best, a label for where it also appears"),
        })
      ),
    }),
    messages: [
      {
        role: "system",
        content: loadPrompt("media-gate"),
        // byte-identical every run, same caching rationale as the cluster rulebook
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
      },
      {
        role: "user",
        content: JSON.stringify({
          // the valid section ids with their meanings, so the prompt can stay generic
          sections: sections.map((s) => ({ id: s.id, title: s.title, description: s.description })),
          episodes: episodes.map((e) => ({
            id: e.id,
            show: e.show,
            title: e.title,
            description: e.excerpt ? truncate(e.excerpt, 400) : undefined,
          })),
        }),
      },
    ],
  });
  return Object.fromEntries(object.verdicts.map((v) => [v.id, { onTopic: v.onTopic, section: v.section }]));
}

/**
 * One editor read per source candidate: what the domain publishes, why the
 * discovery channel keeps linking it, and where its stories would land. One
 * batched call, best-effort at the call site, written once and kept on the
 * candidate.
 */
export async function assessSourceCandidates(
  candidates: SourceCandidate[]
): Promise<Record<string, { why: string; sections: string[] }>> {
  const sections = navSections();
  const { object } = await generateObject({
    model: editorModel(),
    schema: z.object({
      reads: z.array(
        z.object({
          host: z.string(),
          why: z
            .string()
            .describe(
              "ONE standalone sentence under 160 characters: what this domain publishes and why the channel is linking it, grounded in the example casts"
            ),
          sections: z
            .array(enumOf(sections.map((s) => s.id)))
            .min(1)
            .max(2)
            .describe("the section(s) this domain's stories would mostly land in"),
        })
      ),
    }),
    system: loadPrompt("source-candidate"),
    prompt: JSON.stringify({
      sections: sections.map((s) => ({ id: s.id, title: s.title, description: s.description })),
      candidates: candidates.map((c) => ({
        host: c.host,
        casts: c.casts,
        engagement: c.engagement,
        examples: c.examples.slice(0, 3).map((e) => ({ url: e.url, author: e.author, text: truncate(e.text, 240) })),
      })),
    }),
  });
  return Object.fromEntries(object.reads.map((r) => [r.host, { why: r.why, sections: r.sections as string[] }]));
}

/**
 * No-LLM fallback (missing key or API failure): tier-1 items become their own
 * single-link clusters flagged needsReview; tier-2 items are skipped because
 * the editorial gate can't run. Keeps the site alive, degrades honestly.
 */
export function heuristicFallback(newItems: Array<CandidateItem & { id: string }>): EditorOutput {
  const fallbackSection = navSections()[0]?.id ?? "general";
  const items: EditorOutput["items"] = [];
  const clusters: EditorOutput["clusters"] = [];
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
      headline: truncate(item.title, 100),
      explainer: "",
      section: item.sectionHint ?? fallbackSection,
      importance: 2,
      centrality: 3,
      keywords: [],
    });
  }
  return { items, clusters };
}
