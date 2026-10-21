import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { candidateProfileDefinition, bindCandidateProfile, PROFILE_ITEM_FIELDS as f } from '../../automation/intake/candidate-profile.mjs';
import { prepareCandidateProfileEnvelope, reconcileCandidateProfile, ROLE_MARKER } from '../../automation/intake/candidate-profile-executor.mjs';
import { buildCandidateProfileNativePatch } from '../../scripts/prepare-candidate-profile-native.mjs';
import { normalizeSubmission } from '../../netlify/functions/_shared/intake-normalize.mts';
import { FakeBase, FakeStore, source } from './harness.mjs';
import { pathToFileURL } from 'node:url';

const definition = candidateProfileDefinition();
// Synthetic provider bindings and a proposed version for local QA only.
const questions = Object.fromEntries(definition.fields.map((field, i) => [String(1000 + i), { name: field.name, type: field.type, ...(field.options ? { options: field.options.map(o => o.label.en).join('|') } : {}) }]));
const binding = bindCandidateProfile(questions, definition.formId);
const release = { formVersion: '2.0', roleItemType: 'Secondary Role', manifest: binding.manifest, bindingHash: binding.bindingHash };
const hash = value => createHash('sha256').update(value).digest('hex');
const baseline = await readFile(process.env.JEF_PROFILE_TEST_NATIVE_SOURCE || new URL('../../automation/intake/generated/candidate.js', import.meta.url), 'utf8');
const native = await buildCandidateProfileNativePatch(baseline, hash(baseline), release);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const nativeRun = new AsyncFunction('input', 'base', 'fetch', 'output', native.script);
function envelope(answers, day = 21, sid = '9000000000000000001') {
  const s = source('candidate', sid, { 50: '2.0' });
  for (const [key, value] of Object.entries(answers)) {
    const field = definition.fields.find(f => f.key === key);
    const label = v => field.options?.find(o => o.key === v)?.label.en ?? v;
    s.answers[release.manifest.fields[key].qid] = { type: field.type, text: field.label.en, answer: Array.isArray(value) ? value.map(label) : label(value) };
  }
  return normalizeSubmission('candidate', s, `2026-10-${day}T14:00:00.000Z`);
}
const basic = { roles: ['server', 'bartender'], 'experience.server': 'supported', 'experience.bartender': 'independent' };
const data = row => JSON.parse(row[f.details].slice(ROLE_MARKER.length));
const roleRow = (base, key) => [...base.profileRows.values()].find(row => data(row).roleKey === key);
class ProfileBase extends FakeBase {
  profileRows = new Map();
  profileWrites = 0;
  loseCreateAck = false;
  loseReadback = false;
  concurrentChange = false;
  seedRole(fields) { const id = 'rec' + String(++this.sequence).padStart(14, '0'); this.profileRows.set(id, structuredClone(fields)); return id; }
  getTable(tableId) {
    if (tableId !== f.tableId) return super.getTable(tableId);
    const record = id => this.profileRows.has(id) ? { id, getCellValue: key => structuredClone(this.profileRows.get(id)[key] ?? null) } : null;
    return {
      selectRecordsAsync: async () => ({ records: [...this.profileRows.keys()].map(record) }),
      selectRecordAsync: async id => { if (this.loseReadback) { this.loseReadback = false; return null; } if (this.concurrentChange) { this.concurrentChange = false; this.profileRows.get(id)[f.level] = 'Concurrent Owner change'; } return record(id); },
      createRecordAsync: async values => { const id = this.seedRole(values); this.profileWrites++; if (this.loseCreateAck) { this.loseCreateAck = false; throw new Error('Lost create acknowledgement'); } return id; },
      updateRecordAsync: async (id, values) => { Object.assign(this.profileRows.get(id), structuredClone(values)); this.profileWrites++; },
    };
  }
}
async function run(base, e) {
  const calls = [], out = {};
  const fetch = async (_url, request) => {
    const body = JSON.parse(request.body); calls.push(body);
    return Response.json(body.action === 'claim' ? { skip: false, consumerToken: 'LOCAL-ONLY', envelope: e } : { completed: true });
  };
  try { await nativeRun({ config: () => ({ receiptId: 'local-only', token: 'local-only' }) }, base, fetch, { set: (key, value) => { out[key] = value; } }); }
  catch (error) { return { calls, out, error }; }
  return { calls, out };
}

test('legacy applications pass unchanged and create no new role records', async () => {
  const e = normalizeSubmission('candidate', source(), '2026-10-21T14:00:00.000Z');
  const prepared = prepareCandidateProfileEnvelope(e, release);
  assert.equal(prepared.mode, 'LEGACY'); assert.strictEqual(prepared.envelope, e);
  const base = new ProfileBase(); const result = await run(base, e);
  assert.equal(result.out.status, 'done'); assert.equal(base.profileRows.size, 0);
  assert.equal([...base.data.candidates.values()][0]['Target Role'], 'Barista');
});

test('new roles replace retained scalar preference only with an explicitly bound release', () => {
  const e = envelope(basic), before = structuredClone(e);
  const result = prepareCandidateProfileEnvelope(e, release);
  assert.equal(result.mode, 'PROFILE'); assert.equal(result.envelope.candidate.targetRole, 'Server; Bartender');
  assert.equal(result.envelope.issues.includes('FORM_VERSION_CHANGED'), false);
  assert.deepEqual(result.envelope.snapshot, e.snapshot); assert.deepEqual(e, before);
  for (const invalid of [null, { ...release, bindingHash: '0'.repeat(64) }, { ...release, roleItemType: 'Best-Fit Role' }, { ...release, formVersion: '1.0' }]) assert.equal(prepareCandidateProfileEnvelope(e, invalid).mode, 'HOLD');
});

test('new answers with an old or unexpected version hold before Candidate writes', async () => {
  for (const version of ['1.0', '9.0', '']) {
    const e = envelope(basic); e.snapshot.answers['50'].value = version;
    const base = new ProfileBase(); const result = await run(base, e);
    assert.equal(result.out.status, 'exception'); assert.equal(base.data.candidates.size, 0); assert.equal(base.profileRows.size, 0);
    assert.equal(base.data.evidence.size, 1);
  }
});

test('form code and environment problems remain fatal after profile admission', async () => {
  for (const issue of ['FORM_CODE_CHANGED', 'UNEXPECTED_ENVIRONMENT']) {
    const e = envelope(basic); e.issues.push(issue);
    const base = new ProfileBase(); await run(base, e);
    assert.equal(base.data.candidates.size, 0); assert.equal(base.profileRows.size, 0);
  }
});

test('Representation and other source branches pass through without profile configuration', () => {
  const e = { lane: 'candidate', formId: '261558428456063', kind: 'representation' };
  assert.strictEqual(prepareCandidateProfileEnvelope(e, null).envelope, e);
});

test('paired native execution creates one Candidate, exact source Evidence and a declaration per role', async () => {
  const base = new ProfileBase(), result = await run(base, envelope(basic));
  assert.equal(result.error, undefined); assert.equal(result.out.status, 'done');
  assert.deepEqual(result.calls.map(c => c.action), ['claim', 'complete']);
  assert.equal(base.data.candidates.size, 1); assert.equal(base.data.evidence.size, 1); assert.equal(base.profileRows.size, 2);
  for (const row of base.profileRows.values()) {
    assert.equal(row[f.status].name, 'Proposed — Not Promoted'); assert.equal(row[f.sourceType].name, 'Candidate-Entered');
    assert.equal(row.fldBOxRPVmTJWfrFY, undefined); assert.equal(row[f.candidate].length, 1); assert.equal(row[f.evidence].length, 1);
  }
});

test('a consecutive replay is a no-op for role rows even if invoked after transport state loss', async () => {
  const base = new ProfileBase(), e = envelope(basic);
  await run(base, e); const writes = base.profileWrites;
  const result = await run(base, e);
  assert.equal(result.out.status, 'done'); assert.equal(base.profileRows.size, 2); assert.equal(base.profileWrites, writes);
  assert.equal(base.data.candidates.size, 1); assert.equal(base.data.evidence.size, 1);
});

test('a later declaration updates the same role row and preserves both sources', async () => {
  const base = new ProfileBase(); await run(base, envelope(basic));
  const server = roleRow(base, 'server');
  const result = await run(base, envelope({ ...basic, 'experience.server': 'lead' }, 22));
  assert.equal(result.out.status, 'done'); assert.strictEqual(roleRow(base, 'server'), server);
  assert.equal(server[f.level], 'lead'); assert.equal(server[f.evidence].length, 2);
  assert.equal(data(server).previousDeclaration.experience, 'supported');
  assert.equal(base.data.candidates.size, 1); assert.equal(base.data.evidence.size, 2);
});

test('withdrawing a role changes preference without deleting its past work or promoting status', async () => {
  const base = new ProfileBase(); await run(base, envelope(basic));
  await run(base, envelope({ roles: ['server'], 'experience.server': 'supported' }, 22));
  const bartender = roleRow(base, 'bartender');
  assert.equal(data(bartender).requested, false); assert.equal(bartender[f.level], 'independent');
  assert.equal(bartender[f.status].name, 'Proposed — Not Promoted'); assert.equal(bartender[f.evidence].length, 2);
  assert.equal(base.profileRows.size, 2);
});

test('partial or unmapped selections never withdraw other preferences', async () => {
  const base = new ProfileBase(); await run(base, envelope(basic));
  const next = envelope({ roles: ['server'], 'experience.server': 'supported' }, 22);
  next.snapshot.answers[release.manifest.fields.roles.qid].value.push('Unmapped position');
  const result = await run(base, next);
  assert.equal(result.out.status, 'exception'); assert.equal(data(roleRow(base, 'bartender')).requested, true);
});

test('closing optional detail retains the earlier declaration and its original Evidence', async () => {
  const base = new ProfileBase();
  await run(base, envelope({ ...basic, 'detail.bar_coffee': 'yes', 'tasks.bartender': ['cocktails'], 'context.bar_coffee': ['hotel'] }));
  const firstSource = roleRow(base, 'bartender')[f.evidence][0].id;
  await run(base, envelope({ ...basic, 'detail.bar_coffee': 'later', 'tasks.bartender': ['cocktails'] }, 22));
  const row = roleRow(base, 'bartender');
  assert.deepEqual(data(row).tasks, []); assert.deepEqual(data(row).previousDeclaration.tasks, ['cocktails']);
  assert.ok(base.data.evidence.get(firstSource).Notes.includes('Cocktail preparation'));
});

test('a reviewed or independently improved role is protected without creating a replacement duplicate', async () => {
  for (const improve of [row => { row[f.status] = { name: 'Current — Reconciled' }; }, row => { row[f.level] = 'Owner-assessed'; }, row => { row.fldBOxRPVmTJWfrFY = '2026-10-21T15:00:00Z'; }, row => { row.fldnJKhXQDs8VWFqW = 'Owner note'; }]) {
    const base = new ProfileBase(); await run(base, envelope(basic));
    const row = roleRow(base, 'server'); improve(row); const before = structuredClone(row);
    const result = await run(base, envelope({ ...basic, 'experience.server': 'lead' }, 22));
    assert.equal(result.out.status, 'exception'); assert.deepEqual(row, before); assert.equal(base.profileRows.size, 2);
  }
});

test('an existing manually entered role prevents automatic duplication', async () => {
  const base = new ProfileBase(); await run(base, normalizeSubmission('candidate', source(), '2026-10-20T14:00:00Z'));
  const candidateId = [...base.data.candidates.keys()][0];
  base.seedRole({ [f.name]: 'Existing role', [f.candidate]: [{ id: candidateId }], [f.itemType]: { name: 'Secondary Role' }, [f.value]: 'Server', [f.level]: 'Experienced', [f.status]: { name: 'Current — Reconciled' } });
  const result = await run(base, envelope(basic));
  assert.equal(result.out.status, 'exception'); assert.equal(base.profileRows.size, 2);
  assert.equal([...base.profileRows.values()].filter(r => r[f.value] === 'Server').length, 1);
});

test('duplicate role declarations hold that role without manufacturing another copy', async () => {
  const base = new ProfileBase(); await run(base, envelope(basic));
  base.seedRole(roleRow(base, 'server'));
  const result = await run(base, envelope({ ...basic, 'experience.server': 'lead' }, 22));
  assert.equal(result.out.status, 'exception'); assert.equal(base.profileRows.size, 3);
  assert.ok([...base.profileRows.values()].filter(r => r[f.value] === 'Server').every(r => r[f.level] === 'supported'));
});

test('a lost acknowledgement after role creation recovers without another role record', async () => {
  const base = new ProfileBase(); base.loseCreateAck = true;
  let result = await run(base, envelope(basic));
  assert.ok(result.error); assert.equal(result.calls.at(-1).status, 'failed'); assert.equal(base.profileRows.size, 1);
  result = await run(base, envelope(basic));
  assert.equal(result.out.status, 'done'); assert.equal(base.profileRows.size, 2); assert.equal(base.data.candidates.size, 1);
});

test('failed role readback cannot acknowledge DONE, and the same source can recover', async () => {
  const base = new ProfileBase(); base.loseReadback = true;
  let result = await run(base, envelope(basic));
  assert.ok(result.error); assert.equal(result.calls.at(-1).status, 'failed');
  result = await run(base, envelope(basic));
  assert.equal(result.out.status, 'done'); assert.equal(base.profileRows.size, 2);
});

test('ambiguous person identity holds before any role projection', async () => {
  const base = new ProfileBase();
  base.seed('candidates', { Candidate: '[JEF INTAKE QA] Alex Rivera', Email: 'qa.alex@example.invalid' });
  base.seed('candidates', { Candidate: '[JEF INTAKE QA] Other', Phone: '202-555-0101' });
  const result = await run(base, envelope(basic));
  assert.equal(result.out.status, 'exception'); assert.equal(base.profileRows.size, 0); assert.equal(base.data.candidates.size, 2);
});

test('bare Candidate IDs and unrelated source Evidence cannot authorize role writes', async () => {
  const base = new ProfileBase(); const e = envelope(basic); await run(base, e);
  const wrong = base.seed('candidates', { Candidate: 'Unrelated person' });
  const profile = prepareCandidateProfileEnvelope(e, release).profile;
  const before = base.profileWrites;
  await assert.rejects(() => reconcileCandidateProfile(profile, base, { candidateId: wrong, evidenceId: [...base.data.evidence.keys()][0] }), /UNRESOLVED_PROFILE_SOURCE_RELATIONSHIP/);
  assert.equal(base.profileWrites, before);
});

test('an Owner edit between read and write stops projection and is preserved', async () => {
  const base = new ProfileBase(); await run(base, envelope(basic));
  base.concurrentChange = true;
  const result = await run(base, envelope({ ...basic, 'experience.server': 'lead' }, 22));
  assert.ok(result.error); assert.equal(result.calls.at(-1).status, 'failed');
  assert.equal(roleRow(base, 'server')[f.level], 'Concurrent Owner change');
});

test('changing an Other title cannot transplant experience to a different profession', async () => {
  const base = new ProfileBase();
  await run(base, envelope({ roles: ['other'], other_title: 'Shuttle driver', 'experience.other': 'independent' }));
  const result = await run(base, envelope({ roles: ['other'], other_title: 'Event registration assistant', 'experience.other': 'supported' }, 22));
  assert.equal(result.out.status, 'exception'); assert.equal(base.profileRows.size, 1);
  assert.equal(roleRow(base, 'other')[f.value], 'Shuttle driver');
});

test('withdrawing a protected role requires review instead of silently clearing it', async () => {
  const base = new ProfileBase(); await run(base, envelope(basic));
  roleRow(base, 'bartender')[f.status] = { name: 'Current — Reconciled' };
  const result = await run(base, envelope({ roles: ['server'], 'experience.server': 'supported' }, 22));
  assert.equal(result.out.status, 'exception'); assert.equal(data(roleRow(base, 'bartender')).requested, true);
});

test('a stale delivery or a different submission stream cannot overwrite current role declarations', async () => {
  const base = new ProfileBase(); await run(base, envelope(basic, 22));
  await run(base, envelope({ ...basic, 'experience.server': 'lead' }, 21));
  assert.equal(roleRow(base, 'server')[f.level], 'supported');
  await run(base, envelope({ ...basic, 'experience.server': 'lead' }, 23, '9000000000000000002'));
  assert.equal(roleRow(base, 'server')[f.level], 'supported'); assert.equal(base.data.candidates.size, 1);
});

test('native patch preserves source around two explicit anchors and refuses hash/shape drift', async () => {
  assert.equal(native.report.releaseReady, false); assert.equal(native.report.liveMutations, 0); assert.equal(native.report.replacedAnchors, 2);
  assert.ok(native.script.endsWith(baseline.slice(baseline.indexOf('// Inputs:'))));
  await assert.rejects(() => buildCandidateProfileNativePatch(baseline + '\n', hash(baseline), release), /NATIVE_SOURCE_HASH_MISMATCH/);
  const drift = baseline.replace('  const e = envelope;', '  const e = envelope /* new version */;');
  await assert.rejects(() => buildCandidateProfileNativePatch(drift, hash(drift), release), /NATIVE_PATCH_ANCHOR_CHANGED/);
  await assert.rejects(() => buildCandidateProfileNativePatch(native.script, hash(native.script), release), /NATIVE_ALREADY_PATCHED/);
  await assert.rejects(() => buildCandidateProfileNativePatch(baseline, hash(baseline), { ...release, bindingHash: '0'.repeat(64) }), /UNBOUND_NATIVE_PROFILE_RELEASE/);
});

// Opt-in verification against the existing, separately reviewed PR38/39 files.
// Dependencies are supplied locally; this suite never fetches or merges them.
if (process.env.JEF_PROFILE_TEST_TRANSPORT) test('paired transport preserves A→B→A occurrences, exact replay and account-local timestamps', async () => {
  const { handleIntake } = await import(pathToFileURL(process.env.JEF_PROFILE_TEST_TRANSPORT));
  const store = new FakeStore(), base = new ProfileBase(), sent = [], logs = [];
  let clock = Date.UTC(2026, 9, 21, 14), provider;
  const config = { JOTFORM_API_KEY: 'LOCAL-QA-ONLY', JOTFORM_ADMIN_SECRET: 'LOCAL-QA-ONLY', AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL: 'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/local-qa', JEF_CANDIDATE_INTAKE_V2_ENABLED: 'true' };
  const deps = { store, env: key => config[key], log: v => logs.push(v), now: () => new Date(clock += 1000).toISOString(), fetch: async (url, request) => {
    if (String(url).startsWith('https://api.jotform.com/submission/')) return Response.json({ responseCode: 200, content: provider });
    sent.push(JSON.parse(request.body)); return Response.json({ success: true });
  } };
  const deliver = async answers => {
    const e = envelope(answers);
    provider = { id: e.submissionId, form_id: e.formId, status: 'ACTIVE', created_at: e.snapshot.createdAt, updated_at: '', answers: Object.fromEntries(Object.entries(e.snapshot.answers).map(([qid, q]) => [qid, { text: q.question, type: q.type, answer: q.value }])) };
    const body = new FormData(); body.set('submissionID', provider.id); body.set('formID', provider.form_id);
    return handleIntake(new Request('https://jefscouting.com/api/candidate-jotform-webhook', { method: 'POST', body }), 'candidate', deps);
  };
  const claims = [];
  const nativeFetch = async (url, request) => {
    const result = await handleIntake(new Request(url, request), 'candidate', deps);
    if (JSON.parse(request.body).action === 'claim') claims.push((await result.clone().json()).envelope);
    return result;
  };
  for (const answers of [basic, { ...basic, 'experience.server': 'lead' }, basic]) {
    assert.equal((await deliver(answers)).status, 202);
    const out = {};
    await nativeRun({ config: () => sent.at(-1) }, base, nativeFetch, { set: (k, v) => { out[k] = v; } });
    assert.equal(out.status, 'done');
  }
  assert.equal(base.data.candidates.size, 1); assert.equal(base.data.evidence.size, 3); assert.equal(base.profileRows.size, 2);
  assert.equal(roleRow(base, 'server')[f.level], 'supported');
  assert.notEqual(claims[0].version, claims[2].version);
  assert.equal(claims[0].sourceTimestamp, '2026-09-27T04:30:00.000Z');
  const dispatched = sent.length;
  const replay = await deliver(basic); assert.equal(replay.status, 200); assert.equal((await replay.json()).replay, true);
  assert.equal(sent.length, dispatched); assert.equal(base.data.evidence.size, 3);
  for (const value of ['Alex', 'example.invalid', 'LOCAL-QA-ONLY']) assert.ok(!JSON.stringify(logs).includes(value));
});
