import { AmbiguousProviderResult, FailClosedError, PreInvocationProviderError } from "./adapter.js";

function nonEmpty(value) { return typeof value === "string" && value.trim() !== ""; }
function safeHeader(value, name) {
  if (!nonEmpty(value) || /[\r\n\0]/.test(value)) throw new FailClosedError(`UNSAFE_${name}_HEADER`);
  return value;
}
function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildGmailRawMessage({ payload, identity, from }) {
  const to = safeHeader(payload?.destination, "TO");
  const sender = safeHeader(from, "FROM");
  const subject = safeHeader(payload?.subject, "SUBJECT");
  const messageId = safeHeader(identity?.rfcMessageId, "MESSAGE_ID");
  if (!nonEmpty(payload?.textBody)) throw new FailClosedError("EMPTY_GMAIL_BODY");
  const raw = [
    `From: ${sender}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    payload.textBody
  ].join("\r\n");
  return base64url(raw);
}

export class GmailApiProvider {
  constructor({ transport, from }) {
    if (!transport?.sendRaw || !transport?.lookupByRfcMessageId) throw new FailClosedError("GMAIL_TRANSPORT_PORT_INCOMPLETE");
    this.transport = transport;
    this.from = safeHeader(from, "FROM");
  }

  async sendOnce({ payload, identity, authorizedSenderIdentity }) {
    const authorizedFrom = safeHeader(authorizedSenderIdentity, "AUTHORIZED_FROM");
    if (this.from !== authorizedFrom || payload?.senderIdentitySnapshot !== authorizedFrom) throw new FailClosedError("GMAIL_FROM_AUTHORITY_MISMATCH");
    const raw = buildGmailRawMessage({ payload, identity, from: this.from });
    let result;
    try {
      result = await this.transport.sendRaw({ raw });
    } catch (error) {
      if (error?.definitelyNotInvoked === true) throw new PreInvocationProviderError(error.message ?? "GMAIL_PRE_INVOCATION_FAILURE");
      throw new AmbiguousProviderResult(error?.message ?? "GMAIL_SEND_OUTCOME_UNKNOWN");
    }
    if (!nonEmpty(result?.id)) throw new AmbiguousProviderResult("GMAIL_SEND_ACK_MISSING_ID");
    return { confirmed: true, providerMessageId: result.id, outcome: "SENT" };
  }

  async lookup({ identity }) {
    if (!identity?.rfcMessageId) throw new FailClosedError("GMAIL_LOOKUP_IDENTITY_REQUIRED");
    let result;
    try {
      result = await this.transport.lookupByRfcMessageId({ rfcMessageId: identity.rfcMessageId });
    } catch (error) {
      throw new FailClosedError(`GMAIL_LOOKUP_FAILED:${error?.message ?? "UNKNOWN"}`);
    }
    if (!result) return { confirmed: false };
    if (!nonEmpty(result.id)) throw new FailClosedError("GMAIL_LOOKUP_RESULT_MALFORMED");
    return { confirmed: true, providerMessageId: result.id, outcome: "SENT" };
  }
}
