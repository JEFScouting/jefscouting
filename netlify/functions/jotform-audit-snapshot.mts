import { constants, publicEncrypt, randomBytes, createCipheriv } from "node:crypto";

function getAuditPublicKey() {
  return `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7cfnU0Yun7SlbG4ZFEO9
QUBgTFV9jbPWltlYlo6vqM5ZyT0Tj2/EPlLLMWRxFO2W5CY/msSZaTHLHX4S3Dg/
MLuZMm9BDGxfCLHkxTeC+ZAh6Y4hwFiiZZMF5+U2AMHGaZS4fCWd1HEhQM7mAvd9
0jzj26Fli8rmQhMsJhf6SqDx5WTkGm2kHMAKudX4mB6AjIZpctVdVI0QR1Jutg3q
vsoUe93aphGmcqVu+YQhhPEZdiuI3qGXKGp6ZdqRRB7pgvj2O4aXaigZva/LlW+p
Mh8jmBBclh98eFdpBwSB/6UYcGqOnwb0KEkP3RZA1drgGOI3BpIjTghOQH5nZ43q
rQIDAQAB
-----END PUBLIC KEY-----`;
}

async function readJotform(path: string, apiKey: string) {
  const response = await fetch(`https://api.jotform.com${path}`, {
    headers: { APIKEY: apiKey },
  });
  if (!response.ok) {
    throw new Error(`Jotform read failed (${response.status})`);
  }
  return response.json();
}

function encryptSnapshot(snapshot: unknown) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt(
    {
      key: getAuditPublicKey(),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    key,
  );

  return {
    version: 1,
    algorithm: "RSA-OAEP-SHA256+A256GCM",
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Netlify.env.get("JOTFORM_API_KEY");
  if (!apiKey) {
    return Response.json({ success: false, error: "Jotform read runtime is not configured" }, { status: 503 });
  }

  try {
    const formId = "261713499954067";
    const [questions, properties] = await Promise.all([
      readJotform(`/form/${formId}/questions`, apiKey),
      readJotform(`/form/${formId}/properties`, apiKey),
    ]);

    const envelope = encryptSnapshot({
      capturedAt: new Date().toISOString(),
      mode: "READ_ONLY_ENCRYPTED_AUDIT_SNAPSHOT",
      formId,
      questions,
      properties,
    });

    return Response.json(envelope, {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Encrypted Jotform audit snapshot failed", error);
    return Response.json({ success: false, error: "Encrypted audit snapshot failed" }, { status: 500 });
  }
};

export const config = {
  path: "/api/jotform-audit-snapshot",
};
