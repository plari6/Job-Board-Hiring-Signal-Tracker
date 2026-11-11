import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseCsv } from '../src/util.js';

const BIN = resolve(import.meta.dirname, '..', 'bin', 'hiring-tracker.js');
const cleanEnv = () => {
  const env = { ...process.env, TRACKER_SKIP_DOTENV: '1' };
  for (const k of Object.keys(env)) if (/API_KEY|WEBHOOK|TELEGRAM|RESEND|EMAIL_|SENDER_|WATCH_ROLES|TRACKER_HOME|OLLAMA/.test(k)) delete env[k];
  return env;
};
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, env: cleanEnv(), encoding: 'utf8', timeout: 60000 });

test('demo runs offline and writes the report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hst-'));
  try {
    const r = run(['demo', '--out', 'out'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Northwind Logistics closed its Chief Technology Officer \(CTO\) search after 54 days/);
    assert.match(r.stderr, /Brightpath Health is hiring a Chief Technology Officer/);
    const md = readFileSync(join(dir, 'out', 'report.md'), 'utf8');
    assert.match(md, /Draft email/);
    const csv = readFileSync(join(dir, 'out', 'alerts.csv'), 'utf8');
    const rows = parseCsv(csv);
    assert.equal(rows.length, 10);
    assert.ok(rows.every((r) => r.email_body.startsWith('Hi {{first_name}}')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init, import, targets, classify, roles and a clear error without targets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hst-'));
  try {
    const noTargets = run(['scan', '--no-notify'], dir);
    assert.equal(noTargets.status, 1);
    assert.match(noTargets.stderr, /No targets/);

    assert.equal(run(['init'], dir).status, 0);
    assert.ok(existsSync(join(dir, 'config', 'targets.json')));
    assert.ok(existsSync(join(dir, '.env')));

    writeFileSync(join(dir, 'list.csv'), 'Company,Careers URL,Owner,Tier,Roles\nAcme,https://jobs.lever.co/acme,Sam,A,cto;ciso\n');
    const imp = run(['import', 'list.csv'], dir);
    assert.equal(imp.status, 0, imp.stderr);
    const t = JSON.parse(readFileSync(join(dir, 'config', 'targets.json'), 'utf8')).targets;
    const acme = t.find((x) => x.id === 'acme');
    assert.deepEqual(acme.roles, ['cto', 'ciso']);
    assert.equal(acme.tier, 'A');

    const list = run(['targets'], dir);
    assert.match(list.stderr, /Acme/);

    const c = run(['classify', 'Co-Founder', '&', 'CTO'], dir);
    assert.equal(JSON.parse(c.stdout).id, 'cto');
    assert.match(run(['roles'], dir).stderr, /● cto/);
    assert.equal(run(['import', 'missing.csv'], dir).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
