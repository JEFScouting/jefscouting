const JOTFORM_API_BASE = "https://api.jotform.com";

const ALLOWED_FORM_IDS = new Set([
  "261480775333056", // JEF Candidate Application Master
  "261713499954067", // JEF Barista Availability Check
]);

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Netlify.env.get("JOTFORM_API_KEY");
  const adminSecret = Netlify.env.get("JOTFORM_ADMIN_SECRET");

  if (!apiKey || !adminSecret) {
    return Response.json(
      { success: false, error: "Jotform admin runtime is not configured" },
      { status: 503 },
    );
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${adminSecret}`) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const formId = url.searchParams.get("formId") ?? "";

  if (!ALLOWED_FORM_IDS.has(formId)) {
    return Response.json(
      { success: false, error: "Form is not allowlisted" },
      { status: 403 },
    );
  }

  const headers = { APIKEY: apiKey };

  try {
    const [questionsResponse, propertiesResponse] = await Promise.all([
      fetch(`${JOTFORM_API_BASE}/form/${formId}/questions`, { headers }),
      fetch(`${JOTFORM_API_BASE}/form/${formId}/properties`, { headers }),
    ]);

    if (!questionsResponse.ok || !propertiesResponse.ok) {
      return Response.json(
        {
          success: false,
          error: "Jotform API read failed",
          questionsStatus: questionsResponse.status,
          propertiesStatus: propertiesResponse.status,
        },
        { status: 502 },
      );
    }

    const questionsPayload = await questionsResponse.json();
    const propertiesPayload = await propertiesResponse.json();

    return Response.json({
      success: true,
      mode: "READ_ONLY",
      formId,
      observedAt: new Date().toISOString(),
      questions: questionsPayload.content ?? questionsPayload,
      properties: propertiesPayload.content ?? propertiesPayload,
    });
  } catch (error) {
    console.error("Jotform governed read failure", error);
    return Response.json(
      { success: false, error: "Jotform governed read failed" },
      { status: 500 },
    );
  }
};

export const config = {
  path: "/api/jotform-admin-read",
};
