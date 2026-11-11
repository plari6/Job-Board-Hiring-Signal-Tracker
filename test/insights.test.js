import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInsights } from '../src/insights.js';
import { htmlToText, parseCsv, toCsv, toIso, csvCell } from '../src/util.js';
import { parseRobots, isAllowed } from '../src/http.js';

test('mandates, stack, team size, reporting line, comp', () => {
  const i = extractInsights(
    `You will report directly to the CEO and lead a team of 35 engineers.
     Own the migration of our platform to the cloud (AWS), achieve SOC 2 and HIPAA compliance,
     reduce cloud costs and select the vendors we standardise on. Stack: TypeScript, Node.js, React, PostgreSQL, Kubernetes.
     Compensation: $260,000 - $310,000 + equity.`,
  );
  assert.deepEqual(i.mandates, ['Cloud migration', 'Security & compliance', 'Cost optimization', 'Owns vendor & tool decisions']);
  for (const s of ['AWS', 'TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Kubernetes']) assert.ok(i.stack.includes(s), s);
  assert.equal(i.teamSize, 35);
  assert.equal(i.reportsTo, 'CEO');
  assert.equal(i.compensation, '$260,000 - $310,000');
  assert.equal(i.equity, true);
});

test('stack matching avoids common-word false positives', () => {
  const i = extractInsights('We react quickly, go to market fast and spark ideas. Our oracle of truth.');
  assert.deepEqual(i.stack, []);
});

test('first CTO and replacement flags', () => {
  assert.equal(extractInsights('Be our first CTO and build from scratch').firstHire, true);
  assert.equal(extractInsights('Choose the stack', { title: 'Co-Founder & CTO' }).firstHire, true);
  assert.equal(extractInsights('You will succeed our outgoing CTO').replacement, true);
  assert.equal(extractInsights('Report to the founders').reportsTo, 'Founders');
});

test('htmlToText decodes Greenhouse double-escaped HTML', () => {
  const t = htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;');
  assert.match(t, /Hello & welcome/);
  assert.match(t, /- One/);
  assert.equal(htmlToText(''), '');
});

test('csv round trip, formula injection guard, dates', () => {
  const csv = toCsv([{ a: 'x, "y"', b: ['p', 'q'], c: '=HYPERLINK("x")' }]);
  const rows = parseCsv(csv);
  assert.equal(rows[0].a, 'x, "y"');
  assert.equal(rows[0].b, 'p; q');
  assert.equal(rows[0].c, `'=HYPERLINK("x")`);
  assert.equal(csvCell(null), '');
  assert.equal(parseCsv('﻿Company,Careers URL\r\nAcme,https://a.example\r\n\r\n')[0].careers_url, 'https://a.example');
  assert.equal(toIso(1786469891368), '2026-08-11T17:38:11.368Z');
  assert.equal(toIso('2026-11-10 07:31:31 UTC'), '2026-11-10T07:31:31.000Z');
  assert.equal(toIso('nope'), null);
});

test('robots.txt rules', () => {
  const rules = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /careers/internal\nAllow: /careers/internal/public\nDisallow: /*.pdf$');
  assert.equal(isAllowed(rules, '/careers'), true);
  assert.equal(isAllowed(rules, '/careers/internal/x'), false);
  assert.equal(isAllowed(rules, '/careers/internal/public/1'), true);
  assert.equal(isAllowed(rules, '/a/file.pdf'), false);
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow: /\nUser-agent: HiringSignalTracker\nAllow: /'), '/jobs'), true);
});
