/**
 * Offline demo world: 8 fictional companies on 8 different job-board types, over 3 scan days.
 * `createDemoFetch(getDay)` returns a fetch() that answers the real ATS API URLs with this data,
 * so the demo and tests exercise the exact same code path as live scans.
 *
 * Story:
 *  Day 1  baseline. Meridian already has a VP Engineering search open; Northwind has a CTO search
 *         open since 40 days; Kestrel has a CIO search; Quantia has 4 engineering jobs.
 *  Day 2  Brightpath posts a CTO role (HIPAA, cloud migration). Northwind's CTO posting is gone (1st miss).
 *         Helio posts a fractional CTO. Atlas (Greenhouse embed on its own site) posts "Co-Founder & CTO".
 *  Day 3  Northwind's CTO posting still gone -> closed, new CTO likely hired. Quantia engineering jumps to 14.
 *         Corvid (SmartRecruiters) posts a CISO.
 */

export const DEMO_TARGETS = [
  { company: 'Northwind Logistics', careersUrl: 'https://job-boards.greenhouse.io/northwindlogistics', domain: 'northwind.example', owner: 'Sara (AE)', ownerEmail: 'sara@yourco.example', tier: 'A' },
  { company: 'Brightpath Health', careersUrl: 'https://jobs.lever.co/brightpath', domain: 'brightpath.example', owner: 'Omar (AE)', tier: 'A' },
  { company: 'Quantia Labs', careersUrl: 'https://jobs.ashbyhq.com/quantia', domain: 'quantia.example', owner: 'Sara (AE)', tier: 'B' },
  { company: 'Meridian Retail Group', careersUrl: 'https://careers.meridian.example/jobs', domain: 'meridian.example', owner: 'Lina (AE)', tier: 'B' },
  { company: 'Helio Fintech', careersUrl: 'https://apply.workable.com/heliofintech/', domain: 'helio.example', owner: 'Omar (AE)', tier: 'C' },
  { company: 'Atlas Robotics', careersUrl: 'https://atlas.example/careers', domain: 'atlas.example', owner: 'Lina (AE)', tier: 'A' },
  { company: 'Corvid Security', careersUrl: 'https://careers.smartrecruiters.com/CorvidSecurity', domain: 'corvid.example', owner: 'Sara (AE)', tier: 'B' },
  { company: 'Kestrel Energy', careersUrl: 'https://kestrel.jobs.personio.de/', domain: 'kestrel.example', owner: 'Omar (AE)', tier: 'B' },
];

const DAY = 86400000;
export const DEMO_DAY0 = Date.parse('2026-10-01T08:00:00Z');
export const demoNow = (day) => DEMO_DAY0 + (day - 1) * 7 * DAY; // weekly scans
const iso = (day, minusDays = 0) => new Date(demoNow(day) - minusDays * DAY).toISOString();

const ENG = ['Senior Backend Engineer', 'Frontend Engineer (React)', 'DevOps Engineer', 'Data Engineer', 'Site Reliability Engineer', 'Mobile Engineer (iOS)', 'Machine Learning Engineer', 'Staff Software Engineer', 'QA Automation Engineer', 'Platform Engineer', 'Full Stack Developer', 'Security Engineer', 'Android Engineer', 'Engineering Manager, Payments'];
const BIZ = ['Account Executive', 'Customer Success Manager', 'Marketing Manager', 'Office Manager', 'Financial Controller', 'Sales Engineer'];

const CTO_NORTHWIND = `<p>Northwind Logistics moves 2 million parcels a week across Europe. We are looking for our next <b>Chief Technology Officer</b> to succeed our outgoing CTO.</p>
<h3>What you will do</h3><ul><li>Lead an engineering organization of 60 engineers across 7 teams</li><li>Own the migration of our routing platform to the cloud (AWS) and retire the legacy on-prem monolith</li><li>Own the technology budget, vendor selection and build vs buy decisions</li><li>Raise reliability of our tracking platform to 99.95% uptime</li></ul>
<p>You will report directly to the CEO. Stack: Java, Kotlin, PostgreSQL, Kafka, Kubernetes, Terraform.</p>`;

const CTO_BRIGHTPATH = `Brightpath Health runs virtual clinics for 400,000 patients.
As our Chief Technology Officer you will report to the CEO and lead a team of 35 engineers.
Your first year: complete our migration to the cloud (AWS), achieve SOC 2 Type II and keep us HIPAA compliant, and launch our AI triage assistant using LLMs.
You will scale the engineering team to 60 people and select the vendors and tools we standardise on.
Our stack: TypeScript, Node.js, React, Python, PostgreSQL, Snowflake.
Compensation: $260,000 - $310,000 + equity.`;

function greenhouse(day) {
  const jobs = ENG.slice(0, 8).map((t, i) => ({ id: 1000 + i, title: t, absolute_url: `https://job-boards.greenhouse.io/northwindlogistics/jobs/${1000 + i}`, location: { name: 'Hamburg, Germany' }, first_published: iso(1, 30), content: '&lt;p&gt;Join our engineering team.&lt;/p&gt;', departments: [{ name: 'Engineering' }] }));
  jobs.push(...BIZ.slice(0, 4).map((t, i) => ({ id: 2000 + i, title: t, absolute_url: `https://job-boards.greenhouse.io/northwindlogistics/jobs/${2000 + i}`, location: { name: 'Hamburg, Germany' }, first_published: iso(1, 20), content: '', departments: [{ name: 'Business' }] })));
  if (day === 1) jobs.push({ id: 999, title: 'Chief Technology Officer (CTO)', absolute_url: 'https://job-boards.greenhouse.io/northwindlogistics/jobs/999', location: { name: 'Hamburg, Germany' }, first_published: iso(1, 40), content: CTO_NORTHWIND.replace(/</g, '&lt;').replace(/>/g, '&gt;'), departments: [{ name: 'Executive' }] });
  jobs.push({ id: 3000, title: 'Executive Assistant to the CTO', absolute_url: 'https://job-boards.greenhouse.io/northwindlogistics/jobs/3000', location: { name: 'Hamburg' }, first_published: iso(1, 5), content: '' });
  return { jobs, meta: { total: jobs.length } };
}

function lever(day) {
  const list = ENG.slice(0, 5).map((t, i) => ({ id: `bp-eng-${i}`, text: t, hostedUrl: `https://jobs.lever.co/brightpath/bp-eng-${i}`, categories: { location: 'Boston, MA', team: 'Engineering' }, createdAt: demoNow(1) - 10 * DAY, descriptionPlain: 'Build care software.', lists: [], workplaceType: 'hybrid' }));
  if (day >= 2) list.push({ id: 'bp-cto', text: 'Chief Technology Officer', hostedUrl: 'https://jobs.lever.co/brightpath/bp-cto', categories: { location: 'Boston, MA or Remote (US)', team: 'Leadership', commitment: 'Full-time' }, createdAt: demoNow(2) - 2 * DAY, descriptionPlain: CTO_BRIGHTPATH, lists: [], workplaceType: 'hybrid' });
  return list;
}

function ashby(day) {
  const n = day === 3 ? 14 : day === 2 ? 5 : 4;
  const jobs = ENG.slice(0, n).map((t, i) => ({ id: `q-${i}`, title: t, department: 'Engineering', location: 'London, UK', isRemote: false, isListed: true, publishedAt: iso(day, 3), jobUrl: `https://jobs.ashbyhq.com/quantia/q-${i}`, descriptionPlain: 'Engineering at Quantia.' }));
  jobs.push({ id: 'q-fieldcto', title: 'Field CTO, EMEA', department: 'Sales', location: 'London, UK', isListed: true, publishedAt: iso(1, 10), jobUrl: 'https://jobs.ashbyhq.com/quantia/q-fieldcto', descriptionPlain: 'Presales leader.' });
  jobs.push({ id: 'q-ae', title: 'Account Executive', department: 'Sales', location: 'London, UK', isListed: true, publishedAt: iso(1, 10), jobUrl: 'https://jobs.ashbyhq.com/quantia/q-ae', descriptionPlain: '' });
  return { jobs };
}

function meridianHtml() {
  const posting = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'VP of Engineering, Digital Commerce',
    identifier: { '@type': 'PropertyValue', value: 'MRG-2231' },
    url: 'https://careers.meridian.example/jobs/vp-engineering-digital',
    datePosted: iso(1, 12),
    description: '<p>Lead our digital transformation: replatform our e-commerce stack from a legacy monolith to microservices on Azure. You will report to the CIO and lead 45 engineers. Experience with Salesforce Commerce, React and .NET.</p>',
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Manchester', addressCountry: 'GB' } },
  };
  const other = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Store Manager', url: 'https://careers.meridian.example/jobs/store-manager-leeds', datePosted: iso(1, 3), description: 'Run our Leeds store.' };
  return `<!doctype html><html><head><title>Careers at Meridian</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [posting, other] })}</script></head>
<body><h1>Join Meridian</h1><a href="/jobs/vp-engineering-digital">VP of Engineering, Digital Commerce</a><a href="/jobs/store-manager-leeds">Store Manager</a></body></html>`;
}

function workable(day) {
  const jobs = [{ shortcode: 'HF001', title: 'Backend Engineer (Go)', url: 'https://apply.workable.com/heliofintech/j/HF001/', city: 'Lisbon', country: 'Portugal', department: 'Engineering', published_on: iso(1, 4), description: '<p>Payments backend.</p>' }];
  if (day >= 2) jobs.push({ shortcode: 'HF002', title: 'Fractional CTO (Interim, 6 months)', url: 'https://apply.workable.com/heliofintech/j/HF002/', city: 'Lisbon', country: 'Portugal', department: 'Leadership', published_on: iso(2, 1), description: '<p>We need an interim CTO for 6 months to prepare our PCI DSS audit, reduce cloud costs and help us hire our first permanent CTO. Reports to the founders.</p>' });
  return { name: 'Helio Fintech', jobs };
}

function atlasPage() {
  return `<!doctype html><html><head><title>Atlas Robotics careers</title></head><body>
<h1>Build robots with us</h1><div id="grnhse_app"></div>
<script src="https://boards.greenhouse.io/embed/job_board/js?for=atlasrobotics"></script></body></html>`;
}

function atlasBoard(day) {
  const jobs = [
    { id: 501, title: 'Head of Engineering', absolute_url: 'https://atlas.example/careers?gh_jid=501', location: { name: 'Austin, TX' }, first_published: iso(1, 8), content: '&lt;p&gt;Build and grow our robotics software team from 8 to 30 engineers. Python, ROS, AWS.&lt;/p&gt;' },
    { id: 502, title: 'Robotics Software Engineer', absolute_url: 'https://atlas.example/careers?gh_jid=502', location: { name: 'Austin, TX' }, first_published: iso(1, 8), content: '' },
  ];
  if (day >= 2) jobs.push({ id: 503, title: 'Co-Founder & CTO', absolute_url: 'https://atlas.example/careers?gh_jid=503', location: { name: 'Austin, TX' }, first_published: iso(2, 2), content: '&lt;p&gt;Be our first CTO: choose the stack from scratch (greenfield), build the MVP of our fleet software and hire the first 10 engineers. Report to the CEO.&lt;/p&gt;' });
  return { jobs };
}

function smartrecruitersList(day) {
  const content = [{ id: '7001', name: 'Security Analyst (SOC)', releasedDate: iso(1, 5), location: { fullLocation: 'Dublin, Ireland' }, department: { label: 'Security' } }];
  if (day >= 3) content.push({ id: '7002', name: 'Chief Information Security Officer (CISO)', releasedDate: iso(3, 1), location: { fullLocation: 'Dublin, Ireland', remote: false }, department: { label: 'Executive' } });
  return { offset: 0, limit: 100, totalFound: content.length, content };
}

const smartrecruitersDetail = {
  id: '7002',
  name: 'Chief Information Security Officer (CISO)',
  jobAd: { sections: { jobDescription: { text: '<p>Own our zero trust roadmap, ISO 27001 and NIS2 compliance. Lead a security team of 12 and report to the CEO. Microsoft 365, Azure, Okta.</p>' } } },
};

function personioXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position><id>8801</id><office>Munich</office><department>IT</department><name>Chief Information Officer (m/w/d)</name><createdAt>${iso(1, 25)}</createdAt>
<jobDescriptions><jobDescription><name>Your role</name><value><![CDATA[<p>Drive our digital transformation and SAP S/4HANA migration, consolidate vendors and reduce IT costs. Report to the CEO.</p>]]></value></jobDescription></jobDescriptions></position>
<position><id>8802</id><office>Munich</office><department>IT</department><name>Head of IT (m/w/d)</name><createdAt>${iso(1, 10)}</createdAt><jobDescriptions></jobDescriptions></position>
<position><id>8803</id><office>Munich</office><department>Operations</department><name>Werkstudent Operations</name><createdAt>${iso(1, 3)}</createdAt><jobDescriptions></jobDescriptions></position>
</workzag-jobs>`;
}

function response(body, { status = 200, type = 'application/json' } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
}

/** fetch() replacement serving the demo world. `getDay()` returns 1, 2 or 3. `calls` collects every URL. */
export function createDemoFetch(getDay, { calls = [], extra } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body });
    const day = getDay();
    if (extra) {
      const r = await extra(u, init, day);
      if (r) return r;
    }
    if (u.endsWith('/robots.txt')) return response('User-agent: *\nDisallow: /admin\n', { type: 'text/plain' });
    if (u.startsWith('https://boards-api.greenhouse.io/v1/boards/northwindlogistics/jobs')) return response(greenhouse(day));
    if (u.startsWith('https://boards-api.greenhouse.io/v1/boards/atlasrobotics/jobs')) return response(atlasBoard(day));
    if (u.startsWith('https://api.lever.co/v0/postings/brightpath')) return response(lever(day));
    if (u.startsWith('https://api.ashbyhq.com/posting-api/job-board/quantia')) return response(ashby(day));
    if (u === 'https://careers.meridian.example/jobs') return response(meridianHtml(), { type: 'text/html' });
    if (u.startsWith('https://apply.workable.com/api/v1/widget/accounts/heliofintech')) return response(workable(day));
    if (u === 'https://atlas.example/careers') return response(atlasPage(), { type: 'text/html' });
    if (u.startsWith('https://api.smartrecruiters.com/v1/companies/CorvidSecurity/postings/7002')) return response(smartrecruitersDetail);
    if (u.startsWith('https://api.smartrecruiters.com/v1/companies/CorvidSecurity/postings')) return response(smartrecruitersList(day));
    if (u.startsWith('https://kestrel.jobs.personio.de/xml')) return response(personioXml(), { type: 'application/xml' });
    return response({ error: 'not found' }, { status: 404 });
  };
}
