import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleBrief, parseBrief, attachBriefs } from '../src/brief.js';
import { createLLMRouter } from '../src/ai/index.js';
import { AIError, ERROR_KINDS } from '../src/ai/errors.js';
import { createStore } from '../src/store.js';
import { demoTracker } from './helpers.js';

const alert = (over = {}) => ({
  key: 'acme:closed:1',
  type: 'role_closed',
  outcome: 'likely_filled',
  company: 'Acme',
  title: 'Chief Technology Officer',
  roleLabel: 'CTO',
  score: 90,
  headline: 'Acme closed its CTO search',
  insights: { mandates: ['Cloud migration', 'Cost optimization'], stack: ['AWS'], reportsTo: 'CEO', teamSize: 40 },
  ...over,
});

const GOOD = JSON.stringify({
  summary: 'Acme has a new CTO.',
  why_now: 'First 90 days.',
  who_to_contact: 'The new CTO',
  talking_points: ['Cloud cost', 'Migration risk'],
  email_subject: 'Hello',
  email_body: 'Hi {{first_name}}, ...',
  linkedin_note: 'Congrats!',
  timing: 'Week 3',
});

function fakeRouter(behaviours) {
  const providers = {};
  const chain = behaviours.map((b, i) => {
    providers[`p${i}`] = { configured: true, complete: async () => b() };
    return { provider: `p${i}`, model: `m${i}` };
  });
  return createLLMRouter({ chain, providers, timeoutMs: 2000, totalBudgetMs: 5000 });
}

test('rule brief uses mandates, the right contact and timing per signal', () => {
  const b = ruleBrief(alert(), { offer: 'cloud cost software', senderName: 'Dana' });
  assert.equal(b.source, 'rules');
  assert.match(b.who_to_contact, /new CTO.*LinkedIn/);
  assert.match(b.timing, /2-6 weeks/);
  assert.ok(b.talking_points.some((p) => /cloud migration/i.test(p)));
  assert.match(b.email_body, /cloud cost software/);
  assert.match(b.email_body, /Dana$/);
  assert.ok(b.linkedin_note.length <= 280);
  const opened = ruleBrief(alert({ type: 'role_opened', outcome: undefined }), {});
  assert.match(opened.who_to_contact, /CEO/);
  const surge = ruleBrief(alert({ type: 'hiring_surge', surge: { before: 4, now: 14 }, insights: {} }), {});
  assert.match(surge.email_body, /14 open roles/);
});

test('parseBrief accepts fenced JSON and rejects incomplete output', () => {
  assert.equal(parseBrief('```json\n' + GOOD + '\n```').summary, 'Acme has a new CTO.');
  assert.throws(() => parseBrief('{"summary":"x"}'), /missing/);
  assert.throws(() => parseBrief('not json'));
});

test('AI brief: bad JSON from the first model falls through to the next model', async () => {
  const ai = fakeRouter([() => ({ text: 'Sure! Here is the brief' }), () => ({ text: GOOD })]);
  const a = alert();
  const store = createStore(null, { memory: true });
  const stats = await attachBriefs([a], { ai, store, cfg: { aiEnabled: true, maxBriefs: 5, briefMinScore: 50 } });
  assert.equal(a.brief.source, 'ai');
  assert.equal(a.brief.model, 'p1:m1');
  assert.equal(stats.ai, 1);
  // Second run hits the cache, no model call.
  const b = alert();
  const stats2 = await attachBriefs([b], { ai: fakeRouter([() => { throw new Error('should not be called'); }]), store, cfg: { aiEnabled: true, maxBriefs: 5, briefMinScore: 50 } });
  assert.equal(stats2.cached, 1);
  assert.equal(b.brief.cached, true);
});

test('every model down -> rule brief, scan still completes', async () => {
  const down = () => {
    throw new AIError('503 overloaded', { kind: ERROR_KINDS.overloaded, status: 503 });
  };
  const ai = fakeRouter([down, down]);
  const { tracker, world } = demoTracker({ ai, cfg: { aiEnabled: true } });
  world.day = 1;
  const r = await tracker.scan({ notify: false, write: false });
  assert.equal(r.alerts.length, 4);
  assert.ok(r.alerts.every((a) => a.brief.source === 'rules'));
  assert.equal(r.briefStats.failed + r.briefStats.rules, 4);
});

test('only the best alerts above BRIEF_MIN_SCORE use AI', async () => {
  let calls = 0;
  const ai = fakeRouter([() => (calls++, { text: GOOD })]);
  const list = [alert({ key: 'a', score: 95 }), alert({ key: 'b', score: 85 }), alert({ key: 'c', score: 40 })];
  await attachBriefs(list, { ai, store: createStore(null, { memory: true }), cfg: { aiEnabled: true, maxBriefs: 1, briefMinScore: 50 } });
  assert.equal(calls, 1);
  assert.deepEqual(list.map((a) => a.brief.source), ['ai', 'rules', 'rules']);
});
