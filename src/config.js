import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WATCH, parseWatch } from './roles.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Loads .env from the working folder, then the project folder (existing variables win). */
export function loadEnvFiles(env = process.env) {
  if (env.TRACKER_SKIP_DOTENV === '1') return [];
  const loaded = [];
  for (const f of [resolve(process.cwd(), '.env'), resolve(PROJECT_ROOT, '.env')]) {
    if (existsSync(f) && !loaded.includes(f)) {
      try {
        process.loadEnvFile(f);
        loaded.push(f);
      } catch {
        /* malformed .env: ignore, doctor will show missing keys */
      }
    }
  }
  return loaded;
}

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const list = (v) => String(v || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

export function buildConfig(env = process.env, opts = {}) {
  const home = resolve(opts.home || env.TRACKER_HOME || process.cwd());
  const offer = opts.offer ?? env.SENDER_OFFER ?? '';
  return {
    home,
    targetsFile: resolve(home, opts.targets || env.TARGETS_FILE || 'config/targets.json'),
    stateFile: resolve(home, opts.state || env.STATE_FILE || 'data/state.json'),
    outDir: resolve(home, opts.out || env.OUTPUT_DIR || 'output'),
    watch: parseWatch(opts.roles || env.WATCH_ROLES) || DEFAULT_WATCH,
    closeAfterScans: Math.max(1, num(env.CLOSE_AFTER_SCANS, 2)),
    filledMinDays: num(env.FILLED_MIN_DAYS, 14),
    reopenWindowDays: num(env.REOPEN_WINDOW_DAYS, 180),
    surge: bool(env.SURGE_ALERTS, true),
    surgeRatio: num(env.SURGE_RATIO, 1.5),
    surgeMin: num(env.SURGE_MIN_JOBS, 5),
    concurrency: Math.max(1, num(env.SCAN_CONCURRENCY, 4)),
    timeoutMs: num(env.HTTP_TIMEOUT_MS, 25000),
    hostGapMs: num(env.HOST_GAP_MS, 400),
    respectRobots: bool(env.RESPECT_ROBOTS, true),
    notifyMinScore: num(opts.minScore ?? env.NOTIFY_MIN_SCORE, 60),
    maxNotifyPerRun: num(env.MAX_NOTIFY_PER_RUN, 30),
    aiEnabled: opts.ai !== false && bool(env.AI_BRIEFS, true),
    maxBriefs: num(env.MAX_AI_BRIEFS, 15),
    briefMinScore: num(env.BRIEF_MIN_SCORE, 50),
    offer,
    icp: opts.icp ?? env.TARGET_ICP ?? '',
    senderName: env.SENDER_NAME || '',
    offerKeywords: list(env.OFFER_KEYWORDS || ''),
    apiKey: env.API_KEY || '',
    notify: {
      slackWebhook: env.SLACK_WEBHOOK_URL || '',
      teamsWebhook: env.TEAMS_WEBHOOK_URL || '',
      discordWebhook: env.DISCORD_WEBHOOK_URL || '',
      telegramToken: env.TELEGRAM_BOT_TOKEN || '',
      telegramChatId: env.TELEGRAM_CHAT_ID || '',
      resendKey: env.RESEND_API_KEY || '',
      emailFrom: env.EMAIL_FROM || '',
      emailTo: list(env.EMAIL_TO),
      webhookUrl: env.WEBHOOK_URL || '',
      webhookSecret: env.WEBHOOK_SECRET || '',
    },
  };
}
