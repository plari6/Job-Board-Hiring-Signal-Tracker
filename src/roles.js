/**
 * Job title -> watched executive role.
 *
 * `score` is how strong a buying signal the role is for a software seller (0-100).
 * Order matters: the first matching role wins, so specific roles sit above generic ones.
 * Exclusions run first: titles that mention the CTO without being the CTO
 * ("Executive Assistant to the CTO", "Field CTO" presales jobs, "Office of the CTO" engineers).
 */

export const ROLES = [
  {
    id: 'deputy_cto',
    label: 'Deputy CTO',
    group: 'tech_exec',
    score: 72,
    patterns: [/\b(deputy|associate|assistant|vice) (cto|chief tech(nology|nical) officer)\b/],
  },
  {
    id: 'cto',
    label: 'CTO',
    group: 'cto',
    score: 88,
    patterns: [
      /\bcto\b/,
      /\bchief tech(nology|nical)( and [a-z]+)? officer\b/,
      /\bchief (product|digital|information|innovation) and tech(nology)? officer\b/,
      /\bcpto\b/,
      /\b(directeur|directrice) (technique|de la technologie|des technologies)\b/,
      /\btechnische[rn]? (geschaftsfuhrer(in)?|direktor(in)?|vorstand)\b/,
      /\b(director|directora) (de )?tecnolog[ií]a\b/,
      /\bhead of technology\b(?! (partnerships|sales|recruit))/,
    ],
  },
  {
    id: 'vp_engineering',
    label: 'VP of Engineering',
    group: 'tech_exec',
    score: 75,
    patterns: [
      /\b(svp|evp|vp|vice president|senior vice president|executive vice president)\b.{0,25}\b(engineering|technology|software|r and d|platform|infrastructure|product development|technical)\b/,
      /\b(engineering|technology) (svp|evp|vp)\b/,
    ],
  },
  {
    id: 'cio',
    label: 'CIO',
    group: 'tech_exec',
    score: 78,
    patterns: [/\bcio\b/, /\bchief information officer\b/],
  },
  {
    id: 'ciso',
    label: 'CISO',
    group: 'tech_exec',
    score: 72,
    patterns: [/\bciso\b/, /\bchief (information |cyber ?)?security officer\b/],
  },
  {
    id: 'chief_data',
    label: 'Chief Data / AI Officer',
    group: 'tech_exec',
    score: 68,
    patterns: [/\bchief (data|data and analytics|analytics|ai|artificial intelligence|data and ai) officer\b/, /\b(cdao|caio)\b/],
  },
  {
    id: 'chief_digital',
    label: 'Chief Digital Officer',
    group: 'tech_exec',
    score: 66,
    patterns: [/\bchief digital( transformation)? officer\b/],
  },
  {
    id: 'head_engineering',
    label: 'Head of Engineering',
    group: 'tech_exec',
    score: 65,
    patterns: [
      /\b(global |group )?head of (software )?(engineering|r and d|software development|platform engineering|development)\b/,
      /\bengineering (head|lead(er)? \(head\))\b/,
    ],
  },
  {
    id: 'director_engineering',
    label: 'Director of Engineering',
    group: 'tech_lead',
    score: 48,
    patterns: [/\b(senior )?director,? (of )?(software )?engineering\b/, /\bengineering director\b/],
  },
  {
    id: 'head_it',
    label: 'Head of IT',
    group: 'tech_lead',
    score: 50,
    patterns: [/\b(head|director) of (it|information technology|it infrastructure|it operations)\b/, /\bit director\b/],
  },
  {
    id: 'head_security',
    label: 'Head of Security',
    group: 'tech_lead',
    score: 50,
    patterns: [/\b(head|director) of (information |cyber ?|it )?security\b/],
  },
  {
    id: 'head_data',
    label: 'Head of Data / AI',
    group: 'tech_lead',
    score: 46,
    patterns: [/\b(head|director|vp) of (data|data science|analytics|ai|machine learning|data and ai)\b/],
  },
];

export const DEFAULT_WATCH = ['cto', 'deputy_cto', 'vp_engineering', 'cio', 'ciso', 'chief_data', 'chief_digital', 'head_engineering'];

const EXCLUDE = [
  [/\bfield (cto|chief technology officer)\b/, 'Field CTO is a presales role, not a buyer'],
  [/\boffice of the (cto|cio|ciso|chief [a-z ]+officer)\b/, 'works in the CTO office, not the CTO'],
  [/\b(assistant|ea|pa|chief of staff|advisor|adviser|coordinator|recruiter|analyst|manager|partner|engineer|architect|consultant|specialist) (to|for|of|supporting) (the )?(cto|cio|ciso|chief [a-z ]+officer)\b/, 'supports the executive'],
  [/\b(executive|personal) assistant\b/, 'assistant role'],
  [/\b(cto|cio|ciso) (office|org|organi[sz]ation|team|staff)\b/, 'team under the executive'],
  [/\breports? to (the )?(cto|cio|ciso)\b/, 'reports to the executive'],
  [/\b(intern|internship|working student|werkstudent|apprentice|graduate)\b/, 'junior role'],
  [/\b(sales|solutions?|customer|pre-?sales|partner|support) (engineering|engineer)\b/, 'customer-facing engineering'],
  [/\b(recruit(er|ing)|talent acquisition|sourcer)\b/, 'recruiting role'],
];

export function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\((m|w|f|d|x|h)\s*\/\s*(m|w|f|d|x|h)(\s*\/\s*(m|w|f|d|x|h))?\)/g, ' ')
    .replace(/\s*&\s*|\s*\+\s*/g, ' and ')
    .replace(/\br&d\b/g, 'r and d')
    .replace(/\bc\.t\.o\.?/g, 'cto')
    .replace(/\bv\.?p\.?\b/g, 'vp')
    .replace(/[|/,–—:()[\]]/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * -> null (not an executive tech role) or
 *    { id, label, group, score, interim, excluded?: reason }
 */
export function classifyTitle(title) {
  const t = normalizeTitle(title);
  if (!t) return null;
  for (const [re, reason] of EXCLUDE) {
    if (re.test(t)) {
      // Still report what it would have been, so `classify` can explain the decision.
      const role = ROLES.find((r) => r.patterns.some((p) => p.test(t)));
      return role ? { id: role.id, label: role.label, group: role.group, score: 0, interim: false, excluded: reason } : null;
    }
  }
  for (const role of ROLES) {
    if (role.patterns.some((p) => p.test(t))) {
      const interim = /\b(interim|fractional|part[ -]?time|acting|temporary|contract|freelance|consultant)\b/.test(t);
      const founding = /\b(co ?founder|founding|first)\b/.test(t);
      return { id: role.id, label: role.label, group: role.group, score: role.score, interim, founding };
    }
  }
  return null;
}

/** Roles to alert on: target override > env WATCH_ROLES > default. Accepts array or "a,b;c". */
export function parseWatch(spec) {
  if (!spec || (Array.isArray(spec) && !spec.length)) return null;
  const list = (Array.isArray(spec) ? spec : String(spec).split(/[,;\s]+/)).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.includes('all')) return ROLES.map((r) => r.id);
  const unknown = list.filter((id) => !ROLES.some((r) => r.id === id));
  if (unknown.length) throw new Error(`Unknown role(s): ${unknown.join(', ')}. Known: ${ROLES.map((r) => r.id).join(', ')}, all`);
  return list;
}

const ENG_TITLE = /\b(engineer(ing)?|developer|devops|sre|site reliability|architect|programmer|data scientist|machine learning|ml|ai researcher|qa|test automation|tech(nical)? lead|full ?stack|back ?end|front ?end|mobile|ios|android|cloud|platform|security analyst|infrastructure)\b/;
const NOT_ENG = /\b(sales|solutions?|customer|support|field|pre-?sales|recruit|marketing|account) (engineer|architect)/;

/** True for individual engineering jobs (used for the hiring-surge signal). */
export function isEngineeringJob(job) {
  const t = normalizeTitle(job.title);
  if (NOT_ENG.test(t)) return false;
  return ENG_TITLE.test(t) || /\b(engineering|r ?and ?d|technology|tech)\b/i.test(job.department || '');
}
