import { getAdapter, detectBoard } from './ats/index.js';
import { classifyTitle, isEngineeringJob, normalizeTitle } from './roles.js';
import { extractInsights } from './insights.js';
import { scoreAlert } from './score.js';
import { daysBetween, DAY } from './util.js';

/** Where a target's jobs live: explicit config > cached detection > detect now (and cache). */
export async function resolveBoard(target, { http, store }) {
  if (target.ats && target.ats !== 'auto') {
    return { ats: target.ats, board: target.board || target.careersUrl, via: 'config' };
  }
  if (!target.careersUrl) throw new Error(`Target "${target.company}" needs careersUrl or ats + board`);
  const cached = store.data.detected[target.id];
  if (cached && cached.url === target.careersUrl) return cached;
  const found = await detectBoard(target.careersUrl, http);
  const rec = { ...found, url: target.careersUrl };
  store.data.detected[target.id] = rec;
  return rec;
}

function headline(a) {
  const d = a.daysOpen != null ? `${a.daysOpen} days` : 'a while';
  switch (a.type) {
    case 'role_opened':
      return `${a.company} is hiring a ${a.title}${a.baseline ? ' (already open when tracking started)' : ''}`;
    case 'role_closed':
      return a.outcome === 'likely_filled'
        ? `${a.company} closed its ${a.title} search after ${d}: a new ${a.roleLabel} has likely been hired`
        : `${a.company} pulled its ${a.title} posting after only ${d}`;
    case 'role_reopened':
      return `${a.company} reopened its ${a.title} search`;
    case 'hiring_surge':
      return `${a.company} engineering openings jumped from ~${a.surge.before} to ${a.surge.now}`;
    default:
      return `${a.company}: ${a.type}`;
  }
}

function makeAlert(type, target, ts, extra, cfg) {
  const a = {
    key: '',
    type,
    detectedAt: ts,
    targetId: target.id,
    company: target.company,
    domain: target.domain || '',
    owner: target.owner || '',
    ownerEmail: target.ownerEmail || '',
    tier: target.tier || '',
    ...extra,
  };
  Object.assign(a, scoreAlert(a, { tier: target.tier, offerKeywords: cfg.offerKeywords }));
  a.headline = headline(a);
  return a;
}

function roleFields(r) {
  return {
    jobId: r.jobId,
    title: r.title,
    roleId: r.roleId,
    roleLabel: r.roleLabel,
    roleScore: r.roleScore,
    interim: r.interim,
    url: r.url,
    location: r.location,
    department: r.department,
    postedAt: r.postedAt,
    firstSeenAt: r.firstSeenAt,
    insights: r.insights,
    excerpt: r.excerpt,
  };
}

/**
 * Scan one target account and turn changes since the last scan into alerts.
 *
 * Events:
 *  role_opened   a watched executive posting appeared (baseline=true on the first scan of the board)
 *  role_closed   it has been missing for `closeAfterScans` successful scans in a row
 *                -> outcome likely_filled (open >= filledMinDays) or pulled_early
 *  role_reopened the same role/title came back after closing (search failed or new hire left)
 *  hiring_surge  engineering openings >= surgeRatio x recent average and +surgeMin
 *
 * Safety: a failed fetch never closes anything; an empty board that had >= 5 jobs last time is
 * treated as a glitch (site change, block) and ignored.
 */
export async function scanTarget(target, { http, store, now = () => Date.now(), cfg }) {
  const ts = new Date(now()).toISOString();
  const b = store.board(target.id);
  b.lastScanAt = ts;
  const result = { target: target.id, company: target.company, ok: false, jobs: 0, matches: [], alerts: [], warning: null, error: null };

  let jobs;
  let where;
  try {
    where = await resolveBoard(target, { http, store });
    result.ats = where.ats;
    result.board = where.board;
    jobs = await getAdapter(where.ats).fetchJobs(where.board, http, target);
  } catch (err) {
    b.failures = (b.failures || 0) + 1;
    b.lastError = err.message;
    result.error = err.message;
    return result;
  }

  const adapter = getAdapter(where.ats);
  const lastTotal = b.history.at(-1)?.total ?? 0;
  result.ok = true;
  result.jobs = jobs.length;
  if (jobs.length === 0 && lastTotal >= 5) {
    b.lastError = `board returned 0 jobs (had ${lastTotal}); ignored as a glitch`;
    result.warning = b.lastError;
    return result;
  }
  const firstScan = !b.lastOkAt;
  b.lastOkAt = ts;
  b.failures = 0;
  b.lastError = null;

  const watch = target.roles || cfg.watch;
  const seen = new Set();
  const alerts = [];

  for (const job of jobs) {
    const c = classifyTitle(job.title);
    if (!c || c.excluded || !watch.includes(c.id)) continue;
    seen.add(job.id);
    result.matches.push({ title: job.title, role: c.id, url: job.url });
    const existing = b.roles[job.id];
    if (existing?.status === 'open') {
      Object.assign(existing, { lastSeenAt: ts, missingScans: 0, title: job.title, url: job.url || existing.url });
      continue;
    }

    // New or returning posting: read the full description once (some ATS lists have none).
    let detail = {};
    if (!job.description && adapter.fetchDetail) {
      try {
        detail = await adapter.fetchDetail(job, where.board, http);
      } catch {
        /* the list entry is still a valid signal */
      }
    }
    const description = detail.description || job.description || '';
    const role = {
      jobId: job.id,
      title: job.title,
      roleId: c.id,
      roleLabel: c.label,
      roleScore: c.score,
      group: c.group,
      interim: c.interim,
      url: job.url,
      location: detail.location || job.location,
      department: job.department,
      postedAt: detail.postedAt || job.postedAt || null,
      firstSeenAt: ts,
      lastSeenAt: ts,
      missingScans: 0,
      status: 'open',
      closedAt: null,
      insights: extractInsights(description, { title: job.title, compensation: job.compensation }),
      excerpt: description.slice(0, 2500),
    };

    const norm = normalizeTitle(job.title);
    const previous =
      existing ||
      Object.values(b.roles).find(
        (r) => r.status === 'closed' && r.roleId === c.id && normalizeTitle(r.title) === norm && now() - Date.parse(r.closedAt) < cfg.reopenWindowDays * DAY,
      );
    if (previous) {
      previous.reopenedAs = job.id;
      if (previous !== existing) previous.status = 'replaced';
      b.roles[job.id] = role;
      const a = makeAlert('role_reopened', target, ts, { ...roleFields(role), previousClosedAt: previous.closedAt }, cfg);
      a.key = `${target.id}:reopened:${job.id}:${ts.slice(0, 10)}`;
      alerts.push(a);
    } else {
      b.roles[job.id] = role;
      const a = makeAlert('role_opened', target, ts, { ...roleFields(role), baseline: firstScan }, cfg);
      a.key = `${target.id}:opened:${job.id}`;
      alerts.push(a);
    }
  }

  // Watched postings that disappeared.
  for (const r of Object.values(b.roles)) {
    if (r.status !== 'open' || seen.has(r.jobId)) continue;
    r.missingScans = (r.missingScans || 0) + 1;
    if (r.missingScans < cfg.closeAfterScans) continue;
    r.status = 'closed';
    r.closedAt = ts;
    const daysOpen = daysBetween(r.postedAt && r.postedAt < r.firstSeenAt ? r.postedAt : r.firstSeenAt, ts);
    const outcome = daysOpen >= cfg.filledMinDays ? 'likely_filled' : 'pulled_early';
    const a = makeAlert('role_closed', target, ts, { ...roleFields(r), closedAt: ts, daysOpen, outcome }, cfg);
    a.key = `${target.id}:closed:${r.jobId}`;
    alerts.push(a);
  }

  // Engineering hiring surge.
  const eng = jobs.filter(isEngineeringJob).length;
  const prev = b.history.slice(-6);
  if (cfg.surge && prev.length >= 2) {
    const avg = prev.reduce((s, h) => s + h.eng, 0) / prev.length;
    const recent = b.lastSurgeAt && now() - Date.parse(b.lastSurgeAt) < 14 * DAY;
    if (avg >= 3 && eng >= avg * cfg.surgeRatio && eng - avg >= cfg.surgeMin && !recent) {
      b.lastSurgeAt = ts;
      const a = makeAlert('hiring_surge', target, ts, { roleLabel: 'Engineering team', title: `${eng} engineering openings`, url: getAdapter(where.ats).publicUrl(where.board), surge: { before: Math.round(avg), now: eng, ratio: +(eng / avg).toFixed(2), total: jobs.length } }, cfg);
      a.key = `${target.id}:surge:${ts.slice(0, 10)}`;
      alerts.push(a);
    }
  }
  b.history.push({ at: ts, total: jobs.length, eng });
  if (b.history.length > 120) b.history = b.history.slice(-120);

  // Forget long-closed roles.
  for (const [id, r] of Object.entries(b.roles)) {
    if (r.status !== 'open' && r.closedAt && now() - Date.parse(r.closedAt) > 400 * DAY) delete b.roles[id];
  }

  result.alerts = alerts;
  return result;
}

/** Every watched executive posting that is open right now, across all targets. */
export function openRoles(store, targets) {
  const byId = new Map(targets.map((t) => [t.id, t]));
  const rows = [];
  for (const [tid, b] of Object.entries(store.data.boards)) {
    const t = byId.get(tid);
    if (!t) continue;
    for (const r of Object.values(b.roles)) {
      if (r.status !== 'open') continue;
      rows.push({
        company: t.company,
        owner: t.owner || '',
        role: r.roleLabel,
        title: r.title,
        url: r.url,
        location: r.location,
        postedAt: r.postedAt,
        firstSeenAt: r.firstSeenAt,
        daysOpen: daysBetween(r.postedAt && r.postedAt < r.firstSeenAt ? r.postedAt : r.firstSeenAt, b.lastOkAt || r.lastSeenAt),
        mandates: r.insights?.mandates || [],
        stack: r.insights?.stack || [],
        reportsTo: r.insights?.reportsTo || '',
      });
    }
  }
  return rows.sort((a, b) => (b.daysOpen ?? 0) - (a.daysOpen ?? 0));
}
