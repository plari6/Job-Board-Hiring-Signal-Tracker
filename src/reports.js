import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCsv } from './util.js';

export function alertRow(a) {
  const b = a.brief || {};
  return {
    detected_at: a.detectedAt,
    priority: a.priority,
    score: a.score,
    company: a.company,
    signal: a.type,
    outcome: a.outcome || '',
    role: a.roleLabel || '',
    job_title: a.title || '',
    posting_url: a.url || '',
    location: a.location || '',
    days_open: a.daysOpen ?? '',
    reports_to: a.insights?.reportsTo || '',
    team_size: a.insights?.teamSize ?? '',
    mandates: a.insights?.mandates || [],
    tech_stack: a.insights?.stack || [],
    owner: a.owner,
    headline: a.headline,
    why_now: b.why_now || '',
    who_to_contact: b.who_to_contact || '',
    talking_points: b.talking_points || [],
    email_subject: b.email_subject || '',
    email_body: b.email_body || '',
    linkedin_note: b.linkedin_note || '',
    brief_source: b.source ? `${b.source}${b.model ? ` (${b.model})` : ''}` : '',
  };
}

export function markdownReport({ alerts, open, results, startedAt }) {
  const lines = [`# Hiring signal report`, '', `Scan: ${startedAt} · ${results.length} companies · ${alerts.length} new signals`, ''];
  const failed = results.filter((r) => !r.ok);
  for (const p of ['hot', 'warm', 'info']) {
    const list = alerts.filter((a) => a.priority === p).sort((x, y) => y.score - x.score);
    if (!list.length) continue;
    lines.push(`## ${p === 'hot' ? '🔥 Hot' : p === 'warm' ? '🟠 Warm' : '🔵 Info'} (${list.length})`, '');
    for (const a of list) {
      const b = a.brief || {};
      lines.push(`### ${a.headline} — ${a.score}/100`, '');
      if (a.url) lines.push(`- Posting: ${a.url}`);
      if (a.owner) lines.push(`- Owner: ${a.owner}`);
      if (a.insights?.mandates?.length) lines.push(`- Mandates: ${a.insights.mandates.join(', ')}`);
      if (a.insights?.stack?.length) lines.push(`- Stack: ${a.insights.stack.join(', ')}`);
      if (a.insights?.reportsTo) lines.push(`- Reports to: ${a.insights.reportsTo}`);
      lines.push(`- Score reasons: ${a.why.join('; ')}`);
      if (b.why_now) lines.push('', `**Why now:** ${b.why_now}`, '', `**Who:** ${b.who_to_contact}`, '', `**When:** ${b.timing}`);
      if (b.talking_points?.length) lines.push('', ...b.talking_points.map((t) => `- ${t}`));
      if (b.email_body) lines.push('', `**Draft email — ${b.email_subject}**`, '', '```', b.email_body, '```');
      if (b.linkedin_note) lines.push('', `**LinkedIn note:** ${b.linkedin_note}`);
      lines.push('', `<sub>brief: ${b.source || 'none'}${b.model ? ` · ${b.model}` : ''}</sub>`, '');
    }
  }
  if (!alerts.length) lines.push('_No new signals this scan._', '');
  lines.push(`## Open executive searches right now (${open.length})`, '');
  if (open.length) {
    lines.push('| Company | Role | Title | Days open | Owner |', '|---|---|---|---|---|');
    for (const r of open) lines.push(`| ${r.company} | ${r.role} | [${r.title.replace(/\|/g, '/')}](${r.url}) | ${r.daysOpen ?? ''} | ${r.owner} |`);
  } else lines.push('_None._');
  if (failed.length) lines.push('', `## Boards that could not be read (${failed.length})`, '', ...failed.map((r) => `- ${r.company}: ${r.error}`));
  return lines.join('\n') + '\n';
}

/** Writes alerts.csv / alerts.json / open-roles.csv / report.md to outDir. Returns the file paths. */
export function writeReports(outDir, { alerts, open, results, startedAt }) {
  mkdirSync(outDir, { recursive: true });
  const files = {
    csv: join(outDir, 'alerts.csv'),
    json: join(outDir, 'alerts.json'),
    open: join(outDir, 'open-roles.csv'),
    md: join(outDir, 'report.md'),
  };
  writeFileSync(files.csv, '﻿' + toCsv(alerts.map(alertRow), Object.keys(alertRow({ insights: {}, why: [] }))));
  writeFileSync(files.json, JSON.stringify({ startedAt, alerts: alerts.map(({ excerpt, ...a }) => a), results: results.map(({ alerts: _, ...r }) => r) }, null, 2));
  writeFileSync(files.open, '﻿' + toCsv(open, ['company', 'role', 'title', 'url', 'location', 'postedAt', 'firstSeenAt', 'daysOpen', 'reportsTo', 'mandates', 'stack', 'owner']));
  writeFileSync(files.md, markdownReport({ alerts, open, results, startedAt }));
  return files;
}
