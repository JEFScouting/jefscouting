import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { candidateProfileDefinition, bindCandidateProfile, readCandidateProfile, candidateRoleProposals, profileFieldState, ROLES, PROFILE_ITEM_FIELDS } from '../../automation/intake/candidate-profile.mjs';
import { normalizeSubmission } from '../../netlify/functions/_shared/intake-normalize.mts';
import { source } from './harness.mjs';

const now = '2026-10-16T21:44:55.000Z';
const definition = candidateProfileDefinition();
const field = key => definition.fields.find(f => f.key === key);
// All four-digit QIDs below are synthetic fixtures, never production assignments.
function fixture(locale = 'en') {
  const questions = Object.fromEntries(definition.fields.map((f, index) => [String(1000 + index), { name: f.name, type: f.type, text: f.label[locale], ...(f.options ? { options: f.options.map(o => o.label[locale]).join('|') } : {}) }]));
  const bound = bindCandidateProfile(questions, definition.formId);
  assert.equal(bound.status, 'BOUND_FOR_QA');
  return { questions, manifest: bound.manifest };
}
function envelope(manifest, answers, locale = 'en') {
  const s = source();
  for (const [key, value] of Object.entries(answers)) {
    const f = field(key), label = v => f.options?.find(o => o.key === v)?.label[locale] ?? v;
    s.answers[manifest.fields[key].qid] = { text: f.label[locale], type: f.type, answer: Array.isArray(value) ? value.map(label) : label(value) };
  }
  return normalizeSubmission('candidate', s, now);
}
const parse = (answers, locale = 'en') => {
  const { manifest } = fixture(locale);
  return readCandidateProfile(envelope(manifest, answers, locale), manifest);
};

test('every selected role retains its experience; the second role is not downgraded to interest', () => {
  const p = parse({ roles: ['server', 'bartender', 'front_desk'], 'experience.server': 'supported', 'experience.bartender': 'independent', 'experience.front_desk': 'starting' });
  assert.equal(p.status, 'PARSED');
  assert.deepEqual(p.roles.map(r => [r.roleKey, r.experience]), [['server', 'supported'], ['bartender', 'independent'], ['front_desk', 'starting']]);
  assert.ok(p.roles.every(r => r.authority === 'candidate-declared'));
});

test('all 29 positions can be selected without an arbitrary role limit', () => {
  const answers = { roles: ROLES.map(r => r.key), other_title: 'Hotel shuttle coordinator' };
  for (const r of ROLES) answers[`experience.${r.key}`] = 'starting';
  const p = parse(answers);
  assert.equal(p.roles.length, 29);
  assert.equal(p.status, 'PARSED');
  assert.equal(p.roles.find(r => r.roleKey === 'other').title, 'Hotel shuttle coordinator');
  assert.equal(p.families.length, 0);
});

test('Spanish labels bind and produce the same role-specific semantics', () => {
  const p = parse({ roles: ['bartender', 'barista'], 'experience.bartender': 'independent', 'experience.barista': 'supported', 'detail.bar_coffee': 'yes', 'tasks.bartender': ['cocktails'], 'tasks.barista': ['espresso'], 'context.bar_coffee': ['hotel'], 'recency.barista': '6_to_24_months' }, 'es');
  assert.equal(p.status, 'PARSED');
  assert.deepEqual(p.roles[0].tasks, ['cocktails']);
  assert.deepEqual(p.roles[1].tasks, ['espresso']);
  assert.equal(p.roles[1].recency, '6_to_24_months');
  assert.equal(p.families[0].scope, 'family');
  assert.equal(p.roles[0].contexts, undefined);
});

test('a retained hidden answer for a deselected role cannot become current experience', () => {
  const p = parse({ roles: ['server'], 'experience.server': 'independent', 'experience.bartender': 'lead', 'detail.bar_coffee': 'yes', 'tasks.bartender': ['cocktails'] });
  assert.equal(p.status, 'PARSED');
  assert.deepEqual(p.roles.map(r => r.roleKey), ['server']);
  assert.equal(p.families.length, 0);
});

test('starting in a role suppresses stale tasks even when a sibling role opens the family', () => {
  const p = parse({ roles: ['bartender', 'barista'], 'experience.bartender': 'independent', 'experience.barista': 'starting', 'detail.bar_coffee': 'yes', 'tasks.barista': ['espresso'], 'recency.barista': 'last_6_months' });
  const coffee = p.roles.find(r => r.roleKey === 'barista');
  assert.deepEqual(coffee.tasks, []);
  assert.equal(coffee.recency, null);
});

test('declining optional detail suppresses stale task, recency and family answers', () => {
  const p = parse({ roles: ['bartender'], 'experience.bartender': 'independent', 'detail.bar_coffee': 'later', 'tasks.bartender': ['cocktails'], 'recency.bartender': 'last_6_months', 'context.bar_coffee': ['hotel'] });
  assert.deepEqual(p.roles[0].tasks, []);
  assert.equal(p.roles[0].recency, null);
  assert.deepEqual(p.families, []);
});

test('Front Desk does not infer Night Audit or transfer tasks from another role', () => {
  const { manifest } = fixture();
  const e = envelope(manifest, { roles: ['front_desk'], 'experience.front_desk': 'independent', 'detail.hotel': 'yes' });
  const binding = manifest.fields['tasks.front_desk'];
  e.snapshot.answers[binding.qid] = { type: binding.type, value: ['Night audit and daily closing'] };
  const p = readCandidateProfile(e, manifest);
  assert.equal(p.roles.length, 1);
  assert.deepEqual(p.roles[0].tasks, []);
  assert.ok(p.issues.some(i => i.code === 'UNMAPPED_OPTION' && i.field === 'tasks.front_desk'));
});

test('missing experience holds only that role detail while other roles remain explicit', () => {
  const p = parse({ roles: ['server', 'bartender'], 'experience.bartender': 'lead' });
  assert.equal(p.status, 'PARTIAL_REVIEW');
  assert.equal(p.roles.find(r => r.roleKey === 'server').experience, 'unknown');
  assert.equal(p.roles.find(r => r.roleKey === 'bartender').experience, 'lead');
});

test('unknown roles are not guessed and do not authorize withdrawals from a partial selection', () => {
  const { manifest } = fixture();
  const e = envelope(manifest, { roles: ['server'], 'experience.server': 'supported' });
  e.snapshot.answers[manifest.fields.roles.qid].value.push('Unmapped job title');
  const p = readCandidateProfile(e, manifest);
  assert.equal(p.selectionComplete, false);
  assert.equal(p.roles[0].roleKey, 'server');
  assert.ok(p.issues.some(i => i.field === 'roles'));
});

test('empty selections and Other without a title remain explicit gaps', () => {
  assert.equal(parse({ roles: [] }).selectionComplete, false);
  const p = parse({ roles: ['other'], 'experience.other': 'supported' });
  assert.equal(p.roles[0].title, '');
  assert.equal(p.selectionComplete, false);
  assert.ok(p.issues.some(i => i.code === 'OTHER_TITLE_REQUIRED'));
});

test('new bindings cannot repurpose historical q23, q34 or another legacy element', () => {
  for (const legacy of ['1', '23', '34', '60']) {
    const { questions } = fixture();
    questions[legacy] = questions['1000']; delete questions['1000'];
    const b = bindCandidateProfile(questions, definition.formId);
    assert.equal(b.status, 'HOLD');
    assert.ok(b.issues.some(i => i.code === 'INVALID_OR_REUSED_QID'));
  }
});

test('duplicate names, repeated QIDs, unexpected types and changed choices block binding', () => {
  const { questions } = fixture();
  const cases = [
    q => { q['9999'] = { ...q['1000'] }; },
    q => { q['1000'].type = 'control_textbox'; },
    q => { q['1000'].options += '|Unexpected role'; },
    q => { q['1001'].qid = '1000'; },
  ];
  for (const mutate of cases) {
    const q = structuredClone(questions); mutate(q);
    assert.equal(bindCandidateProfile(q, definition.formId).status, 'HOLD');
  }
});

test('a current legacy export cannot masquerade as a bound new contract', () => {
  const b = bindCandidateProfile({ 23: { name: 'q23_checkbox21', type: 'control_checkbox' }, 34: { name: 'preferredRoles', type: 'control_textbox' } }, definition.formId);
  assert.equal(b.status, 'HOLD');
  assert.equal(b.releaseReady, false);
  assert.throws(() => readCandidateProfile(normalizeSubmission('candidate', source(), now), b.manifest), /UNBOUND_PROFILE_CONTRACT/);
});

test('legacy normalization, scalar target role and evidence identity remain unchanged', () => {
  const s = source();
  const before = normalizeSubmission('candidate', s, now);
  const { manifest } = fixture();
  readCandidateProfile(envelope(manifest, { roles: ['bartender'], 'experience.bartender': 'independent' }), manifest);
  const after = normalizeSubmission('candidate', s, now);
  assert.deepEqual(after, before);
  assert.equal(after.candidate.targetRole, 'Barista');
});

test('client, foreign-form and mismatched source identities cannot enter role normalization', () => {
  const { manifest } = fixture();
  const e = envelope(manifest, { roles: ['server'], 'experience.server': 'supported' });
  for (const invalid of [{ ...e, lane: 'client' }, { ...e, formId: '1' }, { ...e, submissionId: 'wrong' }, { ...e, snapshot: { ...e.snapshot, answers: [] } }]) assert.throws(() => readCandidateProfile(invalid, manifest), /INVALID_PROFILE_SOURCE_CONTEXT/);
});

test('hidden fields are never required after role deselection, including the Other title', () => {
  const values = { roles: ['bartender'], 'experience.bartender': 'independent', 'detail.bar_coffee': 'yes' };
  for (const key of ['experience.server', 'tasks.server', 'other_title']) assert.deepEqual(profileFieldState(field(key), values), { visible: false, required: false });
  assert.deepEqual(profileFieldState(field('experience.bartender'), values), { visible: true, required: true });
  assert.deepEqual(profileFieldState(field('tasks.bartender'), values), { visible: true, required: false });
});

test('Other accepts discussion without invented experience or mandatory task answers', () => {
  const p = parse({ roles: ['other'], other_title: 'Event registration assistant', 'experience.other': 'discuss' });
  assert.equal(p.status, 'PARSED');
  assert.equal(p.roles[0].experience, 'discuss');
  assert.deepEqual(p.roles[0].tasks, []);
});

test('malformed arrays and answer types remain review items, without inventing a level', () => {
  const { manifest } = fixture();
  const e = envelope(manifest, { roles: ['bartender'], 'experience.bartender': 'independent' });
  const exp = manifest.fields['experience.bartender'];
  e.snapshot.answers[exp.qid].value = { independent: true };
  let p = readCandidateProfile(e, manifest);
  assert.equal(p.roles[0].experience, 'unknown');
  assert.ok(p.issues.some(i => i.code === 'INVALID_ANSWER_SHAPE'));
  e.snapshot.answers[exp.qid] = { value: 'I have performed this role independently', type: 'control_textbox' };
  p = readCandidateProfile(e, manifest);
  assert.equal(p.roles[0].experience, 'unknown');
  assert.ok(p.issues.some(i => i.code === 'ANSWER_TYPE_MISMATCH'));
});

test('role reading preserves the full original source and does not perform deletion or replay admission', () => {
  const { manifest } = fixture();
  const e = envelope(manifest, { roles: ['server'], 'experience.server': 'supported', 'experience.bartender': 'independent' });
  const before = structuredClone(e);
  readCandidateProfile(e, manifest);
  assert.deepEqual(e, before);
  assert.ok(e.snapshot.answers[manifest.fields['experience.bartender'].qid]);
});

test('review proposals use existing fields and preserve scope, without verification or Worker effects', () => {
  const p = parse({ roles: ['security', 'bartender'], 'experience.security': 'supported', 'experience.bartender': 'independent' });
  const context = { candidateId: 'rec00000000000001', evidenceId: 'rec00000000000002' };
  const proposals = candidateRoleProposals(p, context);
  assert.equal(proposals.length, 2);
  assert.deepEqual(candidateRoleProposals(p, context), proposals);
  assert.equal(new Set(proposals.map(p => p.reconciliationKey)).size, 2);
  const f = PROFILE_ITEM_FIELDS;
  for (const row of proposals) {
    assert.equal(row.tableId, 'tblmJvQTmHgosWQqt');
    assert.equal(row.fields[f.status].name, 'Proposed — Not Promoted');
    assert.equal(row.fields[f.sourceType].name, 'Candidate-Entered');
    assert.equal(row.fields.fldBOxRPVmTJWfrFY, undefined); // Last Verified
    assert.ok(row.fields[f.details].includes(p.source.version));
  }
  assert.throws(() => candidateRoleProposals(p, { candidateId: 'unresolved', evidenceId: context.evidenceId }), /UNRESOLVED_PROFILE_DESTINATION/);
});

test('offline preparer emits a bilingual definition without pretending it configured Jotform', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jef-profile-'));
  try {
    const output = execFileSync(process.execPath, ['scripts/prepare-candidate-profile.mjs', '--out', directory], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
    const summary = JSON.parse(output);
    assert.equal(summary.mode, 'OFFLINE_PREPARATION');
    assert.equal(summary.binding, 'UNBOUND');
    assert.equal(summary.roles, 29);
    assert.equal(summary.liveMutations, 0);
    const d = JSON.parse(await readFile(join(directory, 'candidate-profile-definition.json'), 'utf8'));
    assert.ok(d.fields.every(f => f.label.en && f.label.es));
    assert.ok(d.fields.length + 54 < 190);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
