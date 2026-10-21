// Called only inside the existing claimed Candidate executor, after identity
// and reciprocal Evidence readback. No trigger, queue, person creation or sends.
import { CANDIDATE_FORM_ID, ROLES, PROFILE_ITEM_FIELDS, candidateProfileBindingHash, readCandidateProfile, candidateRoleProposals } from './candidate-profile.mjs';
import { schema } from './schema.mjs';

export const ROLE_MARKER = 'JEF_CANDIDATE_ROLE_PROPOSAL_V1\n';
const SOURCE_MARKER = 'JEF_INTAKE_SOURCE_V2\n';
const f = PROFILE_ITEM_FIELDS;
const extra = { conflict: 'fldfBWW064Q0AV6TC', verified: 'fldBOxRPVmTJWfrFY', notes: 'fldnJKhXQDs8VWFqW' };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const choice = value => value?.name ?? value;
const ids = value => (value || []).map(v => v.id);
const present = value => Array.isArray(value) ? value.some(present) : value !== undefined && value !== null && value !== '';
const parseMarked = (value, marker) => { try { return typeof value === 'string' && value.startsWith(marker) ? JSON.parse(value.slice(marker.length)) : null; } catch { return null; } };
const recordId = value => /^rec[a-zA-Z0-9]{14}$/.test(value || '');
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.+Z$/.test(value) ? Date.parse(value) : NaN;

// The hidden version is necessary, never sufficient. The binding is supplied
// by the reviewed native script; posted answers cannot select a new manifest.
export function prepareCandidateProfileEnvelope(envelope, release) {
  if (envelope?.lane !== 'candidate' || envelope?.formId !== CANDIDATE_FORM_ID) return { mode: 'PASSTHROUGH', envelope, profile: null };
  const hold = () => ({ mode: 'HOLD', profile: null, envelope: { ...envelope, issues: [...new Set([...(envelope.issues || []), 'FORM_VERSION_CHANGED'])] } });
  try {
    if (!release || !/^v?\d+\.\d+$/.test(release.formVersion || '') || release.formVersion === '1.0' || release.bindingHash !== candidateProfileBindingHash(release.manifest) || release.roleItemType !== 'Secondary Role') return hold();
    const answers = envelope.snapshot?.answers || {};
    const version = answers['50']?.value;
    const hasProfile = Object.values(release.manifest.fields).some(b => present(answers[b.qid]?.value));
    if ((version === undefined || version === '' || version === '1.0') && !hasProfile) return { mode: 'LEGACY', envelope, profile: null };
    if (version !== release.formVersion || !Number.isFinite(time(envelope.receivedAt))) return hold();
    const profile = readCandidateProfile(envelope, release.manifest);
    const issues = (envelope.issues || []).filter(code => code !== 'FORM_VERSION_CHANGED');
    issues.push(...profile.issues.map(i => `PROFILE_${i.code}:${i.field}`));
    return { mode: 'PROFILE', profile, envelope: { ...envelope, issues,
      candidate: { ...envelope.candidate, targetRole: profile.selectionComplete ? profile.roles.map(r => r.title).join('; ') : '' },
    } };
  } catch { return hold(); }
}

function managed(row, candidateId) {
  const m = parseMarked(row.getCellValue(f.details), ROLE_MARKER);
  if (!m || !ROLES.some(r => r.key === m.roleKey) || !m.source || !equal(ids(row.getCellValue(f.candidate)), [candidateId])) return null;
  if (row.getCellValue(f.name) !== `Declared role — ${m.title}` || row.getCellValue(f.value) !== m.title || row.getCellValue(f.level) !== m.experience || choice(row.getCellValue(f.itemType)) !== 'Secondary Role' || choice(row.getCellValue(f.sourceType)) !== 'Candidate-Entered' || choice(row.getCellValue(f.status)) !== 'Proposed — Not Promoted' || row.getCellValue(extra.conflict) || row.getCellValue(extra.verified) || row.getCellValue(extra.notes)) return null;
  return m;
}

export async function reconcileCandidateProfile(profile, base, { candidateId, evidenceId }) {
  if (base?.id !== 'appveHEw1HrXr8nD1' || !recordId(candidateId) || !recordId(evidenceId)) throw new Error('INVALID_PROFILE_EXECUTION_CONTEXT');
  const proposals = candidateRoleProposals(profile, { candidateId, evidenceId });
  // The existing writer must already have resolved the Candidate and linked
  // this exact source Evidence. A bare hidden Candidate ID cannot authorize it.
  const candidate = await base.getTable(schema.candidates.id).selectRecordAsync(candidateId);
  const evidence = await base.getTable(schema.evidence.id).selectRecordAsync(evidenceId);
  const source = parseMarked(evidence?.getCellValue(schema.evidence.fields.Notes), SOURCE_MARKER);
  if (!candidate || !evidence || !ids(evidence.getCellValue(schema.evidence.fields.Candidates)).includes(candidateId) || source?.sourceKey !== profile.source.sourceKey || source?.version !== profile.source.version || source?.snapshot?.submissionId !== profile.source.submissionId) throw new Error('UNRESOLVED_PROFILE_SOURCE_RELATIONSHIP');
  const table = base.getTable(f.tableId);
  const fields = [...new Set([...Object.entries(f).filter(([k]) => k !== 'tableId').map(([, v]) => v), ...Object.values(extra)])];
  const rows = () => table.selectRecordsAsync({ fields }).then(q => q.records.filter(r => ids(r.getCellValue(f.candidate)).includes(candidateId)).map(row => {
    // Capture values, not a mutable provider Record cache, for the prewrite check.
    const snapshot = Object.fromEntries(fields.map(key => [key, JSON.parse(JSON.stringify(row.getCellValue(key) ?? null))]));
    return { id: row.id, getCellValue: key => snapshot[key] };
  }));
  const all = await rows();
  const issues = [], recordIds = [], changed = [];
  const roleKey = row => parseMarked(row.getCellValue(f.details), ROLE_MARKER)?.roleKey;
  const matchesRole = (row, role, title) => {
    if (roleKey(row) === role) return true;
    const labels = ROLES.find(r => r.key === role)?.label || {};
    return choice(row.getCellValue(f.itemType)) === 'Secondary Role' && [title, ...Object.values(labels)].includes(row.getCellValue(f.value));
  };
  const write = async (row, values, role) => {
    let id = row?.id;
    if (id) {
      const fresh = await table.selectRecordAsync(id);
      if (!fresh || fields.some(k => !equal(fresh.getCellValue(k), row.getCellValue(k)))) throw new Error('PROFILE_CHANGED_DURING_RECONCILIATION');
      const patch = Object.fromEntries(Object.entries(values).filter(([k, v]) => !equal(choice(fresh.getCellValue(k)), choice(v))));
      if (Object.keys(patch).length) { await table.updateRecordAsync(id, patch); changed.push(id); }
    } else {
      if ((await rows()).some(current => matchesRole(current, role.roleKey, role.title))) throw new Error('PROFILE_CHANGED_DURING_RECONCILIATION');
      id = await table.createRecordAsync(values); changed.push(id);
    }
    const observed = await table.selectRecordAsync(id);
    if (!observed || Object.entries(values).some(([k, v]) => Array.isArray(v) ? !equal([...ids(observed.getCellValue(k))].sort(), [...ids(v)].sort()) : !equal(choice(observed.getCellValue(k)), choice(v)))) throw new Error('PROFILE_READBACK_FAILED');
    recordIds.push(id);
  };
  const canUpdate = (row, old) => {
    if (!old || old.source.sourceKey !== profile.source.sourceKey || !Number.isFinite(time(old.preferenceSource?.receivedAt || old.source.receivedAt))) return false;
    const prior = old.preferenceSource || old.source;
    return time(profile.source.receivedAt) > time(prior.receivedAt) || (profile.source.receivedAt === prior.receivedAt && profile.source.version === prior.version);
  };
  for (const proposal of proposals) {
    const incoming = parseMarked(proposal.fields[f.details], ROLE_MARKER);
    const candidates = all.filter(row => matchesRole(row, incoming.roleKey, incoming.title));
    if (candidates.length > 1) { issues.push(`PROFILE_DUPLICATE_ROLE:${incoming.roleKey}`); continue; }
    const row = candidates[0], old = row && managed(row, candidateId);
    if (row && (!canUpdate(row, old) || (incoming.roleKey === 'other' && old.title !== incoming.title))) { issues.push(`PROFILE_ROLE_REVIEW_REQUIRED:${incoming.roleKey}`); continue; }
    const familyContext = profile.families.find(family => family.familyKey === incoming.familyKey);
    const details = { ...incoming, ...(familyContext ? { familyContext } : {}) };
    // Closing optional detail does not erase earlier declared work experience.
    if (old) details.previousDeclaration = { experience: old.experience, tasks: old.tasks, recency: old.recency, source: old.source };
    // A replay must not recursively grow metadata or overwrite useful details.
    if (old && equal({ ...old, previousDeclaration: undefined }, { ...details, previousDeclaration: undefined })) details.previousDeclaration = old.previousDeclaration;
    const values = { ...proposal.fields, [f.details]: ROLE_MARKER + JSON.stringify(details), [f.evidence]: [...new Set([...(row ? ids(row.getCellValue(f.evidence)) : []), evidenceId])].map(id => ({ id })) };
    await write(row, values, incoming);
  }
  // Preference withdrawal is explicit only for a complete selection in the same
  // source stream. It preserves role history, status, experience and evidence.
  if (profile.selectionComplete) for (const row of all) {
    const marker = parseMarked(row.getCellValue(f.details), ROLE_MARKER);
    if (!marker || marker.requested === false || profile.roles.some(r => r.roleKey === marker.roleKey) || marker.source?.sourceKey !== profile.source.sourceKey) continue;
    const old = managed(row, candidateId);
    if (!old || !canUpdate(row, old) || all.filter(other => matchesRole(other, old.roleKey, old.title)).length !== 1) { issues.push(`PROFILE_WITHDRAWAL_REVIEW_REQUIRED:${marker.roleKey}`); continue; }
    await write(row, { [f.details]: ROLE_MARKER + JSON.stringify({ ...old, requested: false, preferenceSource: profile.source }), [f.evidence]: [...new Set([...ids(row.getCellValue(f.evidence)), evidenceId])].map(id => ({ id })) });
  }
  return { status: issues.length ? 'PARTIAL_REVIEW' : 'RECONCILED', issues, recordIds, changed };
}
