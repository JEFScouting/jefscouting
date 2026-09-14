const TARGET = "https://jef-outreach-next-runtime.netlify.app/.netlify/functions/outreach-airtable-gate-diagnostic";
const COMMAND_RECORD_ID = "recpYdDfwJjrpUwyX";
const CAMPAIGN_RECORD_ID = "reclIlbWpaTcMrc18";

const effectKey = "OUTREACH-SEND|JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY|LEAD-20260810-CHATEAU-ZZS|FOLLOW-UP-ADAPTIVE-v1.0|FOLLOW-UP-1";
const finalBodySnapshot = `Hello Chateau ZZ's team,

I wanted to follow up on my previous note about keeping JEF Scouting available as a supplemental hospitality staffing resource.

If an upcoming event, busy service period, call-out, or other defined coverage need comes up, we can start with the exact roles, schedule, and operating standards before matching screened hospitality professionals.

Would it be useful to keep JEF as a backup resource for an upcoming or future hospitality need?

Best,
Joaquín E. Forti
JEF Scouting
413 S Ocean Blvd Apt 4
Pompano Beach, FL 33062

If you’d prefer not to receive outreach from JEF Scouting, reply “opt out” and I’ll update our records.`;

const payload = Object.freeze({
  contractVersion: "outreach-v2",
  campaignId: "JEF-OUTREACH-V2-20260827-SOUTH-FLORIDA-DAILY",
  leadId: "LEAD-20260810-CHATEAU-ZZS",
  messageVersion: "FOLLOW-UP-ADAPTIVE-v1.0",
  sequenceStep: "FOLLOW-UP-1",
  destination: "reservations@chateauzzs.com",
  subject: "Following up — hospitality support for Chateau ZZ's",
  textBody: finalBodySnapshot,
  sequenceInstanceKey: "OUTREACH-SEQUENCE|LEAD-20260810-CHATEAU-ZZS|GMAIL-THREAD|19fedd7412a83fac",
  sequenceVersionSnapshot: "FOLLOW-UP-ADAPTIVE-v1.0",
  templateVersionSnapshot: "FOLLOW-UP-ADAPTIVE-v1.0",
  senderIdentitySnapshot: "JEF Scouting <jefscouting@gmail.com>",
  verifiedRecipient: "reservations@chateauzzs.com",
  finalSubjectSnapshot: "Following up — hospitality support for Chateau ZZ's",
  finalBodySnapshot,
  priorContactSnapshot: "CLEAR",
  suppressionCleared: true,
  airtableActivityRecordId: "recOJ6Z6RYeIwgyQL",
  airtableLeadRecordId: "recwTTa6IRwcrLbWA",
  airtableCampaignRecordId: CAMPAIGN_RECORD_ID,
  airtableCommandRecordId: COMMAND_RECORD_ID,
  runtimeMode: "zero-send",
});

export default async () => {
  const secret = Netlify.env.get("OUTREACH_RUNTIME_SHARED_SECRET") || "";
  const runtimeMode = Netlify.env.get("OUTREACH_RUNTIME_MODE") || "";
  const sendEnabled = String(Netlify.env.get("OUTREACH_SEND_ENABLED") || "").toLowerCase() === "true";
  const commandRecordId = Netlify.env.get("OUTREACH_AIRTABLE_COMMAND_RECORD_ID") || "";
  const campaignRecordId = Netlify.env.get("OUTREACH_AIRTABLE_CAMPAIGN_RECORD_ID") || "";

  if (!secret || runtimeMode !== "zero-send" || sendEnabled || commandRecordId !== COMMAND_RECORD_ID || campaignRecordId !== CAMPAIGN_RECORD_ID) {
    console.log(JSON.stringify({
      runner: "JEF-OUTREACH-AIRTABLE-DIAGNOSTIC-ONCE-v1.0.0",
      ok: false,
      error: "RUNNER_PRECONDITION_FAILED",
      runtime_mode: runtimeMode,
      send_enabled: sendEnabled,
      provider_send_called: false,
      provider_call_count: 0,
      mutation_performed: false,
    }));
    return;
  }

  const response = await fetch(TARGET, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-outreach-runtime-secret": secret,
    },
    body: JSON.stringify({ effect_key: effectKey, payload }),
  });
  const responseText = await response.text();
  let diagnosticResponse: unknown;
  try {
    diagnosticResponse = JSON.parse(responseText);
  } catch {
    diagnosticResponse = { ok: false, error: "NON_JSON_DIAGNOSTIC_RESPONSE", http_status: response.status };
  }

  const body = diagnosticResponse as Record<string, unknown>;
  console.log(JSON.stringify({
    runner: "JEF-OUTREACH-AIRTABLE-DIAGNOSTIC-ONCE-v1.0.0",
    http_status: response.status,
    runtime_mode: runtimeMode,
    send_enabled: sendEnabled,
    command_record_id: commandRecordId,
    campaign_record_id: campaignRecordId,
    command_readable: response.ok && body?.ok === true,
    campaign_readable: response.ok && body?.ok === true,
    execution_gate_read_current_succeeded: response.ok && body?.ok === true,
    safety_gate_revalidate_succeeded: response.ok && body?.ok === true,
    diagnostic_response: diagnosticResponse,
  }));
};

// Kept far from the current operating window. Netlify's provider-native “Run now”
// action is the only authorized invocation for this temporary diagnostic runner.
export const config = { schedule: "0 0 1 1 *" };
