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
  let issues=[...e.issues], recordIds=[], applied={}, readback={};
  const evidenceRows=await rows('evidence',['Evidence ID','Related Object ID','Notes','Candidates','Client Intake','Clients','Provenance Disposition']);
  const evidenceKey=`${e.qa?'TEST-':''}EVD-JOTFORM-${e.kind==='clientAgreement'?'CLIENT-AGREEMENT':e.kind==='representation'?'REPRESENTATION':e.lane.toUpperCase()}-${e.submissionId}-${e.version.slice(0,16)}`;
  let ev=evidenceRows.filter(r=>get(r,'evidence','Evidence ID')===evidenceKey);
  if(ev.length>1) throw new Error('DUPLICATE_SOURCE_EVIDENCE');
  const payload = status => ({ protocol:e.protocol, sourceKey:e.sourceKey, version:e.version, status, observedAt:e.receivedAt, snapshot:e.snapshot, issues:[...new Set(issues)], recordIds, applied, readback });
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
  if(e.kind==='clientAgreement') {
    if(e.lane!=='client'||e.formId!=='262220234744045') throw new Error('INVALID_CLIENT_AGREEMENT_CONTEXT');
    const a=e.clientAgreement;
    const exactId=v=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\s<>]/.test(v);
    const clientRows=await rows('clients',['NEXT Object ID','Client Name','Record Environment']);
    const intakeRows=await rows('intake',['Request ID','Converted Client','Record Environment']);
    // Both supplied IDs must resolve uniquely and the request's existing relation
    // must already point to that exact account. Names/contacts cannot repair IDs.
    const cm=clientRows.filter(r=>a?.clientId&&(r.id===a.clientId||get(r,'clients','NEXT Object ID')===a.clientId));
    const im=intakeRows.filter(r=>a?.intakeId&&(r.id===a.intakeId||get(r,'intake','Request ID')===a.intakeId));
    let client=cm.length===1?await fresh('clients',cm[0].id):null;
    let intake=im.length===1?await fresh('intake',im[0].id):null;
    const acknowledgment=a?.acknowledgment===true||a?.acknowledgment==='Yes'||a?.acknowledgment==='true';
    const providerDate=value=>{
      const d=typeof value==='object'&&value?`${value.year}-${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')}`:str(value);
      return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:null;
    };
    const signatureDate=providerDate(a?.signatureDate), effectiveDate=providerDate(a?.effectiveDate);
    const current=links(get(client,'clients','Current Agreement Evidence'));
    const status=choice(get(client,'clients','Commercial Agreement Status'));
    const agreementCollision=evidenceRows.some(r=>{
      try {
        const notes=get(r,'evidence','Notes');
        if(r.id===evidenceId||!str(notes).startsWith(machinePrefix)) return false;
        const prior=JSON.parse(notes.slice(machinePrefix.length));
        return prior.snapshot?.formId==='262220234744045'&&prior.snapshot?.answers?.['20']?.value===a?.agreementId&&
          prior.snapshot?.submissionId!==e.submissionId;
      } catch { return false; }
    });
    const invalid=issues.length>0||agreementCollision||!client||!intake||![a?.clientId,a?.intakeId,a?.agreementId].every(exactId)||
      a.formCode!=='JF-CL-AGR-01'||a.formVersion!=='AGR-JEF-2026-v0.3'||
      !acknowledgment||!/^https:\/\/[^\s]+$/.test(a.signature||'')||!signatureDate||!effectiveDate||
      signatureDate>e.receivedAt.slice(0,10)||!e.person.name||!e.person.email||!a.signerTitle||!a.printedNameTitle||
      !norm(e.client.business)||norm(e.client.business)!==norm(get(client,'clients','Client Name'))||
      (get(client,'clients','Record Environment')==='QA / Test')!==e.qa||
      (get(intake,'intake','Record Environment')==='QA / Test')!==e.qa||
      !['Production','Live',...(e.qa?['QA / Test','QA','Test']:[])].includes(a.environment)||
      stable(links(get(intake,'intake','Converted Client')))!==stable([client?.id])||
      !['Existing Client — exact/strong match','New Client — sufficiently distinct'].includes(choice(get(intake,'intake','Client Identity Reconciliation')))||
      ['Needs Review','Superseded','Terminated'].includes(status)||
      current.length>1||(current.length===1&&current[0]!==evidenceId)||
      (status==='Fully Signed'&&current[0]!==evidenceId)||
      ['Exception','Superseded','Not Required'].includes(choice(get(intake,'intake','Agreement Control Status')));
    if(invalid){issues.push('UNMATCHED_OR_UNVERIFIED_CLIENT_AGREEMENT');return finish('exception','CLIENT_AGREEMENT_REQUIRES_REVIEW');}
    const patch={'Commercial Agreement Status':{name:'Fully Signed'},'Current Agreement Evidence':[{id:evidenceId}],
      'Agreement Effective Date':effectiveDate,'Evidence Records':addLink(client,'clients','Evidence Records',evidenceId),
      'Agreement History Evidence':addLink(client,'clients','Agreement History Evidence',evidenceId)};
    await update('clients',client.id,patch);client=await verify('clients',client.id,patch);recordIds.push(client.id);
    // Re-read after account write and before advancing the request seam.
    intake=await fresh('intake',intake.id);client=await fresh('clients',client.id);
    if(stable(links(get(intake,'intake','Converted Client')))!==stable([client.id])||
      choice(get(client,'clients','Commercial Agreement Status'))!=='Fully Signed'||
      stable(links(get(client,'clients','Current Agreement Evidence')))!==stable([evidenceId])||
      ['Exception','Superseded','Not Required'].includes(choice(get(intake,'intake','Agreement Control Status')))) {
      issues.push('CLIENT_AGREEMENT_CHANGED_DURING_RECONCILIATION');return finish('exception');
    }
    const relation={'Agreement Control Status':{name:'Accepted / Current'},'Evidence Records':addLink(intake,'intake','Evidence Records',evidenceId)};
    await update('intake',intake.id,relation);intake=await verify('intake',intake.id,relation);recordIds.push(intake.id);
    await verify('evidence',evidenceId,{'Clients':[{id:client.id}],'Client Intake':[{id:intake.id}]});
    // Formula readback is recorded, never replaced by a signature-only PASS.
    intake=await fresh('intake',intake.id);
    client=await fresh('clients',client.id);
    if(choice(get(client,'clients','Commercial Agreement Status'))!=='Fully Signed'||
      stable(links(get(client,'clients','Current Agreement Evidence')))!==stable([evidenceId])||
      stable(links(get(intake,'intake','Converted Client')))!==stable([client.id])||
      choice(get(intake,'intake','Agreement Control Status'))!=='Accepted / Current') {
      issues.push('CLIENT_AGREEMENT_READBACK_CHANGED');return finish('exception');
    }
    for(const f of ['Record Environment','CLI-01A Source Identity Gate','CLI-02A Commercial Authority Gate',
      'CLI-01A Commercial / Service Authorization Gate','Client Readiness State','Client Readiness Blockers',
      'Service Authorization Decision','Proposal Control Status','Rate Card Control Status',
      'Agreement Control Status','Insurance / Compliance / Onboarding Control Status']) readback[f]=get(intake,'intake',f);
    const authorized=readback['Record Environment']==='Production / Live'&&readback['CLI-01A Commercial / Service Authorization Gate']==='PASS — SERVICE REQUEST AUTHORIZED / STOP BEFORE COVERAGE';
    return finish('done',authorized?'AGREEMENT_RECORDED_GATE_PASS_STOP_BEFORE_COVERAGE':'AGREEMENT_RECORDED_COMMERCIAL_GATE_HELD');
  }
  if(e.kind==='representation') {
    // The tracked public form binds to Object ID. Contacts never repair a broken ID.
    if(e.lane!=='candidate'||e.formId!=='261558428456063') throw new Error('INVALID_AGREEMENT_CONTEXT');
    const a=e.agreement;
    const all=await rows('candidates',['Object ID','Candidate','Email','Phone','Record Environment','Canonical Candidate Record','Population Reconciliation Disposition','Identity Reconciliation Status','Candidate Agreement Status','Evidence Records']);
    const matches=all.filter(r=>a?.candidateId&&get(r,'candidates','Object ID')===a.candidateId);
    let candidate=matches.length===1?await fresh('candidates',matches[0].id):null;
    const invalid=issues.length>0||!candidate||!a?.candidateId||a.candidateId!==a.candidateId.trim()||/[\s<>]/.test(a.candidateId)||
      !/^https:\/\//.test(a.signature||'')||a.formCode!=='JEF-CANDIDATE-REPRESENTATION-AGREEMENT'||a.formVersion!=='1.0'||
      (get(candidate,'candidates','Record Environment')==='QA / Test')!==e.qa||
      links(get(candidate,'candidates','Canonical Candidate Record')).length>0||
      /ARCHIVED|DUPLICATE|EXCEPTION/.test(choice(get(candidate,'candidates','Population Reconciliation Disposition')))||
      /Ambiguous|Exception/.test(choice(get(candidate,'candidates','Identity Reconciliation Status')))||
      choice(get(candidate,'candidates','Candidate Agreement Status'))==='Declined'||
      (e.person.name&&norm(e.person.name)!==norm(get(candidate,'candidates','Candidate')))||
      (e.person.email&&nonempty(get(candidate,'candidates','Email'))&&!emails(get(candidate,'candidates','Email')).includes(e.person.email))||
      (e.person.phone&&nonempty(get(candidate,'candidates','Phone'))&&phone(e.person.phone)!==phone(get(candidate,'candidates','Phone')));
    if(invalid){issues.push('UNMATCHED_AGREEMENT');return finish('exception','UNMATCHED_AGREEMENT');}
    const patch={'Evidence Records':addLink(candidate,'candidates','Evidence Records',evidenceId)};
    if(choice(get(candidate,'candidates','Candidate Agreement Status'))!=='Signed') patch['Candidate Agreement Status']={name:'Signed'};
    await update('candidates',candidate.id,patch);await verify('candidates',candidate.id,patch);
    recordIds.push(candidate.id);await verify('evidence',evidenceId,{'Candidates':[{id:candidate.id}]});
    return finish('done');
  }
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
      // Formatting an already matching phone number is deterministic. Different
      // punctuation/country-prefix formatting must not create Owner work.
      const samePhone=f==='Phone'&&phone(current)&&phone(current)===phone(v);
      if(!nonempty(current)||samePhone||stable(observed)===stable(incoming)||stable(observed)===stable(comparable(prior[f]))) {
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
