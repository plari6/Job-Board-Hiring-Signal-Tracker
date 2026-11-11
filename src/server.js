import express from 'express';
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * REST API over the tracker (for CRMs, Zapier/Make/n8n, internal dashboards).
 * Auth: when API_KEY is set every /api route needs header `x-api-key` (or `Authorization: Bearer`).
 */
export function createApp(tracker, { log = () => {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ...tracker.health() }));

  app.use('/api', (req, res, next) => {
    const key = tracker.cfg.apiKey;
    if (!key) return next();
    const given = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (given && safeEqual(given, key)) return next();
    res.status(401).json({ error: 'missing or wrong API key (header x-api-key)' });
  });

  app.get('/api/targets', (_req, res) => res.json({ targets: tracker.getTargets().map(({ slackWebhook, ...t }) => t) }));

  app.post('/api/targets', async (req, res) => {
    const t = await tracker.addTarget(req.body || {}, { detect: req.query.detect !== 'false' });
    const { slackWebhook, ...safe } = t;
    res.status(201).json({ target: safe });
  });

  app.delete('/api/targets/:id', (req, res) => {
    if (!tracker.removeTarget(req.params.id)) return res.status(404).json({ error: 'not found' });
    res.json({ removed: req.params.id });
  });

  app.post('/api/scan', async (req, res) => {
    const r = await tracker.scan({ only: req.body?.company, notify: req.body?.notify !== false });
    res.json({
      startedAt: r.startedAt,
      scanned: r.results.length,
      failed: r.results.filter((x) => !x.ok).map((x) => ({ company: x.company, error: x.error })),
      alerts: r.alerts.map(({ excerpt, ...a }) => a),
      delivery: r.delivery,
      briefs: r.briefStats,
    });
  });

  app.get('/api/alerts', (req, res) => {
    res.json({ alerts: tracker.alerts({ days: Number(req.query.days) || 30, minScore: Number(req.query.minScore) || 0, company: req.query.company }) });
  });

  app.get('/api/open-roles', (_req, res) => res.json({ openRoles: tracker.openRoles() }));

  app.get('/api/detect', async (req, res) => {
    if (!/^https?:\/\//i.test(String(req.query.url || ''))) return res.status(400).json({ error: 'query parameter url (http/https) is required' });
    res.json(await tracker.detect(String(req.query.url)));
  });

  app.post('/api/classify', (req, res) => {
    const titles = Array.isArray(req.body?.titles) ? req.body.titles : [req.body?.title];
    if (!titles.filter(Boolean).length) return res.status(400).json({ error: 'send { "title": "..." } or { "titles": [...] }' });
    res.json({ results: titles.filter(Boolean).map((t) => ({ title: t, role: tracker.classify(t) })) });
  });

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  // Express 5 forwards async errors here.
  app.use((err, _req, res, _next) => {
    const status = err.status || (/^(Target|No target|.*must|.*give careersUrl|.*unknown ats|Unknown role)/i.test(err.message) ? 400 : 500);
    if (status >= 500) log(`[api] ${err.stack || err.message}`);
    res.status(status).json({ error: err.message });
  });
  return app;
}
