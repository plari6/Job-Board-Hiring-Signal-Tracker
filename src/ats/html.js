import * as cheerio from 'cheerio';
import { htmlToText, toIso, hash } from '../util.js';

/**
 * Generic careers page reader (Cheerio) for companies without a supported ATS feed.
 * Order: 1) schema.org JobPosting JSON-LD, 2) CSS selectors from the target config,
 * 3) heuristic: links that look like job postings.
 */

const JOB_HREF = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|opportunit(y|ies)|roles?|stellen(angebote)?|offres?|o)\/[^/?#]+/i;
const NAV_TEXT =
  /^(jobs?|careers?|all (jobs|positions|openings)|open (positions|roles)|view (all )?(jobs|openings|positions)|see (all )?(jobs|openings)|apply( now)?|learn more|read more|home|about( us)?|contact( us)?|blog|press|privacy|terms|cookies?|login|sign ?in|life at .*|our (team|culture|values)|benefits|students?|internships?|search jobs|join (us|our team)|next|previous|back|more)$/i;

function flattenLd(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) node.forEach((n) => flattenLd(n, out));
  else if (typeof node === 'object') {
    const t = node['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) out.push(node);
    if (node['@graph']) flattenLd(node['@graph'], out);
    if (node.itemListElement) flattenLd(node.itemListElement.map?.((x) => x.item || x) || node.itemListElement, out);
  }
  return out;
}

function ldLocation(loc) {
  const list = Array.isArray(loc) ? loc : loc ? [loc] : [];
  return list
    .map((l) => {
      const a = l.address || l;
      return typeof a === 'string' ? a : [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join(' / ');
}

export function jobsFromJsonLd($, pageUrl) {
  const postings = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      flattenLd(JSON.parse($(el).contents().text()), postings);
    } catch {
      /* invalid JSON-LD block: ignore */
    }
  });
  return postings
    .filter((p) => p.title)
    .map((p) => {
      const url = p.url ? new URL(p.url, pageUrl).href : pageUrl;
      const id = String(p.identifier?.value || p.identifier || url + '#' + p.title);
      return {
        id: typeof id === 'string' && id.length < 120 ? id : hash(id),
        title: htmlToText(p.title),
        url,
        location: ldLocation(p.jobLocation),
        department: p.occupationalCategory || p.industry || '',
        remote: p.jobLocationType === 'TELECOMMUTE',
        postedAt: toIso(p.datePosted),
        description: htmlToText(p.description),
        compensation: p.baseSalary?.value
          ? `${p.baseSalary.currency || ''} ${p.baseSalary.value.minValue ?? p.baseSalary.value.value ?? ''}-${p.baseSalary.value.maxValue ?? ''}`.trim()
          : '',
      };
    });
}

export function jobsFromSelectors($, pageUrl, sel) {
  return $(sel.item)
    .toArray()
    .map((el) => {
      const node = $(el);
      const titleNode = sel.title ? node.find(sel.title).first() : node;
      const linkNode = sel.link ? node.find(sel.link).first() : node.is('a') ? node : node.find('a').first();
      const title = titleNode.text().replace(/\s+/g, ' ').trim();
      const href = linkNode.attr('href');
      const url = href ? new URL(href, pageUrl).href : pageUrl;
      return {
        id: href ? new URL(href, pageUrl).pathname + new URL(href, pageUrl).search : hash(title),
        title,
        url,
        location: sel.location ? node.find(sel.location).first().text().replace(/\s+/g, ' ').trim() : '',
        department: sel.department ? node.find(sel.department).first().text().replace(/\s+/g, ' ').trim() : '',
        remote: false,
        postedAt: null,
        description: '',
        compensation: '',
      };
    })
    .filter((j) => j.title);
}

export function jobsFromLinks($, pageUrl) {
  const page = new URL(pageUrl);
  const seen = new Map();
  $('a[href]').each((_, el) => {
    const a = $(el);
    let url;
    try {
      url = new URL(a.attr('href'), pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || url.href.split('#')[0] === page.href.split('#')[0]) return;
    if (!JOB_HREF.test(url.pathname) || /\/(search|apply|login|category|categories|departments?|locations?|teams?)\/?$/i.test(url.pathname)) return;
    // Prefer a heading inside the link (cards: title + location + "Apply").
    const heading = a.find('h1,h2,h3,h4,h5,[class*="title" i]').first().text();
    const title = (heading || a.text()).replace(/\s+/g, ' ').trim();
    if (title.length < 3 || title.length > 140 || NAV_TEXT.test(title)) return;
    const key = url.origin + url.pathname;
    if (!seen.has(key)) {
      const loc = a.find('[class*="location" i]').first().text().replace(/\s+/g, ' ').trim();
      seen.set(key, { id: url.pathname, title, url: url.href, location: loc, department: '', remote: /remote/i.test(loc), postedAt: null, description: '', compensation: '' });
    }
  });
  return [...seen.values()];
}

export const html = {
  id: 'html',
  label: 'Careers page (HTML)',
  match: () => null,
  publicUrl: (b) => b,
  /** `board` is the careers page URL; `target.selectors` = { item, title, link, location, department } (optional). */
  async fetchJobs(board, http, target = {}) {
    if (!(await http.robotsAllowed(board))) throw new Error(`robots.txt disallows ${board}; ask the company for its ATS link or a feed`);
    const body = await http.text(board);
    const $ = cheerio.load(body);
    const ld = jobsFromJsonLd($, board);
    if (ld.length) return ld;
    if (target.selectors?.item) return jobsFromSelectors($, board, target.selectors);
    return jobsFromLinks($, board);
  },
  async fetchDetail(job, board, http) {
    if (!job.url || job.url === board || !(await http.robotsAllowed(job.url))) return {};
    const $ = cheerio.load(await http.text(job.url));
    const ld = jobsFromJsonLd($, job.url)[0];
    if (ld?.description) return { description: ld.description, postedAt: ld.postedAt || job.postedAt, location: job.location || ld.location };
    const main = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
    main.find('nav, header, footer, script, style, form').remove();
    return { description: htmlToText(main.html()).slice(0, 12000) };
  },
};
