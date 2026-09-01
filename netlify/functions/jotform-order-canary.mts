export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const adminSecret = Netlify.env.get("JOTFORM_ADMIN_SECRET");
  if (!adminSecret) {
    return Response.json({ success: false, error: "Canonical admin secret unavailable" }, { status: 503 });
  }

  const response = await fetch("https://jefscouting.com/api/jotform-admin-order", {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      formId: "261713499954067",
      qid: "3",
      expectedOrder: "25",
      targetOrder: "26",
    }),
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
};

export const config = { path: "/api/jotform-order-canary" };
