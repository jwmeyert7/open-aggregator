# open-aggregator

An open source news aggregator engine. Point it at a list of feeds on any topic, run one command, and get a ranked single page HTML front page. No web framework, no database, no cloud services. You bring your own LLM key.

It fetches your handpicked feeds, sends the new items to a language model that gates, clusters, headlines, and scores them, ranks the result by source weight and freshness, and writes a self contained `out/index.html` you can open or host anywhere.

This is the engine that powers [ethernews.org](https://ethernews.org) as a reference deployment, extracted and stripped of anything specific to that site.

## Quickstart

```
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run
```

That is it. With no config files of your own present, the engine falls back to the committed `config/*.example.*` files, which point at a handful of well known general feeds (BBC, NPR, Ars Technica, The Verge, Hacker News, NASA, and a Discourse forum). Open `out/index.html` in a browser to see the result.

To use your own sources and sections, copy the example files and edit them:

```
cp config/feeds.example.json config/feeds.json
cp config/sections.example.json config/sections.json
cp config/prompts/cluster.example.md config/prompts/cluster.md
```

Your real `feeds.json`, `sections.json`, and `prompts/*.md` are gitignored, so your private tuned setup is never committed. Only the `.example` files are tracked.

### API key

Set one of these before running:

- `ANTHROPIC_API_KEY` calls the Anthropic API directly.
- `AI_GATEWAY_API_KEY` reaches Anthropic through the Vercel AI Gateway.

Override the model with `LLM_MODEL` (default `claude-haiku-4-5`).

If no key is set, the engine still runs: it skips the language model, promotes tier 1 items to their own stories with no gating, and renders the page. This is a degraded mode meant for a quick smoke test, not for real curation.

## How config works

Everything is driven by three files in `config/`.

- **`feeds.json`** is your source whitelist. Each feed has an `id`, `name`, `url`, a `type` of `rss`, `discourse`, or `listing`, a `tier` (1 for trusted sources that pass automatically, 2 for broader sources held to a stricter gate), a `weight` that feeds the ranking score, and an optional `sectionHint`. See `feeds.example.json` for the full shape, including `includePattern` and `excludePattern` for filtering noisy feeds and `linkPattern` for scraping listing pages that publish no feed.
- **`sections.json`** defines your sections and all the ranking and ingest tuning knobs. Sections are yours to name. Add, remove, or rename them and point your feeds and prompt at the ids you choose.
- **`prompts/cluster.md`** is the editorial prompt. It tells the model how to gate, cluster, headline, explain, section, and score. Adapt the voice to your topic and audience. The valid section ids are handed to the model automatically.

State lives in `.data/state.json` as a single local file, written atomically. Delete it to start fresh.

## Commands

- `npm run` runs the pipeline (fetch, edit, cluster, save) and then renders the front page to `out/index.html`, the chronological stream to `out/stream.html`, and a daily archive page per covered day under `out/day/`.
- `npm run typecheck` runs the TypeScript compiler with no emit.

## Not included

This is the curation engine only. The following are application concerns and live in the site built on top of it, not here:

- posting to social platforms
- email digests and subscriber management
- an admin or editorial review UI
- hosting, scheduling, and deployment

## License

MIT. See `LICENSE`.
