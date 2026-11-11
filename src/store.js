import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY = () => ({ version: 1, boards: {}, alerts: [], sent: {}, aiCache: {}, detected: {} });

/**
 * JSON file state (atomic write via temp file + rename). Plenty for hundreds of target accounts;
 * swap for a database by keeping the same methods.
 *
 * boards[targetId] = { lastScanAt, lastOkAt, failures, lastError, history: [{ at, total, eng }], roles: { [jobId]: role } }
 */
export function createStore(file, { memory = false } = {}) {
  let data = EMPTY();
  if (!memory && file && existsSync(file)) {
    try {
      data = { ...EMPTY(), ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch (err) {
      throw new Error(`State file ${file} is not valid JSON (${err.message}). Fix or delete it.`);
    }
  }
  return {
    file,
    get data() {
      return data;
    },
    board(id) {
      return (data.boards[id] ||= { lastScanAt: null, lastOkAt: null, failures: 0, lastError: null, history: [], roles: {} });
    },
    addAlerts(alerts, keep = 2000) {
      data.alerts.push(...alerts);
      if (data.alerts.length > keep) data.alerts = data.alerts.slice(-keep);
    },
    wasSent: (key) => Boolean(data.sent[key]),
    markSent(key, at) {
      data.sent[key] = at;
    },
    cacheGet: (k) => data.aiCache[k],
    cacheSet(k, v) {
      data.aiCache[k] = v;
      const keys = Object.keys(data.aiCache);
      if (keys.length > 1000) for (const old of keys.slice(0, keys.length - 1000)) delete data.aiCache[old];
    },
    save() {
      if (memory || !file) return;
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 1));
      renameSync(tmp, file);
    },
  };
}
