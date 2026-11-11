import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { demoTracker } from './helpers.js';

async function withServer(tracker, fn) {
  const server = createApp(tracker).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('REST API: auth, targets, scan, alerts, open roles, classify, detect', async () => {
  const { tracker, world } = demoTracker({ cfg: { apiKey: 'k3y' } });
  world.day = 1;
  await withServer(tracker, async (base) => {
    const h = { 'x-api-key': 'k3y', 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/targets`)).status, 401);
    assert.equal((await fetch(`${base}/api/targets`, { headers: { 'x-api-key': 'wrong' } })).status, 401);

    const targets = await (await fetch(`${base}/api/targets`, { headers: h })).json();
    assert.equal(targets.targets.length, 8);

    const scan = await (await fetch(`${base}/api/scan`, { method: 'POST', headers: h, body: JSON.stringify({ notify: false }) })).json();
    assert.equal(scan.scanned, 8);
    assert.equal(scan.alerts.length, 4);

    const alerts = await (await fetch(`${base}/api/alerts?minScore=80`, { headers: { authorization: 'Bearer k3y' } })).json();
    assert.ok(alerts.alerts.every((a) => a.score >= 80));
    assert.ok(alerts.alerts.length >= 1);

    const open = await (await fetch(`${base}/api/open-roles`, { headers: h })).json();
    assert.equal(open.openRoles.length, 4);

    const cls = await (await fetch(`${base}/api/classify`, { method: 'POST', headers: h, body: JSON.stringify({ titles: ['Interim CTO', 'Field CTO'] }) })).json();
    assert.equal(cls.results[0].role.id, 'cto');
    assert.ok(cls.results[1].role.excluded);

    const det = await (await fetch(`${base}/api/detect?url=${encodeURIComponent('https://atlas.example/careers')}`, { headers: h })).json();
    assert.equal(det.ats, 'greenhouse');
    assert.equal((await fetch(`${base}/api/detect?url=ftp://x`, { headers: h })).status, 400);

    const add = await fetch(`${base}/api/targets`, { method: 'POST', headers: h, body: JSON.stringify({ company: 'New Co', careersUrl: 'https://jobs.lever.co/newco' }) });
    assert.equal(add.status, 201);
    assert.equal((await add.json()).target.ats, 'lever');
    const bad = await fetch(`${base}/api/targets`, { method: 'POST', headers: h, body: JSON.stringify({ company: 'No URL' }) });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/api/targets/new-co`, { method: 'DELETE', headers: h })).status, 200);
    assert.equal((await fetch(`${base}/api/targets/new-co`, { method: 'DELETE', headers: h })).status, 404);
    assert.equal((await fetch(`${base}/api/nope`, { headers: h })).status, 404);
  });
});
