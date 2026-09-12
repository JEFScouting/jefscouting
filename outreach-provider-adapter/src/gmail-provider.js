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
  const headers = [
    `From: ${sender}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
  ];
  if (payload?.sequenceStep === "FOLLOW-UP-1") {
    const prior = safeHeader(payload?.priorRfcMessageId, "PRIOR_MESSAGE_ID");
    const threadId = safeHeader(payload?.gmailThreadId, "GMAIL_THREAD_ID");
    headers.push(`In-Reply-To: ${prior}`, `References: ${prior}`);
    // Thread ID is intentionally not a MIME header; it is bound separately in the Gmail API request.
    void threadId;
  }
  const raw = [
    ...headers,
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
    const threadId = payload?.sequenceStep === "FOLLOW-UP-1" ? safeHeader(payload?.gmailThreadId, "GMAIL_THREAD_ID") : undefined;
    let result;
    try {
      result = await this.transport.sendRaw({ raw, threadId });
    } catch (error) {
      if (error?.definitelyNotInvoked === true) throw new PreInvocationProviderError(error.message ?? "GMAIL_PRE_INVOCATION_FAILURE");
      throw new AmbiguousProviderResult(error?.message ?? "GMAIL_SEND_OUTCOME_UNKNOWN");
    }
    if (!nonEmpty(result?.id)) throw new AmbiguousProviderResult("GMAIL_SEND_ACK_MISSING_ID");
    if (threadId && result?.threadId !== threadId) throw new AmbiguousProviderResult("GMAIL_FOLLOW_UP_THREAD_ACK_MISMATCH");
    return { confirmed: true, providerMessageId: result.id, providerThreadId: result.threadId ?? null, outcome: "SENT" };
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
    return { confirmed: true, providerMessageId: result.id, providerThreadId: result.threadId ?? null, outcome: "SENT" };
  }
}
