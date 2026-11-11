import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyAlerts, slackPayload, channelsFor } from '../src/notify.js';
import { createStore } from '../src/store.js';
import { ruleBrief } from '../src/brief.js';
import { testHttp, testConfig, demoTracker } from './helpers.js';

const make = (over = {}) => {
  const a = { key: 'k1', type: 'role_opened', company: 'Acme', targetId: 'acme', title: 'CTO', roleLabel: 'CTO', url: 'https://x/cto', score: 88, priority: 'hot', why: ['CTO role'], headline: 'Acme is hiring a CTO', insights: { mandates: ['Cloud migration'], stack: ['AWS'] }, detectedAt: '2026-11-11T00:00:00Z', ownerEmail: 'rep@x.example', ...over };
  a.brief = ruleBrief(a, {});
  return a;
};

function capture(status = () => 200) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const s = status(String(url));
    return new Response(s === 200 ? '{"ok":true}' : 'fail', { status: s });
  };
  return { sent, http: testHttp(fetchImpl) };
}

const cfgWith = (notify, over = {}) => {
  const c = testConfig(over);
  return { ...c, notify: { ...c.notify, ...notify } };
};

test('sends to every configured channel with the right payloads, once', async () => {
  const { sent, http } = capture();
  const cfg = cfgWith({ slackWebhook: 'https://hooks.slack.test/a', telegramToken: '123:abc', telegramChatId: '-1', resendKey: 're_x', emailFrom: 'Signals <s@x.example>', emailTo: ['team@x.example'], webhookUrl: 'https://hook.test/w', webhookSecret: 'sec', discordWebhook: 'https://discord.test/w', teamsWebhook: 'https://teams.test/w' });
  const store = createStore(null, { memory: true });
  const a = make();
  const r = await notifyAlerts([a], { http, store, cfg, targets: [{ id: 'acme', slackWebhook: 'https://hooks.slack.test/owner' }] });
  assert.equal(r.sent, 1);
  const by = (p) => sent.find((s) => s.url.startsWith(p));
  assert.ok(by('https://hooks.slack.test/owner'), 'owner Slack webhook overrides the global one');
  assert.ok(!by('https://hooks.slack.test/a'));
  assert.equal(by('https://hooks.slack.test/owner').body.blocks[0].type, 'header');
  assert.equal(by('https://api.telegram.org/bot123:abc/sendMessage').body.parse_mode, 'HTML');
  const mail = by('https://api.resend.com/emails');
  assert.deepEqual(mail.body.to, ['rep@x.example', 'team@x.example']);
  assert.equal(mail.headers.authorization, 'Bearer re_x');
  const hook = by('https://hook.test/w');
  assert.equal(hook.body.event, 'hiring_signal');
  assert.equal(hook.headers['x-webhook-secret'], 'sec');
  assert.equal(hook.body.alert.excerpt, undefined);
  assert.ok(by('https://discord.test/w').body.content.length <= 2000);
  assert.equal(by('https://teams.test/w').body.attachments[0].content.type, 'AdaptiveCard');

  // Already delivered: nothing is sent again.
  const before = sent.length;
  await notifyAlerts([a], { http, store, cfg });
  assert.equal(sent.length, before);
});

test('below threshold is skipped; failed delivery is retried later and the token is redacted', async () => {
  let fail = true;
  const { sent, http } = capture(() => (fail ? 500 : 200));
  const cfg = cfgWith({ telegramToken: '999:SECRET', telegramChatId: '1' }, { notifyMinScore: 60 });
  const store = createStore(null, { memory: true });
  const low = make({ key: 'low', score: 40 });
  const a = make({ key: 'k2' });
  const r = await notifyAlerts([low, a], { http, store, cfg });
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
  assert.equal(r.failures.length, 1);
  assert.ok(!r.failures[0].error.includes('SECRET'));
  fail = false;
  const r2 = await notifyAlerts([a], { http, store, cfg });
  assert.equal(r2.sent, 1);
  assert.ok(store.wasSent('k2'));
  assert.ok(sent.every((s) => !s.url.includes('low')));
});

test('no channels -> reported, nothing marked as sent', async () => {
  const { http } = capture();
  const store = createStore(null, { memory: true });
  const r = await notifyAlerts([make()], { http, store, cfg: cfgWith({}) });
  assert.equal(r.noChannels, true);
  assert.equal(store.wasSent('k1'), false);
  assert.deepEqual(channelsFor(make({ ownerEmail: '' }), cfgWith({})), []);
});

test('slack payload stays within block limits', () => {
  const a = make({ brief: { ...ruleBrief(make(), {}), email_body: 'x'.repeat(5000) } });
  const p = slackPayload(a);
  assert.ok(p.blocks.every((b) => !b.text || b.text.text.length <= 3000));
  assert.equal(p.blocks.at(-1).type, 'actions');
});

test('scan sends notifications end to end through the tracker', async () => {
  const sent = [];
  const { tracker, world } = demoTracker({
    cfg: { notify: { ...testConfig().notify, webhookUrl: 'https://hook.test/w', emailTo: [] }, notifyMinScore: 60 },
    extra: (u, init) => {
      if (u === 'https://hook.test/w') {
        sent.push(JSON.parse(init.body).alert);
        return new Response('ok');
      }
      return null;
    },
  });
  world.day = 1;
  const r = await tracker.scan({ notify: true, write: false });
  assert.equal(r.delivery.sent, sent.length);
  assert.ok(sent.length >= 3);
  assert.ok(sent.every((a) => a.score >= 60));
  world.day = 1;
  const again = await tracker.scan({ notify: true, write: false });
  assert.equal(again.delivery.sent, 0);
});
