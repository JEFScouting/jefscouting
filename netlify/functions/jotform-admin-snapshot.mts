import crypto from "node:crypto";

const JOTFORM_API_BASE = "https://api.jotform.com";
const BARISTA_FORM_ID = "261713499954067";
const SNAPSHOT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA559bV0EHDw0FB/Qq8RVR
zs8JZ6ZbPmiPJAeNklBYrwBD9ur3XXbKsQmY9EJog8qWnmmSS1IAOUVi7YMEH5IS
w7RU/u7BuQDkvdK1RZ6k3LGh3gwrhJNGMltfDKPspZL/4aFqpfbE+QCaTnxa6L9s
HGTJZ+MzTGfI+57i2j0ilJXIZyDXV71xDkU37kqDbP8KdiS8qO++nX31lYkgqzII
YJOWbn+Flf+8n6Aa6udxHB2g81UQbsUi3sDSk4s1Y1lyqgP8p2LNaX/ziB4Aj5zb
8c0awvB429JyeO72GC5CZvusphYTU0IyJ1yOLpIT0yfbnM09kYgC2OB0+oWDqWyd
PwIDAQAB
-----END PUBLIC KEY-----`;

function encrypt(plaintext: string) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptedKey = crypto.publicEncrypt({
    key: SNAPSHOT_PUBLIC_KEY,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, key);
  return {
    alg: "RSA-OAEP-256+A256GCM",
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const apiKey = Netlify.env.get("JOTFORM_API_KEY");
  if (!apiKey) return Response.json({ success: false, error: "Snapshot bridge is not configured" }, { status: 503 });
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
    return Response.json({ success: true, mode: "ENCRYPTED_READ_ONLY", ...encrypt(payload) });
  } catch (error) {
    console.error("Encrypted Jotform snapshot failed", error);
    return Response.json({ success: false, error: "Encrypted snapshot failed" }, { status: 500 });
  }
};

export const config = { path: "/api/jotform-admin-snapshot" };
