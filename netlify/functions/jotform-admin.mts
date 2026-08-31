import { timingSafeEqual } from "node:crypto";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function questionSnapshot(question: Record<string, unknown>) {
  return {
    qid: question.qid,
    name: question.name,
    text: question.text,
    order: question.order,
    hidden: question.hidden,
    required: question.required,
    options: question.options,
  };
}

const JOTFORM_API_BASE = "https://api.jotform.com";
const ALLOWED_FORM_IDS = new Set([
  "262081932367056",
  "262220138013037",
  "261713499954067",
]);
const ALLOWED_RESOURCES = new Set(["form", "questions", "webhooks", "properties"]);

const BARISTA_FORM_ID = "261713499954067";
const BARISTA_DUPLICATE_QID = "49";
const RETIRE_DUPLICATE_ACTION = "retire-barista-duplicate-work-auth";

export default async (req: Request) => {
  const requestUrl = new URL(req.url);
  const isDeployPreview = requestUrl.hostname.startsWith("deploy-preview-");

  const apiKey = Netlify.env.get("JOTFORM_API_KEY");
  if (!apiKey) {
    return json({ ok: false, error: "Jotform API key not configured" }, 503);
  }

  const jotformRequest = async (
    endpoint: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; data?: any }> => {
    const upstream = await fetch(`${JOTFORM_API_BASE}${endpoint}`, {
      ...init,
      headers: {
        APIKEY: apiKey,
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!upstream.ok) {
      return { ok: false, status: upstream.status };
    }

    return {
      ok: true,
      status: upstream.status,
      data: await upstream.json(),
    };
  };

  if (req.method === "GET") {
    const formId = (requestUrl.searchParams.get("formId") ?? "").trim();
    const resource = (requestUrl.searchParams.get("resource") ?? "form").trim();

    if (!/^\d+$/.test(formId) || !ALLOWED_FORM_IDS.has(formId)) {
      return json({ ok: false, error: "Form is not allowlisted" }, 403);
    }

    if (!ALLOWED_RESOURCES.has(resource)) {
      return json({ ok: false, error: "Unsupported resource" }, 400);
    }

    const endpoint =
      resource === "form" ? `/form/${formId}` : `/form/${formId}/${resource}`;

    try {
      const result = await jotformRequest(endpoint, { method: "GET" });
      if (!result.ok) {
        console.error("Jotform read rejected", result.status, formId, resource);
        return json(
          { ok: false, error: "Jotform read failed", upstreamStatus: result.status },
          502,
        );
      }

      return json({
        ok: true,
        mode: "READ_ONLY",
        authority: "JOTFORM_REMEDIATION_ADAPTER",
        formId,
        resource,
        data: result.data,
      });
    } catch (error) {
      console.error("Jotform admin adapter read failure", error);
      return json({ ok: false, error: "Jotform request failed" }, 502);
    }
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // Until production cutover is explicitly authorized, mutation execution remains
  // constrained to Deploy Preview. There is deliberately no browser/admin UI.
  // A governed runtime/automation must invoke this contract; Joaquin is not the
  // transport layer for deterministic JEF operations.
  if (!isDeployPreview) {
    return json({ ok: false, error: "Mutations allowed only on Deploy Preview" }, 403);
  }

  const automationSecret = Netlify.env.get("JEF_AUTOMATION_SECRET");
  if (!automationSecret) {
    return json({ ok: false, error: "Governed execution secret is not configured" }, 503);
  }

  const providedSecret = req.headers.get("x-jef-automation-secret") ?? "";
  if (!providedSecret || !secretsMatch(providedSecret, automationSecret)) {
    return json({ ok: false, error: "Unauthorized governed execution request" }, 401);
  }

  let payload: { action?: string; formId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (
    payload.action !== RETIRE_DUPLICATE_ACTION ||
    payload.formId !== BARISTA_FORM_ID
  ) {
    return json({ ok: false, error: "Unsupported mutation contract" }, 400);
  }

  try {
    const beforeResult = await jotformRequest(
      `/form/${BARISTA_FORM_ID}/question/${BARISTA_DUPLICATE_QID}`,
      { method: "GET" },
    );

    if (!beforeResult.ok) {
      return json(
        { ok: false, error: "Read-before failed", upstreamStatus: beforeResult.status },
        502,
      );
    }

    const before = beforeResult.data?.content ?? {};
    const exactDuplicateIdentity =
      before.qid === BARISTA_DUPLICATE_QID &&
      before.name === "doYou" &&
      before.text === "Current U.S. work authorization" &&
      before.options ===
        "Authorized to work|Will need sponsorship|Need to confirm";

    if (!exactDuplicateIdentity) {
      return json(
        {
          ok: false,
          error: "Mutation identity precondition failed",
          before: questionSnapshot(before),
        },
        409,
      );
    }

    // Idempotent no-op: already in the intended retired-input state.
    if (before.hidden === "Yes" && before.required === "No") {
      return json({
        ok: true,
        mode: "GOVERNED_MUTATION_UAT",
        action: RETIRE_DUPLICATE_ACTION,
        formId: BARISTA_FORM_ID,
        qid: BARISTA_DUPLICATE_QID,
        result: "NO_OP_ALREADY_REMEDIATED",
        before: questionSnapshot(before),
        historicalQuestionPreserved: true,
        physicalDeletePerformed: false,
      });
    }

    const expectedMutableState =
      before.hidden === "No" && before.required === "Yes";

    if (!expectedMutableState) {
      return json(
        {
          ok: false,
          error: "Mutation state precondition failed",
          before: questionSnapshot(before),
        },
        409,
      );
    }

    const body = new URLSearchParams();
    body.set("question[hidden]", "Yes");
    body.set("question[required]", "No");

    const mutationResult = await jotformRequest(
      `/form/${BARISTA_FORM_ID}/question/${BARISTA_DUPLICATE_QID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );

    if (!mutationResult.ok) {
      return json(
        {
          ok: false,
          error: "Jotform mutation failed",
          upstreamStatus: mutationResult.status,
        },
        502,
      );
    }

    const afterResult = await jotformRequest(
      `/form/${BARISTA_FORM_ID}/question/${BARISTA_DUPLICATE_QID}`,
      { method: "GET" },
    );

    if (!afterResult.ok) {
      return json(
        { ok: false, error: "Read-after failed", upstreamStatus: afterResult.status },
        502,
      );
    }

    const after = afterResult.data?.content ?? {};
    const verified =
      after.qid === BARISTA_DUPLICATE_QID &&
      after.name === "doYou" &&
      after.hidden === "Yes" &&
      after.required === "No";

    if (!verified) {
      return json(
        {
          ok: false,
          error: "Mutation could not be verified",
          before: questionSnapshot(before),
          after: questionSnapshot(after),
        },
        502,
      );
    }

    return json({
      ok: true,
      mode: "GOVERNED_MUTATION_UAT",
      action: RETIRE_DUPLICATE_ACTION,
      formId: BARISTA_FORM_ID,
      qid: BARISTA_DUPLICATE_QID,
      result: "REMEDIATED_AND_VERIFIED",
      before: questionSnapshot(before),
      after: questionSnapshot(after),
      historicalQuestionPreserved: true,
      physicalDeletePerformed: false,
    });
  } catch (error) {
    console.error("Jotform remediation adapter mutation failure", error);
    return json({ ok: false, error: "Jotform mutation request failed" }, 502);
  }
};

export const config = {
  path: "/api/jotform-admin",
};
