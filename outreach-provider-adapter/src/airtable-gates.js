import {
  FailClosedError,
  ZERO_PROVIDER_RECOVERY_KIND,
  canonicalPayloadFingerprint,
  isZeroProviderRecoveryAuthority
} from "./adapter.js";

export const JEF_AIRTABLE = Object.freeze({
  baseId: "appveHEw1HrXr8nD1",
  tables: Object.freeze({
    command: "tblxEpFOWLyUid82T",
    campaign: "tblx3DLlUn8HOX33X",
    lead: "tblaCk5tyADLKIuwv",
    activity: "tblSoO0HwlXCu4KWL",
    suppression: "tblQkt75eAQ7v66dH"
  }),
  fields: Object.freeze({
    command: Object.freeze({ id:"fldKxEQsTN94OmHdJ", state:"fldOnCmzw1mkSqCaK", approval:"fldNC296H0MkDBwd0", gate:"fldFOFnufX3Wk34HN", integrity:"fldkFkfVIFlurpB5u", health:"fldyzzZG9LaGeWt64", campaigns:"fldkpBKa6gjLOsIzQ" }),
    campaign: Object.freeze({ id:"fldzPi1HVA0AoOjD9", status:"fldh6Qy8jjs0q6O6K", runtime:"fldQ5sTHfdEisNpwn", circuit:"fldHhm4H0rSaXgiJk", runtimeGate:"fldFLWvsTmpmAyv4z", engineVersion:"fldFMGC3CVDbvHxQD", commands:"fldPVT2Wr7IFAviuQ" }),
    lead: Object.freeze({ id:"fldlDDtYe3AcX0QJO", recipient:"fldpRmzGTsF3gg3eB", dnc:"fldRbrGaDHNSICYdL", suppressionRecords:"fld1KPjcQmm1WSNHo", suppressionStatus:"fldb69wNMIukC5mix", emailStatus:"fldU2mjJAQ5SwzHT7", admission:"fldugOmymGBeJsRD5", admissionEvidence:"fldfKCGHJ9MqHmbly", admissionGate:"fldpidZBwOWjgDI4Q", followUpAdmission:"fldfcMMjFqfVGgyy5", followUpGate:"fldsmTEwa9WFsfhIb", responsePriority:"fld1Xn60Ml8g5sNcL", nextAction:"fldvbSUuEQ6DxcWyD", campaigns:"fldgbyNKk5prGiGaT" }),
    activity: Object.freeze({ lead:"fldBiZlNMKXE8sa0e", campaign:"fldTDKd5fl2DNmqDg", campaignId:"fldA95EJVk3Hk2Fla", state:"fldN6MwXRlcBaAlUT", recipient:"fld4JG1YJRy7QlcIu", prior:"fldKr1GLupKyRWjYd", suppression:"fldls1Vw4TIAmpZc4", contractGate:"fldRZKftkZDWUZQp6", payloadGate:"fldKXJ1Ag2GRbBzBS", effectKey:"fld8GwqyOUXvsMjNx", sequenceInstance:"fld9jL4f8xVnw6K11", sequenceVersion:"fld4FVFnKCmJ0UlEq", subject:"fldfJ3HO1dn02atAE", body:"fldKGtIalqPOILCRY", templateVersion:"fldQwXKI36a6a7k1v", sender:"fldAHahCW8zGUzAlT", runtimeStatus:"flddDapD8SJPciVjX", attemptCount:"fldY1CK7ICUi0bJAo", reconciledAt:"fldhKjHXBssXKNO4D", providerMessageId:"fld15JwDA9OK5m6VR", providerGate:"fldqXrtwIG5iv0Ebl", reconciliationResult:"fldUCsV3KRSMS5yvx", claimToken:"fldhb6AjhgQyfSPg9", claimedAt:"fld2OwrfPVVjHkV6l", claimant:"fldKbvF3LeIfRtIgi", claimGate:"fldhpVipuiPI2rEPP" }),
    suppression: Object.freeze({ status:"fldzChBn4GTkedQn4", integrity:"fld0FeJhqwornwuaA" })
  })
});

function select(value) { return typeof value === "object" && value && !Array.isArray(value) ? value.name : value; }
function scalar(value) { return Array.isArray(value) && value.length === 1 ? select(value[0]) : select(value); }
function links(value) { return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : item?.id).filter(Boolean) : []; }
function exactIds(value, expected) { const ids=links(value); return ids.length===1 && ids[0]===expected; }
function requireRecordId(value, name) { if (!/^rec[A-Za-z0-9]{14}$/.test(value || "")) throw new FailClosedError(`${name}_AIRTABLE_RECORD_ID_REQUIRED`); }

export class AirtableReadOnlyClient {
  constructor({ token, baseId = JEF_AIRTABLE.baseId, fetchImpl = fetch }) {
    if (!token) throw new FailClosedError("AIRTABLE_READONLY_TOKEN_REQUIRED");
    if (baseId !== JEF_AIRTABLE.baseId) throw new FailClosedError("CANONICAL_AIRTABLE_BASE_REQUIRED");
    this.token=token; this.baseId=baseId; this.fetchImpl=fetchImpl;
  }
  async getRecord(tableId, recordId) {
    if (!Object.values(JEF_AIRTABLE.tables).includes(tableId)) throw new FailClosedError("AIRTABLE_TABLE_NOT_ALLOWLISTED");
    requireRecordId(recordId, "EXACT");
    const url=`https://api.airtable.com/v0/${this.baseId}/${tableId}/${recordId}?returnFieldsByFieldId=true`;
    const response=await this.fetchImpl(url,{method:"GET",headers:{authorization:`Bearer ${this.token}`}});
    if (!response?.ok) throw new FailClosedError(`AIRTABLE_READ_FAILED_${response?.status ?? "UNKNOWN"}`);
    const body=await response.json();
    if (body?.id!==recordId || !body?.fields) throw new FailClosedError("AIRTABLE_RECORD_IDENTITY_MISMATCH");
    return body;
  }
}

export class AirtableOutreachGates {
  constructor({ client, commandRecordId, campaignRecordId, correlationDomain }) {
    if (!client) throw new FailClosedError("AIRTABLE_CLIENT_REQUIRED");
    requireRecordId(commandRecordId,"COMMAND"); requireRecordId(campaignRecordId,"CAMPAIGN");
    if (!correlationDomain || correlationDomain.endsWith(".invalid")) throw new FailClosedError("CORRELATION_DOMAIN_REQUIRED");
    this.client=client; this.commandRecordId=commandRecordId; this.campaignRecordId=campaignRecordId; this.correlationDomain=correlationDomain;
  }

  requireExactIds(payload) {
    for (const [name,value] of [["ACTIVITY",payload.airtableActivityRecordId],["LEAD",payload.airtableLeadRecordId],["CAMPAIGN",payload.airtableCampaignRecordId],["COMMAND",payload.airtableCommandRecordId]]) requireRecordId(value,name);
    if (payload.airtableCampaignRecordId!==this.campaignRecordId || payload.airtableCommandRecordId!==this.commandRecordId) throw new FailClosedError("PINNED_AUTHORITY_RECORD_MISMATCH");
  }

  async readSnapshot(payload) {
    this.requireExactIds(payload);
    const T=JEF_AIRTABLE.tables;
    const [activity,lead,campaign,command]=await Promise.all([
      this.client.getRecord(T.activity,payload.airtableActivityRecordId),
      this.client.getRecord(T.lead,payload.airtableLeadRecordId),
      this.client.getRecord(T.campaign,payload.airtableCampaignRecordId),
      this.client.getRecord(T.command,payload.airtableCommandRecordId)
    ]);
    return {activity,lead,campaign,command};
  }

  evaluate({ payload, effectKey, claimToken, claimantId, recoveryAuthority, snapshot }) {
    const F=JEF_AIRTABLE.fields, a=snapshot.activity.fields, l=snapshot.lead.fields, c=snapshot.campaign.fields, cmd=snapshot.command.fields;
    if (recoveryAuthority !== undefined && !isZeroProviderRecoveryAuthority(recoveryAuthority, {
      effectKey,
      sequenceStep: payload.sequenceStep,
      runtimeMode: payload.runtimeMode
    })) throw new FailClosedError("ZERO_PROVIDER_RECOVERY_AUTHORITY_INVALID");
    const recoveryRequested = recoveryAuthority !== undefined;
    const manualFollowUp = !recoveryRequested && payload.runtimeMode === "manual" && payload.sequenceStep === "FOLLOW-UP-1";
    const campaignActive = scalar(c[F.campaign.status]) === "Running";
    const runtimeActive = scalar(c[F.campaign.runtime]) === "Running";
    const circuitActive = scalar(c[F.campaign.circuit]) === "Healthy";
    const controls={adapterBuildEnabled:true,execution:manualFollowUp?(campaignActive?"ACTIVE":"HOLD"):(campaignActive&&runtimeActive&&circuitActive?"ACTIVE":"HOLD"),campaign:campaignActive?"ACTIVE":"HOLD",runtime:runtimeActive?"ACTIVE":"HOLD",circuit:circuitActive?"ACTIVE":"HOLD"};
    const leadAdmission = manualFollowUp ? [
      scalar(l[F.lead.followUpGate])==="PASS — FOLLOW-UP CONCATENATION CANDIDATE"
    ] : payload.sequenceStep === "FIRST-TOUCH" ? [
      scalar(l[F.lead.admission])==="READY",
      scalar(l[F.lead.admissionGate])==="PASS — CONCATENATION CANDIDATE",
      scalar(l[F.lead.responsePriority])==="P5 — NEW FIRST TOUCH",
      scalar(l[F.lead.nextAction])==="FIRST_TOUCH"
    ] : payload.sequenceStep === "FOLLOW-UP-1" ? [
      scalar(l[F.lead.followUpAdmission])==="READY",
      scalar(l[F.lead.followUpGate])==="PASS — FOLLOW-UP CONCATENATION CANDIDATE",
      scalar(l[F.lead.responsePriority])==="P4 — DUE FOLLOW-UP",
      scalar(l[F.lead.nextAction])==="FOLLOW_UP"
    ] : [false];
    const effectStateAuthority = recoveryRequested ? [
      scalar(a[F.activity.state])==="RECONCILED",
      scalar(a[F.activity.contractGate])==="NO-OP — EFFECT EXISTS",
      scalar(a[F.activity.runtimeStatus])==="Reconciled",
      Number(a[F.activity.attemptCount])===0,
      Boolean(a[F.activity.reconciledAt]),
      !scalar(a[F.activity.providerMessageId]),
      scalar(a[F.activity.reconciliationResult])==="CLOSED_NO_PROVIDER_EFFECT",
      scalar(a[F.activity.providerGate])==="NO-OP — CLOSED NO PROVIDER EFFECT",
      scalar(a[F.activity.claimToken])===claimToken,
      scalar(a[F.activity.claimant])===claimantId,
      Boolean(a[F.activity.claimedAt]),
      scalar(a[F.activity.claimGate])==="SEALED — CLAIM PRESERVED"
    ] : [
      scalar(a[F.activity.state])==="READY",
      scalar(a[F.activity.contractGate])==="PASS — EFFECT READY"
    ];
    const campaignAndCommandAuthority = manualFollowUp ? [
      scalar(cmd[F.command.approval])==="Approved",
      scalar(cmd[F.command.integrity])==="READY"
    ] : [
      scalar(c[F.campaign.runtimeGate])==="READY — V2 AUTONOMOUS RUNTIME",
      scalar(cmd[F.command.state])==="In Progress", scalar(cmd[F.command.approval])==="Approved",
      scalar(cmd[F.command.gate])==="Approved", scalar(cmd[F.command.integrity])==="READY", scalar(cmd[F.command.health])==="ACTIVE"
    ];
    const authority = [
      exactIds(a[F.activity.lead],payload.airtableLeadRecordId), exactIds(a[F.activity.campaign],payload.airtableCampaignRecordId),
      exactIds(l[F.lead.campaigns],payload.airtableCampaignRecordId), exactIds(c[F.campaign.commands],payload.airtableCommandRecordId),
      exactIds(cmd[F.command.campaigns],payload.airtableCampaignRecordId),
      scalar(a[F.activity.effectKey])===effectKey, ...effectStateAuthority,
      scalar(a[F.activity.payloadGate])==="PASS — CORE PAYLOAD FROZEN", scalar(a[F.activity.recipient])===payload.destination,
      scalar(a[F.activity.prior])==="CLEAR", scalar(a[F.activity.suppression])==="CLEAR",
      scalar(a[F.activity.sequenceInstance])===payload.sequenceInstanceKey, scalar(a[F.activity.sequenceVersion])===payload.sequenceVersionSnapshot,
      scalar(a[F.activity.templateVersion])===payload.templateVersionSnapshot, scalar(a[F.activity.subject])===payload.finalSubjectSnapshot,
      scalar(a[F.activity.body])===payload.finalBodySnapshot, scalar(a[F.activity.sender])===payload.senderIdentitySnapshot,
      scalar(l[F.lead.id])===payload.leadId, scalar(l[F.lead.recipient])===payload.destination, l[F.lead.dnc]!==true,
      scalar(l[F.lead.suppressionStatus])==="Clear", ...leadAdmission,
      scalar(c[F.campaign.id])===payload.campaignId, ...campaignAndCommandAuthority
    ];
    const decision=authority.every(Boolean)&&controls.execution==="ACTIVE"?"AUTHORIZED":"HOLD";
    return {decision,commandId:scalar(cmd[F.command.id])||"",releaseId:snapshot.campaign.id,authorityVersion:scalar(c[F.campaign.engineVersion])||"",effectKey,payloadFingerprint:canonicalPayloadFingerprint(payload),verifiedRecipient:scalar(a[F.activity.recipient])||"",senderIdentity:scalar(a[F.activity.sender])||"",correlationDomain:this.correlationDomain,controls,recoveryKind:recoveryRequested?ZERO_PROVIDER_RECOVERY_KIND:null};
  }

  async readCurrent({payload,effectKey,claimToken,claimantId,recoveryAuthority}) { return this.evaluate({payload,effectKey,claimToken,claimantId,recoveryAuthority,snapshot:await this.readSnapshot(payload)}); }

  async revalidate({payload,effectKey,claimToken,claimantId,payloadFingerprint,recoveryAuthority}) {
    if (payloadFingerprint!==canonicalPayloadFingerprint(payload)) throw new FailClosedError("SAFETY_PAYLOAD_FINGERPRINT_MISMATCH");
    const snapshot=await this.readSnapshot(payload);
    const binding=this.evaluate({payload,effectKey,claimToken,claimantId,recoveryAuthority,snapshot});
    const suppressionIds=links(snapshot.lead.fields[JEF_AIRTABLE.fields.lead.suppressionRecords]);
    const suppressions=await Promise.all(suppressionIds.map((id)=>this.client.getRecord(JEF_AIRTABLE.tables.suppression,id)));
    const registryClear=suppressions.every((r)=>scalar(r.fields[JEF_AIRTABLE.fields.suppression.status])==="Lifted" && scalar(r.fields[JEF_AIRTABLE.fields.suppression.integrity])==="PASS — SUPPRESSION LIFTED WITH TRACE");
    return {suppressionCleared:binding.decision==="AUTHORIZED"&&registryClear,responsePriorityClear:binding.decision==="AUTHORIZED"};
  }
}
