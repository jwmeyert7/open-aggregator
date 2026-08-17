# Deploying to Vercel

The whole platform runs on one Vercel project: the site, the admin, the cron pipeline (schedule yours to set in `vercel.ts`), and a Blob store for state. This walkthrough assumes nothing beyond a GitHub account and a Vercel account.

## 1. Fork and clone

Fork the repository on GitHub, then clone your fork. If you plan to keep your tuned config private, make your fork private: your real `config/*.json` and `config/prompts/*.md` files are gitignored by default, but you will eventually want to commit them so deployments carry them (see step 6).

## 2. Link the project

```
npm install
npx vercel link
```

Choose "create a new project" when prompted. Alternatively, import the repository from the Vercel dashboard: Add New, Project, pick your fork. The framework preset is Next.js and needs no changes. The cron schedule ships in `vercel.ts` and registers on the first production deploy.

## 3. Create the Blob store

In the Vercel dashboard open your project, go to Storage, and create a **Blob** store. Attaching it to the project sets `BLOB_READ_WRITE_TOKEN` automatically in every environment. All site state (the story database, snapshots, daily digests) lives in this store as JSON.

## 4. Set the environment variables

In Settings, Environment Variables, add at minimum:

| Variable | Value |
| --- | --- |
| `AI_GATEWAY_API_KEY` or `ANTHROPIC_API_KEY` | your LLM key |
| `CRON_SECRET` | any long random string, for example from `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | the admin panel password you choose |
| `SESSION_SECRET` | another long random string (recommended) |
| `SITE_URL` | your canonical URL, for example `https://your-project.vercel.app` |

`CRON_SECRET` is not optional: the cron route fails closed, so without it the pipeline never runs. The optional extras (SMTP, X, Neynar, GA) are listed in `.env.example` and can be added any time later. Bots stay in dry-run until their credentials exist.

## 5. Deploy

```
npx vercel deploy --prod
```

Or push to your fork's default branch if you imported through the dashboard, which deploys automatically.

## 6. Ship your config

The deployed site reads the config files baked into the deployment. Out of the box that is the neutral `config/*.example.*` set, which is fine for a first smoke test. To run your own sections, sources, prompts, and identity, copy the examples as described in the README, edit them, then remove the ignore rules for the real files from `.gitignore` in your private fork and commit them. Every push then ships your config like code.

## 7. First run

The cron fires within one schedule interval of the first production deploy. To trigger a run immediately:

```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-project.vercel.app/api/cron
```

The response is a JSON run report: items fetched, stories created, feed errors. The same report appears in the admin under Runs.

## 8. Log into the admin

Open `https://your-project.vercel.app/admin`, enter your `ADMIN_PASSWORD`, and you have the whole editorial desk: stories, sources, submissions, runs, layout, email, and the sponsored surfaces. A cosmetic Admin link appears in the site footer in any browser that has logged in.

## 9. Optional: a custom domain

Add your domain in Settings, Domains, then update `SITE_URL` (and the `domain` field in `config/site.json`) to match. Nothing else changes: `*.vercel.app` and a custom domain behave identically.

## Troubleshooting

- **The pipeline never runs.** Check that `CRON_SECRET` is set in the production environment and that the cron appears under Settings, Cron Jobs. The route answers 401 to anything without the right bearer token.
- **The site renders but stays empty.** Trigger a run (step 7) and read the report. Feed errors name the failing source. With no LLM key, only tier 1 items appear, flagged "needs review".
- **Admin login fails.** `ADMIN_PASSWORD` must be set in the environment the deployment runs in. Redeploy after adding it.
- **Emails do not send.** Set `SMTP_USER` and `SMTP_PASS` (a Gmail app password works), and check the run log: send failures are reported there.
