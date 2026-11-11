import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, detectFromUrl, detectFromHtml, detectBoard } from '../src/ats/index.js';
import { jobsFromLinks, jobsFromSelectors } from '../src/ats/html.js';
import * as cheerio from 'cheerio';
import { createDemoFetch } from '../examples/demo-data.js';
import { testHttp, jsonResponse } from './helpers.js';

const http = (day = 2) => testHttp(createDemoFetch(() => day));

test('detectFromUrl recognises every ATS URL shape', () => {
  const cases = [
    ['https://boards.greenhouse.io/airbnb', 'greenhouse', 'airbnb'],
    ['https://job-boards.greenhouse.io/airbnb/jobs/123', 'greenhouse', 'airbnb'],
    ['https://job-boards.eu.greenhouse.io/acme', 'greenhouse', 'acme'],
    ['https://boards.greenhouse.io/embed/job_board?for=acme&b=x', 'greenhouse', 'acme'],
    ['https://boards.greenhouse.io/embed/job_board/js?for=acme', 'greenhouse', 'acme'],
    ['https://boards-api.greenhouse.io/v1/boards/acme/jobs', 'greenhouse', 'acme'],
    ['https://jobs.lever.co/palantir', 'lever', 'palantir'],
    ['https://jobs.eu.lever.co/acme/123', 'lever', 'eu:acme'],
    ['https://jobs.ashbyhq.com/ramp', 'ashby', 'ramp'],
    ['https://apply.workable.com/heliofintech/', 'workable', 'heliofintech'],
    ['https://acme.workable.com', 'workable', 'acme'],
    ['https://careers.smartrecruiters.com/Visa', 'smartrecruiters', 'Visa'],
    ['https://jobs.smartrecruiters.com/Visa/123', 'smartrecruiters', 'Visa'],
    ['https://bunq.recruitee.com/o/role', 'recruitee', 'bunq'],
    ['https://acme.jobs.personio.de/', 'personio', 'acme'],
    ['https://acme.jobs.personio.com/', 'personio', 'acme.com'],
  ];
  for (const [url, ats, board] of cases) assert.deepEqual(detectFromUrl(url), { ats, board }, url);
  assert.equal(detectFromUrl('https://www.example.com/careers'), null);
});

test('detectFromHtml finds embedded boards', () => {
  assert.deepEqual(detectFromHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=atlas"></script>'), { ats: 'greenhouse', board: 'atlas' });
  assert.deepEqual(detectFromHtml('<script>Grnhse.Settings.boardToken = "tok";</script>'), { ats: 'greenhouse', board: 'tok' });
  assert.deepEqual(detectFromHtml('<iframe src="https://jobs.ashbyhq.com/notion/embed"></iframe>'), { ats: 'ashby', board: 'notion' });
  assert.deepEqual(detectFromHtml('<a href="https://jobs.lever.co/acme">Open roles</a>'), { ats: 'lever', board: 'acme' });
  assert.deepEqual(detectFromHtml('<script>var u = "https://apply.workable.com/acme/";</script>'), { ats: 'workable', board: 'acme' });
  assert.equal(detectFromHtml('<p>nothing</p>'), null);
});

test('detectBoard: embed, careers link hop, html fallback, unreachable page', async () => {
  const fetchImpl = createDemoFetch(() => 1, {
    extra: (u) => {
      if (u === 'https://home.example/') return new Response('<a href="/careers">Careers</a>', { headers: { 'content-type': 'text/html' } });
      if (u === 'https://home.example/careers') return new Response('<a href="https://jobs.lever.co/homeco">Jobs</a>', { headers: { 'content-type': 'text/html' } });
      if (u === 'https://plain.example/jobs') return new Response('<a href="/jobs/123-engineer">Engineer</a>', { headers: { 'content-type': 'text/html' } });
      if (u === 'https://down.example/careers') return new Response('err', { status: 500 });
      return null;
    },
  });
  const h = testHttp(fetchImpl);
  assert.deepEqual(await detectBoard('https://atlas.example/careers', h), { ats: 'greenhouse', board: 'atlasrobotics', via: 'embedded' });
  assert.deepEqual(await detectBoard('https://home.example/', h), { ats: 'lever', board: 'homeco', via: 'careers-link' });
  assert.deepEqual(await detectBoard('https://plain.example/jobs', h), { ats: 'html', board: 'https://plain.example/jobs', via: 'html' });
  const down = await detectBoard('https://down.example/careers', h);
  assert.equal(down.ats, 'html');
  assert.match(down.warning, /500/);
});

test('every ATS adapter normalises its feed', async () => {
  const h = http(3);
  const gh = await ADAPTERS.greenhouse.fetchJobs('atlasrobotics', h);
  const cto = gh.find((j) => j.title === 'Co-Founder & CTO');
  assert.equal(cto.id, '503');
  assert.match(cto.description, /first CTO/);
  assert.ok(cto.postedAt.startsWith('2026-'));

  const lv = await ADAPTERS.lever.fetchJobs('brightpath', h);
  assert.equal(lv.find((j) => j.id === 'bp-cto').location, 'Boston, MA or Remote (US)');

  const ab = await ADAPTERS.ashby.fetchJobs('quantia', h);
  assert.equal(ab.length, 16);
  assert.equal(ab[0].department, 'Engineering');

  const wk = await ADAPTERS.workable.fetchJobs('heliofintech', h);
  assert.equal(wk[1].id, 'HF002');
  assert.equal(wk[1].location, 'Lisbon, Portugal');

  const sr = await ADAPTERS.smartrecruiters.fetchJobs('CorvidSecurity', h);
  const ciso = sr.find((j) => j.id === '7002');
  assert.equal(ciso.description, '');
  const detail = await ADAPTERS.smartrecruiters.fetchDetail(ciso, 'CorvidSecurity', h);
  assert.match(detail.description, /zero trust/);

  const pe = await ADAPTERS.personio.fetchJobs('kestrel', h);
  assert.equal(pe[0].title, 'Chief Information Officer (m/w/d)');
  assert.equal(pe[0].url, 'https://kestrel.jobs.personio.de/job/8801');
  assert.match(pe[0].description, /SAP S\/4HANA/);

  const html = await ADAPTERS.html.fetchJobs('https://careers.meridian.example/jobs', h);
  assert.equal(html.length, 2);
  assert.equal(html[0].id, 'MRG-2231');
  assert.equal(html[0].location, 'Manchester, GB');
});

test('recruitee and lever EU endpoints', async () => {
  const seen = [];
  const h = testHttp(async (u) => {
    seen.push(String(u));
    if (String(u).includes('recruitee')) return jsonResponse({ offers: [{ id: 1, title: 'CTO', careers_url: 'https://x.recruitee.com/o/cto', status: 'published', published_at: '2026-11-10 07:31:31 UTC', description: '<p>Lead</p>' }, { id: 2, title: 'Old', status: 'closed' }] });
    return jsonResponse([]);
  });
  const rc = await ADAPTERS.recruitee.fetchJobs('x', h);
  assert.equal(rc.length, 1);
  assert.equal(rc[0].postedAt, '2026-11-10T07:31:31.000Z');
  await ADAPTERS.lever.fetchJobs('eu:acme', h);
  assert.ok(seen.includes('https://api.eu.lever.co/v0/postings/acme?mode=json'));
});

test('HTML fallbacks: CSS selectors and job-like links', () => {
  const $ = cheerio.load(`<nav><a href="/careers">Careers</a><a href="/jobs/">All jobs</a></nav>
    <div class="job"><h3>Chief Technology Officer</h3><span class="loc">Berlin</span><a href="/jobs/cto-berlin">Apply</a></div>
    <a href="/jobs/12-backend-engineer"><h4>Backend Engineer</h4><span class="location">Remote</span></a>
    <a href="/jobs/12-backend-engineer">Backend Engineer</a>
    <a href="/about">About</a>`);
  const sel = jobsFromSelectors($, 'https://co.example/careers', { item: '.job', title: 'h3', link: 'a', location: '.loc' });
  assert.deepEqual(sel.map((j) => [j.title, j.url, j.location]), [['Chief Technology Officer', 'https://co.example/jobs/cto-berlin', 'Berlin']]);
  const links = jobsFromLinks($, 'https://co.example/careers');
  assert.deepEqual(links.map((j) => j.title), ['Backend Engineer']);
  assert.equal(links[0].remote, true);
});

test('robots.txt disallow blocks the HTML reader', async () => {
  const h = testHttp(async (u) => (String(u).endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /careers') : new Response('<a href="/careers/1">x</a>')));
  await assert.rejects(ADAPTERS.html.fetchJobs('https://blocked.example/careers', h), /robots\.txt disallows/);
});

test('HTTP errors: bot wall HTML instead of JSON, retry on 503, no retry on 404', async () => {
  let n = 0;
  const h = testHttp(async (u) => {
    n++;
    if (String(u).includes('flaky')) return n < 2 ? new Response('busy', { status: 503 }) : jsonResponse({ jobs: [] });
    if (String(u).includes('html')) return new Response('<html>Access denied</html>');
    return new Response('nope', { status: 404 });
  });
  await assert.rejects(h.json('https://x.example/html'), /HTML \(blocked or wrong board name\?\)/);
  n = 0;
  assert.deepEqual(await h.json('https://x.example/flaky'), { jobs: [] });
  n = 0;
  await assert.rejects(h.json('https://x.example/missing'), (e) => e.status === 404 && n === 1);
});
