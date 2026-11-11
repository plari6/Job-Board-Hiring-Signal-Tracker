/**
 * Facts a sales rep can use, pulled from a job description with plain rules (no AI needed):
 * what the new executive is hired to do (mandates), the tech stack, team size, who they report to,
 * and whether this is the company's first CTO or a replacement.
 */

export const MANDATES = [
  { id: 'cloud_migration', label: 'Cloud migration', re: /\b(migrat\w*[^.\n]{0,50}\b(to|into|onto) (the )?(cloud|aws|azure|gcp|google cloud)|cloud migration|move (us )?to the cloud|cloud[- ]first|lift[- ]and[- ]shift)\b/i },
  { id: 'legacy_modernization', label: 'Modernize legacy systems', re: /\b(legacy|monolith|moderni[sz]\w*|re-?platform\w*|re-?architect\w*|tech(nical)? debt|rebuild (the|our) (platform|stack))\b/i },
  { id: 'ai_data', label: 'AI / data platform', re: /\b(artificial intelligence|machine learning|\bml\b|generative ai|gen ?ai|llms?|data platform|data strategy|analytics platform|data warehouse|ai strategy|ai[- ]first)\b/i },
  { id: 'security_compliance', label: 'Security & compliance', re: /\b(soc ?2|iso ?27001|hipaa|gdpr|pci[- ]?dss|fedramp|nis ?2|dora\b|cyber ?security|information security|zero trust|compliance)\b/i },
  { id: 'scale_team', label: 'Scale the engineering team', re: /\b(scale|grow|build|hire|recruit)\w* (out )?(the |our |a |an )?(world[- ]class |high[- ]performing |engineering |tech(nology)? |product )*(team|organi[sz]ation|org|function)\b/i },
  { id: 'platform_scale', label: 'Scale the platform / reliability', re: /\b(scalab\w*|reliability|uptime|high availability|performance at scale|millions of (users|requests|transactions)|site reliability)\b/i },
  { id: 'devops', label: 'DevOps / developer productivity', re: /\b(devops|ci\/cd|continuous (integration|delivery|deployment)|developer (experience|productivity)|platform engineering|infrastructure as code|observability)\b/i },
  { id: 'cost', label: 'Cost optimization', re: /\b(cost (optimi[sz]\w*|reduction|efficien\w*)|reduc\w* (?:our |the )?(?:\w+ ){0,2}(costs?|spend(ing)?)|finops|vendor consolidation|budget ownership|own(ing)? the (tech(nology)? )?budget)\b/i },
  { id: 'digital_transformation', label: 'Digital transformation', re: /\b(digital transformation|digiti[sz]\w*|transformation (program|agenda|roadmap))\b/i },
  { id: 'm_and_a', label: 'M&A / integration', re: /\b(acquisitions?|post[- ]merger|m&a|integrat\w* (acquired|new) (companies|businesses))\b/i },
  { id: 'product_build', label: 'Build product from zero', re: /\b(0 ?(to|->|→) ?1|zero to one|from scratch|greenfield|mvp|build (the|our) (first|v1))\b/i },
  { id: 'vendor_selection', label: 'Owns vendor & tool decisions', re: /\b(vendor (selection|management|relationships)|build (vs\.?|versus|or) buy|tool(ing)? (selection|decisions)|technology (selection|choices|decisions)|select(ing)? (the |our |new )?(vendors|tools|technolog\w*|partners))\b/i },
];

const STACK = [
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Kubernetes', 'Docker', 'Terraform', 'Snowflake', 'Databricks', 'BigQuery', 'Redshift',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kafka', 'Elasticsearch', 'Python', 'Java', 'Kotlin', 'Golang', 'Rust', 'Scala',
  'C#', '.NET', 'Node.js', 'TypeScript', 'JavaScript', 'React', 'Angular', 'Vue', 'Ruby on Rails', 'PHP', 'Swift',
  'Salesforce', 'SAP', 'ServiceNow', 'Workday', 'Oracle', 'Microsoft 365', 'Jira', 'GitHub', 'GitLab', 'Datadog', 'Okta',
  'OpenAI', 'LLM', 'TensorFlow', 'PyTorch', 'Spark', 'Airflow', 'dbt', 'Shopify', 'Stripe', 'HubSpot',
];
const STACK_RE = STACK.map((name) => [name, new RegExp(`(^|[^A-Za-z0-9])${name.replace(/[.+#]/g, (c) => `\\${c}`)}(?![A-Za-z0-9])`)]);

export function extractInsights(text, { title = '', compensation = '' } = {}) {
  const d = String(text || '');
  const lower = d.toLowerCase();
  const mandates = MANDATES.filter((m) => m.re.test(d)).map((m) => m.label);

  const stack = [];
  for (const [name, re] of STACK_RE) if (re.test(d) && !stack.includes(name === 'Golang' ? 'Go' : name)) stack.push(name === 'Golang' ? 'Go' : name);

  const team =
    lower.match(/\b(?:team|organi[sz]ation|org|department) of (?:about |around |over |approximately |~)?(\d{1,4})\+?\s*(?:engineers|developers|people|ftes?|technologists|staff)?/) ||
    lower.match(/\b(\d{1,4})\+?\s*(?:-person |person )?(?:engineers|developers|technologists|engineering (?:team|staff))\b/) ||
    lower.match(/\blead(?:ing)? (?:a team of )?(\d{1,4})\+?\b/);
  const teamSize = team ? Number(team[1]) : null;

  const rep = lower.match(/\breport(?:s|ing)? (?:directly )?(?:in)?to (?:the |our )?(ceo|chief executive officer|founders?|co-?founders?|board|coo|president|cfo|cio|cto|managing director|group cto|vp of engineering|head of engineering)\b/);

  const firstHire = /\b(first|founding) (cto|technical (leader|hire)|technology leader|engineering leader|tech(nical)? co-?founder)\b|\bco-?founder\b/i.test(`${title}\n${d}`);
  const replacement = /\b(succeed|successor|replac(e|ing) (our|the) (current|outgoing)|outgoing cto|following the departure|transition from)\b/i.test(d);
  const salary = compensation || (d.match(/(?:[$€£]\s?\d{2,3}(?:[.,]\d{3})+|\d{2,3}k)\s?(?:-|–|to)\s?(?:[$€£]\s?)?\d{2,3}(?:(?:[.,]\d{3})+|k)/i)?.[0] ?? '');
  const equity = /\b(equity|stock options|esop|vsop|rsus?)\b/i.test(d);

  return {
    mandates,
    stack: stack.slice(0, 12),
    teamSize: teamSize && teamSize < 5000 ? teamSize : null,
    reportsTo: rep ? (rep[1] === 'chief executive officer' ? 'CEO' : /^(ceo|coo|cfo|cto|cio)$/.test(rep[1]) ? rep[1].toUpperCase() : rep[1].replace(/\b\w/g, (c) => c.toUpperCase())) : null,
    firstHire,
    replacement,
    compensation: salary || '',
    equity,
  };
}
