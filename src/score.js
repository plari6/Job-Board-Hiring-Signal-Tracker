/**
 * Alert score 0-100 = how worth a rep's time this signal is today.
 *
 * Base = the role's buying-signal strength (CTO 95, CIO 78, VP Eng 75 ... see roles.js).
 * Event: role closed after >= 14 days ("likely filled") +3, pulled within 14 days -20 (maybe cancelled),
 *        reopened +2, hiring surge uses its own base 55.
 * Already open when tracking started: -8 (the search may be old news).
 * Interim / fractional -15. Founding / first CTO +4 (greenfield: no incumbent vendors).
 * Account tier A +8, C -8. Each mandate that matches the seller's offer +4 (max +12).
 */

export function scoreAlert(alert, { tier, offerKeywords = [] } = {}) {
  let s;
  const why = [];
  if (alert.type === 'hiring_surge') {
    s = 55 + Math.min(15, Math.round((alert.surge?.ratio - 1.5) * 10) || 0);
    why.push('engineering hiring surge');
  } else {
    s = alert.roleScore ?? 50;
    why.push(`${alert.roleLabel} role`);
    if (alert.type === 'role_closed') {
      if (alert.outcome === 'likely_filled') { s += 3; why.push('posting closed after a full search: new leader likely hired'); }
      else { s -= 20; why.push('posting pulled quickly'); }
    }
    if (alert.type === 'role_reopened') { s += 2; why.push('search reopened'); }
    if (alert.type === 'role_opened' && alert.baseline) { s -= 8; why.push('already open when tracking started'); }
    if (alert.interim) { s -= 15; why.push('interim / fractional'); }
    if (alert.insights?.firstHire) { s += 4; why.push('first technical leader (no incumbent stack owner)'); }
  }
  const t = String(tier || '').toUpperCase();
  if (t === 'A') { s += 8; why.push('tier A account'); }
  if (t === 'C') { s -= 8; why.push('tier C account'); }

  const kws = offerKeywords.map((k) => k.toLowerCase()).filter(Boolean);
  if (kws.length && alert.insights) {
    const hay = [...(alert.insights.mandates || []), ...(alert.insights.stack || [])].join(' | ').toLowerCase();
    const hits = kws.filter((k) => hay.includes(k));
    if (hits.length) { s += Math.min(12, hits.length * 4); why.push(`matches your offer: ${hits.join(', ')}`); }
  }
  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, priority: score >= 80 ? 'hot' : score >= 60 ? 'warm' : 'info', why };
}
