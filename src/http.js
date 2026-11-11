import { sleep as realSleep } from './util.js';

export const USER_AGENT = 'HiringSignalTracker/1.0 (+https://github.com/plari6/Job-Board-Hiring-Signal-Tracker)';

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', retryable = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

function retryAfterMs(res) {
  const h = res.headers?.get?.('retry-after');
  if (!h) return 0;
  const n = Number(h);
  if (Number.isFinite(n)) return n * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : 0;
}

/**
 * Small polite HTTP client:
 *  - timeout on every request, retries on 429/5xx/network with backoff (honours Retry-After, capped);
 *  - requests to the same host are spaced by `hostGapMs` so a big target list never hammers one ATS;
 *  - robots.txt check for HTML career pages (`robots: true`), cached per origin.
 */
export function createHttp({
  fetchImpl = fetch,
  timeoutMs = 15_000,
  retries = 2,
  hostGapMs = 400,
  userAgent = USER_AGENT,
  sleep = realSleep,
  respectRobots = true,
} = {}) {
  const hostQueue = new Map();
  const robotsCache = new Map();
  const stats = { requests: 0, errors: 0 };

  async function politeTurn(host) {
    const prev = hostQueue.get(host) || Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    hostQueue.set(host, prev.then(() => mine));
    await prev;
    return () => {
      setTimeout(release, hostGapMs);
    };
  }

  async function request(url, { method = 'GET', headers = {}, body, accept = '*/*' } = {}) {
    const host = new URL(url).host;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const done = hostGapMs > 0 ? await politeTurn(host) : () => {};
      stats.requests++;
      let res;
      let text;
      try {
        res = await fetchImpl(url, {
          method,
          headers: { 'user-agent': userAgent, accept, ...headers },
          body,
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Read the body inside the same timeout/retry: large feeds can stall mid-download.
        text = await res.text();
      } catch (err) {
        done();
        const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        lastErr = new HttpError(`${timeout ? `timeout after ${timeoutMs} ms` : 'network error'} for ${url}${timeout ? '' : `: ${err?.message || err}`}`, { url, retryable: true });
        if (attempt < retries) await sleep(500 * 2 ** attempt);
        continue;
      }
      done();
      if (res.ok) return { status: res.status, headers: res.headers, text };
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new HttpError(`HTTP ${res.status} for ${url}`, { status: res.status, url, retryable });
      if (!retryable || attempt >= retries) break;
      await sleep(Math.min(30_000, retryAfterMs(res) || 1000 * 2 ** attempt));
    }
    stats.errors++;
    throw lastErr;
  }

  async function robotsAllowed(url) {
    if (!respectRobots) return true;
    const u = new URL(url);
    let rules = robotsCache.get(u.origin);
    if (!rules) {
      rules = [];
      try {
        const res = await fetchImpl(`${u.origin}/robots.txt`, {
          headers: { 'user-agent': userAgent },
          signal: AbortSignal.timeout(Math.min(timeoutMs, 8000)),
        });
        if (res.ok) rules = parseRobots(await res.text());
      } catch {
        /* no robots.txt reachable -> allowed */
      }
      robotsCache.set(u.origin, rules);
    }
    return isAllowed(rules, u.pathname + u.search);
  }

  return {
    stats,
    request,
    robotsAllowed,
    async text(url, opts) {
      return (await request(url, { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...opts })).text;
    },
    async json(url, opts = {}) {
      const res = await request(url, { accept: 'application/json', ...opts });
      const t = res.text;
      try {
        return JSON.parse(t);
      } catch {
        throw new HttpError(`expected JSON from ${url} but got ${/^\s*</.test(t) ? 'HTML (blocked or wrong board name?)' : 'invalid JSON'}`, { url, status: res.status });
      }
    },
    async postJson(url, payload, headers = {}) {
      return request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    },
  };
}

/** Rules for "*" (and our own agent name) from robots.txt: [{ allow: bool, path }]. */
export function parseRobots(txt) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow') && val) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a.includes('hiringsignaltracker')));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}

export function isAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp(
      '^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'),
    );
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
