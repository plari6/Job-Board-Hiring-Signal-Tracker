# Job Board Hiring Signal Tracker

Watches your target accounts' job boards and tells the right sales rep when a company **is hiring a CTO** (or another technology executive), and again when that search **closes**, which usually means a new CTO is about to start. New technology leaders review the stack, budget and vendors in their first 90 days. This tool makes sure your reps reach them during that window.

Each alert comes with a short sales brief: why now, who to contact, talking points taken from the job description (cloud migration, SOC 2, cost cutting, team size, tech stack, reporting line), the best timing, a draft email and a LinkedIn note.

**Stack:** JavaScript (Node.js 22+, ESM). The project card names Node.js, Cheerio and Express, and the tool is a scraper + CLI + small API, so plain JS keeps it light. Dependencies: `cheerio`, `commander`, `express`. AI briefs are optional and go through a multi-model fallback router (Gemini → Groq → NVIDIA → OpenRouter → Ollama), with rule-based briefs as the last resort.

## What it detects

| Signal | Meaning | Typical score |
|---|---|---|
| `role_opened` | A watched executive posting appeared (CTO, CIO, CISO, VP Engineering, ...) | CTO 88-100 |
| `role_closed` → `likely_filled` | The posting was open ≥ 14 days and has now been gone for 2 scans in a row: a new leader was likely hired | CTO 90-100 |
| `role_closed` → `pulled_early` | Gone within 14 days (internal hire, agency or cancelled) | lower |
| `role_reopened` | The same search came back (the hire failed or the person left) | high |
| `hiring_surge` | Engineering openings ≥ 1.5× the recent average and +5 | 55-70 |

What it ignores: "Executive Assistant to the CTO", "Field CTO" (a presales job at vendors), "Office of the CTO" engineers, "reports to the CTO", interns, recruiters, sales engineers. Interim or fractional CTOs are flagged and scored lower.

The safety rules keep false alerts low. A failed fetch never closes a posting. A board that suddenly returns 0 jobs is treated as a glitch. A posting must be missing on 2 scans in a row before it counts as closed.

## Supported job boards

| ATS | Example URL | How it is read |
|---|---|---|
| Greenhouse | `job-boards.greenhouse.io/<co>`, embedded `?for=<co>` | public Job Board API (JSON) |
| Lever (US + EU) | `jobs.lever.co/<co>` | public Postings API (JSON) |
| Ashby | `jobs.ashbyhq.com/<co>` | public Posting API (JSON) |
| Workable | `apply.workable.com/<co>` | public widget API (JSON) |
| SmartRecruiters | `careers.smartrecruiters.com/<co>` | public Posting API, with details fetched only for matching roles |
| Recruitee | `<co>.recruitee.com` | public Offers API (JSON) |
| Personio | `<co>.jobs.personio.de` | public XML feed |
| Any careers page | `company.com/careers` | Cheerio: schema.org JobPosting JSON-LD → your CSS selectors → job-like links |

Give the company's own careers page and the tool **detects** the ATS. It checks the URL, then iframes and scripts embedded in the page (for example Notion and Linear use Ashby), then follows a "Careers" link one hop from a homepage. The result is cached.

## Quick start

```bash
npm install
node bin/hiring-tracker.js demo        # offline: 8 fictional companies on 8 board types over 3 weekly scans
node bin/hiring-tracker.js init        # creates config/targets.json and .env
node bin/hiring-tracker.js add "Acme" https://acme.com/careers --owner "Sara" --email sara@you.com --tier A
node bin/hiring-tracker.js import accounts.csv      # company, careers_url, owner, owner_email, tier, roles ...
node bin/hiring-tracker.js doctor      # checks keys, channels and every board
node bin/hiring-tracker.js scan        # one scan: alerts + output/report.md, alerts.csv, open-roles.csv
node bin/hiring-tracker.js watch --every 360        # scan every 6 hours
```

The first scan sets the baseline: searches that are already open are reported once, marked "already open when tracking started". From then on, every scan reports only changes.

### All commands

| Command | Purpose |
|---|---|
| `demo [--ai]` | offline demo (no network or keys) |
| `init` | create `config/targets.json` and `.env` from the examples |
| `add <company> <url> [--owner --email --slack --tier --roles --domain]` | add a target (ATS auto-detected) |
| `import <csv> [--replace]` / `remove <company>` / `targets` | manage the account list |
| `scan [-c company] [--no-notify] [--no-ai] [--roles all] [--offer "..."] [--json]` | scan once |
| `watch --every <min>` | scan on a loop |
| `alerts [--days 30 --min-score 60]` / `open-roles` | history and every executive search open right now |
| `detect <url>` / `jobs <company> [--all]` / `classify <title>` / `roles` | debugging tools |
| `doctor [--ping]` / `test-notify` | health checks |
| `serve [--port 3000] [--every 360]` | REST API, with optional built-in schedule |

Global options: `--home <dir>` (folder holding `config/`, `data/` and `output/`), `--targets <file>`, `--state <file>`.

## Targets file

```json
{ "targets": [
  { "company": "Acme", "careersUrl": "https://acme.com/careers", "owner": "Sara", "ownerEmail": "sara@you.com",
    "slackWebhook": "https://hooks.slack.com/...", "tier": "A", "roles": ["cto", "ciso"] },
  { "company": "Beta", "ats": "greenhouse", "board": "beta" },
  { "company": "Gamma", "careersUrl": "https://gamma.com/jobs",
    "selectors": { "item": ".job-card", "title": "h3", "link": "a", "location": ".loc" } }
]}
```

`tier` A gives +8 to the score and C gives −8. `roles` replaces `WATCH_ROLES` for that company. `ownerEmail` and `slackWebhook` route the alert to that account's owner. `enabled: false` pauses a target.

Roles: `cto`, `deputy_cto`, `vp_engineering`, `cio`, `ciso`, `chief_data`, `chief_digital`, `head_engineering` (watched by default), plus `director_engineering`, `head_it`, `head_security`, `head_data`. Use `all` to watch every role.

## Notifications

Set any combination in `.env`: Slack (Block Kit message with an "Open posting" button), Microsoft Teams (Workflows webhook, Adaptive Card), Discord, Telegram, email through Resend (also sent to each account owner), and a generic JSON webhook for Zapier, Make, n8n or a CRM (`{"event":"hiring_signal","alert":{...}}`, with an optional `x-webhook-secret` header). Only alerts with a score at or above `NOTIFY_MIN_SCORE` (default 60) are sent. Each alert is sent once. A failed delivery is retried on the next scans, up to 3 attempts.

## Sales briefs and AI

Set `SENDER_OFFER`, `TARGET_ICP`, `SENDER_NAME` and `OFFER_KEYWORDS` (for example `cloud,aws,cost,kubernetes`). Mandates or stack items in a job description that match your keywords raise the score.

- Without AI keys, every alert gets a rule-based brief. It still uses the mandates, stack, team size and reporting line from the job description.
- With `GEMINI_API_KEY` (and optionally `GROQ_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`), the best alerts get an AI-written brief, up to `MAX_AI_BRIEFS` per scan. The router tries several models with timeouts, cooldowns and hedging. Invalid JSON moves on to the next model. If every model fails, the rule brief is used. Briefs are cached per alert and offer.

## REST API

`node bin/hiring-tracker.js serve --every 360`. When `API_KEY` is set, every `/api` route needs the header `x-api-key` (or `Authorization: Bearer`).

| Method | Route | |
|---|---|---|
| GET | `/health` | targets, failing boards, last scan, AI model states |
| GET / POST / DELETE | `/api/targets`, `/api/targets/:id` | list, add (with ATS auto-detect) and remove targets |
| POST | `/api/scan` `{ "company"?: "...", "notify"?: false }` | run a scan |
| GET | `/api/alerts?days=30&minScore=60&company=` | alert history |
| GET | `/api/open-roles` | executive searches open now |
| GET | `/api/detect?url=` | which ATS a careers page uses |
| POST | `/api/classify` `{ "titles": [...] }` | title → role |

## Deploy

```bash
docker build -t hiring-tracker .
docker run -d -p 3000:3000 --env-file .env -v $PWD/tracker-data:/data hiring-tracker
# put targets in tracker-data/config/targets.json; state in tracker-data/data, reports in tracker-data/output
```

You can also run `scan` from cron or a GitHub Actions schedule. Keep `data/state.json` between runs: it is how the tool knows what is new and what has closed.

## Good to know

- **Be polite.** All requests use an honest user agent, wait 400 ms between calls to the same host and use timeouts with retries. HTML pages are only read when robots.txt allows it. ATS feeds are the public JSON/XML endpoints that the vendors publish for career sites.
- **Plain HTML careers pages are best effort.** Some sites list department pages instead of jobs. Prefer the company's ATS URL (`detect` finds it), or add `selectors`. Pages that need JavaScript to render are not supported. Use their ATS URL instead.
- **"Closed" is an inference.** A posting that disappears usually means it was filled, but it can also mean the search moved to an agency. The `likely_filled` and `pulled_early` labels and the brief's wording reflect this.
- State is a single JSON file, which is plenty for hundreds of accounts. The store interface is small (`src/store.js`), so it can be swapped for a database.

## Tests

`npm test` runs 41 offline tests: title classifier, description insights, all 8 adapters, ATS detection, the 3-day scan story, the safety rules, AI fallback with fake models, all notification channels, the REST API and the CLI.

## License

MIT
