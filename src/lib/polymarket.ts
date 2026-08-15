/**
 * Implied probabilities for curated Polymarket EVENT markets, for the
 * exceptional-swing house story. Gamma is Polymarket's free read API: no key,
 * generous limits, one call per configured market per pipeline run.
 * Best-effort: any failure returns null and the pipeline moves on (the run
 * log records unresolved slugs so a bad slug in config stays visible).
 */
export interface MarketQuote {
  slug: string;
  question: string;
  /** Implied probability of the market's first outcome (usually "Yes"), 0..1. */
  prob: number;
  /** 24h change in that probability, 0..1 units, when the API provides one. */
  change24h?: number;
  liquidity: number;
  closed: boolean;
  url: string;
}

export async function polymarketQuote(slug: string, timeoutMs = 10000): Promise<MarketQuote | null> {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const markets = (await res.json()) as Array<Record<string, unknown>>;
    const m = Array.isArray(markets) ? markets[0] : undefined;
    if (!m) return null;
    // outcomePrices ships JSON-encoded ('["0.62","0.38"]') from Gamma;
    // tolerate a plain array too in case that ever changes.
    const rawPrices = m.outcomePrices;
    const prices: unknown = typeof rawPrices === "string" ? JSON.parse(rawPrices) : rawPrices;
    const prob = Array.isArray(prices) ? Number(prices[0]) : NaN;
    if (!Number.isFinite(prob)) return null;
    const change = Number(m.oneDayPriceChange);
    const liquidity = Number(m.liquidityNum ?? m.liquidity);
    // canonical market pages live under the parent EVENT's slug; the market
    // slug alone is not a working URL
    const events = m.events as Array<{ slug?: string }> | undefined;
    const eventSlug = Array.isArray(events) ? events[0]?.slug : undefined;
    return {
      slug,
      question: String(m.question ?? slug),
      prob,
      ...(Number.isFinite(change) ? { change24h: change } : {}),
      liquidity: Number.isFinite(liquidity) ? liquidity : 0,
      closed: Boolean(m.closed),
      url: eventSlug ? `https://polymarket.com/event/${eventSlug}` : `https://polymarket.com/market/${slug}`,
    };
  } catch {
    return null;
  }
}
