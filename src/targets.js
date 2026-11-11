import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADAPTERS } from './ats/index.js';
import { parseWatch } from './roles.js';
import { parseCsv, slugify } from './util.js';

/**
 * A target account:
 * { id, company, careersUrl?, ats?, board?, domain?, owner?, ownerEmail?, slackWebhook?, tier?: A|B|C,
 *   roles?: ["cto", ...], selectors?: { item, title, link, location }, notes?, enabled? }
 */
export function normalizeTarget(t) {
  const company = String(t.company || t.name || t.account || '').trim();
  if (!company) throw new Error(`Target without a company name: ${JSON.stringify(t).slice(0, 120)}`);
  const careersUrl = String(t.careersUrl || t.careers_url || t.url || t.careers || '').trim();
  const ats = String(t.ats || '').trim().toLowerCase() || undefined;
  if (ats && ats !== 'auto' && !ADAPTERS[ats]) throw new Error(`${company}: unknown ats "${ats}" (use ${Object.keys(ADAPTERS).join(', ')} or leave empty)`);
  const board = String(t.board || t.board_token || '').trim() || undefined;
  if (!careersUrl && !(ats && board)) throw new Error(`${company}: give careersUrl, or ats + board`);
  if (careersUrl && !/^https?:\/\//i.test(careersUrl)) throw new Error(`${company}: careersUrl must start with http(s)://`);
  const roles = parseWatch(t.roles || t.watch) || undefined;
  const tier = String(t.tier || '').trim().toUpperCase() || undefined;
  const out = {
    id: t.id ? slugify(t.id) : slugify(company),
    company,
    ...(careersUrl && { careersUrl }),
    ...(ats && { ats }),
    ...(board && { board }),
    ...(t.domain && { domain: String(t.domain).trim() }),
    ...((t.owner || t.account_owner) && { owner: String(t.owner || t.account_owner).trim() }),
    ...((t.ownerEmail || t.owner_email) && { ownerEmail: String(t.ownerEmail || t.owner_email).trim() }),
    ...((t.slackWebhook || t.slack_webhook) && { slackWebhook: String(t.slackWebhook || t.slack_webhook).trim() }),
    ...(tier && { tier }),
    ...(roles && { roles }),
    ...(t.selectors && { selectors: t.selectors }),
    ...(t.notes && { notes: String(t.notes) }),
    ...(t.enabled === false || /^(false|no|0)$/i.test(String(t.enabled ?? '')) ? { enabled: false } : {}),
  };
  return out;
}

export function loadTargets(file) {
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  const list = Array.isArray(raw) ? raw : raw.targets || [];
  const seen = new Set();
  return list.map((t) => {
    const n = normalizeTarget(t);
    if (seen.has(n.id)) throw new Error(`Duplicate target id "${n.id}" in ${file}`);
    seen.add(n.id);
    return n;
  });
}

export function saveTargets(file, targets) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ targets }, null, 2) + '\n');
}

/** CSV columns (any case): company, careers_url, ats, board, domain, owner, owner_email, slack_webhook, tier, roles, notes */
export function targetsFromCsv(text) {
  return parseCsv(text).map((r) => normalizeTarget(r));
}

/** Merge new targets into existing ones by id (new values win). */
export function mergeTargets(existing, incoming) {
  const map = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) map.set(t.id, { ...(map.get(t.id) || {}), ...t });
  return [...map.values()];
}
