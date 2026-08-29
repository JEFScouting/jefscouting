const JOTFORM_API_BASE = "https://api.jotform.com";

// Explicit canonical JEF allowlist. Unknown form IDs fail closed.
const ALLOWED_FORM_IDS = new Set([
  "262081932367056", // Client Staffing Request Master / existing production adapter form
  "262220138013037", // JEF Staffing Service Order
  "261713499954067", // JEF Barista Availability Check — Sept 28–Oct 1 South Florida Event
]);

const ALLOWED_RESOURCES = new Set(["form", "questions", "webhooks"]);

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const apiKey = Netlify.env.get("JOTFORM_API_KEY");
  if (!apiKey) {
    return json({ ok: false, error: "Jotform API key not configured" }, 503);
  }

  const url = new URL(req.url);
  const formId = (url.searchParams.get("formId") ?? "").trim();
  const resource = (url.searchParams.get("resource") ?? "form").trim();

  if (!/^\d+$/.test(formId) || !ALLOWED_FORM_IDS.has(formId)) {
    return json({ ok: false, error: "Form is not allowlisted" }, 403);
  }

  if (!ALLOWED_RESOURCES.has(resource)) {
    return json({ ok: false, error: "Unsupported resource" }, 400);
  }

  const endpoint =
    resource === "form" ? `/form/${formId}` : `/form/${formId}/${resource}`;

  try {
    const upstream = await fetch(`${JOTFORM_API_BASE}${endpoint}`, {
      method: "GET",
      headers: {
        APIKEY: apiKey,
        Accept: "application/json",
      },
    });

    if (!upstream.ok) {
      console.error("Jotform read rejected", upstream.status, formId, resource);
      return json(
        { ok: false, error: "Jotform read failed", upstreamStatus: upstream.status },
        502,
      );
    }

    const data = await upstream.json();

    return json({
      ok: true,
      mode: "READ_ONLY",
      formId,
      resource,
      data,
    });
  } catch (error) {
    console.error("Jotform admin adapter failure", error);
    return json({ ok: false, error: "Jotform request failed" }, 502);
  }
};

export const config = {
  path: "/api/jotform-admin",
};
