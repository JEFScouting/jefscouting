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
  if (steps.some(step => provider.effects.filter(e => e.step === step).length !== 1)) return hold('EXACT_EFFECT_READBACK_REQUIRED');
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

// Executor integration contract. The provider/claim/evidence implementations
// must come from the existing governed Gmail executor; no raw send or clock is
// installed here. An uncertain external effect is never retried by this code.
export async function executeReminder(candidateId,deps) {
  const hold=reason=>({disposition:'HOLD',reason});
  const required=['readCandidate','readProvider','now','readApprovedPayload','claimEffect','cancelClaim','markSending','sendApprovedPayload','markUnknown','persistSendEvidence','markSent','writeCandidateTimestamp','verifyCandidateTimestamp'];
  if(required.some(k=>typeof deps?.[k]!=='function'))return hold('GOVERNED_EXECUTOR_REQUIRED');
  let candidate=await deps.readCandidate(candidateId),provider=await deps.readProvider(candidateId);
  if(candidate?.id!==candidateId)return hold('EXACT_CANDIDATE_REQUIRED');
  let decision=reminderDecision(candidate,provider,deps.now());
  const approvedFor=(payload,step,key)=>payload?.approved===true&&payload.candidateId===candidateId&&payload.step===step&&payload.key===key&&payload.recipient===candidate.Email&&payload.trackedLink===candidate['Tracked Representation Agreement Link']&&typeof payload.version==='string'&&payload.version.length>0&&typeof payload.body==='string'&&payload.body.includes(payload.trackedLink);
  // A copied timestamp cannot establish the prior invitation. Require the same
  // recipient, tracked link and reviewed payload version as the provider proof.
  const historyConfirmed=async()=>{
    for(const effect of provider.effects.filter(e=>e.outcome==='sent')) {
      const payload=await deps.readApprovedPayload(candidateId,effect.step);
      if(!effect.messageId||!effect.threadId||!approvedFor(payload,effect.step,effect.key)||effect.recipient!==payload.recipient||effect.payloadVersion!==payload.version||effect.trackedLink!==payload.trackedLink)return false;
    }
    return true;
  };
  if(['DUE','RECONCILE'].includes(decision.disposition)&&!await historyConfirmed())return hold('PROVIDER_SEND_READBACK_UNCONFIRMED');
  if(decision.disposition==='RECONCILE'){
    const proof=provider.effects.filter(e=>e.key===decision.key&&e.outcome==='sent');
    if(proof.length!==1||!proof[0].messageId||!proof[0].threadId||proof[0].recipient!==candidate.Email)return hold('PROVIDER_SEND_READBACK_UNCONFIRMED');
    const evidence=await deps.persistSendEvidence(candidateId,decision.key,proof[0]);
    if(!/^rec[A-Za-z0-9]{14}$/.test(evidence?.evidenceId||''))throw new Error('SEND_EVIDENCE_READBACK_REQUIRED');
    await deps.writeCandidateTimestamp(candidateId,decision.field,decision.value);
    if(!await deps.verifyCandidateTimestamp(candidateId,decision.field,decision.value))throw new Error('REMINDER_TIMESTAMP_READBACK_FAILED');
    return {...decision,disposition:'RECONCILED'};
  }
  if(decision.disposition!=='DUE')return decision;
  const approved=payload=>approvedFor(payload,decision.step,decision.key);
  const payload=await deps.readApprovedPayload(candidateId,decision.step);
  if(!approved(payload))return hold('EXACT_APPROVED_TRACKED_PAYLOAD_REQUIRED');
  const claim=await deps.claimEffect(decision.key,payload.version);
  if(claim?.status!=='claimed'||claim.key!==decision.key||!claim.claimId)return hold('EFFECT_ALREADY_CLAIMED_OR_UNCERTAIN');
  candidate=await deps.readCandidate(candidateId);provider=await deps.readProvider(candidateId);
  const fresh=reminderDecision(candidate,provider,deps.now()),freshPayload=await deps.readApprovedPayload(candidateId,decision.step);
  if(fresh.disposition==='DUE'&&!await historyConfirmed()){
    await deps.cancelClaim(claim);return hold('PROVIDER_SEND_READBACK_UNCONFIRMED');
  }
  if(fresh.disposition!=='DUE'||fresh.key!==decision.key||!approved(freshPayload)||JSON.stringify(freshPayload)!==JSON.stringify(payload)){
    await deps.cancelClaim(claim);
    return fresh.disposition==='DUE'?hold('APPROVED_PAYLOAD_CHANGED'):fresh;
  }
  if(!await deps.markSending(claim))return hold('EXCLUSIVE_EFFECT_CLAIM_LOST');
  let sent;
  try{sent=await deps.sendApprovedPayload(payload,claim);}catch{await deps.markUnknown(claim);return hold('PROVIDER_OUTCOME_UNCERTAIN');}
  // Transport acceptance alone is not provider evidence. The exact message,
  // thread, route, sent timestamp and logical step must independently agree.
  provider=await deps.readProvider(candidateId);
  const proof=provider?.effects?.filter(e=>e.key===decision.key&&e.step===decision.step&&e.outcome==='sent');
  const observed=proof?.length===1?proof[0]:null;
  if(provider?.candidateId!==candidateId||provider.complete!==true||!observed||!sent?.messageId||!sent?.threadId||observed.messageId!==sent.messageId||observed.threadId!==sent.threadId||observed.recipient!==payload.recipient||observed.payloadVersion!==payload.version||observed.trackedLink!==payload.trackedLink||!Number.isFinite(millis(observed.sentAt))||millis(observed.sentAt)>millis(deps.now())){
    await deps.markUnknown(claim);return hold('PROVIDER_SEND_READBACK_UNCONFIRMED');
  }
  const evidence=await deps.persistSendEvidence(candidateId,decision.key,observed);
  if(!/^rec[A-Za-z0-9]{14}$/.test(evidence?.evidenceId||''))throw new Error('SEND_EVIDENCE_READBACK_REQUIRED');
  await deps.markSent(claim,observed,evidence);
  const field=fields[steps.indexOf(decision.step)];
  await deps.writeCandidateTimestamp(candidateId,field,observed.sentAt);
  if(!await deps.verifyCandidateTimestamp(candidateId,field,observed.sentAt))throw new Error('REMINDER_TIMESTAMP_READBACK_FAILED');
  return {disposition:'SENT_VERIFIED',step:decision.step,key:decision.key,messageId:observed.messageId,threadId:observed.threadId,evidenceId:evidence.evidenceId};
}
