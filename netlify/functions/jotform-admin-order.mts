const JOTFORM_API_BASE = "https://api.jotform.com";
const BARISTA_FORM_ID = "261713499954067";

const ALLOWED_QIDS = new Set([
  "3", "7", "8", "9", "10", "11", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "23", "24", "25", "27", "28", "29", "30", "31", "32", "37", "38",
  "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50",
]);

type MutationRequest = {
  formId?: string;
  qid?: string;
  expectedOrder?: string | number;
  targetOrder?: string | number;
};

async function getQuestion(formId: string, qid: string, headers: Record<string, string>) {
  const response = await fetch(`${JOTFORM_API_BASE}/form/${formId}/question/${qid}`, { headers });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Question read failed (${response.status})`);
  }
  return payload.content ?? payload;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Netlify.env.get("JOTFORM_API_KEY");
  const adminSecret = Netlify.env.get("JOTFORM_ADMIN_SECRET");
  if (!apiKey || !adminSecret) {
    return Response.json({ success: false, error: "Jotform admin runtime is not configured" }, { status: 503 });
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${adminSecret}`) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: MutationRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const formId = String(body.formId ?? "");
  const qid = String(body.qid ?? "");
  const expectedOrder = String(body.expectedOrder ?? "");
  const targetOrder = String(body.targetOrder ?? "");

  if (formId !== BARISTA_FORM_ID) {
    return Response.json({ success: false, error: "Only canonical Barista form is allowlisted" }, { status: 403 });
  }
  if (!ALLOWED_QIDS.has(qid)) {
    return Response.json({ success: false, error: "Question is not allowlisted" }, { status: 403 });
  }
  if (!/^\d+$/.test(expectedOrder) || !/^\d+$/.test(targetOrder)) {
    return Response.json({ success: false, error: "Orders must be non-negative integers" }, { status: 400 });
  }

  const headers = { APIKEY: apiKey };

  try {
    const before = await getQuestion(formId, qid, headers);
    const observedOrder = String(before.order ?? "");

    if (observedOrder !== expectedOrder) {
      return Response.json({
        success: false,
        error: "PRECONDITION_FAILED",
        formId,
        qid,
        expectedOrder,
        observedOrder,
      }, { status: 409 });
    }

    if (expectedOrder === targetOrder) {
      return Response.json({ success: true, mode: "NOOP", formId, qid, order: observedOrder });
    }

    const form = new URLSearchParams();
    form.set("question[order]", targetOrder);

    const mutationResponse = await fetch(`${JOTFORM_API_BASE}/form/${formId}/question/${qid}`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!mutationResponse.ok) {
      const failureBody = await mutationResponse.text();
      console.error("Jotform order mutation failed", mutationResponse.status, failureBody);
      return Response.json({ success: false, error: "Jotform order mutation failed", status: mutationResponse.status }, { status: 502 });
    }

    const after = await getQuestion(formId, qid, headers);
    const verifiedOrder = String(after.order ?? "");
    if (verifiedOrder !== targetOrder) {
      return Response.json({
        success: false,
        error: "VERIFY_FAILED",
        formId,
        qid,
        expectedOrder,
        targetOrder,
        verifiedOrder,
      }, { status: 502 });
    }

    return Response.json({
      success: true,
      mode: "ORDER_ONLY",
      formId,
      qid,
      previousOrder: expectedOrder,
      verifiedOrder,
    });
  } catch (error) {
    console.error("Governed Jotform order mutation failed", error);
    return Response.json({ success: false, error: "Governed Jotform order mutation failed" }, { status: 500 });
  }
};

export const config = {
  path: "/api/jotform-admin-order",
};
