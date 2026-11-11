import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTitle, isEngineeringJob, parseWatch, normalizeTitle } from '../src/roles.js';

const role = (t) => {
  const c = classifyTitle(t);
  return c && !c.excluded ? c.id : null;
};

test('CTO titles in many spellings and languages', () => {
  for (const t of [
    'Chief Technology Officer',
    'CTO',
    'C.T.O.',
    'Chief Technical Officer',
    'Co-Founder & CTO',
    'Founding CTO',
    'VP Engineering & CTO',
    'Chief Product & Technology Officer',
    'Chief Technology and Product Officer',
    'CPTO',
    'CTO (m/w/d)',
    'Directeur Technique',
    'Technischer Geschäftsführer (m/w/d)',
    'Director de Tecnología',
    'Head of Technology',
    'Fractional CTO',
  ]) {
    assert.equal(role(t), 'cto', t);
  }
});

test('titles that mention the CTO but are not the CTO are ignored', () => {
  for (const t of [
    'Executive Assistant to the CTO',
    'Field CTO, EMEA',
    'Software Engineer, Office of the CTO',
    'Chief of Staff to the CTO',
    'Technical Advisor to the CTO',
    'CTO Office Program Manager',
    'Sales Engineer',
    'VP of Sales Engineering',
    'CTO Intern',
    'Head of Technology Partnerships',
  ]) {
    assert.equal(role(t), null, t);
  }
  assert.match(classifyTitle('Executive Assistant to the CTO').excluded, /assist|support/);
});

test('other technology executives', () => {
  assert.equal(role('Deputy CTO'), 'deputy_cto');
  assert.equal(role('VP of Engineering'), 'vp_engineering');
  assert.equal(role('SVP, Technology'), 'vp_engineering');
  assert.equal(role('Vice President, Software Engineering'), 'vp_engineering');
  assert.equal(role('Chief Information Officer'), 'cio');
  assert.equal(role('CIO (m/w/d)'), 'cio');
  assert.equal(role('Chief Information Security Officer (CISO)'), 'ciso');
  assert.equal(role('Chief Data & AI Officer'), 'chief_data');
  assert.equal(role('Chief Digital Officer'), 'chief_digital');
  assert.equal(role('Head of Engineering'), 'head_engineering');
  assert.equal(role('Director of Engineering'), 'director_engineering');
  assert.equal(role('Head of IT'), 'head_it');
});

test('non-executive and non-tech titles are not matched', () => {
  for (const t of ['Senior Backend Engineer', 'Chief Executive Officer', 'Chief Compliance Officer', 'Head of Product', 'Director, Product Design', 'Account Executive', 'Doctor', 'Victor Sales Lead', 'Principal Engineer']) {
    assert.equal(role(t), null, t);
  }
});

test('interim and founding flags', () => {
  assert.equal(classifyTitle('Interim CTO').interim, true);
  assert.equal(classifyTitle('Fractional CTO (6 months)').interim, true);
  assert.equal(classifyTitle('Chief Technology Officer').interim, false);
  assert.equal(classifyTitle('Co-Founder & CTO').founding, true);
});

test('normalizeTitle and parseWatch', () => {
  assert.equal(normalizeTitle('  VP, R&D (m/w/d) '), 'vp r and d');
  assert.deepEqual(parseWatch('cto, ciso'), ['cto', 'ciso']);
  assert.equal(parseWatch(''), null);
  assert.ok(parseWatch('all').length > 8);
  assert.throws(() => parseWatch('cto,ceo'), /Unknown role/);
});

test('engineering job detection for the surge signal', () => {
  assert.equal(isEngineeringJob({ title: 'Senior Backend Engineer' }), true);
  assert.equal(isEngineeringJob({ title: 'DevOps Engineer' }), true);
  assert.equal(isEngineeringJob({ title: 'Analyst', department: 'Engineering' }), true);
  assert.equal(isEngineeringJob({ title: 'Sales Engineer' }), false);
  assert.equal(isEngineeringJob({ title: 'Account Executive', department: 'Sales' }), false);
});
