// Read-only pre-effect boundary. The existing Gmail executor must supply complete,
// exact-candidate provider readback and atomically claim an effect before sending.
// This module creates no queue, recurrence, communication or business record.
const steps = ['initial', 'r1', 'r2'];
const fields = ['Agreement Initial Sent At', 'Agreement R1 Sent At', 'Agreement R2 Sent At'];
const status = v => v?.name || v || '';
const millis = v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
export function reminderDecision(candidate, provider, now) {
  const hold = reason => ({ disposition: 'HOLD', reason });
  if (!/^rec[A-Za-z0-9]{14}$/.test(candidate?.id)) return hold('EXACT_CANDIDATE_REQUIRED');
  if (['Signed', 'Declined', 'Not Applicable'].includes(status(candidate['Candidate Agreement Status']))) return { disposition: 'STOP' };
  if (provider?.candidateId !== candidate.id || provider.complete !== true || !Array.isArray(provider.effects)) return hold('PROVIDER_READBACK_REQUIRED');
  if (provider.effects.some(e => !steps.includes(e.step) || e.key !== `${candidate.id}|agreement|${e.step}` || !['sent','not_sent'].includes(e.outcome))) return hold('PROVIDER_OUTCOME_UNCERTAIN');
  const current = millis(now);
  if (!Number.isFinite(current)) return hold('CURRENT_TIME_INVALID');
  let prior = null;
  for (let i=0; i<steps.length; i++) {
    const effects = provider.effects.filter(e=>e.step===steps[i]);
    if (effects.length!==1) return hold('EXACT_EFFECT_READBACK_REQUIRED');
    const effect=effects[0], snapshot=candidate[fields[i]];
    if (effect.outcome==='sent') {
      const at=millis(effect.sentAt);
      if (!Number.isFinite(at)||at>current||(prior!==null&&at<prior)|| (snapshot&&millis(snapshot)!==at)) return hold('SEND_TIMESTAMP_CONFLICT');
      // Restore a missing canonical timestamp from provider proof before another effect.
      if (!snapshot) return { disposition:'RECONCILE', field:fields[i], value:effect.sentAt, key:effect.key };
      prior=at;continue;
    }
    if (snapshot||provider.effects.some(e=>steps.indexOf(e.step)>i&&e.outcome==='sent')) return hold('SEND_SEQUENCE_CONFLICT');
    if (i>0 && (prior===null || current-prior < (i===1?24:48)*3600000)) return { disposition:'NOT_DUE' };
    const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date(current)));
    if(hour<9||hour>=19)return { disposition:'OUTSIDE_WINDOW' };
    if(!candidate['Tracked Representation Agreement Link']||!candidate.Email)return hold('TRACKED_ROUTE_REQUIRED');
    return { disposition:'DUE', step:steps[i], key:effect.key };
  }
  return { disposition:'STOP', reason:'MAX_REMINDERS_SENT' };
}
export async function rereadReminder(candidateId, { readCandidate, readProvider, now }) {
  // Invoke directly before the existing executor's durable claim. A DUE result
  // is not send authorization and must never be cached across executions.
  const candidate=await readCandidate(candidateId);
  if(candidate?.id!==candidateId)return { disposition:'HOLD',reason:'EXACT_CANDIDATE_REQUIRED' };
  const provider=await readProvider(candidateId);
  return reminderDecision(candidate,provider,now());
}
