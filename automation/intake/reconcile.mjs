import { schema } from './schema.mjs';

const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const str = v => typeof v === 'string' ? v.trim() : '';
const email = v => str(v).toLowerCase();
const emails = v => str(v).split(/[;,\s]+/).map(email).filter(Boolean);
const phone = v => { const d = str(v).replace(/\D/g, ''); return d.length === 10 ? '1' + d : d; };
const choice = v => v?.name || v || '';
const links = v => (v || []).map(x => typeof x === 'string' ? x : x.id);
const stable = v => JSON.stringify(v);
const nonempty = v => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0);
const readable = v => typeof v === 'string' ? v : stable(v);
const machinePrefix = 'JEF_INTAKE_SOURCE_V2\n';
const comparable = v => Array.isArray(v) ? v.map(comparable) : v && typeof v === 'object' && 'name' in v ? v.name : v;

export async function reconcile(envelope, base) {
  const e = envelope;
  if (base.id !== 'appveHEw1HrXr8nD1' || e.protocol !== 'JEF-INTAKE-2' || !['candidate','client'].includes(e.lane)) throw new Error('INVALID_EXECUTION_CONTEXT');
  const tables = Object.fromEntries(Object.entries(schema).map(([k,v]) => [k,base.getTable(v.id)]));
  const id = (t, f) => { const v = schema[t].fields[f]; if (!v) throw new Error('UNMAPPED_FIELD'); return v; };
  const get = (r,t,f) => r?.getCellValue(id(t,f));
  const encode = (t, fields) => Object.fromEntries(Object.entries(fields).map(([k,v]) => [id(t,k),v]));
  const rows = async (t, fields) => (await tables[t].selectRecordsAsync({fields:fields.map(f=>id(t,f))})).records;
  const update = async (t, recordId, fields) => { if (Object.keys(fields).length) await tables[t].updateRecordAsync(recordId,encode(t,fields)); };
  const create = async (t, fields) => tables[t].createRecordAsync(encode(t,fields));
  const fresh = async (t, recordId) => { const r=await tables[t].selectRecordAsync(recordId); if (!r) throw new Error('READBACK_MISSING'); return r; };
  const addLink = (r,t,f,target) => [...new Set([...links(get(r,t,f)),target])].map(id=>({id}));
  const verify = async (t, recordId, fields) => {
    const r = await fresh(t,recordId);
    for (const [f,v] of Object.entries(fields)) {
      const observed=get(r,t,f);
      if (Array.isArray(v) && v.every(x=>x?.id)) { if (v.some(x=>!links(observed).includes(x.id))) throw new Error('RELATIONSHIP_READBACK_FAILED'); }
      else if (v?.name) { if(choice(observed)!==v.name) throw new Error('SELECT_READBACK_FAILED'); }
      else if (Array.isArray(v) && v.every(x=>x?.name)) { if(v.some(x=>!(observed||[]).some(o=>o.name===x.name))) throw new Error('MULTISELECT_READBACK_FAILED'); }
      else if (stable(observed??null)!==stable(v??null)) throw new Error('FIELD_READBACK_FAILED');
    }
    return r;
  };
  let issues=[...e.issues], recordIds=[], applied={};
  const evidenceRows=await rows('evidence',['Evidence ID','Related Object ID','Notes','Candidates','Client Intake','Clients','Provenance Disposition']);
  const evidenceKey=`${e.qa?'TEST-':''}EVD-JOTFORM-${e.lane.toUpperCase()}-${e.submissionId}-${e.version.slice(0,16)}`;
  let ev=evidenceRows.filter(r=>get(r,'evidence','Evidence ID')===evidenceKey);
  if(ev.length>1) throw new Error('DUPLICATE_SOURCE_EVIDENCE');
  const payload = status => ({ protocol:e.protocol, sourceKey:e.sourceKey, version:e.version, status, observedAt:e.receivedAt, snapshot:e.snapshot, issues:[...new Set(issues)], recordIds, applied });
  const sourceFields={
    'Evidence ID':evidenceKey,'Evidence Type':{name:e.qa?'System Test':'Source Document'},
    'Related Module':{name:e.lane==='candidate'?'Recruiting':'Client Intake'},
    'Related Object ID':e.submissionId,'Related Object':e.sourceKey,'Evidence Date':e.receivedAt,
    'File Link':e.sourceURL,'Source Provenance Verified':true,
    'Provenance Disposition':{name:'Accepted Source'},'Notes':machinePrefix+stable(payload('received')),
  };
  const evidenceId=ev[0]?.id || await create('evidence',sourceFields);
  recordIds.push(evidenceId);
  const finish = async (status, code='') => {
    issues=[...new Set(issues)];
    const fields={'Notes':machinePrefix+stable(payload(status)), 'Provenance Disposition':{name:status==='exception'?'Needs Review':'Accepted Source'}};
    await update('evidence',evidenceId,fields); await verify('evidence',evidenceId,fields);
    return {status,recordIds,code:code||issues.join('|').slice(0,150)};
  };
  // Source snapshots are the authority for otherwise unmapped/explicit negative answers.
  // A human disposition, work authorization, reliability, or readiness is never inferred.
  const sourceFatal=issues.some(x=>['FORM_VERSION_CHANGED','FORM_CODE_CHANGED','UNEXPECTED_ENVIRONMENT'].includes(x));
  if(sourceFatal) return finish('exception','SOURCE_CONTRACT_CHANGED');
  const previousFor = recordId => {
    const versions=evidenceRows.map(r=>{try {const n=get(r,'evidence','Notes');return str(n).startsWith(machinePrefix)?JSON.parse(n.slice(machinePrefix.length)):null;}catch{return null;}})
      .filter(v=>v&&v.sourceKey===e.sourceKey&&v.recordIds?.includes(recordId)&&v.applied?.[recordId])
      .sort((a,b)=>String(b.observedAt).localeCompare(String(a.observedAt)));
    return versions[0]?.applied?.[recordId]||{};
  };
  const safeFields = (r,t,proposed) => {
    const prior=previousFor(r.id), patch={}, managed={...prior};
    for(const [f,v] of Object.entries(proposed)) {
      if(!nonempty(v)) continue;
      const current=get(r,t,f), observed=comparable(current), incoming=comparable(v);
      if(!nonempty(current)||stable(observed)===stable(incoming)||stable(observed)===stable(comparable(prior[f]))) {
        if(stable(observed)!==stable(incoming)) patch[f]=v;
        managed[f]=v;
      } else issues.push('CANONICAL_CONFLICT:'+f);
    }
    applied[r.id]=managed;
    return patch;
  };
  const person=e.person;
  if(e.lane==='candidate') {
    const fields=['Candidate','Email','Phone','Object ID','Candidate Profile Submission ID','Record Environment','Canonical Candidate Record','Population Reconciliation Disposition','Identity Reconciliation Status','Evidence Records','Location','Preferred Work Areas','Target Role','Availability','English Level','Source','Resume Processing Status'];
    const all=await rows('candidates',fields);
    const source=all.filter(r=>get(r,'candidates','Candidate Profile Submission ID')===e.submissionId||get(r,'candidates','Object ID')===`CAN-JF-${e.submissionId}`);
    const contact=all.filter(r=>(person.email&&emails(get(r,'candidates','Email')).includes(person.email))||(person.phone&&phone(get(r,'candidates','Phone'))===phone(person.phone)));
    const resolve=r=>{
      const redirect=links(get(r,'candidates','Canonical Candidate Record'));
      return redirect.length===1 ? all.find(x=>x.id===redirect[0])||r : r;
    };
    const matches=[...new Map([...source,...contact].map(resolve).map(r=>[r.id,r])).values()];
    let candidate=matches[0];
    const invalidMatch=candidate&&(
      (get(candidate,'candidates','Record Environment')==='QA / Test')!==e.qa ||
      /ARCHIVED|DUPLICATE|EXCEPTION/.test(choice(get(candidate,'candidates','Population Reconciliation Disposition'))) ||
      /Ambiguous|Exception/.test(choice(get(candidate,'candidates','Identity Reconciliation Status'))) ||
      (!source.length && norm(get(candidate,'candidates','Candidate'))!==norm(person.name))
    );
    const sameName=all.filter(r=>norm(get(r,'candidates','Candidate'))===norm(person.name));
    if(matches.length>1||invalidMatch||(!matches.length&&sameName.length)||!person.name||(!person.email&&!person.phone)) {
      issues.push('AMBIGUOUS_OR_INCOMPLETE_CANDIDATE_IDENTITY');return finish('exception');
    }
    const c=e.candidate;
    const proposed={'Candidate':person.name,'Email':person.email,'Phone':person.phone,'Location':c.location,'Preferred Work Areas':c.preferredAreas,'Target Role':c.targetRole,'Availability':c.availability};
    if(c.english) proposed['English Level']={name:c.english};
    if(!candidate) {
      const values=Object.fromEntries(Object.entries(proposed).filter(([,v])=>nonempty(v)));
      Object.assign(values,{'Object ID':`${e.qa?'TEST-':''}CAN-JF-${e.submissionId}`,'Candidate Profile Submission ID':e.submissionId,'Source':{name:'Jotform'},'Identity Reconciliation Status':{name:'Reconciled — Unique'},'Identity Reconciliation Basis':`Provider submission ${e.submissionId}; no conflicting source, name, email or phone match. Intake identity only.`, 'Evidence Records':[{id:evidenceId}]});
      if(e.attachments.length) values['Resume Processing Status']={name:'Received Original'};
      const candidateId=await create('candidates',values);recordIds.push(candidateId);applied[candidateId]=proposed;
      candidate=await verify('candidates',candidateId,values);
    } else {
      candidate=await fresh('candidates',candidate.id);
      const patch=safeFields(candidate,'candidates',proposed);
      if(!get(candidate,'candidates','Candidate Profile Submission ID')) patch['Candidate Profile Submission ID']=e.submissionId;
      patch['Evidence Records']=addLink(candidate,'candidates','Evidence Records',evidenceId);
      await update('candidates',candidate.id,patch);await verify('candidates',candidate.id,patch);recordIds.push(candidate.id);
    }
    await verify('evidence',evidenceId,{'Candidates':[{id:candidate.id}]});
    return finish(issues.length?'exception':'done');
  }

  const c=e.client;
  const intakeFields=['Request ID','Source Submission ID','Source Event Key — Immutable','Converted Client','Leads','Client Name','Contact Name','Email','Phone','Requested Location','Service Needed','Urgency','Commercial Requirement','Notes','Evidence Records','Record Environment','Client Identity Reconciliation','Client Identity Reconciliation Basis'];
  const intakeRows=await rows('intake',intakeFields);
  const sameSource=intakeRows.filter(r=>get(r,'intake','Source Submission ID')===e.submissionId||get(r,'intake','Source Event Key — Immutable')===e.sourceKey);
  if(sameSource.length>1) { issues.push('DUPLICATE_INTAKE_SOURCE');return finish('exception'); }
  let intake=sameSource[0];
  if(intake&&(get(intake,'intake','Record Environment')==='QA / Test')!==e.qa) {issues.push('ENVIRONMENT_CONFLICT');return finish('exception');}
  const summary=Object.entries(e.snapshot.answers).map(([qid,q])=>`${qid}. ${q.question}: ${readable(q.value)}`).join('\n');
  const proposed={'Client Name':c.business,'Contact Name':person.name,'Email':person.email,'Phone':person.phone,'Requested Location':c.location,'Commercial Requirement':c.commercial};
  if(c.services.length) proposed['Service Needed']=c.services.map(name=>({name}));
  if(c.urgency) proposed['Urgency']={name:c.urgency};
  if(!intake) {
    const values=Object.fromEntries(Object.entries(proposed).filter(([,v])=>nonempty(v)));
    Object.assign(values,{'Request ID':`${e.qa?'TEST-':''}CLIENTREQ|${e.sourceKey}`,'Source System':{name:'Jotform'},'Source Event ID':e.submissionId,'Source Form ID':e.formId,'Source Event Key — Immutable':e.sourceKey,'Source Submission ID':e.submissionId,'Reconciled / Ingested At':e.receivedAt,'Intake Source Channel':{name:'JotForm'},'Source Form Code':'JF-CL-02','Source Form Version':'v1.1','Intake Status':{name:'New'},'Intake Approval Status':{name:'Not Reviewed'},'Service Authorization Decision':{name:'Not Reviewed'},'Decision / Contact Authority Status':{name:'Unknown'},'Client Readiness State':{name:'INQUIRY RECEIVED'},'Evidence Records':[{id:evidenceId}],'Notes':'Jotform source facts; no service authorization.\n'+summary});
    if(e.sourceTimestamp) values['Source Event Timestamp']=e.sourceTimestamp;
    const intakeId=await create('intake',values);recordIds.push(intakeId);applied[intakeId]=proposed;intake=await verify('intake',intakeId,values);
  } else {
    intake=await fresh('intake',intake.id);
    const patch=safeFields(intake,'intake',proposed);
    patch['Evidence Records']=addLink(intake,'intake','Evidence Records',evidenceId);
    await update('intake',intake.id,patch);await verify('intake',intake.id,patch);recordIds.push(intake.id);
  }
  const clients=await rows('clients',['Client Name','Main Contact','Email','Phone','NEXT Object ID','Record Environment','Evidence Records','Client Status']);
  let lead=null;
  if(c.leadId) {
    const leadRows=await rows('leads',['Lead ID','Business','Emails','Phone','Client Record','Evidence Records']);
    const referenced=leadRows.filter(r=>r.id===c.leadId||get(r,'leads','Lead ID')===c.leadId);
    lead=referenced[0];
    const route=lead&&((person.email&&emails(get(lead,'leads','Emails')).includes(person.email))||(person.phone&&phone(get(lead,'leads','Phone'))===phone(person.phone)));
    // A hidden ID is a hint, never sufficient authority to manufacture a relationship.
    if(referenced.length!==1||!route||norm(get(lead,'leads','Business'))!==norm(c.business)||links(get(lead,'leads','Client Record')).length>1) {
      issues.push('AMBIGUOUS_OR_UNSUPPORTED_LEAD_REFERENCE');
      await update('intake',intake.id,{'Client Identity Reconciliation':{name:'Ambiguous — review required'},'Client Identity Reconciliation Basis':`Submission ${e.submissionId}; the supplied Lead reference was not independently corroborated by business and contact evidence.`});
      return finish('exception');
    }
  }
  const existingLinks=[...new Set([...links(get(intake,'intake','Converted Client')),...(lead?links(get(lead,'leads','Client Record')):[])])];
  const matches=clients.filter(r=>existingLinks.includes(r.id)||get(r,'clients','NEXT Object ID')===`CLI-JF-${e.submissionId}`||get(r,'clients','NEXT Object ID')===`TEST-CLI-JF-${e.submissionId}`||(c.clientId&&(r.id===c.clientId||get(r,'clients','NEXT Object ID')===c.clientId))||(person.email&&emails(get(r,'clients','Email')).includes(person.email))||(person.phone&&phone(get(r,'clients','Phone'))===phone(person.phone))||norm(get(r,'clients','Client Name'))===norm(c.business));
  let client=matches[0];
  const nameIsExact=client&&norm(get(client,'clients','Client Name'))===norm(c.business);
  const contactMatches=client&&((person.email&&emails(get(client,'clients','Email')).includes(person.email))||(person.phone&&phone(get(client,'clients','Phone'))===phone(person.phone)));
  const partialName=clients.some(r=>{const n=norm(get(r,'clients','Client Name')), b=norm(c.business);return n&&b&&(n.includes(b)||b.includes(n));});
  const heldBefore=choice(get(intake,'intake','Client Identity Reconciliation'))==='Ambiguous — review required';
  if(heldBefore||matches.length>1||existingLinks.length>1||!c.business||!person.name||(!person.email&&!person.phone)||(c.clientId&&!client)||(!client&&partialName)||(client&&((get(client,'clients','Record Environment')==='QA / Test')!==e.qa||!nameIsExact||(!contactMatches&&!existingLinks.includes(client.id))))) {
    issues.push('AMBIGUOUS_OR_INCOMPLETE_CLIENT_IDENTITY');
    await update('intake',intake.id,{'Client Identity Reconciliation':{name:'Ambiguous — review required'},'Client Identity Reconciliation Basis':`Provider submission ${e.submissionId}; conflicting or insufficient business/contact identity. Source retained in Evidence ${evidenceId}.`});
    return finish('exception');
  }
  let created=false;
  if(!client) {
    const values={'Client Name':c.business,'Main Contact':person.name,'NEXT Object ID':`${e.qa?'TEST-':''}CLI-JF-${e.submissionId}`,'Client Status':{name:'Lead'},'Evidence Records':[{id:evidenceId}]};
    if(person.email) values.Email=person.email;if(person.phone) values.Phone=person.phone;
    const clientId=await create('clients',values);recordIds.push(clientId);client=await verify('clients',clientId,values);created=true;
  } else {
    client=await fresh('clients',client.id);
    const patch={'Evidence Records':addLink(client,'clients','Evidence Records',evidenceId)};
    // A request contact is not automatically the account's main/billing contact.
    if(!get(client,'clients','Main Contact')) patch['Main Contact']=person.name;
    if(!get(client,'clients','Email')&&person.email) patch.Email=person.email;
    if(!get(client,'clients','Phone')&&person.phone) patch.Phone=person.phone;
    await update('clients',client.id,patch);await verify('clients',client.id,patch);recordIds.push(client.id);
  }
  const relation={'Converted Client':[{id:client.id}],'Client Identity Reconciliation':{name:created?'New Client — sufficiently distinct':'Existing Client — exact/strong match'},'Client Identity Reconciliation Basis':`Submission ${e.submissionId}; business identity and contact route reconciled to ${client.id}. No decision authority or service authorization inferred.`};
  if(lead) {
    relation.Leads=addLink(intake,'intake','Leads',lead.id);
    const leadLinks={'Client Record':addLink(lead,'leads','Client Record',client.id),'Evidence Records':addLink(lead,'leads','Evidence Records',evidenceId)};
    await update('leads',lead.id,leadLinks);await verify('leads',lead.id,leadLinks);recordIds.push(lead.id);
  }
  await update('intake',intake.id,relation);await verify('intake',intake.id,relation);
  await verify('evidence',evidenceId,{'Clients':[{id:client.id}],'Client Intake':[{id:intake.id}]});
  return finish(issues.length?'exception':'done');
}
