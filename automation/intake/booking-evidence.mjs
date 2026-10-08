import { schema } from './schema.mjs';
import { operationsSchema } from './operations-schema.mjs';

// Link the reviewed artifact itself. Never manufacture attendance, hours or a review.
export async function linkBookingEvidence(evidenceId, base) {
  const tables = { ...schema, ...operationsSchema };
  const read = async (table, id) => {
    const record = await base.getTable(tables[table].id).selectRecordAsync(id);
    if (!record) return null;
    return Object.fromEntries(Object.entries(tables[table].fields).map(([name, id]) => [name, record.getCellValue(id)]));
  };
  const ids = value => (value || []).map(link => link.id).sort();
  const select = value => value?.name || value || '';
  const one = value => ids(value).length === 1 ? ids(value)[0] : null;
  const hold = reason => ({ status: 'HOLD', reason, evidenceId });
  async function plan() {
    const evidence = await read('evidence', evidenceId);
    if (!evidence) return hold('SOURCE_MISSING');
    if (evidence.Verified !== true || evidence['Source Provenance Verified'] !== true ||
      !['Accepted Source', 'Canonical Source', 'Verified'].includes(select(evidence['Provenance Disposition']))) return hold('SOURCE_NOT_REVIEWED');
    if (select(evidence['Related Module']) !== 'Assignments Shifts' ||
      !['Message', 'Screenshot', 'Homebase Proof', 'Operational Evidence', 'Gmail Source', 'Email / Message', 'Email', 'Gmail', 'Email Evidence', 'Source Document', 'Document / PDF', 'Other Verified Evidence'].includes(select(evidence['Evidence Type'])) ||
      !(evidence['File Link'] || evidence.Attachment?.length)) return hold('SOURCE_ARTIFACT_REQUIRED');
    const bookingId = one(evidence['Worker Bookings']);
    const coverageId = one(evidence['Coverage Requests']);
    if (!bookingId || !coverageId || evidence['Related Object ID'] !== bookingId) return hold('SOURCE_SCOPE_AMBIGUOUS');
    const booking = await read('bookings', bookingId);
    const coverage = await read('coverage', coverageId);
    if (!booking || !coverage || one(booking['Coverage Slot']) !== coverageId ||
      !ids(booking['Evidence Records']).includes(evidenceId)) return hold('BOOKING_SCOPE_MISMATCH');
    if (!['Completed', 'Cancelled', 'Released', 'Replaced'].includes(select(booking['Booking Status']))) return hold('BOOKING_NOT_TERMINAL');
    const workerIds = ids(booking.Worker), candidateIds = ids(booking.Candidate);
    if (workerIds.length > 1 || candidateIds.length > 1 || (!workerIds.length && !candidateIds.length)) return hold('PERSON_AMBIGUOUS');
    const worker = workerIds.length ? await read('workers', workerIds[0]) : null;
    const candidate = candidateIds.length ? await read('candidates', candidateIds[0]) : null;
    if ((workerIds.length && !worker) || (candidateIds.length && !candidate)) return hold('PERSON_MISSING');
    if (candidate && ids(candidate['Canonical Candidate Record']).length) return hold('CANDIDATE_REDIRECT');
    if (worker && candidate && (one(worker['Source Candidate Record']) !== candidateIds[0] ||
      one(candidate['Promoted Worker']) !== workerIds[0] || !worker['Team Member Number'] ||
      worker['Team Member Number'] !== candidate['Team Member Number'])) return hold('IDENTITY_MISMATCH');
    const environment = select(evidence['Record Environment']);
    if (!['Production / Live', 'QA / Test'].includes(environment) || [booking, coverage, worker, candidate].filter(Boolean).some(r => select(r['Record Environment']) !== environment)) return hold('ENVIRONMENT_MISMATCH');
    const expected = { Workers: workerIds, Candidates: candidateIds };
    for (const [field, wanted] of Object.entries(expected)) {
      const current = ids(evidence[field]);
      if (current.length && JSON.stringify(current) !== JSON.stringify(wanted)) return hold('EXISTING_PERSON_CONFLICT');
    }
    // Capture scalar snapshots now; Airtable record objects can otherwise reflect later changes.
    const fingerprint = JSON.stringify([evidenceId, ...[evidence, booking, coverage, worker, candidate].map(r => r && Object.fromEntries(Object.entries(r).filter(([name]) => !['Workers', 'Candidates', 'Evidence Records'].includes(name))))]);
    return { status: 'READY', evidence, expected, fingerprint, bookingId, coverageId };
  }
  const initial = await plan();
  if (initial.status === 'HOLD') return initial;
  const current = await plan();
  if (current.status === 'HOLD') return current;
  if (initial.fingerprint !== current.fingerprint) return hold('SOURCE_CHANGED');
  const fields = {};
  for (const [field, wanted] of Object.entries(current.expected)) {
    if (JSON.stringify(ids(current.evidence[field])) !== JSON.stringify(wanted)) fields[schema.evidence.fields[field]] = wanted.map(id => ({ id }));
  }
  if (Object.keys(fields).length) await base.getTable(schema.evidence.id).updateRecordAsync(evidenceId, fields);
  const readback = await plan();
  if (readback.status === 'HOLD' || readback.fingerprint !== current.fingerprint) return hold('READBACK_REVIEW_REQUIRED');
  if (Object.entries(current.expected).some(([field, wanted]) => JSON.stringify(ids(readback.evidence[field])) !== JSON.stringify(wanted))) return hold('LINK_READBACK_FAILED');
  return { status: Object.keys(fields).length ? 'LINKED' : 'REPLAY_NO_WRITE', evidenceId, bookingId: current.bookingId, personIds: current.expected };
}
