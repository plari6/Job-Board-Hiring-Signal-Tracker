import { escapeHtml, truncate } from './util.js';

const ICON = { hot: '🔥', warm: '🟠', info: '🔵' };
const TYPE = { role_opened: 'Exec search opened', role_closed: 'Exec search closed', role_reopened: 'Exec search reopened', hiring_surge: 'Engineering hiring surge' };

export function plainText(a) {
  const b = a.brief || {};
  return [
    `${ICON[a.priority] || ''} ${a.headline} [${a.score}/100]`,
    a.url ? `Posting: ${a.url}` : '',
    a.owner ? `Account owner: ${a.owner}` : '',
    b.why_now ? `\nWhy now: ${b.why_now}` : '',
    b.who_to_contact ? `Who: ${b.who_to_contact}` : '',
    b.talking_points?.length ? `Talking points:\n${b.talking_points.map((p) => `• ${p}`).join('\n')}` : '',
    b.timing ? `When: ${b.timing}` : '',
    b.email_subject ? `\nDraft email - ${b.email_subject}\n${b.email_body}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function slackPayload(a) {
  const b = a.brief || {};
  const facts = [
    a.location && `*Location:* ${a.location}`,
    a.daysOpen != null && `*Open for:* ${a.daysOpen} days`,
    a.insights?.reportsTo && `*Reports to:* ${a.insights.reportsTo}`,
    a.insights?.mandates?.length && `*Mandates:* ${a.insights.mandates.join(', ')}`,
    a.insights?.stack?.length && `*Stack:* ${a.insights.stack.slice(0, 8).join(', ')}`,
    a.owner && `*Owner:* ${a.owner}`,
  ].filter(Boolean);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: truncate(`${ICON[a.priority] || ''} ${TYPE[a.type] || a.type}: ${a.company}`, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${a.headline}*\nScore *${a.score}/100* (${a.priority}) · ${a.why?.join(' · ') || ''}` } },
  ];
  if (facts.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: facts.join('\n') } });
  if (b.why_now) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(`*Why now:* ${b.why_now}\n*Who:* ${b.who_to_contact || '-'}\n*When:* ${b.timing || '-'}`, 2900) } });
  if (b.talking_points?.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(`*Talking points*\n${b.talking_points.map((p) => `• ${p}`).join('\n')}`, 2900) } });
  if (b.email_body) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(`*Draft email: ${b.email_subject}*\n\`\`\`${b.email_body}\`\`\``, 2900) } });
  if (a.url) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open posting' }, url: a.url }] });
  return { text: a.headline, blocks };
}

function telegramHtml(a) {
  const b = a.brief || {};
  return truncate(
    [
      `${ICON[a.priority] || ''} <b>${escapeHtml(a.headline)}</b>`,
      `Score ${a.score}/100 (${a.priority})${a.owner ? ` · owner ${escapeHtml(a.owner)}` : ''}`,
      a.url ? `<a href="${escapeHtml(a.url)}">Open posting</a>` : '',
      b.why_now ? `\n<b>Why now:</b> ${escapeHtml(b.why_now)}` : '',
      b.who_to_contact ? `<b>Who:</b> ${escapeHtml(b.who_to_contact)}` : '',
      b.talking_points?.length ? b.talking_points.map((p) => `• ${escapeHtml(p)}`).join('\n') : '',
      b.email_body ? `\n<b>Draft email:</b> ${escapeHtml(b.email_subject)}\n<pre>${escapeHtml(b.email_body)}</pre>` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    4000,
  );
}

function emailHtml(alerts) {
  const rows = alerts
    .map((a) => {
      const b = a.brief || {};
      return `<div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin:0 0 14px;font-family:Arial,sans-serif">
<div style="font-size:16px;font-weight:bold">${ICON[a.priority] || ''} ${escapeHtml(a.headline)}</div>
<div style="color:#555;margin:4px 0 10px">Score ${a.score}/100 · ${escapeHtml(a.why?.join(' · ') || '')}${a.url ? ` · <a href="${escapeHtml(a.url)}">posting</a>` : ''}</div>
${b.why_now ? `<p><b>Why now:</b> ${escapeHtml(b.why_now)}</p>` : ''}
${b.who_to_contact ? `<p><b>Who:</b> ${escapeHtml(b.who_to_contact)}</p>` : ''}
${b.talking_points?.length ? `<ul>${b.talking_points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
${b.email_body ? `<p><b>Draft email: ${escapeHtml(b.email_subject)}</b></p><pre style="white-space:pre-wrap;background:#f6f6f6;padding:10px;border-radius:6px">${escapeHtml(b.email_body)}</pre>` : ''}
</div>`;
    })
    .join('\n');
  return `<div>${rows}<p style="color:#888;font-size:12px">Sent by Job Board Hiring Signal Tracker</p></div>`;
}

/** Channels configured in env, plus per-target overrides (owner Slack webhook / owner email). */
export function channelsFor(alert, cfg, target = {}) {
  const ch = [];
  const n = cfg.notify;
  const slack = target.slackWebhook || n.slackWebhook;
  if (slack) ch.push({ kind: 'slack', url: slack });
  if (n.teamsWebhook) ch.push({ kind: 'teams', url: n.teamsWebhook });
  if (n.discordWebhook) ch.push({ kind: 'discord', url: n.discordWebhook });
  if (n.telegramToken && n.telegramChatId) ch.push({ kind: 'telegram' });
  const to = [...new Set([alert.ownerEmail, ...n.emailTo].filter(Boolean))];
  if (n.resendKey && n.emailFrom && to.length) ch.push({ kind: 'email', to });
  if (n.webhookUrl) ch.push({ kind: 'webhook', url: n.webhookUrl });
  return ch;
}

async function sendOne(ch, alert, { http, cfg }) {
  const n = cfg.notify;
  switch (ch.kind) {
    case 'slack':
      return http.postJson(ch.url, slackPayload(alert));
    case 'teams':
      // Teams "Workflows" incoming webhook: Adaptive Card message.
      return http.postJson(ch.url, {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [{ type: 'TextBlock', text: alert.headline, weight: 'Bolder', wrap: true }, { type: 'TextBlock', text: plainText(alert), wrap: true }],
              actions: alert.url ? [{ type: 'Action.OpenUrl', title: 'Open posting', url: alert.url }] : [],
            },
          },
        ],
      });
    case 'discord':
      return http.postJson(ch.url, { content: truncate(plainText(alert), 1990), allowed_mentions: { parse: [] } });
    case 'telegram':
      return http.postJson(`https://api.telegram.org/bot${n.telegramToken}/sendMessage`, {
        chat_id: n.telegramChatId,
        text: telegramHtml(alert),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    case 'email':
      return http.postJson(
        'https://api.resend.com/emails',
        { from: n.emailFrom, to: ch.to, subject: truncate(`${ICON[alert.priority] || ''} ${alert.headline}`, 150), html: emailHtml([alert]), text: plainText(alert) },
        { authorization: `Bearer ${n.resendKey}` },
      );
    case 'webhook': {
      // Generic JSON for Zapier / Make / n8n / CRM workflows.
      const { excerpt, ...rest } = alert;
      return http.postJson(ch.url, { event: 'hiring_signal', alert: rest }, n.webhookSecret ? { 'x-webhook-secret': n.webhookSecret } : {});
    }
    default:
      throw new Error(`unknown channel ${ch.kind}`);
  }
}

/**
 * Deliver alerts at or above cfg.notifyMinScore that were not delivered before.
 * An alert counts as delivered when at least one channel accepted it; failed ones are retried on the
 * next scans (max 3 attempts). Returns { sent, skipped, failures: [{ company, channel, error }] }.
 */
export async function notifyAlerts(alerts, { http, store, cfg, targets = [], now = () => Date.now(), log = () => {} }) {
  const byId = new Map(targets.map((t) => [t.id, t]));
  const out = { sent: 0, skipped: 0, failures: [], noChannels: false };
  const due = alerts.filter((a) => a.score >= cfg.notifyMinScore && !store.wasSent(a.key) && (a.notifyAttempts || 0) < 3);
  out.skipped = alerts.length - due.length;
  for (const a of due.slice(0, cfg.maxNotifyPerRun)) {
    const channels = channelsFor(a, cfg, byId.get(a.targetId));
    if (!channels.length) {
      out.noChannels = true;
      continue;
    }
    a.notifyAttempts = (a.notifyAttempts || 0) + 1;
    let ok = 0;
    for (const ch of channels) {
      try {
        await sendOne(ch, a, { http, cfg });
        ok++;
      } catch (err) {
        out.failures.push({ company: a.company, channel: ch.kind, error: err.message.replace(/bot\d+:[\w-]+/g, 'bot***') });
        log(`[notify] ${ch.kind} failed for ${a.company}: ${err.message.replace(/bot\d+:[\w-]+/g, 'bot***')}`);
      }
    }
    if (ok) {
      store.markSent(a.key, new Date(now()).toISOString());
      a.notifiedAt = new Date(now()).toISOString();
      out.sent++;
    }
  }
  return out;
}
