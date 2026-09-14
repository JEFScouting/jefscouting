import { FailClosedError } from "./adapter.js";

/** Production Gmail wiring is intentionally absent pending independent review and authority. */
export class DisabledGmailProvider {
  async sendOnce() { throw new FailClosedError("GMAIL_PROVIDER_UNWIRED"); }
  async lookup() { throw new FailClosedError("GMAIL_PROVIDER_UNWIRED"); }
}
