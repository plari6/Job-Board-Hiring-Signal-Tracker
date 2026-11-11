import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoTracker, jsonResponse } from './helpers.js';
import { DAY } from '../src/util.js';

async function runDays(tracker, world, days) {
  const out = {};
  for (const d of days) {
    world.day = d;
    out[d] = await tracker.scan({ notify: false, write: false });
  }
  return out;
}

test('three-day story produces the expected signals', async () => {
  const { tracker, world } = demoTracker();
  const r = await runDays(tracker, world, [1, 2, 3]);
  const sig = (d) => r[d].alerts.map((a) => `${a.company}|${a.type}${a.outcome ? `|${a.outcome}` : ''}${a.baseline ? '|baseline' : ''}`).sort();

  assert.deepEqual(sig(1), [
    'Atlas Robotics|role_opened|baseline',
    'Kestrel Energy|role_opened|baseline',
    'Meridian Retail Group|role_opened|baseline',
    'Northwind Logistics|role_opened|baseline',
  ]);
  assert.deepEqual(sig(2), ['Atlas Robotics|role_opened', 'Brightpath Health|role_opened', 'Helio Fintech|role_opened']);
  assert.deepEqual(sig(3), ['Corvid Security|role_opened', 'Northwind Logistics|role_closed|likely_filled', 'Quantia Labs|hiring_surge']);

  const closed = r[3].alerts.find((a) => a.type === 'role_closed');
  assert.equal(closed.daysOpen, 54);
  assert.equal(closed.priority, 'hot');
  assert.match(closed.headline, /new CTO has likely been hired/);
  assert.equal(closed.insights.reportsTo, 'CEO');
  assert.ok(closed.insights.mandates.includes('Cloud migration'));

  const helio = r[2].alerts.find((a) => a.company === 'Helio Fintech');
  assert.equal(helio.interim, true);
  assert.ok(helio.score < r[2].alerts.find((a) => a.company === 'Brightpath Health').score);

  // Every alert has a brief (rules, since AI is off) and all scans succeeded.
  assert.ok(Object.values(r).every((x) => x.results.every((y) => y.ok)));
  assert.ok(Object.values(r).flatMap((x) => x.alerts).every((a) => a.brief?.source === 'rules' && a.brief.email_body.startsWith('Hi {{first_name}}')));
  // CISO description came from the SmartRecruiters detail endpoint.
  assert.ok(world.calls.some((c) => c.url.endsWith('/postings/7002')));
  assert.ok(r[3].alerts.find((a) => a.company === 'Corvid Security').insights.stack.includes('Okta'));

  const open = tracker.openRoles();
  assert.equal(open.length, 7);
  assert.ok(!open.some((o) => o.company === 'Northwind Logistics'));
});

test('excluded and unwatched titles never alert', async () => {
  const { tracker, world } = demoTracker();
  const r = await runDays(tracker, world, [1, 2, 3]);
  const titles = Object.values(r).flatMap((x) => x.alerts.map((a) => a.title));
  for (const t of ['Executive Assistant to the CTO', 'Field CTO, EMEA', 'Head of IT (m/w/d)']) assert.ok(!titles.includes(t), t);
});

test('a posting must be missing for CLOSE_AFTER_SCANS scans; a failed fetch never closes it', async () => {
  const { tracker, world } = demoTracker({ cfg: { closeAfterScans: 2 }, targets: [{ company: 'Northwind Logistics', careersUrl: 'https://job-boards.greenhouse.io/northwindlogistics' }] });
  await runDays(tracker, world, [1]);
  // Board down (404) for two scans: nothing closes.
  world.day = 2;
  const failing = tracker.store.board('northwind-logistics');
  const origFailures = failing.failures;
  const realTargets = tracker.getTargets();
  realTargets[0].ats = 'greenhouse';
  realTargets[0].board = 'does-not-exist';
  let r = await tracker.scan({ notify: false, write: false });
  assert.equal(r.results[0].ok, false);
  assert.equal(failing.failures, origFailures + 1);
  r = await tracker.scan({ notify: false, write: false });
  assert.equal(r.alerts.length, 0);
  assert.equal(Object.values(failing.roles)[0].status, 'open');

  // Board back (CTO gone): first miss = no alert, second miss = closed.
  delete realTargets[0].ats;
  delete realTargets[0].board;
  r = await tracker.scan({ notify: false, write: false });
  assert.equal(r.alerts.length, 0);
  assert.equal(Object.values(failing.roles)[0].missingScans, 1);
  r = await tracker.scan({ notify: false, write: false });
  assert.deepEqual(r.alerts.map((a) => a.type), ['role_closed']);
});

test('empty board after a full one is treated as a glitch', async () => {
  let empty = false;
  const { tracker, world } = demoTracker({
    cfg: { closeAfterScans: 1 },
    targets: [{ company: 'Northwind Logistics', careersUrl: 'https://job-boards.greenhouse.io/northwindlogistics' }],
    extra: (u) => (empty && u.includes('greenhouse') ? jsonResponse({ jobs: [] }) : null),
  });
  await runDays(tracker, world, [1]);
  empty = true;
  const r = await tracker.scan({ notify: false, write: false });
  assert.equal(r.alerts.length, 0);
  assert.match(r.results[0].warning, /ignored as a glitch/);
  assert.equal(Object.values(tracker.store.board('northwind-logistics').roles)[0].status, 'open');
});

test('a closed role that comes back is "reopened", and a short-lived posting is "pulled_early"', async () => {
  let phase = 'open';
  const job = (id) => ({ id, title: 'Chief Technology Officer', absolute_url: `https://x/${id}`, location: { name: 'NYC' }, first_published: null, content: '' });
  const filler = Array.from({ length: 3 }, (_, i) => ({ id: 100 + i, title: `Engineer ${i}`, absolute_url: `https://x/e${i}`, location: { name: 'NYC' } }));
  const { tracker, world } = demoTracker({
    cfg: { closeAfterScans: 1, filledMinDays: 14 },
    targets: [{ company: 'Acme', ats: 'greenhouse', board: 'acme' }],
    extra: (u) => (u.includes('/boards/acme/') ? jsonResponse({ jobs: phase === 'open' ? [...filler, job(1)] : phase === 'reopen' ? [...filler, job(2)] : filler }) : null),
  });
  world.day = 1;
  await tracker.scan({ notify: false, write: false });
  phase = 'gone';
  world.offsetMs = 3 * DAY;
  let r = await tracker.scan({ notify: false, write: false });
  assert.equal(r.alerts[0].type, 'role_closed');
  assert.equal(r.alerts[0].outcome, 'pulled_early');
  assert.ok(r.alerts[0].score < 80);
  phase = 'reopen';
  world.offsetMs = 10 * DAY;
  r = await tracker.scan({ notify: false, write: false });
  assert.equal(r.alerts[0].type, 'role_reopened');
  assert.equal(r.alerts[0].jobId, '2');
});

test('per-target role list and tier change what alerts and how it scores', async () => {
  const { tracker, world } = demoTracker({
    targets: [
      { company: 'Kestrel Energy', careersUrl: 'https://kestrel.jobs.personio.de/', roles: 'head_it', tier: 'C' },
      { company: 'Northwind Logistics', careersUrl: 'https://job-boards.greenhouse.io/northwindlogistics', tier: 'A' },
    ],
    cfg: { offerKeywords: ['kubernetes', 'cost'] },
  });
  world.day = 1;
  const r = await tracker.scan({ notify: false, write: false });
  const k = r.alerts.find((a) => a.company === 'Kestrel Energy');
  assert.equal(k.roleId, 'head_it');
  assert.ok(k.why.includes('tier C account'));
  const n = r.alerts.find((a) => a.company === 'Northwind Logistics');
  assert.ok(n.why.some((w) => w.startsWith('matches your offer: kubernetes, cost')));
});

test('ATS detection is cached per target and reused', async () => {
  const { tracker, world } = demoTracker({ targets: [{ company: 'Atlas Robotics', careersUrl: 'https://atlas.example/careers' }] });
  await runDays(tracker, world, [1, 2]);
  assert.equal(world.calls.filter((c) => c.url === 'https://atlas.example/careers').length, 1);
  assert.equal(tracker.store.data.detected['atlas-robotics'].board, 'atlasrobotics');
});
