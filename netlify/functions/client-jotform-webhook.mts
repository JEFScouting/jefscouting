const EXPECTED_FORM_ID = "262081932367056";
const ADAPTER_ID = "NETLIFY|jefscouting|client-jotform-webhook";

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
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

    const submissionId =
      asString(formData.get("submissionID")) ||
      asString(formData.get("submission_id")) ||
      String(rawRequest.submission_id ?? rawRequest.id ?? "");

    const providerFormId =
      asString(formData.get("formID")) ||
      asString(formData.get("form_id")) ||
      String(rawRequest.formID ?? rawRequest.form_id ?? "");

    if (!submissionId) {
      return new Response("Missing Jotform Submission ID", { status: 400 });
    }

    if (providerFormId !== EXPECTED_FORM_ID) {
      return new Response("Unexpected Jotform Form ID", { status: 400 });
    }

    const sourceEventKey = `CLIENTSRC|Jotform|${submissionId}`;

    const sourceTimestamp =
      asString(formData.get("created_at")) ||
      asString(formData.get("createdAt")) ||
      String(rawRequest.created_at ?? rawRequest.createdAt ?? "");

    const airtableWebhook = Netlify.env.get(
      "AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL",
    );

    if (!airtableWebhook) {
      return new Response("Airtable webhook not configured", {
        status: 500,
      });
    }

    const normalizedPayload = {
      sourceSystem: "Jotform",
      providerFormId,
      submissionId,
      sourceEventId: submissionId,
      sourceEventKey,
      clientRequestIdentityKey: `CLIENTREQ|${sourceEventKey}`,
      sourceTimestamp: rawRequest.submitDate
  ? new Date(Number(rawRequest.submitDate)).toISOString()
  : sourceTimestamp || null,
reconciliationTimestamp: new Date().toISOString(),
      provenance: {
        adapter: ADAPTER_ID,
        environment: "production",
        provider: "Jotform",
      },
      rawRequest,
    };

    const airtableResponse = await fetch(airtableWebhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(normalizedPayload),
    });

    if (!airtableResponse.ok) {
      const detail = await airtableResponse.text();

      console.error(
        "Airtable webhook rejected request",
        airtableResponse.status,
        detail,
      );

      return new Response("Airtable webhook failed", {
        status: 502,
      });
    }

    return Response.json({
      success: true,
      submissionId,
      sourceEventKey,
    });
  } catch (error) {
    console.error("Client Jotform adapter failure", error);

    return new Response("Webhook processing failed", {
      status: 500,
    });
  }
};

export const config = {
  path: "/api/client-jotform-webhook",
};
