import { createHash } from 'node:crypto';

export type Lane = 'candidate' | 'client';
export const FORMS = { candidate: '261480775333056', client: '262081932367056' };
export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}
export function canonicalJSON(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
export function digest(value: unknown): string { return createHash('sha256').update(canonicalJSON(value)).digest('hex'); }
export function evidenceVersion(snapshot: any): string {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const { formId, submissionId, createdAt, answers } = snapshot;
  return digest({ formId, submissionId, createdAt, answers });
}
export function normalizeEmail(value: unknown): string {
  const v = text(value).toLowerCase();
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v) ? v : '';
}
export function normalizePhone(value: any): string {
  const v = text(value?.full ?? value);
  if (!v || /[a-z]/i.test(v)) return '';
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return v.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : '';
}
export function fullName(value: any): string {
  return value && typeof value === 'object' ? ['prefix', 'first', 'middle', 'last', 'suffix'].map(k => text(value[k])).filter(Boolean).join(' ') : text(value);
}
function asList(value: any): string[] { return (Array.isArray(value) ? value : [value]).map(text).filter(Boolean); }
function address(value: any, areaOnly = false): string {
  if (!value || typeof value !== 'object') return text(value);
  return (areaOnly ? ['city', 'state', 'country'] : ['addr_line1', 'addr_line2', 'city', 'state', 'postal', 'country']).map(k => text(value[k])).filter(Boolean).join(', ');
}

// Jotform returns account-local created_at values without an offset. The first live
// production Client canary on 2026-10-10 established that this JEF account is using
// America/New_York: provider 12:33:23 reconciled to receipt 16:33:25Z. Convert that
// wall-clock value explicitly instead of silently treating it as UTC. Offset-aware
// provider timestamps remain authoritative as-is. DST gaps/invalid values fail closed.
const JOTFORM_ACCOUNT_TIME_ZONE = 'America/New_York';
function sourceEventTimestamp(value: unknown): string | null {
  const date = text(value);
  if (/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(date) && !Number.isNaN(Date.parse(date))) return new Date(date).toISOString();
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const target = match.slice(1).map(Number);
  const targetUtc = Date.UTC(target[0], target[1] - 1, target[2], target[3], target[4], target[5]);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: JOTFORM_ACCOUNT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let instant = targetUtc;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const observedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = targetUtc - observedUtc;
    instant += delta;
    if (delta === 0) break;
  }
  const check = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  if (check.year !== target[0] || check.month !== target[1] || check.day !== target[2] || check.hour !== target[3] || check.minute !== target[4] || check.second !== target[5]) return null;
  return new Date(instant).toISOString();
}

// Only provider-fetched answers are consumed here; never trust answers supplied by the caller.
export function normalizeSubmission(lane: Lane, source: any, receivedAt: string) {
  if (typeof source?.id !== 'string' || !/^\d{16,22}$/.test(source.id)) throw new Error('INVALID_PROVIDER_SUBMISSION_ID');
  if (String(source.form_id) !== FORMS[lane] || source.status !== 'ACTIVE') throw new Error('PROVIDER_FORM_OR_STATUS_MISMATCH');
  if (!source.answers || typeof source.answers !== 'object' || Array.isArray(source.answers)) throw new Error('INVALID_PROVIDER_ANSWERS');
  const answers: Record<string, any> = {};
  for (const [qid, question] of Object.entries<any>(source.answers)) {
    if (Object.prototype.hasOwnProperty.call(question, 'answer')) answers[qid] = { question: text(question.text), value: question.answer, type: text(question.type) };
  }
  if (canonicalJSON(answers).length > 65000) throw new Error('SOURCE_TOO_LARGE_FOR_EVIDENCE');
  const a = (qid: number) => answers[String(qid)]?.value;
  const issues: string[] = [];
  const candidate = lane === 'candidate';
  const name = fullName(a(3));
  const email = normalizeEmail(a(5));
  const phone = normalizePhone(a(candidate ? 4 : 6));
  if (text(a(5)) && !email) issues.push('INVALID_EMAIL');
  if (fullName(a(candidate ? 4 : 6)) && !phone) issues.push('INVALID_PHONE');
  const meta = candidate ? [49, 50, 51] : [25, 26, 32];
  const expected = candidate ? ['JEF-CANDIDATE-APPLICATION', '1.0'] : ['JF-CL-02', 'v1.1'];
  for (let i = 0; i < 2; i++) if (text(a(meta[i])) && text(a(meta[i])) !== expected[i]) issues.push(i ? 'FORM_VERSION_CHANGED' : 'FORM_CODE_CHANGED');
  const environment = text(a(meta[2]));
  const qaName = candidate ? name : text(a(2));
  // QA is recognized by explicit source names; a hidden environment field alone is insufficient.
  const qa = qaName.startsWith('[JEF INTAKE QA]');
  if ((!qa && qaName.startsWith('[')) || (!qa && environment && !['Production', 'Live'].includes(environment))) issues.push('UNEXPECTED_ENVIRONMENT');
  const sourceKey = `${candidate ? 'CANDIDATESRC' : 'CLIENTSRC'}|Jotform|${source.id}`;
  // Keep mutable provider metadata in the audit snapshot, but do not let it define
  // evidence identity. Jotform can advance updated_at during a replay even when the
  // actual submitted answers are unchanged.
  const snapshot = { formId: source.form_id, submissionId: source.id, createdAt: source.created_at, updatedAt: source.updated_at || null, answers };
  const version = evidenceVersion(snapshot);
  const sourceTimestamp = sourceEventTimestamp(source.created_at);
  const english = text(a(14));
  const englishMap: Record<string, string> = { Basic: 'Basic', Intermediate: 'Intermediate', Conversational: 'Conversational', Advanced: 'Advanced', 'Fluent / Native': 'Fluent', Fluent: 'Fluent' };
  if (candidate && english && !englishMap[english]) issues.push('UNMAPPED_ENGLISH_LEVEL');
  const services = asList(a(9));
  const allowedServices = ['Recruiting', 'Trial Staffing', 'Payroll Support', 'Invoice Billing', 'Content Opportunity', 'Other', 'Event Staffing', 'Temporary Staffing & Payroll Support', 'Trial-to-Hire', 'Direct Hire Recruiting', 'Not Sure'];
  if (!candidate && services.some(v => !allowedServices.includes(v))) issues.push('SERVICE_REQUIRES_MAPPING');
  if (!candidate && services.includes('Not Sure')) issues.push('SERVICE_INTENT_UNSPECIFIED');
  const urgencyMap: Record<string, string> = { 'Immediate (within 1–3 days)': 'Urgent', 'Soon (within 1 week)': 'Upcoming', 'This month': 'Upcoming', 'Flexible / Not urgent': 'Routine' };
  if (!candidate && text(a(15)) && !urgencyMap[text(a(15))]) issues.push('UNMAPPED_URGENCY');
  const attachments = asList(a(candidate ? 27 : 20)).filter(v => /^https:\/\/[^\s]+$/i.test(v.replace(/ /g, '%20')));
  return {
    protocol: 'JEF-INTAKE-2', lane, formId: FORMS[lane], submissionId: source.id, sourceKey, version, receivedAt, sourceTimestamp, qa,
    sourceURL: `https://www.jotform.com/submission/${source.id}`, snapshot, issues,
    person: { name, email, phone },
    candidate: candidate ? { location: address(a(8), true), preferredAreas: asList(a(11)).join('; '), targetRole: text(a(34)), availability: asList(a(36)).join('; '), english: englishMap[english] || '' } : null,
    client: !candidate ? { business: text(a(2)), location: address(a(8)), services: services.filter(v => allowedServices.includes(v)), urgency: urgencyMap[text(a(15))] || '', commercial: text(a(16)), clientId: text(a(28)), leadId: text(a(27)), gmailThreadId: text(a(30)) } : null,
    attachments,
  };
}
export type Envelope = ReturnType<typeof normalizeSubmission>;
