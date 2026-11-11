import * as cheerio from 'cheerio';
import { ATS_ADAPTERS } from './adapters.js';
import { html } from './html.js';

export const ADAPTERS = Object.fromEntries([...ATS_ADAPTERS, html].map((a) => [a.id, a]));

export function getAdapter(id) {
  const a = ADAPTERS[id];
  if (!a) throw new Error(`Unknown ATS "${id}". Supported: ${Object.keys(ADAPTERS).join(', ')}`);
  return a;
}

/** Match a URL against every ATS pattern. -> { ats, board } | null */
export function detectFromUrl(url) {
  for (const a of ATS_ADAPTERS) {
    const board = a.match(url);
    if (board) return { ats: a.id, board };
  }
  return null;
}

/** Find an embedded ATS inside a careers page: iframes, script src, links, Greenhouse JS settings. */
export function detectFromHtml(body) {
  const $ = cheerio.load(body);
  const candidates = [];
  $('iframe[src], script[src], a[href], link[href], form[action], [data-src]').each((_, el) => {
    const v = $(el).attr('src') || $(el).attr('href') || $(el).attr('action') || $(el).attr('data-src');
    if (v) candidates.push(v);
  });
  const inline = $('script:not([src])').text();
  const gh = inline.match(/Grnhse\.Settings\.boardToken\s*=\s*["']([A-Za-z0-9_-]+)["']/) || body.match(/greenhouse\.io\/embed\/job_board\/js\?for=([A-Za-z0-9_-]+)/);
  if (gh) return { ats: 'greenhouse', board: gh[1] };
  candidates.push(...(inline.match(/https?:\/\/[^\s"'<>]+/g) || []));
  for (const c of candidates) {
    const hit = detectFromUrl(c);
    if (hit) return hit;
  }
  return null;
}

function careersLink($, base) {
  let best = null;
  $('a[href]').each((_, el) => {
    if (best) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
    const href = $(el).attr('href') || '';
    if (/^(careers?|jobs|join (us|the team|our team)|we('| a)re hiring|open (positions|roles)|work with us|karriere|carri[eè]res?|empleo)$/.test(text) || /\/(careers?|jobs)\/?$/i.test(href)) {
      try {
        best = new URL(href, base).href;
      } catch {
        /* bad href */
      }
    }
  });
  return best;
}

/**
 * Work out where a company's jobs live.
 * 1) the URL itself is an ATS board; 2) the page embeds an ATS; 3) the page links to a careers page that
 * does (one hop); 4) fall back to reading the page as HTML.
 * -> { ats, board, via }
 */
export async function detectBoard(url, http) {
  const direct = detectFromUrl(url);
  if (direct) return { ...direct, via: 'url' };
  let body;
  try {
    body = await http.text(url);
  } catch (err) {
    return { ats: 'html', board: url, via: 'fallback', warning: err.message };
  }
  const embedded = detectFromHtml(body);
  if (embedded) return { ...embedded, via: 'embedded' };
  const alreadyCareers = /\/(careers?|jobs?|join[-\w]*|work-with-us|open-positions|vacancies|karriere|stellen\w*)(\/|$)/i.test(new URL(url).pathname);
  const link = alreadyCareers ? null : careersLink(cheerio.load(body), url);
  const same = (a, b) => a.replace(/[#?].*$/, '').replace(/\/$/, '') === b.replace(/[#?].*$/, '').replace(/\/$/, '');
  if (link && !same(link, url) && new URL(link).pathname !== '/') {
    const linked = detectFromUrl(link);
    if (linked) return { ...linked, via: 'careers-link' };
    try {
      const inner = detectFromHtml(await http.text(link));
      if (inner) return { ...inner, via: 'careers-link' };
      return { ats: 'html', board: link, via: 'careers-link' };
    } catch {
      /* fall through */
    }
  }
  return { ats: 'html', board: url, via: 'html' };
}
