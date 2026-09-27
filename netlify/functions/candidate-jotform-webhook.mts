const EXPECTED_FORM_ID = "261480775333056";
const EXPECTED_FORM_CODE = "JEF-CANDIDATE-APPLICATION";
const EXPECTED_FORM_VERSION = "1.0";
const EXPECTED_ENVIRONMENT = "Production";
const EXPECTED_SOURCE_CHANNEL = "Jotform";
const ADAPTER_ID = "NETLIFY|jefscouting|candidate-jotform-webhook";

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function rawString(
  rawRequest: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = rawRequest[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function readValue(
  formData: FormData,
  rawRequest: Record<string, unknown>,
  formKeys: string[],
  rawKeys: string[] = formKeys,
): string {
  for (const key of formKeys) {
    const value = asString(formData.get(key));
    if (value) return value;
  }
  return rawString(rawRequest, ...rawKeys);
}

function timestampFromRaw(
  rawRequest: Record<string, unknown>,
  fallback: string,
): string | null {
  const submitDate = rawRequest.submitDate;
  if (typeof submitDate === "number" ||
      (typeof submitDate === "string" && /^\d+$/.test(submitDate))) {
    const milliseconds = Number(submitDate) * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback || null;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const formData = await req.formData();
    const rawValue = formData.get("rawRequest");
    let rawRequest: Record<string, unknown> = {};

    if (typeof rawValue === "string" && rawValue.trim()) {
      try {
        rawRequest = JSON.parse(rawValue) as Record<string, unknown>;
      } catch {
        return new Response("Invalid Jotform rawRequest", { status: 400 });
      }
    }

    const submissionId = readValue(
      formData,
      rawRequest,
      ["submissionID", "submission_id"],
      ["submission_id", "id"],
    );
    const providerFormId = readValue(
      formData,
      rawRequest,
      ["formID", "form_id"],
      ["formID", "form_id"],
    );

    if (!submissionId) {
      return new Response("Missing Jotform Submission ID", { status: 400 });
    }
    if (providerFormId !== EXPECTED_FORM_ID) {
      return new Response("Unexpected Jotform Form ID", { status: 400 });
    }

    const formCode = readValue(
      formData,
      rawRequest,
      ["formCode", "form_code", "Form Code"],
      ["formCode", "form_code", "Form Code"],
    );
    const formVersion = readValue(
      formData,
      rawRequest,
      ["formVersion", "form_version", "Form Version"],
      ["formVersion", "form_version", "Form Version"],
    );
    const environment = readValue(
      formData,
      rawRequest,
      ["environment", "Environment"],
      ["environment", "Environment"],
    );
    const sourceChannel = readValue(
      formData,
      rawRequest,
      ["sourceChannel", "source_channel", "Source Channel"],
      ["sourceChannel", "source_channel", "Source Channel"],
    );

    // Jotform webhook payloads can expose metadata at different levels.
    // Reject only an explicit conflict here; Airtable remains authoritative
    // for field-level reconciliation from the preserved rawRequest.
    if (formCode && formCode !== EXPECTED_FORM_CODE) {
      return new Response("Unexpected Candidate Form Code", { status: 400 });
    }
    if (formVersion && formVersion !== EXPECTED_FORM_VERSION) {
      return new Response("Unexpected Candidate Form Version", { status: 400 });
    }
    if (environment && environment !== EXPECTED_ENVIRONMENT) {
      return new Response("Unexpected Candidate Environment", { status: 400 });
    }
    if (sourceChannel && sourceChannel !== EXPECTED_SOURCE_CHANNEL) {
      return new Response("Unexpected Candidate Source Channel", { status: 400 });
    }

    const sourceTimestamp = readValue(
      formData,
      rawRequest,
      ["created_at", "createdAt"],
      ["created_at", "createdAt"],
    );
    const sourceEventKey = `CANDIDATESRC|Jotform|${submissionId}`;
    const updateId = `UPD-CAN-JF-${submissionId}`;
    const candidateObjectId = `CAN-JF-${submissionId}`;
    const commandId = `CMD-CANDIDATE-INTAKE-${submissionId}`;

    const airtableWebhook = Netlify.env.get(
      "AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL",
    );

    if (!airtableWebhook) {
      return new Response("Candidate Airtable webhook not configured", {
        status: 503,
      });
    }

    const normalizedPayload = {
      sourceSystem: "Jotform",
      providerFormId,
      submissionId,
      sourceEventId: submissionId,
      sourceEventKey,
      updateId,
      candidateObjectId,
      commandId,
      formCode: formCode || EXPECTED_FORM_CODE,
      formVersion: formVersion || EXPECTED_FORM_VERSION,
      environment: environment || EXPECTED_ENVIRONMENT,
      sourceChannel: sourceChannel || EXPECTED_SOURCE_CHANNEL,
      sourceTimestamp: timestampFromRaw(rawRequest, sourceTimestamp),
      reconciliationTimestamp: new Date().toISOString(),
      provenance: {
        adapter: ADAPTER_ID,
        provider: "Jotform",
        providerFormId,
        submissionId,
      },
      controls: {
        oneSubmissionOneSourceEnvelope: true,
        oneSourceOneCommand: true,
        candidateResolution: "CREATE_OR_REUSE_OR_HOLD",
        replayPolicy: "UPSERT_SAME_IDENTITIES_NO_DUPLICATE",
        workerActivationAuthority: false,
        shortlistAuthority: false,
        bookingAuthority: false,
        dispatchAuthority: false,
        protectedCommunicationAuthority: false,
      },
      rawRequest,
    };

    const airtableResponse = await fetch(airtableWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(normalizedPayload),
    });

    if (!airtableResponse.ok) {
      const detail = await airtableResponse.text();
      console.error(
        "Candidate Airtable webhook rejected request",
        airtableResponse.status,
        detail,
      );
      return new Response("Candidate Airtable webhook failed", { status: 502 });
    }

    return Response.json({
      success: true,
      submissionId,
      sourceEventKey,
      updateId,
      candidateObjectId,
      commandId,
    });
  } catch (error) {
    console.error("Candidate Jotform adapter failure", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
};

export const config = {
  path: "/api/candidate-jotform-webhook",
};
