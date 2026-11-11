#!/usr/bin/env node
import { Command, Option } from 'commander';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildConfig, loadEnvFiles, PROJECT_ROOT } from '../src/config.js';
import { createTracker } from '../src/tracker.js';
import { createStore } from '../src/store.js';
import { normalizeTarget, targetsFromCsv } from '../src/targets.js';
import { ROLES, DEFAULT_WATCH } from '../src/roles.js';
import { createApp } from '../src/server.js';
import { channelsFor, notifyAlerts } from '../src/notify.js';
import { ruleBrief } from '../src/brief.js';
import { writeReports } from '../src/reports.js';
import { openRoles } from '../src/scanner.js';

const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
const err = (m) => process.stderr.write(`${m}\n`);
const ICON = { hot: '🔥', warm: '🟠', info: '🔵' };

const program = new Command()
  .name('hiring-tracker')
  .description('Job Board Hiring Signal Tracker - alerts sales reps when target companies hire a CTO or other tech executive.')
  .version(pkg.version)
  .option('--home <dir>', 'folder holding config/, data/ and output/ (default: current folder or TRACKER_HOME)')
  .option('--targets <file>', 'targets file (default config/targets.json)')
  .option('--state <file>', 'state file (default data/state.json)');

function setup(extra = {}) {
  loadEnvFiles();
  const g = program.opts();
  const cfg = buildConfig(process.env, { home: g.home, targets: g.targets, state: g.state, ...extra });
  return cfg;
}

function tracker(extra = {}, opts = {}) {
  const cfg = setup(extra);
  return createTracker({ cfg, log: err, simulate: opts.simulate || [] });
}

function printAlert(a) {
  err(`  ${ICON[a.priority] || ''} [${String(a.score).padStart(3)}] ${a.headline}`);
  if (a.url) err(`         ${a.url}`);
  const i = a.insights;
  if (i?.mandates?.length) err(`         mandates: ${i.mandates.join(', ')}`);
  if (i?.stack?.length) err(`         stack: ${i.stack.slice(0, 8).join(', ')}`);
  if (a.brief?.who_to_contact) err(`         who: ${a.brief.who_to_contact}`);
}

function summary(r) {
  const failed = r.results.filter((x) => !x.ok);
  err(`\n${r.alerts.length} new signal(s) from ${r.results.length} companies${failed.length ? `, ${failed.length} board(s) failed` : ''}.`);
  for (const a of [...r.alerts].sort((x, y) => y.score - x.score)) printAlert(a);
  const b = r.briefStats;
  if (r.alerts.length) err(`\nBriefs: ${b.ai} AI, ${b.cached} cached, ${b.rules} rules${b.failed ? `, ${b.failed} AI failures -> rules` : ''}${r.ai ? '' : ' (AI off: no key or --no-ai)'}`);
  const d = r.delivery;
  if (d.sent || d.failures.length) err(`Notifications: ${d.sent} sent${d.failures.length ? `, ${d.failures.length} channel failure(s)` : ''}`);
  if (d.noChannels) err('Notifications: no channel configured (set SLACK_WEBHOOK_URL, TELEGRAM_*, RESEND_API_KEY, WEBHOOK_URL... in .env)');
  if (r.files) err(`Reports: ${r.files.md}\n         ${r.files.csv}\n         ${r.files.open}`);
}

const scanOptions = (cmd) =>
  cmd
    .option('-c, --company <name>', 'scan one target only')
    .option('--no-notify', 'do not send notifications')
    .option('--no-ai', 'rule-based briefs only')
    .option('--min-score <n>', 'notify threshold (default NOTIFY_MIN_SCORE or 60)')
    .option('--roles <list>', `roles to watch (default ${DEFAULT_WATCH.join(',')}; "all" for every role)`)
    .option('--offer <text>', 'what you sell (drives the brief and email)')
    .option('--out <dir>', 'output folder')
    .addOption(new Option('--simulate-outage <providers>', 'make AI providers fail (demo of model fallback), e.g. gemini').hideHelp());

const scanExtra = (o) => ({ ai: o.ai, minScore: o.minScore, roles: o.roles, offer: o.offer, out: o.out });

scanOptions(program.command('scan').description('scan every target once, alert on new signals, write reports'))
  .option('--json', 'print alerts as JSON on stdout')
  .action(async (o) => {
    const t = tracker(scanExtra(o), { simulate: o.simulateOutage ? o.simulateOutage.split(',') : [] });
    if (!t.getTargets().length) throw new Error(`No targets in ${t.cfg.targetsFile}. Run "hiring-tracker init" or "hiring-tracker add <company> <careers-url>".`);
    const r = await t.scan({ only: o.company, notify: o.notify });
    if (o.json) process.stdout.write(JSON.stringify(r.alerts.map(({ excerpt, ...a }) => a), null, 2) + '\n');
    summary(r);
    if (r.results.length && r.results.every((x) => !x.ok)) process.exitCode = 2;
  });

scanOptions(program.command('watch').description('scan on a schedule (Ctrl+C to stop)'))
  .option('--every <minutes>', 'minutes between scans', '360')
  .action(async (o) => {
    const t = tracker(scanExtra(o));
    const every = Math.max(5, Number(o.every) || 360) * 60_000;
    let stop = false;
    process.on('SIGINT', () => {
      stop = true;
      err('\nstopping after the current scan...');
      process.exit(0);
    });
    while (!stop) {
      try {
        summary(await t.scan({ notify: o.notify }));
      } catch (e) {
        err(`scan failed: ${e.message}`);
      }
      err(`next scan at ${new Date(Date.now() + every).toLocaleString()}`);
      await new Promise((r) => setTimeout(r, every));
    }
  });

program
  .command('demo')
  .description('offline demo: 8 fictional companies on 8 job-board types over 3 weekly scans (no network, no keys)')
  .option('--ai', 'write briefs with AI (needs a key in .env); default rules only')
  .option('--offer <text>', 'what you sell', 'a developer productivity platform that cuts cloud and CI costs')
  .option('--out <dir>', 'output folder', 'output/demo')
  .action(async (o) => {
    const { DEMO_TARGETS, createDemoFetch, demoNow } = await import('../examples/demo-data.js');
    const cfg = setup({ ai: Boolean(o.ai), offer: o.offer, out: o.out });
    cfg.hostGapMs = 0;
    cfg.offerKeywords = cfg.offerKeywords.length ? cfg.offerKeywords : ['cloud', 'devops', 'cost', 'kubernetes'];
    let day = 1;
    const demoFetch = createDemoFetch(() => day);
    // Demo pages come from the fake fetch; AI calls (with --ai) go to the real network.
    const fetchImpl = (url, init) => (/googleapis|groq|nvidia|openrouter|localhost:11434/.test(String(url)) ? fetch(url, init) : demoFetch(url, init));
    const t = createTracker({
      cfg,
      fetchImpl,
      now: () => demoNow(day),
      store: createStore(null, { memory: true }),
      targets: DEMO_TARGETS.map(normalizeTarget),
      ai: o.ai ? undefined : null,
      log: () => {},
    });
    const stories = {
      1: 'Day 1 - first scan (baseline): searches that are already open',
      2: 'Day 8 - new CTO searches appear; Northwind CTO posting disappears (waiting for a 2nd scan to confirm)',
      3: 'Day 15 - Northwind CTO search confirmed closed (new CTO likely hired), hiring surge, new CISO search',
    };
    let last;
    for (day = 1; day <= 3; day++) {
      err(`\n=== ${stories[day]} ===`);
      last = await t.scan({ notify: false, write: false });
      for (const r of last.results) err(`  ${r.ok ? '✓' : '✗'} ${r.company.padEnd(24)} ${(r.ats || '').padEnd(16)} ${r.jobs} jobs`);
      err('');
      for (const a of [...last.alerts].sort((x, y) => y.score - x.score)) printAlert(a);
    }
    const all = t.store.data.alerts;
    const files = writeReports(cfg.outDir, { alerts: all, open: openRoles(t.store, t.getTargets()), results: last.results, startedAt: last.startedAt });
    err(`\nIgnored on purpose: "Executive Assistant to the CTO", "Field CTO, EMEA" (presales), "Head of IT" (not watched), "Werkstudent".`);
    err(`Full report with briefs and draft emails: ${files.md}\nSpreadsheet: ${files.csv}`);
  });

program
  .command('init')
  .description('create config/targets.json and .env from the examples (never overwrites)')
  .action(() => {
    const cfg = setup();
    const made = [];
    if (!existsSync(cfg.targetsFile)) {
      mkdirSync(dirname(cfg.targetsFile), { recursive: true });
      copyFileSync(join(PROJECT_ROOT, 'examples', 'targets.example.json'), cfg.targetsFile);
      made.push(cfg.targetsFile);
    }
    const envFile = resolve(cfg.home, '.env');
    if (!existsSync(envFile)) {
      copyFileSync(join(PROJECT_ROOT, '.env.example'), envFile);
      made.push(envFile);
    }
    err(made.length ? `Created:\n  ${made.join('\n  ')}` : 'Nothing to do: files already exist.');
    err('Next: edit the targets, then run "hiring-tracker doctor" and "hiring-tracker scan".');
  });

program
  .command('add <company> <careersUrl>')
  .description('add (or update) a target; the job board type is detected automatically')
  .option('--owner <name>', 'account owner (sales rep)')
  .option('--email <email>', 'owner email for alerts')
  .option('--slack <webhook>', 'owner Slack webhook')
  .option('--tier <A|B|C>', 'account tier')
  .option('--roles <list>', 'roles to watch for this company')
  .option('--domain <domain>', 'company website domain')
  .action(async (company, careersUrl, o) => {
    const t = tracker();
    const added = await t.addTarget({ company, careersUrl, owner: o.owner, ownerEmail: o.email, slackWebhook: o.slack, tier: o.tier, roles: o.roles, domain: o.domain });
    err(`Saved ${added.company} -> ${added.ats}${added.board ? ` (${added.board})` : ''}${added.detectedVia ? ` via ${added.detectedVia}` : ''} in ${t.cfg.targetsFile}`);
    if (added.ats === 'html') err('No ATS feed found; the careers page will be read as HTML (JSON-LD or links). Check with "hiring-tracker jobs ' + added.id + '".');
  });

program
  .command('remove <company>')
  .description('remove a target by id or name')
  .action((company) => {
    const t = tracker();
    if (!t.removeTarget(company)) throw new Error(`No target "${company}"`);
    err(`Removed ${company}`);
  });

program
  .command('import <csv>')
  .description('import targets from CSV: company, careers_url, [ats, board, domain, owner, owner_email, slack_webhook, tier, roles, notes]')
  .option('--replace', 'replace the whole list instead of merging')
  .action((file, o) => {
    const t = tracker();
    const list = targetsFromCsv(readFileSync(file, 'utf8'));
    const n = t.importTargets(list, { replace: o.replace });
    err(`Imported ${list.length} row(s); ${n} target(s) in ${t.cfg.targetsFile}. Board types are detected on the first scan.`);
  });

program
  .command('targets')
  .description('list targets and their board health')
  .option('--json', 'JSON output')
  .action((o) => {
    const t = tracker();
    const boards = t.store.data.boards;
    const list = t.getTargets();
    if (o.json) return process.stdout.write(JSON.stringify(list, null, 2) + '\n');
    for (const x of list) {
      const b = boards[x.id];
      const det = t.store.data.detected[x.id];
      const where = x.ats ? `${x.ats}:${x.board || x.careersUrl}` : det ? `${det.ats}:${det.board}` : 'auto (not scanned yet)';
      err(`${x.enabled === false ? '⏸' : b?.failures ? '✗' : b?.lastOkAt ? '✓' : '·'} ${x.company.padEnd(28)} ${where}${x.owner ? `  owner: ${x.owner}` : ''}${b?.failures ? `  (${b.failures} failures: ${b.lastError})` : ''}`);
    }
    err(`${list.length} target(s) in ${t.cfg.targetsFile}`);
  });

program
  .command('detect <url>')
  .description('show which job board a careers page uses')
  .action(async (url) => {
    const t = tracker();
    const d = await t.detect(url);
    process.stdout.write(JSON.stringify(d, null, 2) + '\n');
  });

program
  .command('jobs <company>')
  .description("list a target's current postings and how each title is classified")
  .option('--all', 'also list non-executive jobs')
  .action(async (company, o) => {
    const t = tracker();
    const r = await t.jobs(company);
    err(`${r.target.company}: ${r.jobs.length} jobs on ${r.ats} (${r.board})`);
    for (const j of r.jobs) {
      if (!o.all && !j.role) continue;
      const tag = !j.role ? '         ' : j.role.excluded ? `ignored  ` : `${j.role.id}`.padEnd(9);
      err(`  ${tag} ${j.title}${j.role?.excluded ? `  (${j.role.excluded})` : ''}  ${j.url || ''}`);
    }
  });

program
  .command('classify <title...>')
  .description('test the title classifier, e.g. classify "Fractional CTO"')
  .action((words) => {
    const t = tracker();
    const r = t.classify(words.join(' '));
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  });

program
  .command('roles')
  .description('list the roles the tracker can watch')
  .action(() => {
    const cfg = setup();
    for (const r of ROLES) err(`${cfg.watch.includes(r.id) ? '●' : '○'} ${r.id.padEnd(22)} ${r.label.padEnd(26)} base score ${r.score}`);
    err('● = watched now (WATCH_ROLES in .env, --roles, or "roles" per target)');
  });

program
  .command('alerts')
  .description('show past alerts')
  .option('--days <n>', 'look back this many days', '30')
  .option('--min-score <n>', 'minimum score', '0')
  .option('-c, --company <name>', 'one company')
  .option('--json', 'JSON output')
  .action((o) => {
    const t = tracker();
    const list = t.alerts({ days: Number(o.days), minScore: Number(o.minScore), company: o.company });
    if (o.json) return process.stdout.write(JSON.stringify(list, null, 2) + '\n');
    for (const a of list) err(`${a.detectedAt.slice(0, 10)} ${ICON[a.priority] || ''} [${a.score}] ${a.headline}${a.notified ? '' : '  (not sent)'}`);
    err(`${list.length} alert(s)`);
  });

program
  .command('open-roles')
  .description('executive searches open right now across all targets')
  .option('--json', 'JSON output')
  .action((o) => {
    const t = tracker();
    const rows = t.openRoles();
    if (o.json) return process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    for (const r of rows) err(`${r.company.padEnd(26)} ${r.role.padEnd(20)} ${String(r.daysOpen ?? '?').padStart(4)}d  ${r.title}`);
    err(`${rows.length} open search(es)`);
  });

program
  .command('doctor')
  .description('check config, keys, notification channels and every job board')
  .option('--ping', 'also call each AI model once')
  .option('--no-boards', 'skip fetching the job boards')
  .action(async (o) => {
    const t = tracker();
    const cfg = t.cfg;
    const ok = (b, m) => err(`${b ? '✓' : '✗'} ${m}`);
    ok(Number(process.versions.node.split('.')[0]) >= 22, `Node ${process.versions.node} (needs 22+)`);
    const targets = t.getTargets();
    ok(targets.length > 0, `${targets.length} target(s) in ${cfg.targetsFile}`);
    err(`· watching roles: ${cfg.watch.join(', ')}`);
    err(`· offer: ${cfg.offer || '(SENDER_OFFER not set - briefs use a generic pitch)'}`);
    const ch = channelsFor({ ownerEmail: '' }, cfg).map((c) => c.kind);
    ok(ch.length > 0, `notification channels: ${ch.join(', ') || 'none (alerts only in reports)'}`);
    if (!t.ai) err('· AI briefs: off (no GEMINI_API_KEY / GROQ_API_KEY / ... set) - rule-based briefs are used');
    else {
      const st = t.ai.status();
      err(`· AI chain: ${st.filter((s) => s.enabled).map((s) => s.id).join(' -> ')}`);
      if (o.ping) {
        for (const s of st.filter((x) => x.enabled)) {
          const started = Date.now();
          try {
            await t.ai.generate({ only: s.id, messages: [{ role: 'user', content: 'Reply with OK' }], maxTokens: 1024, timeoutMs: 20000 });
            ok(true, `${s.id} ${Date.now() - started} ms`);
          } catch (e) {
            ok(false, `${s.id}: ${e.message.slice(0, 120)}`);
          }
        }
      }
    }
    if (o.boards) {
      for (const x of targets.filter((y) => y.enabled !== false)) {
        try {
          const r = await t.jobs(x.id);
          const exec = r.jobs.filter((j) => j.role && !j.role.excluded).length;
          ok(true, `${x.company}: ${r.ats} ${r.board} - ${r.jobs.length} jobs, ${exec} executive`);
          if (r.jobs.length === 0 && r.ats === 'html') err('    0 jobs read from HTML: add "selectors" for this target or use its ATS URL');
        } catch (e) {
          ok(false, `${x.company}: ${e.message}`);
        }
      }
    }
  });

program
  .command('test-notify')
  .description('send a sample alert to every configured channel')
  .action(async () => {
    const t = tracker();
    const a = {
      key: `test:${Date.now()}`,
      type: 'role_opened',
      company: 'Example Corp',
      title: 'Chief Technology Officer',
      roleLabel: 'CTO',
      url: 'https://example.com/jobs/cto',
      score: 90,
      priority: 'hot',
      why: ['CTO role', 'test message'],
      headline: 'TEST: Example Corp is hiring a Chief Technology Officer',
      insights: { mandates: ['Cloud migration'], stack: ['AWS', 'Kubernetes'], reportsTo: 'CEO' },
      detectedAt: new Date().toISOString(),
    };
    a.brief = ruleBrief(a, t.cfg);
    const r = await notifyAlerts([a], { http: t.http, store: createStore(null, { memory: true }), cfg: { ...t.cfg, notifyMinScore: 0 }, log: err });
    if (r.noChannels) throw new Error('No channel configured. Set SLACK_WEBHOOK_URL, TEAMS_WEBHOOK_URL, DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN+TELEGRAM_CHAT_ID, RESEND_API_KEY+EMAIL_FROM+EMAIL_TO or WEBHOOK_URL.');
    err(r.sent ? `Sent (${channelsFor(a, t.cfg).map((c) => c.kind).join(', ')}).${r.failures.length ? ` Failures: ${r.failures.map((f) => `${f.channel}: ${f.error}`).join('; ')}` : ''}` : `All channels failed: ${r.failures.map((f) => `${f.channel}: ${f.error}`).join('; ')}`);
    if (!r.sent) process.exitCode = 1;
  });

program
  .command('serve')
  .description('start the REST API (and optional scheduled scans)')
  .option('-p, --port <port>', 'port', process.env.PORT || '3000')
  .option('--every <minutes>', 'also scan every N minutes (0 = off)', '0')
  .action(async (o) => {
    const t = tracker();
    const app = createApp(t, { log: err });
    const server = app.listen(Number(o.port), () => {
      err(`Hiring Signal Tracker API on http://localhost:${server.address().port}${t.cfg.apiKey ? ' (x-api-key required)' : ' (no API_KEY set: open access)'}`);
    });
    const every = Number(o.every) || 0;
    if (every > 0) {
      const run = () => t.scan().then(summary, (e) => err(`scheduled scan failed: ${e.message}`));
      setTimeout(run, 2000);
      setInterval(run, Math.max(5, every) * 60_000);
      err(`Scheduled scans every ${Math.max(5, every)} minutes.`);
    }
    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parseAsync().catch((e) => {
  err(`Error: ${e.message}`);
  process.exitCode = 1;
});
