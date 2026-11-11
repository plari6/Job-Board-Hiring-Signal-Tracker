import { hash, mapLimit, truncate } from './util.js';

export const PROMPT_VERSION = 'brief-v1';

const MANDATE_POINTS = {
  'Cloud migration': 'They plan a cloud migration: lead with how you cut migration risk or cloud cost.',
  'Modernize legacy systems': 'They are modernizing legacy systems: show a low-risk path off the old stack.',
  'AI / data platform': 'AI and data are on the agenda: connect your product to their data/AI plans.',
  'Security & compliance': 'Security/compliance is in scope (e.g. SOC 2, ISO 27001): offer audit-ready proof points.',
  'Scale the engineering team': 'They are growing the engineering team: speak to onboarding speed and team productivity.',
  'Scale the platform / reliability': 'Reliability at scale matters: bring uptime and performance numbers.',
  'DevOps / developer productivity': 'DevOps/developer productivity is a goal: quantify hours saved per engineer.',
  'Cost optimization': 'Cost is a mandate: open with a savings estimate or consolidation story.',
  'Digital transformation': 'There is a transformation program: position as a quick win inside it.',
  'M&A / integration': 'They integrate acquisitions: show how you unify systems across companies.',
  'Build product from zero': 'Greenfield build: they choose the stack from scratch, so get into the first decisions.',
  'Owns vendor & tool decisions': 'The new leader explicitly owns vendor decisions: ask for a short intro slot early.',
};

const WHY_NOW = {
  role_opened:
    'An open CTO-level search means the technology roadmap and vendor list will be re-decided soon. Build the relationship with the people running the search now, so you are already known when the new leader starts reviewing tools.',
  role_closed_likely_filled:
    'The search has closed, so a new leader is likely starting. New technology executives usually review the stack, budget and vendors in their first 90 days, which is the best window to get a meeting.',
  role_closed_pulled_early:
    'The posting was pulled quickly. The hire may have been made internally, filled through a recruiter, or the plan changed. Worth a light check-in, not a full campaign.',
  role_reopened:
    'The search restarted. Whoever covers the role in the meantime still owns the problems and may welcome help that does not need a new leader to sign off.',
  hiring_surge:
    'Engineering hiring is accelerating, which usually follows new funding or a new product push. Tools that help a growing team (onboarding, productivity, security, infrastructure) get budget now.',
};

function whoToContact(a) {
  const rep = a.insights?.reportsTo;
  switch (a.type) {
    case 'role_opened':
    case 'role_reopened':
      return `${rep && rep !== 'CTO' ? `The ${rep} (the role reports there)` : 'The CEO / founders'} and whoever leads engineering today (interim tech lead or VP Engineering).`;
    case 'role_closed':
      return `The new ${a.roleLabel}: search LinkedIn for "${a.roleLabel} at ${a.company}" who started in the last 60 days. Also the ${rep || 'CEO'} who hired them.`;
    case 'hiring_surge':
      return 'The head of engineering and the engineering managers who are hiring.';
    default:
      return 'The technology leadership team.';
  }
}

function timing(a) {
  if (a.type === 'role_closed' && a.outcome === 'likely_filled') return 'Reach out 2-6 weeks after the start date: early enough to shape the 90-day plan, late enough that they have settled in.';
  if (a.type === 'role_opened') return 'Now, while the search runs. Plan a second touch when the posting closes (this tool will alert you).';
  if (a.type === 'hiring_surge') return 'This week, while budgets for the new team are being set.';
  return 'Within the next 2 weeks.';
}

/** Brief written from rules only - used when AI is off or every model failed. */
export function ruleBrief(a, cfg = {}) {
  const key = a.type === 'role_closed' ? `role_closed_${a.outcome}` : a.type;
  const i = a.insights || {};
  const points = [
    ...(i.mandates || []).map((m) => MANDATE_POINTS[m]).filter(Boolean),
    i.stack?.length ? `Their stack mentions ${i.stack.slice(0, 6).join(', ')}: lead with integrations you already have.` : null,
    i.teamSize ? `The role leads about ${i.teamSize} people, so expect team-level purchasing decisions.` : null,
    i.firstHire ? 'This is their first technical leader: no incumbent owner of the stack yet.' : null,
  ].filter(Boolean);
  if (!points.length) points.push('Ask what the new leader is expected to fix in the first 6 months.');

  const offer = cfg.offer || 'our product';
  const first = (a.title || a.roleLabel || '').trim();
  const angle = (i.mandates || [])[0];
  const subject =
    a.type === 'role_closed' ? `First 90 days as ${a.roleLabel} at ${a.company}` : a.type === 'hiring_surge' ? `Scaling engineering at ${a.company}` : `${a.company}'s ${first} search`;
  const body =
    a.type === 'role_closed'
      ? `Hi {{first_name}},\n\nCongratulations on the new role at ${a.company}. Most technology leaders I speak with use their first 90 days to review the stack${angle ? `, and ${angle.toLowerCase()} looked like a priority in the role description` : ''}.\n\nWe help teams like yours with ${offer}. Would a 20-minute call in the next couple of weeks be useful, so you have one option ready when you get to that review?\n\nBest,\n${cfg.senderName || '{{sender_name}}'}`
      : a.type === 'hiring_surge'
        ? `Hi {{first_name}},\n\nI noticed ${a.company} is hiring a lot of engineers right now (${a.surge?.now} open roles). Teams growing that fast often run into onboarding and tooling limits.\n\nWe help with ${offer}. Open to a short call to compare notes?\n\nBest,\n${cfg.senderName || '{{sender_name}}'}`
        : `Hi {{first_name}},\n\nI saw ${a.company} is looking for a ${first}${angle ? `, with ${angle.toLowerCase()} on the agenda` : ''}. While the search runs, the team usually still has to keep the roadmap moving.\n\nWe help with ${offer}. Happy to share what similar companies did before their new leader started. Worth a quick call?\n\nBest,\n${cfg.senderName || '{{sender_name}}'}`;
  return {
    source: 'rules',
    summary: a.headline,
    why_now: WHY_NOW[key] || WHY_NOW.role_opened,
    who_to_contact: whoToContact(a),
    talking_points: points.slice(0, 4),
    email_subject: subject,
    email_body: body,
    linkedin_note: truncate(
      a.type === 'role_closed'
        ? `Congrats on joining ${a.company} as ${a.roleLabel}! I work with tech leaders on ${offer}. Happy to connect and share what peers prioritise in their first 90 days.`
        : `Hi! Saw ${a.company} is growing its tech leadership. I work with teams on ${offer}. Would be glad to connect.`,
      280,
    ),
    timing: timing(a),
  };
}

const SYSTEM = `You are a B2B sales research assistant writing for a software sales rep.
You receive a hiring signal from a target company's job board (a CTO or other technology executive search, or an engineering hiring surge).
Write a short, specific account brief. Use ONLY the facts given; never invent names, numbers, funding or customers.
If the seller's offer is given, connect the job description's mandates to it honestly; if there is no real link, say what to ask instead.
The email must be under 120 words, plain, no hype, one clear ask, and start with "Hi {{first_name}},".
Return JSON only with keys: summary, why_now, who_to_contact, talking_points (array of 2-4 strings), email_subject, email_body, linkedin_note (max 280 chars), timing.`;

function promptFor(a, cfg) {
  const i = a.insights || {};
  return [
    `Company: ${a.company}${a.domain ? ` (${a.domain})` : ''}`,
    `Signal: ${a.type}${a.outcome ? ` (${a.outcome})` : ''} - ${a.headline}`,
    a.title ? `Job title: ${a.title}` : '',
    a.location ? `Location: ${a.location}` : '',
    a.daysOpen != null ? `Days the posting was open: ${a.daysOpen}` : '',
    a.surge ? `Engineering openings: ~${a.surge.before} -> ${a.surge.now}` : '',
    i.reportsTo ? `Reports to: ${i.reportsTo}` : '',
    i.teamSize ? `Team size mentioned: ${i.teamSize}` : '',
    i.mandates?.length ? `Mandates found: ${i.mandates.join('; ')}` : '',
    i.stack?.length ? `Tech stack mentioned: ${i.stack.join(', ')}` : '',
    i.firstHire ? 'First / founding technical leader: yes' : '',
    i.compensation ? `Compensation: ${i.compensation}` : '',
    '',
    `Seller's offer: ${cfg.offer || '(not given)'}`,
    `Seller's ideal customer: ${cfg.icp || '(not given)'}`,
    `Sender name: ${cfg.senderName || '{{sender_name}}'}`,
    a.excerpt ? `\nJob description excerpt:\n"""\n${a.excerpt.slice(0, 2500)}\n"""` : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** Validates model JSON; throwing makes the router try the next model. */
export function parseBrief(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  for (const k of ['summary', 'why_now', 'email_subject', 'email_body']) {
    if (typeof j[k] !== 'string' || !j[k].trim()) throw new Error(`brief missing "${k}"`);
  }
  const points = Array.isArray(j.talking_points) ? j.talking_points.filter((p) => typeof p === 'string' && p.trim()) : [];
  if (!points.length) throw new Error('brief has no talking_points');
  return {
    source: 'ai',
    summary: truncate(j.summary, 400),
    why_now: truncate(j.why_now, 600),
    who_to_contact: truncate(j.who_to_contact || '', 300),
    talking_points: points.slice(0, 4).map((p) => truncate(p, 300)),
    email_subject: truncate(j.email_subject, 120),
    email_body: truncate(j.email_body, 1200),
    linkedin_note: truncate(j.linkedin_note || '', 280),
    timing: truncate(j.timing || '', 300),
  };
}

/**
 * Attach `brief` to every alert. The best `cfg.maxBriefs` alerts get an AI brief (cached per alert +
 * offer + prompt version); the rest, and any AI failure, get the rule brief. Never throws.
 */
export async function attachBriefs(alerts, { ai, store, cfg, log = () => {} }) {
  const stats = { ai: 0, cached: 0, rules: 0, failed: 0 };
  const ranked = [...alerts].sort((x, y) => y.score - x.score);
  const aiSet = new Set(ai && cfg.aiEnabled ? ranked.filter((a) => a.score >= cfg.briefMinScore).slice(0, cfg.maxBriefs) : []);
  await mapLimit(ranked, 3, async (a) => {
    if (!aiSet.has(a)) {
      a.brief = ruleBrief(a, cfg);
      stats.rules++;
      return;
    }
    const key = hash([PROMPT_VERSION, a.key, cfg.offer, cfg.icp, cfg.senderName]);
    const hit = store?.cacheGet(key);
    if (hit) {
      a.brief = { ...hit, cached: true };
      stats.cached++;
      return;
    }
    try {
      const r = await ai.generate({
        system: SYSTEM,
        messages: [{ role: 'user', content: promptFor(a, cfg) }],
        json: true,
        temperature: 0.3,
        maxTokens: 2048,
        parse: parseBrief,
      });
      a.brief = { ...r.data, model: r.target };
      store?.cacheSet(key, a.brief);
      stats.ai++;
    } catch (err) {
      log(`[ai] brief for ${a.company} fell back to rules: ${err.message}`);
      a.brief = ruleBrief(a, cfg);
      stats.failed++;
    }
  });
  return stats;
}
