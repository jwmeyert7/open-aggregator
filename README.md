# open-aggregator

An open source, self-hostable news aggregation platform. Point it at a handpicked list of feeds on any topic and it runs a Techmeme-style front page for you: a cron pipeline fetches your sources on a schedule you set, an LLM editor gates, clusters, headlines, and scores the news, and an admin panel gives you control. Sections, sources, prompts, and the site's identity are all configurable.

This is the platform that powers [ethernews.org](https://ethernews.org).

## What you get

- A ranked front page with section pages, a raw stream, full-text search, and story permalinks
- A plain-language explainer under every headline, written by the editor model
- Frozen daily digest pages, a snapshot archive of every front page, and date-based time travel from the header
- Email digests (daily and weekly) with double opt-in and one-click unsubscribe
- An admin panel: pin, kill, merge, split, re-edit, add a story by URL, review reader submissions, manage sources, and see every pipeline run
- A source leaderboard, feed health tracking, and automatic source discovery from a Farcaster channel
- Optional social posting, capped in code and dry-run by default (Farcaster and X built in, the module pattern extends to others)
- A podcasts shelf: videos and podcast episodes from whitelisted YouTube channels and podcast feeds, played in place on the page, with tier 2 shows held to an LLM media gate
- Optional sponsored posts, announcement slot, and jobs/events/shows listings, always visually marked as paid
- A built-in remote MCP server at `/api/mcp` (streamable HTTP, stateless, read-only): AI assistants like Claude can pull your ranked top stories, search them, fetch a daily edition, or read the podcasts shelf. It serves the same state the front page renders and makes no LLM calls, so it adds nothing to your costs.

If the LLM is unreachable, tier 1 items become single-link stories flagged "needs review", tier 2 items wait, and the site stays up.

## What you bring

- **A hosting account.** Something that runs a Next.js app, a recurring cron, and a blob store for state. Vercel is what the repo is wired for today (note that Vercel's Hobby tier caps cron jobs at once per day, so a continuously updating site needs Pro), and the storage and cron layers are the only pieces to swap for another host.
- **A domain, optionally.** The URL your host gives you works fine on day one. Point a custom domain at it whenever you like.
- **An LLM key.** Any capable model can play the editor in principle. Wired today: `AI_GATEWAY_API_KEY` (Vercel AI Gateway, pass-through pricing) or `ANTHROPIC_API_KEY` (direct), defaulting to Claude Haiku, overridable via `LLM_MODEL`. Costs scale with news volume, not cron frequency: a no-news run makes no LLM call.
- **`ADMIN_PASSWORD`**, a password you choose for the admin panel, plus a recommended `SESSION_SECRET` (any long random string) to sign admin sessions.
- **`CRON_SECRET`**, required. The cron route fails closed: without it nothing can trigger the pipeline, so an unconfigured fork can't run anything.
- **SMTP credentials, only if you want email digests.** The worked example is a Gmail app password sending as a forwarding alias from ImprovMX (free): ImprovMX forwards `hello@yourdomain` to your Gmail, and Gmail's "send mail as" plus an app password lets the site send from that address. Any SMTP server works via `SMTP_HOST` and `SMTP_PORT`.
- **`YOUTUBE_API_KEY`, optional.** Fills in episode lengths and view counts on the podcasts shelf from the YouTube Data API (one quota unit per video, ten thousand a day free). Without it the pipeline falls back to a best-effort scrape of each watch page, which datacenter egress often cannot do, so lengths and view counts may stay unknown.
- **Social credentials, only if you want posting.** The built-in modules are Farcaster (`NEYNAR_API_KEY` plus `FARCASTER_SIGNER_UUID`) and X (its four API keys), and the same small-module shape extends to any network. Until credentials exist every post is a logged dry-run.

## Quickstart (local)

```
npm install
npm run dev
```

With no env vars and no config files of your own, the site boots on the committed `config/*.example.*` files (BBC, NPR, Ars Technica, The Verge, Hacker News, NASA, and a Discourse forum, filed into Technology, Science, and World) and state lives in `.data/` on disk. Open http://localhost:3000 for the front page and `/admin` for the panel (set `ADMIN_PASSWORD` in `.env.local` to log in).

The first page load against an empty state seeds itself: dev mode notices there is nothing to show and runs the pipeline once in the background, so refresh after half a minute and the example feeds are in. Set an LLM key in `.env.local` first if you want that run gated and clustered instead of raw headlines. After that, trigger runs yourself: press "Run pipeline now" in `/admin`, or set `CRON_SECRET` and curl the cron endpoint:

```
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

## Configuration

Copy the example configs and edit them. The real files are gitignored, so your tuned setup never leaks into a fork or a pull request:

```
cp config/site.example.json config/site.json
cp config/feeds.example.json config/feeds.json
cp config/sections.example.json config/sections.json
cp config/prompts/cluster.example.md config/prompts/cluster.md
cp config/prompts/add-by-url.example.md config/prompts/add-by-url.md
cp config/prompts/day-summary.example.md config/prompts/day-summary.md
cp config/prompts/source-candidate.example.md config/prompts/source-candidate.md
cp config/prompts/summary-refresh.example.md config/prompts/summary-refresh.md
cp config/prompts/media-gate.example.md config/prompts/media-gate.md
cp config/prompts/chapter-match.example.md config/prompts/chapter-match.md
```

- **`site.json`** is the site's identity: name, tagline, topic, domain, contact address, optional social handles.
- **`feeds.json`** is the source whitelist: RSS, Discourse forums, subreddits, scraped listing pages, Google News query feeds, and Farcaster discovery channels, each with a trust tier and a ranking weight. YouTube channel feeds and podcast feeds go in the same list and fill the podcasts shelf instead of the story pipeline.
- **`sections.json`** defines your sections and every ranking, ingest, weekend-mode, prediction-market, and bot-cap knob.
- **`prompts/*.md`** hold the editorial rules: gating, clustering, headline and explainer style, and the media gate for tier 2 shows. The valid section ids are handed to the model automatically, so the prompts stay topic-portable. The examples ban em dashes and semicolons in editorial copy as a house default you are free to change.

Since a deployed site reads the config baked into the deployment, config changes ship like code: commit them to your private fork (or keep a private branch) and push.

## Deploying

See [DEPLOY.md](DEPLOY.md) for the step-by-step Vercel path: fork, link, create the Blob store, set the env vars, and the cron starts running on its own.

## Cost profile

- LLM: scales with news volume (roughly 1 to 3 Haiku calls per news-bearing run, batched). Quiet runs are free.
- Blob storage: very low. State is about 1 MB and snapshots accumulate slowly.
- X posting: hard-capped in code (default 30 posts per month).

## License

MIT. See `LICENSE`.
