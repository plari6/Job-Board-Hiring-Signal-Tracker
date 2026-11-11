import * as cheerio from 'cheerio';
import { htmlToText, toIso } from '../util.js';

/**
 * Applicant tracking system (ATS) adapters. Each one reads the public job feed that the ATS
 * itself publishes for career pages, so no login or scraping of rendered pages is needed.
 *
 * Normalised job: { id, title, url, location, department, remote, postedAt, description, compensation }
 * `description` may be '' when the list endpoint has none; `fetchDetail` (if present) fills it
 * only for the few jobs that matched a watched role.
 */

const seg = (re) => (url) => {
  const m = String(url).match(re);
  return m ? decodeURIComponent(m[1]) : null;
};

export const greenhouse = {
  id: 'greenhouse',
  label: 'Greenhouse',
  match(url) {
    const s = String(url);
    return (
      s.match(/greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?(?:[^#]*&)?for=)([A-Za-z0-9_-]+)/)?.[1] ||
      s.match(/boards-api(?:\.eu)?\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/)?.[1] ||
      s.match(/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?!embed\b)([A-Za-z0-9_-]+)/)?.[1] ||
      null
    );
  },
  publicUrl: (b) => `https://job-boards.greenhouse.io/${b}`,
  async fetchJobs(board, http) {
    const data = await http.json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
    return (data.jobs || []).map((j) => ({
      id: String(j.id),
      title: j.title,
      url: j.absolute_url,
      location: j.location?.name || '',
      department: (j.departments || []).map((d) => d.name).join(', '),
      remote: /remote/i.test(j.location?.name || ''),
      postedAt: toIso(j.first_published || j.updated_at),
      description: htmlToText(j.content),
      compensation: '',
    }));
  },
};

export const lever = {
  id: 'lever',
  label: 'Lever',
  match(url) {
    const m = String(url).match(/(?:jobs|api)(\.eu)?\.lever\.co\/(?:v0\/postings\/)?([A-Za-z0-9_.-]+)/);
    return m ? (m[1] ? `eu:${m[2]}` : m[2]) : null;
  },
  publicUrl: (b) => (b.startsWith('eu:') ? `https://jobs.eu.lever.co/${b.slice(3)}` : `https://jobs.lever.co/${b}`),
  async fetchJobs(board, http) {
    const eu = board.startsWith('eu:');
    const name = eu ? board.slice(3) : board;
    const data = await http.json(`https://api${eu ? '.eu' : ''}.lever.co/v0/postings/${encodeURIComponent(name)}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => ({
      id: String(j.id),
      title: j.text,
      url: j.hostedUrl,
      location: j.categories?.location || (j.categories?.allLocations || []).join(' / '),
      department: [j.categories?.department, j.categories?.team].filter(Boolean).join(' / '),
      remote: j.workplaceType === 'remote' || /remote/i.test(j.categories?.location || ''),
      postedAt: toIso(j.createdAt),
      description: [
        j.descriptionPlain || htmlToText(j.description),
        ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
        j.additionalPlain || '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      compensation: j.salaryRange
        ? `${j.salaryRange.currency || ''} ${j.salaryRange.min ?? ''}-${j.salaryRange.max ?? ''} ${j.salaryRange.interval || ''}`.trim()
        : '',
    }));
  },
};

export const ashby = {
  id: 'ashby',
  label: 'Ashby',
  match: (url) => seg(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/)(url) || seg(/posting-api\/job-board\/([A-Za-z0-9_.%-]+)/)(url),
  publicUrl: (b) => `https://jobs.ashbyhq.com/${b}`,
  async fetchJobs(board, http) {
    const data = await http.json(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`);
    return (data.jobs || [])
      .filter((j) => j.isListed !== false)
      .map((j) => ({
        id: String(j.id),
        title: String(j.title || '').trim(),
        url: j.jobUrl,
        location: [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean).join(' / '),
        department: [j.department, j.team].filter(Boolean).join(' / '),
        remote: Boolean(j.isRemote) || j.workplaceType === 'Remote',
        postedAt: toIso(j.publishedAt),
        description: j.descriptionPlain || htmlToText(j.descriptionHtml),
        compensation: j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary || '',
      }));
  },
};

export const workable = {
  id: 'workable',
  label: 'Workable',
  match(url) {
    const s = String(url);
    return (
      s.match(/apply\.workable\.com\/(?:api\/v\d\/(?:widget\/)?accounts\/)?([A-Za-z0-9_-]+)/)?.[1] ||
      s.match(/\/\/([A-Za-z0-9_-]+)\.workable\.com/)?.[1]?.replace(/^(www|apply)$/, '') ||
      null
    );
  },
  publicUrl: (b) => `https://apply.workable.com/${b}/`,
  async fetchJobs(board, http) {
    const data = await http.json(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(board)}?details=true`);
    return (data.jobs || []).map((j) => ({
      id: String(j.shortcode || j.id || j.url),
      title: j.title,
      url: j.url || j.shortlink || `https://apply.workable.com/${board}/j/${j.shortcode}/`,
      location: [j.city, j.state, j.country].filter(Boolean).join(', '),
      department: j.department || '',
      remote: Boolean(j.telecommuting),
      postedAt: toIso(j.published_on || j.created_at),
      description: htmlToText(j.description),
      compensation: '',
    }));
  },
};

export const smartrecruiters = {
  id: 'smartrecruiters',
  label: 'SmartRecruiters',
  match: (url) =>
    seg(/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/)(url) || seg(/api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]+)/)(url),
  publicUrl: (b) => `https://careers.smartrecruiters.com/${b}`,
  async fetchJobs(board, http) {
    const jobs = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const data = await http.json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board)}/postings?limit=100&offset=${offset}`);
      const page = data.content || [];
      for (const j of page) {
        jobs.push({
          id: String(j.id),
          title: j.name,
          url: `https://jobs.smartrecruiters.com/${board}/${j.id}`,
          location: j.location?.fullLocation || [j.location?.city, j.location?.country].filter(Boolean).join(', '),
          department: j.department?.label || j.function?.label || '',
          remote: Boolean(j.location?.remote),
          postedAt: toIso(j.releasedDate),
          description: '',
          compensation: '',
        });
      }
      if (page.length < 100 || jobs.length >= (data.totalFound || 0)) break;
    }
    return jobs;
  },
  async fetchDetail(job, board, http) {
    const d = await http.json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board)}/postings/${encodeURIComponent(job.id)}`);
    const s = d.jobAd?.sections || {};
    return {
      description: ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription']
        .map((k) => htmlToText(s[k]?.text))
        .filter(Boolean)
        .join('\n\n'),
    };
  },
};

export const recruitee = {
  id: 'recruitee',
  label: 'Recruitee',
  match: seg(/\/\/([A-Za-z0-9_-]+)\.recruitee\.com/),
  publicUrl: (b) => `https://${b}.recruitee.com/`,
  async fetchJobs(board, http) {
    const data = await http.json(`https://${encodeURIComponent(board)}.recruitee.com/api/offers/`);
    return (data.offers || [])
      .filter((j) => !j.status || j.status === 'published')
      .map((j) => ({
        id: String(j.id),
        title: j.title,
        url: j.careers_url,
        location: j.location || [j.city, j.country].filter(Boolean).join(', '),
        department: j.department || '',
        remote: Boolean(j.remote),
        postedAt: toIso(j.published_at || j.created_at),
        description: [htmlToText(j.description), htmlToText(j.requirements)].filter(Boolean).join('\n\n'),
        compensation: j.salary?.min ? `${j.salary.currency || ''} ${j.salary.min}-${j.salary.max || ''} ${j.salary.period || ''}`.trim() : '',
      }));
  },
};

export const personio = {
  id: 'personio',
  label: 'Personio',
  match(url) {
    const m = String(url).match(/\/\/([A-Za-z0-9_-]+)\.jobs\.personio\.(de|com)/);
    return m ? (m[2] === 'com' ? `${m[1]}.com` : m[1]) : null;
  },
  publicUrl: (b) => (b.endsWith('.com') ? `https://${b.slice(0, -4)}.jobs.personio.com/` : `https://${b}.jobs.personio.de/`),
  async fetchJobs(board, http) {
    const base = personio.publicUrl(board).replace(/\/$/, '');
    const xml = await http.text(`${base}/xml?language=en`);
    const $ = cheerio.load(xml, { xml: true });
    return $('position')
      .toArray()
      .map((el) => {
        const p = $(el);
        const id = p.children('id').text().trim();
        return {
          id,
          title: p.children('name').text().trim(),
          url: `${base}/job/${id}`,
          location: p.children('office').text().trim(),
          department: p.children('department').text().trim(),
          remote: /remote/i.test(p.children('office').text()),
          postedAt: toIso(p.children('createdAt').text().trim()),
          description: p
            .find('jobDescription')
            .toArray()
            .map((d) => `${$(d).children('name').text().trim()}\n${htmlToText($(d).children('value').text())}`)
            .join('\n\n'),
          compensation: '',
        };
      });
  },
};

export const ATS_ADAPTERS = [greenhouse, lever, ashby, workable, smartrecruiters, recruitee, personio];
