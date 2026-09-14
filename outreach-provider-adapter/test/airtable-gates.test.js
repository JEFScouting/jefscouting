import assert from "node:assert/strict";
import test from "node:test";
import { AirtableOutreachGates, AirtableReadOnlyClient, JEF_AIRTABLE } from "../src/airtable-gates.js";
import {
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID,
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_ID,
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_SHA256,
  GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY,
  GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,
  LEGACY_ZERO_PROVIDER_IMPORT_KIND,
  ZERO_PROVIDER_RECOVERY_KIND
} from "../src/adapter.js";

const ids={activity:"recAAAAAAAAAAAAAA",lead:"recBBBBBBBBBBBBBB",campaign:"reclIlbWpaTcMrc18",command:"recpYdDfwJjrpUwyX"};
const payload={contractVersion:"outreach-v2",suppressionCleared:true,campaignId:"JEF-CAMPAIGN",leadId:"LEAD-1",messageVersion:"v4.1",sequenceStep:"FIRST-TOUCH",destination:"person@example.com",subject:"Subject",textBody:"Body",sequenceInstanceKey:"SEQ-1",sequenceVersionSnapshot:"SEQ-v1",templateVersionSnapshot:"v4.1",senderIdentitySnapshot:"hello@jefscouting.com",verifiedRecipient:"person@example.com",finalSubjectSnapshot:"Subject",finalBodySnapshot:"Body",priorContactSnapshot:"CLEAR",airtableActivityRecordId:ids.activity,airtableLeadRecordId:ids.lead,airtableCampaignRecordId:ids.campaign,airtableCommandRecordId:ids.command,runtimeMode:"production"};
const effectKey="OUTREACH-SEND|JEF-CAMPAIGN|LEAD-1|v4.1|FIRST-TOUCH";
const followUpPayload={...payload,messageVersion:"FOLLOW-UP-ADAPTIVE-v1.0",sequenceStep:"FOLLOW-UP-1",sequenceInstanceKey:"SEQ-FU-1",sequenceVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",templateVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",gmailThreadId:"thread-1",priorRfcMessageId:"<prior@example.com>"};
const manualFollowUpPayload={...followUpPayload,runtimeMode:"manual"};
const followUpEffectKey="OUTREACH-SEND|JEF-CAMPAIGN|LEAD-1|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const recoveryPayload={...followUpPayload,campaignId:"JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY",leadId:"LEAD-ANCHOR-20260819-001",sequenceInstanceKey:"OUTREACH-SEQUENCE|LEAD-ANCHOR-20260819-001|GMAIL-THREAD|1a0193666357e1f4",destination:"info@motek.com",verifiedRecipient:"info@motek.com",gmailThreadId:"1a0193666357e1f4",runtimeMode:"zero-send"};
const recoveryAuthority={kind:ZERO_PROVIDER_RECOVERY_KIND,effectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY};
const recoveryClaimToken="11111111-1111-4111-8111-111111111111";
const recoveryClaimant="codex-motek-canary";
const legacyEvidenceText="2026-09-10 controlled execution attempt. Preflight re-read PASS: recipient info@motek.com; Effect State READY; Execution Gate PASS — EFFECT READY; Claim Gate READY — CLAIM AVAILABLE; Payload Gate PASS — CORE PAYLOAD FROZEN; prior-contact and suppression snapshots CLEAR; Gmail thread 1a0193666357e1f4 contained original SENT + one pre-existing DRAFT, no inbound human reply and no sent follow-up. Activity was claimed in Airtable before provider boundary. Direct Gmail fallback then returned `Failed to build message payload`; fresh Gmail readback confirmed no new SENT message. Provider invocation count observed: 0. Duplicate count: 0. No retry performed, per hard ceiling. Airtable terminalized FAILED. Neon was not invoked/reconciled because the authenticated Netlify POST runtime is not callable through the currently connected Netlify action surface from this chat.";
const legacyComments=[{id:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_ID,createdTime:"2026-09-11T00:18:10.000Z",lastUpdatedTime:null,author:{id:"usrSgISx4ipspMOlC",email:"jefscouting@gmail.com"},text:legacyEvidenceText}];
const legacyImportPayload=Object.freeze({...recoveryPayload,messageVersion:"FOLLOW-UP-ADAPTIVE-v1.1",sequenceVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.1",templateVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.1",airtableActivityRecordId:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID,runtimeMode:"manual"});
const legacyImportAuthority=Object.freeze({kind:LEGACY_ZERO_PROVIDER_IMPORT_KIND,effectKey:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY,activityRecordId:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID,evidenceCommentId:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_ID,evidenceCommentSha256:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_COMMENT_SHA256,historicalClaimExistence:"VERIFIED",historicalClaimIdentity:"UNAVAILABLE",providerInvocationCount:0,gmailSentCount:0,sameClaimPreserved:false});
const F=JEF_AIRTABLE.fields;
function records({paused=false,suppression=[],requestPayload=payload,requestEffectKey=effectKey,recovery=false,legacyImport=false}={}) { const followUp=requestPayload.sequenceStep==="FOLLOW-UP-1"; const activityId=requestPayload.airtableActivityRecordId; const activityFields={
  [F.activity.lead]:[ids.lead],[F.activity.campaign]:[ids.campaign],[F.activity.effectKey]:requestEffectKey,
  [F.activity.state]:recovery?"RECONCILED":legacyImport?"FAILED":"READY",
  [F.activity.contractGate]:recovery?"NO-OP — EFFECT EXISTS":legacyImport?"HOLD — EFFECT NOT READY":"PASS — EFFECT READY",
  [F.activity.payloadGate]:"PASS — CORE PAYLOAD FROZEN",[F.activity.recipient]:requestPayload.destination,
  [F.activity.prior]:"CLEAR",[F.activity.suppression]:"CLEAR",[F.activity.sequenceInstance]:requestPayload.sequenceInstanceKey,
  [F.activity.sequenceVersion]:requestPayload.sequenceVersionSnapshot,[F.activity.templateVersion]:requestPayload.templateVersionSnapshot,
  [F.activity.subject]:requestPayload.subject,[F.activity.body]:requestPayload.textBody,[F.activity.sender]:requestPayload.senderIdentitySnapshot
};
if(recovery) Object.assign(activityFields,{
  [F.activity.runtimeStatus]:"Reconciled",[F.activity.attemptCount]:0,[F.activity.reconciledAt]:"2026-09-09T08:19:14.204Z",
  [F.activity.providerGate]:"NO-OP — CLOSED NO PROVIDER EFFECT",[F.activity.reconciliationResult]:"CLOSED_NO_PROVIDER_EFFECT",
  [F.activity.claimToken]:recoveryClaimToken,[F.activity.claimedAt]:"2026-09-09T06:07:26.457Z",
  [F.activity.claimant]:recoveryClaimant,[F.activity.claimGate]:"SEALED — CLAIM PRESERVED"
});
if(legacyImport) Object.assign(activityFields,{
  [F.activity.runtimeStatus]:"Failed",[F.activity.attemptCount]:0,
  [F.activity.providerGate]:"HOLD — FAILURE; MANUAL RECONCILIATION REQUIRED",
  [F.activity.claimGate]:"HOLD — EXECUTION STATE WITHOUT CLAIM"
});
return {
  [activityId]:{id:activityId,fields:activityFields},
  [ids.lead]:{id:ids.lead,fields:{[F.lead.id]:requestPayload.leadId,[F.lead.recipient]:requestPayload.destination,[F.lead.dnc]:false,[F.lead.suppressionRecords]:suppression,[F.lead.suppressionStatus]:"Clear",[F.lead.admission]:followUp?"HOLD":"READY",[F.lead.admissionGate]:followUp?"HOLD — V2 ADMISSION NOT READY":"PASS — CONCATENATION CANDIDATE",[F.lead.followUpAdmission]:followUp?"READY":"HOLD",[F.lead.followUpGate]:followUp?"PASS — FOLLOW-UP CONCATENATION CANDIDATE":"HOLD",[F.lead.responsePriority]:followUp?"P4 — DUE FOLLOW-UP":"P5 — NEW FIRST TOUCH",[F.lead.nextAction]:followUp?"FOLLOW_UP":"FIRST_TOUCH",[F.lead.campaigns]:[ids.campaign]}},
  [ids.campaign]:{id:ids.campaign,fields:{[F.campaign.id]:requestPayload.campaignId,[F.campaign.status]:paused?"Paused":"Running",[F.campaign.runtime]:"Running",[F.campaign.circuit]:"Healthy",[F.campaign.runtimeGate]:"READY — V2 AUTONOMOUS RUNTIME",[F.campaign.engineVersion]:"OUTREACH-v2",[F.campaign.commands]:[ids.command]}},
  [ids.command]:{id:ids.command,fields:{[F.command.id]:"CMD-1",[F.command.state]:"In Progress",[F.command.approval]:"Approved",[F.command.gate]:"Approved",[F.command.integrity]:"READY",[F.command.health]:"ACTIVE",[F.command.campaigns]:[ids.campaign]}}
}; }
function gate(dataset,{comments=legacyComments,commentReads}={}){return new AirtableOutreachGates({client:{async getRecord(_table,id){if(!dataset[id]) throw new Error("missing"); return structuredClone(dataset[id]);},async getRecordComments(){if(commentReads) commentReads.count+=1;return structuredClone(comments);}},commandRecordId:ids.command,campaignRecordId:ids.campaign,correlationDomain:"jefscouting.com"});}

test("read-only client fetches exact Activity comments and rejects incomplete pagination",async()=>{
  const calls=[];
  const client=new AirtableReadOnlyClient({token:"test-read-token",fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json({comments:legacyComments});}});
  assert.deepEqual(await client.getRecordComments(JEF_AIRTABLE.tables.activity,GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID),legacyComments);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,new RegExp(`${JEF_AIRTABLE.tables.activity}/${GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID}/comments\\?pageSize=100$`));
  assert.equal(calls[0].init.method,"GET");
  const paged=new AirtableReadOnlyClient({token:"test-read-token",fetchImpl:async()=>Response.json({comments:legacyComments,offset:"next"})});
  await assert.rejects(paged.getRecordComments(JEF_AIRTABLE.tables.activity,GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID),/AIRTABLE_COMMENT_EVIDENCE_INCOMPLETE/);
});

test("exact canonical IDs and all current gates authorize",async()=>{const binding=await gate(records()).readCurrent({payload,effectKey});assert.equal(binding.decision,"AUTHORIZED");assert.equal((await gate(records()).revalidate({payload,effectKey,payloadFingerprint:binding.payloadFingerprint})).suppressionCleared,true);});
test("FOLLOW-UP-1 uses the current Follow-Up admission gates without accepting First-Touch admission",async()=>{const data=records({requestPayload:followUpPayload,requestEffectKey:followUpEffectKey});const binding=await gate(data).readCurrent({payload:followUpPayload,effectKey:followUpEffectKey});assert.equal(binding.decision,"AUTHORIZED");data[ids.lead].fields[F.lead.followUpGate]="HOLD";assert.equal((await gate(data).readCurrent({payload:followUpPayload,effectKey:followUpEffectKey})).decision,"HOLD");});
test("manual Follow-Up uses Campaign as its single execution switch while legacy Runtime/Circuit remain diagnostic",async()=>{
  const data=records({requestPayload:manualFollowUpPayload,requestEffectKey:followUpEffectKey});
  data[ids.campaign].fields[F.campaign.runtime]="Paused";
  data[ids.campaign].fields[F.campaign.circuit]="Paused";
  data[ids.campaign].fields[F.campaign.runtimeGate]="HOLD — V2 PAUSED";
  data[ids.command].fields[F.command.state]="Completed";
  data[ids.command].fields[F.command.gate]="HOLD";
  data[ids.command].fields[F.command.health]="INACTIVE";
  const binding=await gate(data).readCurrent({payload:manualFollowUpPayload,effectKey:followUpEffectKey});
  assert.equal(binding.decision,"AUTHORIZED");
  assert.equal(binding.controls.execution,"ACTIVE");
  assert.equal(binding.controls.runtime,"HOLD");
  assert.equal(binding.controls.circuit,"HOLD");
  data[ids.campaign].fields[F.campaign.status]="Paused";
  assert.equal((await gate(data).readCurrent({payload:manualFollowUpPayload,effectKey:followUpEffectKey})).decision,"HOLD");
});
test("Motek recovery requires every closed-zero-provider Airtable control",async()=>{
  const data=records({requestPayload:recoveryPayload,requestEffectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,recovery:true});
  const request={payload:recoveryPayload,effectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,claimToken:recoveryClaimToken,claimantId:recoveryClaimant,recoveryAuthority};
  const binding=await gate(data).readCurrent(request);
  assert.equal(binding.decision,"AUTHORIZED");
  assert.equal(binding.recoveryKind,ZERO_PROVIDER_RECOVERY_KIND);
  assert.equal((await gate(data).revalidate({...request,payloadFingerprint:binding.payloadFingerprint})).suppressionCleared,true);
});
test("provider-possible, unknown, accepted, failed, mismatched-claim and unclassified terminals cannot use recovery",async()=>{
  const mutations=[
    (a)=>{a[F.activity.attemptCount]=1;},
    (a)=>{a[F.activity.providerMessageId]="gmail-provider-id";},
    (a)=>{a[F.activity.reconciliationResult]="RECONCILED_FOUND";},
    (a)=>{a[F.activity.state]="UNKNOWN_HOLD";},
    (a)=>{a[F.activity.state]="ACCEPTED";},
    (a)=>{a[F.activity.state]="FAILED";a[F.activity.runtimeStatus]="Failed";a[F.activity.attemptCount]=1;},
    (a)=>{delete a[F.activity.reconciliationResult];},
    (a)=>{a[F.activity.claimToken]="22222222-2222-4222-8222-222222222222";},
    (a)=>{a[F.activity.providerGate]="HOLD — RECONCILIATION EVIDENCE INCOMPLETE";}
  ];
  for(const mutate of mutations){
    const data=records({requestPayload:recoveryPayload,requestEffectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,recovery:true});
    mutate(data[ids.activity].fields);
    const binding=await gate(data).readCurrent({payload:recoveryPayload,effectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,claimToken:recoveryClaimToken,claimantId:recoveryClaimant,recoveryAuthority});
    assert.equal(binding.decision,"HOLD");
  }
});
test("reconciled Motek is not recoverable without the exact internal recovery capability",async()=>{
  const data=records({requestPayload:recoveryPayload,requestEffectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,recovery:true});
  const without=await gate(data).readCurrent({payload:recoveryPayload,effectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,claimToken:recoveryClaimToken,claimantId:recoveryClaimant});
  assert.equal(without.decision,"HOLD");
  await assert.rejects(gate(data).readCurrent({payload:recoveryPayload,effectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,claimToken:recoveryClaimToken,claimantId:recoveryClaimant,recoveryAuthority:{...recoveryAuthority,extra:"forbidden"}}),/ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID/);
});
test("exact v1.1 legacy import requires failed Airtable state and immutable historical evidence",async()=>{
  const data=records({requestPayload:legacyImportPayload,requestEffectKey:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY,legacyImport:true});
  data[ids.campaign].fields[F.campaign.runtime]="Paused";
  data[ids.campaign].fields[F.campaign.circuit]="Paused";
  data[ids.campaign].fields[F.campaign.runtimeGate]="HOLD — V2 PAUSED";
  const request={payload:legacyImportPayload,effectKey:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY,claimToken:"55555555-5555-4555-8555-555555555555",claimantId:"fresh-recovery-worker",recoveryAuthority:legacyImportAuthority};
  const binding=await gate(data).readCurrent(request);
  assert.equal(binding.decision,"AUTHORIZED");
  assert.equal(binding.recoveryKind,LEGACY_ZERO_PROVIDER_IMPORT_KIND);
  assert.equal(binding.recoveryEvidence.historicalClaimExistence,"VERIFIED");
  assert.equal(binding.recoveryEvidence.historicalClaimIdentity,"UNAVAILABLE");
  assert.equal(binding.recoveryEvidence.sameClaimPreserved,false);
  assert.equal(binding.controls.runtime,"HOLD");
  assert.equal(binding.controls.circuit,"HOLD");
  assert.equal((await gate(data).revalidate({...request,payloadFingerprint:binding.payloadFingerprint})).suppressionCleared,true);
});
test("legacy import fails closed for missing evidence, provider possibility, or invented historical claim",async()=>{
  const base=()=>records({requestPayload:legacyImportPayload,requestEffectKey:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY,legacyImport:true});
  const request={payload:legacyImportPayload,effectKey:GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_EFFECT_KEY,claimToken:"55555555-5555-4555-8555-555555555555",claimantId:"fresh-recovery-worker",recoveryAuthority:legacyImportAuthority};
  const scenarios=[
    {mutate:(data)=>{data[GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID].fields[F.activity.attemptCount]=1;}},
    {mutate:(data)=>{data[GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID].fields[F.activity.providerMessageId]="gmail-provider-id";}},
    {mutate:(data)=>{data[GOVERNED_LEGACY_ZERO_PROVIDER_IMPORT_ACTIVITY_ID].fields[F.activity.claimToken]="44444444-4444-4444-8444-444444444444";}},
    {comments:[]},
    {comments:[{...legacyComments[0],text:`${legacyEvidenceText} altered`}]},
    {comments:[{...legacyComments[0],author:{...legacyComments[0].author,id:"usrWrongAuthor000"}}]},
    {comments:[{...legacyComments[0],lastUpdatedTime:"2026-09-12T00:00:00.000Z"}]}
  ];
  for(const scenario of scenarios){
    const data=base();
    scenario.mutate?.(data);
    assert.equal((await gate(data,{comments:scenario.comments??legacyComments}).readCurrent(request)).decision,"HOLD");
  }
});
test("ordinary effects never read exceptional comment evidence",async()=>{
  const commentReads={count:0};
  assert.equal((await gate(records(),{commentReads}).readCurrent({payload,effectKey})).decision,"AUTHORIZED");
  assert.equal(commentReads.count,0);
  await assert.rejects(gate(records(),{commentReads}).readCurrent({payload,effectKey,recoveryAuthority:legacyImportAuthority}),/ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID/);
  assert.equal(commentReads.count,0);
});
test("paused Campaign fails closed",async()=>assert.equal((await gate(records({paused:true})).readCurrent({payload,effectKey})).decision,"HOLD"));
test("active linked suppression fails closed",async()=>{const suppressionId="recSSSSSSSSSSSSSS";const data=records({suppression:[suppressionId]});data[suppressionId]={id:suppressionId,fields:{[F.suppression.status]:"Active",[F.suppression.integrity]:"PASS"}};const binding=await gate(data).readCurrent({payload,effectKey});assert.equal(binding.decision,"AUTHORIZED");assert.equal((await gate(data).revalidate({payload,effectKey,payloadFingerprint:binding.payloadFingerprint})).suppressionCleared,false);});
test("pinned authority IDs cannot be redirected",async()=>{const bad={...payload,airtableCommandRecordId:"recEEEEEEEEEEEEEE"};await assert.rejects(gate(records()).readCurrent({payload:bad,effectKey}),/PINNED_AUTHORITY_RECORD_MISMATCH/);});
