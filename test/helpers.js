import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../src/config.js';
import { createTracker } from '../src/tracker.js';
import { createStore } from '../src/store.js';
import { createHttp } from '../src/http.js';
import { normalizeTarget } from '../src/targets.js';
import { DEMO_TARGETS, createDemoFetch, demoNow } from '../examples/demo-data.js';

export function testConfig(over = {}) {
  const cfg = buildConfig({}, { home: process.cwd() });
  return { ...cfg, hostGapMs: 0, respectRobots: true, outDir: join(tmpdir(), 'hiring-tracker-test-output'), ...over };
}

export function testHttp(fetchImpl) {
  return createHttp({ fetchImpl, hostGapMs: 0, retries: 1, sleep: async () => {} });
}

/** Tracker over the demo world. `world.day` controls which snapshot the fake fetch serves. */
export function demoTracker({ cfg = {}, ai = null, targets, extra } = {}) {
  const world = { day: 1, calls: [] };
  const fetchImpl = createDemoFetch(() => world.day, { calls: world.calls, extra });
  const tracker = createTracker({
    cfg: testConfig(cfg),
    env: {},
    fetchImpl,
    ai,
    now: () => demoNow(world.day) + (world.offsetMs || 0),
    store: createStore(null, { memory: true }),
    targets: (targets || DEMO_TARGETS).map(normalizeTarget),
    log: () => {},
  });
  return { tracker, world };
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
