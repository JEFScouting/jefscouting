import crypto from "node:crypto";

const JOTFORM_API_BASE = "https://api.jotform.com";
const BARISTA_FORM_ID = "261713499954067";

function encrypt(plaintext: string, hexKey: string) {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) throw new Error("Invalid snapshot key");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { alg: "A256GCM", iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const apiKey = Netlify.env.get("JOTFORM_API_KEY");
  const snapshotKey = Netlify.env.get("JOTFORM_SNAPSHOT_KEY");
  if (!apiKey || !snapshotKey) return Response.json({ success: false, error: "Snapshot bridge is not configured" }, { status: 503 });
  const headers = { APIKEY: apiKey };
  try {
    const [questionsResponse, propertiesResponse] = await Promise.all([
      fetch(`${JOTFORM_API_BASE}/form/${BARISTA_FORM_ID}/questions`, { headers }),
      fetch(`${JOTFORM_API_BASE}/form/${BARISTA_FORM_ID}/properties`, { headers }),
    ]);
    if (!questionsResponse.ok || !propertiesResponse.ok) return Response.json({ success: false, error: "Jotform API read failed" }, { status: 502 });
    const questionsPayload = await questionsResponse.json();
    const propertiesPayload = await propertiesResponse.json();
    const questions = questionsPayload.content ?? questionsPayload;
    const compact = Object.fromEntries(Object.entries(questions).map(([qid, q]: [string, any]) => [qid, { order: q.order, text: q.text, type: q.type, name: q.name, required: q.required, hidden: q.hidden }]));
    const payload = JSON.stringify({ observedAt: new Date().toISOString(), formId: BARISTA_FORM_ID, questions: compact, properties: propertiesPayload.content ?? propertiesPayload });
    return Response.json({ success: true, mode: "ENCRYPTED_READ_ONLY", ...encrypt(payload, snapshotKey) });
  } catch (error) {
    console.error("Encrypted Jotform snapshot failed", error);
    return Response.json({ success: false, error: "Encrypted snapshot failed" }, { status: 500 });
  }
};

export const config = { path: "/api/jotform-admin-snapshot" };
