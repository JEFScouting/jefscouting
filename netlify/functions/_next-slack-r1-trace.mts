const NEXT_BASE_ID = "appBUnJ5tQSKXAoA2";
const NEXT_RUNTIME_RUNS_TABLE = "tblNe1vDlPjcSDEDC";
const NEXT_EVENTS_TABLE = "tblcDIssO3HoqsxuZ";
const JEF_BASE_ID = "appveHEw1HrXr8nD1";
const JEF_EVIDENCE_TABLE = "tblmeZC1GiM0R6VhK";
const TENANT_ID = "TEN-JEF-PROD";
const WORKFLOW_ID = "ENG-NEXT-RUNTIME-ADAPTER-LAYER";
const WORKFLOW_VERSION = "SLACK-R1-A0-v1.0";
const ADAPTER_ID = "ADP-NEXT-SLACK-01";
const PR_URL = "https://github.com/JEFScouting/jefscouting/pull/29";

type TraceStart = {
  runtimeRunId: string;
  envelopeId: string;
  effectKey: string;
  commandId: string;
  releaseId: string;
  operation: "PRECHECK" | "READ_CANARY";
  bindingId: string;
  resourceId: string;
  deployId: string | null;
  siteId: string;
  inputHash: string;
  startedAt: string;
};

type TraceFinish = TraceStart & {
  outcome: string;
  terminalStatus: "Succeeded" | "Failed" | "Blocked";
  outputHash: string;
  completedAt: string;
  providerCalls: number;
  providerWrites: number;
  contentReads: number;
  providerNativeEffectId?: string | null;
  evidenceMetadata?: Record<string, unknown>;
};

type AirtableRecord = { id: string; fields?: Record<string, unknown> };

type AirtableResponse = {
  records?: AirtableRecord[];
  error?: { type?: string; message?: string };
};

function apiUrl(baseId: string, tableId: string, query = "") {
  return `https://api.airtable.com/v0/${baseId}/${tableId}${query}`;
}

function safeTraceFetch(): typeof fetch {
  const hook = (globalThis as any).__NEXT_SLACK_R1_TRACE_FETCH;
  return typeof hook === "function" ? hook : fetch;
}

async function airtableRequest(
  token: string,
  baseId: string,
  tableId: string,
  init: RequestInit,
  query = "",
): Promise<AirtableResponse> {
  const response = await safeTraceFetch()(apiUrl(baseId, tableId, query), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as AirtableResponse;
  if (!response.ok) {
    const errorType = payload.error?.type ?? `HTTP_${response.status}`;
    throw new Error(`AIRTABLE_${errorType}`);
  }
  return payload;
}

function escapeFormula(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findRuntimeRun(token: string, runtimeRunId: string) {
  const formula = encodeURIComponent(`{Run ID}='${escapeFormula(runtimeRunId)}'`);
  const payload = await airtableRequest(
    token,
    NEXT_BASE_ID,
    NEXT_RUNTIME_RUNS_TABLE,
    { method: "GET" },
    `?maxRecords=1&filterByFormula=${formula}`,
  );
  return payload.records?.[0] ?? null;
}

function traceNotes(input: TraceStart, lifecycle: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    lifecycle,
    tenant_id: TENANT_ID,
    envelope_id: input.envelopeId,
    effect_key: input.effectKey,
    release_id: input.releaseId,
    adapter_id: ADAPTER_ID,
    binding_id: input.bindingId,
    operation: input.operation,
    resource_id: input.resourceId,
    deploy_id: input.deployId,
    site_id: input.siteId,
    ...extra,
  });
}

export async function beginCanonicalTrace(token: string, input: TraceStart) {
  const existing = await findRuntimeRun(token, input.runtimeRunId);
  if (existing) {
    return { ok: false as const, code: "RUNTIME_RUN_ID_REPLAY", recordId: existing.id };
  }

  const payload = await airtableRequest(
    token,
    NEXT_BASE_ID,
    NEXT_RUNTIME_RUNS_TABLE,
    {
      method: "POST",
      body: JSON.stringify({
        records: [
          {
            fields: {
              "Run ID": input.runtimeRunId,
              "Tenant ID": TENANT_ID,
              "Workflow ID": WORKFLOW_ID,
              "Workflow Version": WORKFLOW_VERSION,
              "Command ID": input.commandId,
              "Run Type": "Execute",
              "Status": "Running",
              "Input Hash": input.inputHash,
              "Attempt Number": 1,
              "Idempotency Key": input.effectKey,
              "Started At": input.startedAt,
              Notes: traceNotes(input, "INVOCATION_STARTED", {
                provider_calls: 0,
                provider_writes: 0,
                content_reads: 0,
              }),
            },
          },
        ],
        typecast: false,
      }),
    },
  );
  const record = payload.records?.[0];
  if (!record?.id) throw new Error("AIRTABLE_RUNTIME_RUN_CREATE_NO_ID");
  return { ok: true as const, recordId: record.id };
}

export async function finishCanonicalTrace(
  token: string,
  runtimeRecordId: string,
  input: TraceFinish,
) {
  await airtableRequest(token, NEXT_BASE_ID, NEXT_RUNTIME_RUNS_TABLE, {
    method: "PATCH",
    body: JSON.stringify({
      records: [
        {
          id: runtimeRecordId,
          fields: {
            Status: input.terminalStatus,
            "Output Hash": input.outputHash,
            "Completed At": input.completedAt,
            Notes: traceNotes(input, input.outcome, {
              provider_calls: input.providerCalls,
              provider_writes: input.providerWrites,
              content_reads: input.contentReads,
              provider_native_effect_id: input.providerNativeEffectId ?? null,
            }),
          },
        },
      ],
      typecast: false,
    }),
  });

  const eventId = `EVT-${input.runtimeRunId}`;
  await airtableRequest(token, NEXT_BASE_ID, NEXT_EVENTS_TABLE, {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            "Event ID": eventId,
            "Tenant ID": TENANT_ID,
            "Event Type": `NEXT_SLACK_R1_${input.outcome}`,
            "Occurred At": input.completedAt,
            "Recorded At": input.completedAt,
            "Actor / Source": ADAPTER_ID,
            "Causation Command ID": input.commandId,
            "Correlation ID": input.effectKey,
            "Idempotency Key": `${input.effectKey}|${input.runtimeRunId}|EVENT`,
            "Schema Version": "NEXT-SLACK-R1-TRACE-v1.0",
            "Payload JSON": JSON.stringify({
              runtime_run_id: input.runtimeRunId,
              envelope_id: input.envelopeId,
              effect_key: input.effectKey,
              release_id: input.releaseId,
              binding_id: input.bindingId,
              operation: input.operation,
              resource_id: input.resourceId,
              provider_calls: input.providerCalls,
              provider_writes: input.providerWrites,
              content_reads: input.contentReads,
              provider_native_effect_id: input.providerNativeEffectId ?? null,
              evidence: input.evidenceMetadata ?? {},
            }),
            "Integrity Status": "Recorded",
          },
        },
      ],
      typecast: false,
    }),
  });

  const evidenceId = `EVD-${input.runtimeRunId}`;
  await airtableRequest(token, JEF_BASE_ID, JEF_EVIDENCE_TABLE, {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            "Evidence ID": evidenceId,
            "Evidence Type": "Runtime Proof",
            "Related Object": "NEXT v2 Implementation — CP04 Slack R1 Stable Workspace Identity Binding",
            "Related Object ID": input.runtimeRunId,
            "Evidence Date": input.completedAt,
            "File Link": PR_URL,
            Notes: JSON.stringify({
              runtime_run_id: input.runtimeRunId,
              event_id: eventId,
              envelope_id: input.envelopeId,
              effect_key: input.effectKey,
              command_id: input.commandId,
              release_id: input.releaseId,
              tenant_id: TENANT_ID,
              adapter_id: ADAPTER_ID,
              binding_id: input.bindingId,
              operation: input.operation,
              resource_id: input.resourceId,
              outcome: input.outcome,
              provider_calls: input.providerCalls,
              provider_writes: input.providerWrites,
              content_reads: input.contentReads,
              provider_native_effect_id: input.providerNativeEffectId ?? null,
              evidence: input.evidenceMetadata ?? {},
              raw_provider_content_stored: false,
              secrets_stored: false,
            }),
          },
        },
      ],
      typecast: false,
    }),
  });

  return { eventId, evidenceId };
}

export const TRACE_TENANT_ID = TENANT_ID;
