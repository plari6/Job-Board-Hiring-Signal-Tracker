import { createHttp } from './http.js';
import { createStore } from './store.js';
import { loadTargets, saveTargets, normalizeTarget, mergeTargets } from './targets.js';
import { scanTarget, openRoles, resolveBoard } from './scanner.js';
import { attachBriefs } from './brief.js';
import { notifyAlerts } from './notify.js';
import { writeReports } from './reports.js';
import { detectBoard, getAdapter } from './ats/index.js';
import { classifyTitle } from './roles.js';
import { createRouterFromEnv } from './ai/index.js';
import { mapLimit, normCompany, DAY } from './util.js';

/**
 * One object used by both the CLI and the HTTP API.
 * Everything external is injectable for tests: fetchImpl, ai, now, store, targetsOverride.
 */
export function createTracker({ cfg, env = process.env, fetchImpl = fetch, ai, now = () => Date.now(), log = (m) => console.error(m), store, targets: targetsOverride, simulate = [] } = {}) {
  const http = createHttp({ fetchImpl, timeoutMs: cfg.timeoutMs, hostGapMs: cfg.hostGapMs, respectRobots: cfg.respectRobots });
  const st = store || createStore(cfg.stateFile);
  const hasAiKey = Boolean(env.GEMINI_API_KEY || env.GROQ_API_KEY || env.NVIDIA_API_KEY || env.OPENROUTER_API_KEY || env.OLLAMA_BASE_URL);
  const router =
    ai === null
      ? null
      : ai ||
        (hasAiKey
          ? createRouterFromEnv(env, { fetchImpl, simulate, onEvent: (e) => e.type === 'failure' && log(`[ai] ${e.target} ${e.kind} -> next model`) })
          : null);
  let running = null;

  const getTargets = () => targetsOverride || loadTargets(cfg.targetsFile);

  function setTargets(list) {
    if (targetsOverride) {
      targetsOverride.splice(0, targetsOverride.length, ...list);
      return;
    }
    saveTargets(cfg.targetsFile, list);
  }

  async function runScan({ only, notify = true, write = true } = {}) {
    const startedAt = new Date(now()).toISOString();
    const all = getTargets();
    let targets = all.filter((t) => t.enabled !== false);
    if (only) {
      const q = String(only).toLowerCase();
      targets = targets.filter((t) => t.id === q || normCompany(t.company) === normCompany(only) || t.company.toLowerCase().includes(q));
      if (!targets.length) throw new Error(`No target matches "${only}"`);
    }
    const results = await mapLimit(targets, cfg.concurrency, async (t) => {
      const r = await scanTarget(t, { http, store: st, now, cfg });
      log(`${r.ok ? (r.warning ? '!' : '✓') : '✗'} ${t.company.padEnd(28)} ${r.ok ? `${String(r.jobs).padStart(4)} jobs, ${r.matches.length} exec, ${r.alerts.length} new signal(s)${r.warning ? ` - ${r.warning}` : ''}` : r.error}`);
      return r;
    });
    const alerts = results.flatMap((r) => r.alerts);
    const briefStats = await attachBriefs(alerts, { ai: router, store: st, cfg, log });
    st.addAlerts(alerts);

    let delivery = { sent: 0, skipped: 0, failures: [], noChannels: false };
    if (notify) {
      // Retry recent undelivered alerts from earlier scans too.
      const recent = st.data.alerts.filter((a) => !alerts.includes(a) && !st.wasSent(a.key) && now() - Date.parse(a.detectedAt) < 3 * DAY);
      delivery = await notifyAlerts([...alerts, ...recent], { http, store: st, cfg, targets: all, now, log });
    }
    st.save();

    const open = openRoles(st, all);
    const files = write ? writeReports(cfg.outDir, { alerts, open, results, startedAt }) : null;
    return { startedAt, results, alerts, open, files, briefStats, delivery, ai: Boolean(router && cfg.aiEnabled) };
  }

  return {
    cfg,
    http,
    store: st,
    ai: router,
    getTargets,

    /** Concurrent scans share one run (API + scheduler can't double-scan). */
    scan(opts) {
      if (running && !opts?.only) return running;
      const p = runScan(opts).finally(() => {
        if (running === p) running = null;
      });
      if (!opts?.only) running = p;
      return p;
    },

    async addTarget(input, { detect = true } = {}) {
      const t = normalizeTarget(input);
      if (detect && t.careersUrl && !t.ats) {
        const d = await detectBoard(t.careersUrl, http);
        t.ats = d.ats;
        t.board = d.board;
        t.detectedVia = d.via;
      }
      setTargets(mergeTargets(getTargets(), [t]));
      return t;
    },

    removeTarget(id) {
      const list = getTargets();
      const next = list.filter((t) => t.id !== id && normCompany(t.company) !== normCompany(id));
      if (next.length === list.length) return false;
      setTargets(next);
      return true;
    },

    importTargets(list, { replace = false } = {}) {
      const merged = replace ? list : mergeTargets(getTargets(), list);
      setTargets(merged);
      return merged.length;
    },

    detect: (url) => detectBoard(url, http),
    classify: (title) => classifyTitle(title),

    /** Current postings of one target with their classification (debugging a board). */
    async jobs(idOrName) {
      const t = getTargets().find((x) => x.id === idOrName || normCompany(x.company) === normCompany(idOrName));
      if (!t) throw new Error(`No target "${idOrName}"`);
      const where = await resolveBoard(t, { http, store: st });
      const jobs = await getAdapter(where.ats).fetchJobs(where.board, http, t);
      st.save();
      return { target: t, ...where, jobs: jobs.map((j) => ({ ...j, description: undefined, role: classifyTitle(j.title) })) };
    },

    alerts({ days = 30, minScore = 0, company } = {}) {
      const since = now() - days * DAY;
      return st.data.alerts
        .filter((a) => Date.parse(a.detectedAt) >= since && a.score >= minScore && (!company || normCompany(a.company).includes(normCompany(company))))
        .map(({ excerpt, ...a }) => ({ ...a, notified: st.wasSent(a.key) }))
        .reverse();
    },

    openRoles: () => openRoles(st, getTargets()),

    health() {
      const boards = st.data.boards;
      const targets = getTargets();
      return {
        targets: targets.length,
        failing: targets.filter((t) => (boards[t.id]?.failures || 0) > 0).map((t) => ({ company: t.company, failures: boards[t.id].failures, error: boards[t.id].lastError })),
        lastScanAt: Object.values(boards).map((b) => b.lastScanAt).filter(Boolean).sort().at(-1) || null,
        alerts: st.data.alerts.length,
        ai: router ? router.status().map((s) => ({ id: s.id, state: s.state })) : 'off',
      };
    },
  };
}
