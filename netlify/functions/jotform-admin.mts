import { timingSafeEqual } from "node:crypto";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

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

function mutationUatPage(): Response {
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JEF Jotform Mutation UAT</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #0b1220; color: #e5e7eb; }
    main { max-width: 680px; margin: 0 auto; padding: 28px 18px 48px; }
    .card { background: #111827; border: 1px solid #374151; border-radius: 16px; padding: 22px; }
    h1 { font-size: 1.35rem; margin: 0 0 10px; }
    p { line-height: 1.55; color: #cbd5e1; }
    .facts { background: #0f172a; border-radius: 12px; padding: 14px; margin: 16px 0; line-height: 1.55; }
    label { display: block; font-weight: 700; margin: 18px 0 8px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #475569; border-radius: 10px; padding: 13px; font-size: 16px; background: #020617; color: #fff; }
    button { width: 100%; margin-top: 14px; border: 0; border-radius: 10px; padding: 14px; font-size: 16px; font-weight: 800; background: #f59e0b; color: #111827; }
    button:disabled { opacity: .55; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border-radius: 10px; padding: 14px; min-height: 64px; margin-top: 16px; }
    .warn { color: #fbbf24; font-weight: 700; }
  </style>
</head>
<body>
<main>
  <div class="card">
    <h1>JEF Jotform Mutation UAT</h1>
    <p class="warn">Deploy Preview only. This action does not delete QID 49.</p>
    <div class="facts">
      Form: 261713499954067<br>
      Target: QID 49 — Current U.S. work authorization<br>
      Change: hidden = Yes; required = No<br>
      Preservation: historical question retained; physical delete = No
    </div>
    <p>The adapter will read the question first, refuse to proceed unless it exactly matches the audited duplicate, apply the reversible change, then read it again and verify the result.</p>
    <label for="secret">JOTFORM_ADMIN_SECRET</label>
    <input id="secret" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Paste the Deploy Preview admin secret">
    <button id="run" type="button">Run reversible remediation</button>
    <pre id="result">Ready. Nothing has been changed yet.</pre>
  </div>
</main>
<script>
(() => {
  const run = document.getElementById('run');
  const secret = document.getElementById('secret');
  const result = document.getElementById('result');

  run.addEventListener('click', async () => {
    const value = secret.value;
    if (!value) {
      result.textContent = 'Secret is required. No request sent.';
      return;
    }

    run.disabled = true;
    result.textContent = 'Running read-before → reversible mutation → read-after verification…';

    try {
      const response = await fetch('/api/jotform-admin', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-jef-admin-secret': value,
        },
        body: JSON.stringify({ action: 'hide-barista-duplicate-work-auth' }),
      });

      const data = await response.json();
      result.textContent = JSON.stringify(data, null, 2);
      secret.value = '';
    } catch (error) {
      result.textContent = 'Request failed before verification: ' + String(error);
    } finally {
      run.disabled = false;
    }
  });
})();
</script>
</body>
</html>`);
}

export default async (req: Request) => {
  const JOTFORM_API_BASE = "https://api.jotform.com";

  const ALLOWED_FORM_IDS = new Set([
    "262081932367056",
    "262220138013037",
    "261713499954067",
  ]);

  const ALLOWED_RESOURCES = new Set(["form", "questions", "webhooks", "properties"]);
  const BARISTA_FORM_ID = "261713499954067";
  const BARISTA_DUPLICATE_QID = "49";
  const MUTATION_ACTION = "hide-barista-duplicate-work-auth";
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
    if (requestUrl.searchParams.get("ui") === "mutation") {
      if (!isDeployPreview) {
        return json({ ok: false, error: "Mutation UI allowed only on Deploy Preview" }, 403);
      }
      return mutationUatPage();
    }

    const formId = (requestUrl.searchParams.get("formId") ?? "").trim();
    const resource = (requestUrl.searchParams.get("resource") ?? "form").trim();

    if (!/^\d+$/.test(formId) || !ALLOWED_FORM_IDS.has(formId)) {
      return json({ ok: false, error: "Form is not allowlisted" }, 403);
    }

    if (!ALLOWED_RESOURCES.has(resource)) {
      return json({ ok: false, error: "Unsupported resource" }, 400);
    }

    const endpoint = resource === "form" ? `/form/${formId}` : `/form/${formId}/${resource}`;

    try {
      const result = await jotformRequest(endpoint, { method: "GET" });

      if (!result.ok) {
        console.error("Jotform read rejected", result.status, formId, resource);
        return json({ ok: false, error: "Jotform read failed", upstreamStatus: result.status }, 502);
      }

      return json({ ok: true, mode: "READ_ONLY", formId, resource, data: result.data });
    } catch (error) {
      console.error("Jotform admin adapter read failure", error);
      return json({ ok: false, error: "Jotform request failed" }, 502);
    }
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!isDeployPreview) {
    return json({ ok: false, error: "Mutations allowed only on Deploy Preview" }, 403);
  }

  const adminSecret = Netlify.env.get("JOTFORM_ADMIN_SECRET");
  if (!adminSecret) {
    return json({ ok: false, error: "Mutation gate is not configured" }, 503);
  }

  const providedSecret = req.headers.get("x-jef-admin-secret") ?? "";
  if (!providedSecret || !secretsMatch(providedSecret, adminSecret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let payload: { action?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (payload.action !== MUTATION_ACTION) {
    return json({ ok: false, error: "Unsupported mutation action" }, 400);
  }

  try {
    const beforeResult = await jotformRequest(
      `/form/${BARISTA_FORM_ID}/question/${BARISTA_DUPLICATE_QID}`,
      { method: "GET" },
    );

    if (!beforeResult.ok) {
      return json({ ok: false, error: "Read-before failed", upstreamStatus: beforeResult.status }, 502);
    }

    const before = beforeResult.data?.content ?? {};
    const expectedState =
      before.qid === BARISTA_DUPLICATE_QID &&
      before.name === "doYou" &&
      before.text === "Current U.S. work authorization" &&
      before.hidden === "No" &&
      before.required === "Yes" &&
      before.options === "Authorized to work|Will need sponsorship|Need to confirm";

    if (!expectedState) {
      return json({ ok: false, error: "Mutation precondition failed", before: questionSnapshot(before) }, 409);
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
      return json({ ok: false, error: "Jotform mutation failed", upstreamStatus: mutationResult.status }, 502);
    }

    const afterResult = await jotformRequest(
      `/form/${BARISTA_FORM_ID}/question/${BARISTA_DUPLICATE_QID}`,
      { method: "GET" },
    );

    if (!afterResult.ok) {
      return json({ ok: false, error: "Read-after failed", upstreamStatus: afterResult.status }, 502);
    }

    const after = afterResult.data?.content ?? {};
    const verified =
      after.qid === BARISTA_DUPLICATE_QID &&
      after.name === "doYou" &&
      after.hidden === "Yes" &&
      after.required === "No";

    if (!verified) {
      return json({
        ok: false,
        error: "Mutation could not be verified",
        before: questionSnapshot(before),
        after: questionSnapshot(after),
      }, 502);
    }

    return json({
      ok: true,
      mode: "MUTATION_UAT",
      action: MUTATION_ACTION,
      formId: BARISTA_FORM_ID,
      qid: BARISTA_DUPLICATE_QID,
      before: questionSnapshot(before),
      after: questionSnapshot(after),
      historicalQuestionPreserved: true,
      physicalDeletePerformed: false,
    });
  } catch (error) {
    console.error("Jotform admin adapter mutation failure", error);
    return json({ ok: false, error: "Jotform mutation request failed" }, 502);
  }
};

export const config = {
  path: "/api/jotform-admin",
};
