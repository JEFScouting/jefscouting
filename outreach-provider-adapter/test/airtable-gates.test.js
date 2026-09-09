import assert from "node:assert/strict";
import test from "node:test";
import { AirtableOutreachGates, JEF_AIRTABLE } from "../src/airtable-gates.js";
import {
  GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY,
  ZERO_PROVIDER_RECOVERY_KIND
} from "../src/adapter.js";

const ids={activity:"recAAAAAAAAAAAAAA",lead:"recBBBBBBBBBBBBBB",campaign:"reclIlbWpaTcMrc18",command:"recpYdDfwJjrpUwyX"};
const payload={contractVersion:"outreach-v2",suppressionCleared:true,campaignId:"JEF-CAMPAIGN",leadId:"LEAD-1",messageVersion:"v4.1",sequenceStep:"FIRST-TOUCH",destination:"person@example.com",subject:"Subject",textBody:"Body",sequenceInstanceKey:"SEQ-1",sequenceVersionSnapshot:"SEQ-v1",templateVersionSnapshot:"v4.1",senderIdentitySnapshot:"hello@jefscouting.com",verifiedRecipient:"person@example.com",finalSubjectSnapshot:"Subject",finalBodySnapshot:"Body",priorContactSnapshot:"CLEAR",airtableActivityRecordId:ids.activity,airtableLeadRecordId:ids.lead,airtableCampaignRecordId:ids.campaign,airtableCommandRecordId:ids.command,runtimeMode:"production"};
const effectKey="OUTREACH-SEND|JEF-CAMPAIGN|LEAD-1|v4.1|FIRST-TOUCH";
const followUpPayload={...payload,messageVersion:"FOLLOW-UP-ADAPTIVE-v1.0",sequenceStep:"FOLLOW-UP-1",sequenceInstanceKey:"SEQ-FU-1",sequenceVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",templateVersionSnapshot:"FOLLOW-UP-ADAPTIVE-v1.0",gmailThreadId:"thread-1",priorRfcMessageId:"<prior@example.com>"};
const followUpEffectKey="OUTREACH-SEND|JEF-CAMPAIGN|LEAD-1|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const recoveryPayload={...followUpPayload,campaignId:"JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY",leadId:"LEAD-ANCHOR-20260819-001",sequenceInstanceKey:"OUTREACH-SEQUENCE|LEAD-ANCHOR-20260819-001|GMAIL-THREAD|1a0193666357e1f4",destination:"info@motek.com",verifiedRecipient:"info@motek.com",gmailThreadId:"1a0193666357e1f4",runtimeMode:"zero-send"};
const recoveryAuthority={kind:ZERO_PROVIDER_RECOVERY_KIND,effectKey:GOVERNED_ZERO_PROVIDER_RECOVERY_EFFECT_KEY};
const recoveryClaimToken="11111111-1111-4111-8111-111111111111";
const recoveryClaimant="codex-motek-canary";
const F=JEF_AIRTABLE.fields;
function records({paused=false,suppression=[],requestPayload=payload,requestEffectKey=effectKey,recovery=false}={}) { const followUp=requestPayload.sequenceStep==="FOLLOW-UP-1"; const activityFields={
  [F.activity.lead]:[ids.lead],[F.activity.campaign]:[ids.campaign],[F.activity.effectKey]:requestEffectKey,
  [F.activity.state]:recovery?"RECONCILED":"READY",
  [F.activity.contractGate]:recovery?"NO-OP — EFFECT EXISTS":"PASS — EFFECT READY",
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
return {
  [ids.activity]:{id:ids.activity,fields:activityFields},
  [ids.lead]:{id:ids.lead,fields:{[F.lead.id]:requestPayload.leadId,[F.lead.recipient]:requestPayload.destination,[F.lead.dnc]:false,[F.lead.suppressionRecords]:suppression,[F.lead.suppressionStatus]:"Clear",[F.lead.admission]:followUp?"HOLD":"READY",[F.lead.admissionGate]:followUp?"HOLD — V2 ADMISSION NOT READY":"PASS — CONCATENATION CANDIDATE",[F.lead.followUpAdmission]:followUp?"READY":"HOLD",[F.lead.followUpGate]:followUp?"PASS — FOLLOW-UP CONCATENATION CANDIDATE":"HOLD",[F.lead.responsePriority]:followUp?"P4 — DUE FOLLOW-UP":"P5 — NEW FIRST TOUCH",[F.lead.nextAction]:followUp?"FOLLOW_UP":"FIRST_TOUCH",[F.lead.campaigns]:[ids.campaign]}},
  [ids.campaign]:{id:ids.campaign,fields:{[F.campaign.id]:requestPayload.campaignId,[F.campaign.status]:paused?"Paused":"Running",[F.campaign.runtime]:"Running",[F.campaign.circuit]:"Healthy",[F.campaign.runtimeGate]:"READY — V2 AUTONOMOUS RUNTIME",[F.campaign.engineVersion]:"OUTREACH-v2",[F.campaign.commands]:[ids.command]}},
  [ids.command]:{id:ids.command,fields:{[F.command.id]:"CMD-1",[F.command.state]:"In Progress",[F.command.approval]:"Approved",[F.command.gate]:"Approved",[F.command.integrity]:"READY",[F.command.health]:"ACTIVE",[F.command.campaigns]:[ids.campaign]}}
}; }
function gate(dataset){return new AirtableOutreachGates({client:{async getRecord(_table,id){if(!dataset[id]) throw new Error("missing"); return structuredClone(dataset[id]);}},commandRecordId:ids.command,campaignRecordId:ids.campaign,correlationDomain:"jefscouting.com"});}

test("exact canonical IDs and all current gates authorize",async()=>{const binding=await gate(records()).readCurrent({payload,effectKey});assert.equal(binding.decision,"AUTHORIZED");assert.equal((await gate(records()).revalidate({payload,effectKey,payloadFingerprint:binding.payloadFingerprint})).suppressionCleared,true);});
test("FOLLOW-UP-1 uses the current Follow-Up admission gates without accepting First-Touch admission",async()=>{const data=records({requestPayload:followUpPayload,requestEffectKey:followUpEffectKey});const binding=await gate(data).readCurrent({payload:followUpPayload,effectKey:followUpEffectKey});assert.equal(binding.decision,"AUTHORIZED");data[ids.lead].fields[F.lead.followUpGate]="HOLD";assert.equal((await gate(data).readCurrent({payload:followUpPayload,effectKey:followUpEffectKey})).decision,"HOLD");});
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
test("paused Campaign fails closed",async()=>assert.equal((await gate(records({paused:true})).readCurrent({payload,effectKey})).decision,"HOLD"));
test("active linked suppression fails closed",async()=>{const suppressionId="recSSSSSSSSSSSSSS";const data=records({suppression:[suppressionId]});data[suppressionId]={id:suppressionId,fields:{[F.suppression.status]:"Active",[F.suppression.integrity]:"PASS"}};const binding=await gate(data).readCurrent({payload,effectKey});assert.equal(binding.decision,"AUTHORIZED");assert.equal((await gate(data).revalidate({payload,effectKey,payloadFingerprint:binding.payloadFingerprint})).suppressionCleared,false);});
test("pinned authority IDs cannot be redirected",async()=>{const bad={...payload,airtableCommandRecordId:"recEEEEEEEEEEEEEE"};await assert.rejects(gate(records()).readCurrent({payload:bad,effectKey}),/PINNED_AUTHORITY_RECORD_MISMATCH/);});
