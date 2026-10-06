import { randomBytes, timingSafeEqual } from 'node:crypto';
import { FORMS, digest, evidenceVersion, normalizeSubmission, text, type Lane } from './intake-normalize.mts';

type Store = {
  getWithMetadata: (key: string, options: any) => Promise<any>;
  setJSON: (key: string, value: any, options: any) => Promise<any>;
  list: (options: { prefix: string; paginate: true }) => AsyncIterable<any>;
};
type Dependencies = { store: Store; env: (key: string) => string | undefined; fetch: typeof fetch; log: (value: any) => void; now: () => string };
const token = () => randomBytes(32).toString('hex');
const equal = (a: unknown, b: unknown) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const response = (status: number, data: any) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const read = (store: Store, key: string) => store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
const terminal = (status: string) => ['done', 'exception', 'failed', 'superseded'].includes(status);

// Strong compare-and-swap serializes each existing Airtable automation.
// A claimed slot never expires: a slow writer must not overlap its replacement.
async function cas(store: Store, key: string, data: any, previous?: any) {
  const result = await store.setJSON(key, data, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!result.modified || !result.etag) return false;
  const verify = await read(store, key);
  return !!verify && verify.etag === result.etag;
}

export async function handleIntake(req: Request, lane: Lane, deps: Dependencies): Promise<Response> {
  const { store, env, log, now } = deps;
  const laneKey = `lane/${lane}`;
  const dispatchPaused = () => env(`JEF_${lane.toUpperCase()}_INTAKE_DISPATCH_PAUSED`) === 'true';
  const validReceipt = (v: unknown) => typeof v === 'string' && new RegExp(`^receipt/${lane}/[0-9]{16,22}/[a-f0-9]{64}$`).test(v);
  const authorized = () => !!env('JOTFORM_ADMIN_SECRET') && equal(req.headers.get('authorization'), `Bearer ${env('JOTFORM_ADMIN_SECRET')}`);
  const webhook = () => {
    if (env(`JEF_${lane.toUpperCase()}_INTAKE_V2_ENABLED`) !== 'true') throw new Error('INTAKE_NOT_ENABLED');
    const value = env(lane === 'candidate' ? 'AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL' : 'AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL');
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.hostname !== 'hooks.airtable.com' || !url.pathname.includes('/appveHEw1HrXr8nD1/')) throw new Error('INVALID_AIRTABLE_DESTINATION');
    return url.toString();
  };
  const receipts = async (prefix = `receipt/${lane}/`) => {
    const result: any[] = [];
    for await (const page of store.list({ prefix, paginate: true })) {
      for (const item of page.blobs) {
        const value = await read(store, item.key);
        if (value) result.push({ key: item.key, ...value });
      }
    }
    return result.sort((a, b) => String(a.data.envelope.receivedAt).localeCompare(String(b.data.envelope.receivedAt)) || a.key.localeCompare(b.key));
  };
  const prefixFor = (id: string) => `receipt/${lane}/${id}/`;
  const headKey = (id: string) => `head/${lane}/${id}`;
  const materialize = async (head: any) => {
    let receipt = await read(store, head.receiptId);
    if (!receipt) {
      await cas(store, head.receiptId, { status: 'queued', envelope: head.envelope, observedAt: head.observedAt || head.envelope.receivedAt, occurrence: head.occurrence, previousReceiptId: head.previousReceiptId });
      receipt = await read(store, head.receiptId);
    }
    if (!receipt || receipt.data.occurrence !== head.occurrence || receipt.data.envelope.version !== head.envelope.version || evidenceVersion(receipt.data.envelope.snapshot) !== head.semanticVersion) throw new Error('RECEIPT_WRITE_UNCONFIRMED');
    return receipt;
  };
  // Bootstrap only from observable, consecutive legacy occurrences. A content
  // match elsewhere in history is not evidence of a replay (A -> B -> A).
  const sourceHead = async (id: string) => {
    const key = headKey(id);
    let head = await read(store, key);
    if (!head) {
      const history = await receipts(prefixFor(id));
      const groups: any[][] = [];
      for (const receipt of history) {
        const previous = groups.at(-1)?.at(-1);
        const same = previous && evidenceVersion(previous.data.envelope.snapshot) === evidenceVersion(receipt.data.envelope.snapshot);
        if (previous && !same && previous.data.envelope.receivedAt === receipt.data.envelope.receivedAt) throw new Error('AMBIGUOUS_LEGACY_ORDER');
        if (same) groups.at(-1)!.push(receipt); else groups.push([receipt]);
      }
      let latest: any;
      const slot = await read(store, laneKey);
      const survivors = groups.map(group => {
        const live = group.filter(r => ['claimed', 'dispatching'].includes(r.data.status) || (slot?.data.state === 'active' && slot.data.receiptId === r.key));
        const completed = group.filter(r => ['done', 'exception'].includes(r.data.status));
        const failed = group.filter(r => r.data.status === 'failed');
        if (live.length > 1 || (live.length && completed.some(r => r.key !== live[0].key))) throw new Error('LEGACY_ACTIVE_DUPLICATE_REQUIRES_REVIEW');
        // A failed receipt may already own partial native Evidence. Retain that
        // recovery identity; uncertain multiple writers need independent review.
        if (failed.length > 1 || (failed.length && (live.length || completed.length))) throw new Error('LEGACY_FAILED_DUPLICATE_REQUIRES_REVIEW');
        const rank = (r: any) => live.some(v => v.key === r.key) ? 0 : ['done', 'exception'].includes(r.data.status) ? 1 : r.data.status === 'failed' ? 2 : r.data.status === 'queued' ? 3 : 4;
        return [...group].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key))[0];
      });
      for (const [index, group] of groups.entries()) {
        const survivor = survivors[index];
        for (const member of group) {
          const current = await read(store, member.key);
          if (!current) throw new Error('LEGACY_RECEIPT_MISSING');
          const duplicate = member.key !== survivor.key;
          if (duplicate && ['claimed', 'dispatching'].includes(current.data.status)) throw new Error('LEGACY_ACTIVE_DUPLICATE_REQUIRES_REVIEW');
          const data = { ...current.data, occurrence: index + 1 };
          if (duplicate && current.data.status === 'failed') throw new Error('LEGACY_FAILED_DUPLICATE_REQUIRES_REVIEW');
          if (duplicate && current.data.status === 'queued') Object.assign(data, { status: 'superseded', supersededBy: survivor.key });
          if (current.data.occurrence !== data.occurrence || current.data.status !== data.status) {
            if (!await cas(store, member.key, data, current)) throw new Error('LEGACY_COALESCE_RACE');
          }
        }
        latest = { receiptId: survivor.key, semanticVersion: evidenceVersion(survivor.data.envelope.snapshot), envelope: survivor.data.envelope, occurrence: index + 1 };
      }
      if (latest) { await cas(store, key, latest); head = await read(store, key); }
    }
    if (head) await materialize(head.data);
    return head;
  };
  const admit = async (envelope: any) => {
    const id = envelope.submissionId, key = headKey(id), semanticVersion = envelope.version;
    const head = await sourceHead(id);
    if (head?.data.semanticVersion === semanticVersion) return head.data.receiptId;
    // Keep the original semantic key when unused; a return to older content gets
    // a new occurrence version, which is also the native Evidence identity.
    let version = semanticVersion;
    if (await read(store, `${prefixFor(id)}${version}`)) version = digest({ semanticVersion, previousReceiptId: head?.data.receiptId });
    // Native readback orders this source's managed-field evidence by receivedAt.
    // Keep that order strict even when admissions share a millisecond.
    const receivedAt = head && Date.parse(envelope.receivedAt) <= Date.parse(head.data.envelope.receivedAt)
      ? new Date(Date.parse(head.data.envelope.receivedAt) + 1).toISOString() : envelope.receivedAt;
    const next = { semanticVersion, receiptId: `${prefixFor(id)}${version}`, envelope: { ...envelope, version, receivedAt }, observedAt: envelope.receivedAt, occurrence: (head?.data.occurrence || 0) + 1, previousReceiptId: head?.data.receiptId || null };
    // Persist the immutable envelope with the admission CAS. Recovery can create
    // a missing receipt before advancing this head; no queued orphan is admitted.
    if (!await cas(store, key, next, head)) {
      const winner = await sourceHead(id);
      if (winner?.data.semanticVersion !== semanticVersion) throw new Error('ADMISSION_RACE');
      return winner.data.receiptId;
    }
    await materialize(next);
    return next.receiptId;
  };
  const inspect = (key: string, value: any) => value ? {
    receiptId: key, status: value.data.status, receivedAt: value.data.envelope.receivedAt,
    observedAt: value.data.observedAt || value.data.envelope.receivedAt,
    claimedAt: value.data.claimedAt || null, completedAt: value.data.completedAt || null,
    result: value.data.result || null, supersededBy: value.data.supersededBy || null,
  } : null;
  const staleQueued = (receipt: any, all: any[]) => receipt.data.status === 'queued' && all.some(later =>
    later.data.envelope.submissionId === receipt.data.envelope.submissionId && later.data.occurrence > receipt.data.occurrence && ['done', 'exception', 'failed'].includes(later.data.status));
  // Persist submissions before dispatch, including while another submission runs.
  // Completion dispatches the next receipt without an Owner execution cycle.
  const dispatch = async (preferred = ''): Promise<string> => {
    const hook = webhook();
    // The existing durable queue bridges human review of the native draft.
    // Intake remains recoverable while neither old nor new actions are invoked.
    // Already claimed writers can still acknowledge their completion.
    if (dispatchPaused()) {
      log({ lane, receiptId: preferred, status: 'queued_pending_activation' });
      return 'queued_pending_activation';
    }
    // Completion and unrelated submissions must also neutralize old queued
    // equivalents, even when no fresh delivery for that source arrives.
    const queued = (await receipts()).filter(r => r.data.status === 'queued');
    for (const id of new Set<string>(queued.map(r => r.data.envelope.submissionId))) await sourceHead(id);
    let slot = await read(store, laneKey);
    if (!slot) { await cas(store, laneKey, { state: 'idle' }); slot = await read(store, laneKey); }
    if (!slot) throw new Error('SLOT_UNAVAILABLE');
    if (slot.data.state === 'active') {
      const active = await read(store, slot.data.receiptId);
      if (!active) throw new Error('ACTIVE_RECEIPT_MISSING');
      if (terminal(active.data.status)) {
        if (!await cas(store, laneKey, { state: 'idle', lastReceiptId: slot.data.receiptId }, slot)) return 'queued';
        slot = await read(store, laneKey);
      } else if (active.data.status === 'claimed' || (preferred && slot.data.receiptId !== preferred)) return 'queued';
    }
    if (slot.data.state === 'idle') {
      const all = await receipts();
      if (all.some(r => r.data.status === 'queued' && !Number.isInteger(r.data.occurrence))) throw new Error('UNADMITTED_RECEIPT_REQUIRES_REVIEW');
      if (all.some(r => staleQueued(r, all))) throw new Error('STALE_QUEUED_OCCURRENCE_REQUIRES_REVIEW');
      const pending = all.find(r => r.data.status === 'queued' && !all.some(p => p.data.envelope.submissionId === r.data.envelope.submissionId && p.data.occurrence < r.data.occurrence && ['queued', 'dispatching', 'claimed'].includes(p.data.status)));
      if (!pending) return 'idle';
      const receiptToken = token();
      if (!await cas(store, laneKey, { ...slot.data, state: 'active', receiptId: pending.key, token: receiptToken, receivedAt: now() }, slot)) return 'queued';
      slot = await read(store, laneKey);
      if (slot?.data.token !== receiptToken) return 'queued';
    }
    const key = slot.data.receiptId;
    let current = await read(store, key);
    if (!current) throw new Error('ACTIVE_RECEIPT_MISSING');
    if (current.data.status === 'superseded') {
      if (!await cas(store, laneKey, { state: 'idle', lastReceiptId: key }, slot)) return 'queued';
      return dispatch(preferred);
    }
    if (current.data.status === 'queued') {
      if (staleQueued({ key, ...current }, await receipts())) throw new Error('STALE_QUEUED_OCCURRENCE_REQUIRES_REVIEW');
      if (!await cas(store, key, { ...current.data, token: slot.data.token, status: 'dispatching' }, current)) return 'queued';
      current = await read(store, key);
    }
    if (current.data.status !== 'dispatching' || current.data.token !== slot.data.token) return 'queued';
    // Resending an unclaimed receipt is safe. All native runs share this token;
    // only one can atomically change dispatching to claimed.
    const payload = { protocol: 'JEF-INTAKE-2', lane, receiptId: key, token: current.data.token, submissionId: current.data.envelope.submissionId, sourceEventKey: current.data.envelope.sourceKey };
    const destination = await deps.fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    if (!destination.ok) {
      log({ lane, receiptId: key, status: 'delivery_uncertain', code: `AIRTABLE_HTTP_${destination.status}` });
      throw new Error('DELIVERY_UNCERTAIN');
    }
    log({ lane, receiptId: key, status: 'accepted_pending_airtable' });
    return 'accepted_pending_airtable';
  };
  let receiptId = '';
  try {
    if (req.method === 'GET') {
      if (!authorized()) return response(401, { error: 'UNAUTHORIZED' });
      const slot = await read(store, laneKey);
      const all = await receipts();
      const selected = new URL(req.url).searchParams.get('receiptId');
      if (selected && !validReceipt(selected)) return response(400, { error: 'INVALID_RECEIPT_ID' });
      return response(200, {
        lane, state: slot?.data?.state || 'idle',
        enabled: env(`JEF_${lane.toUpperCase()}_INTAKE_V2_ENABLED`) === 'true',
        dispatchPaused: dispatchPaused(),
        active: slot?.data?.state === 'active' ? inspect(slot.data.receiptId, await read(store, slot.data.receiptId)) : null,
        last: slot?.data?.lastReceiptId ? inspect(slot.data.lastReceiptId, await read(store, slot.data.lastReceiptId)) : null,
        receipt: selected ? inspect(selected, await read(store, selected)) : null,
        counts: Object.fromEntries(['queued', 'dispatching', 'claimed', 'done', 'exception', 'failed', 'superseded'].map(status => [status, all.filter(v => v.data.status === status).length])),
        attention: all.filter(v => ['queued', 'dispatching', 'claimed', 'failed', 'exception'].includes(v.data.status)).slice(-50).map(v => inspect(v.key, v)),
      });
    }
    if (req.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    if (Number(req.headers.get('content-length') || 0) > 1000000) return response(413, { error: 'PAYLOAD_TOO_LARGE' });
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      let body: any;
      try { body = await req.json(); } catch { return response(400, { error: 'INVALID_JSON' }); }
      if (!['claim', 'complete', 'retry'].includes(body?.action) || !validReceipt(body.receiptId)) return response(400, { error: 'INVALID_CONTROL_REQUEST' });
      receiptId = body.receiptId;
      let receipt = await read(store, receiptId);
      if (body.action === 'retry') {
        if (!authorized()) return response(401, { error: 'UNAUTHORIZED' });
        if (!receipt) return response(404, { error: 'RECEIPT_NOT_FOUND' });
        const head = await sourceHead(receipt.data.envelope.submissionId);
        receipt = await read(store, receiptId);
        if (receipt.data.status === 'claimed') return response(409, { error: 'ACTIVE_WRITER_REQUIRES_REVIEW' });
        if (['done', 'exception', 'superseded'].includes(receipt.data.status)) return response(200, { replay: true, status: receipt.data.status });
        if (receipt.data.status === 'failed' && head?.data.receiptId !== receiptId) return response(409, { error: 'STALE_OCCURRENCE_REQUIRES_REVIEW' });
        if (receipt.data.status === 'failed' && !await cas(store, receiptId, { ...receipt.data, status: 'queued', token: null, consumerToken: null }, receipt)) return response(409, { error: 'RETRY_RACE' });
        return response(202, { status: await dispatch(receiptId) });
      }
      if (!receipt || !equal(body.token, receipt.data.token)) return response(403, { error: 'INVALID_RECEIPT' });
      const slot = await read(store, laneKey);
      if (body.action === 'claim') {
        if (['done', 'exception', 'superseded'].includes(receipt.data.status)) return response(200, { skip: true, status: receipt.data.status });
        if (!slot || slot.data.receiptId !== receiptId || !equal(slot.data.token, body.token) || receipt.data.status !== 'dispatching') return response(409, { error: 'ALREADY_CLAIMED_OR_NOT_ACTIVE' });
        const consumerToken = token();
        if (!await cas(store, receiptId, { ...receipt.data, status: 'claimed', claimedAt: now(), consumerToken }, receipt)) return response(409, { error: 'CLAIM_RACE' });
        return response(200, { skip: false, consumerToken, envelope: receipt.data.envelope });
      }
      if (!equal(body.consumerToken, receipt.data.consumerToken) || !['done', 'exception', 'failed'].includes(body.status)) return response(403, { error: 'INVALID_COMPLETION' });
      const result = { status: body.status, recordIds: Array.isArray(body.recordIds) ? body.recordIds.filter((v: any) => /^rec[A-Za-z0-9]{14}$/.test(v)).slice(0, 20) : [], code: text(body.code).slice(0, 150) };
      if (receipt.data.status === 'claimed') {
        if (!await cas(store, receiptId, { ...receipt.data, status: body.status, completedAt: now(), result }, receipt)) return response(409, { error: 'COMPLETION_RACE' });
      } else if (receipt.data.status !== body.status) return response(409, { error: 'COMPLETION_STATE_CONFLICT' });
      if (slot?.data?.receiptId === receiptId && equal(slot.data.token, body.token)) {
        if (!await cas(store, laneKey, { state: 'idle', lastReceiptId: receiptId }, slot)) return response(503, { error: 'SLOT_RELEASE_UNCONFIRMED' });
      }
      log({ lane, receiptId, ...result });
      // Failure to dispatch the next receipt does not falsify this receipt's result.
      try { await dispatch(); } catch { log({ lane, status: 'queue_dispatch_failed' }); }
      return response(200, { acknowledged: true, status: body.status });
    }
    const apiKey = env('JOTFORM_API_KEY');
    if (!apiKey) return response(503, { error: 'INTAKE_NOT_CONFIGURED' });
    webhook();
    let form: FormData;
    try { form = await req.formData(); } catch { return response(400, { error: 'INVALID_FORM_DATA' }); }
    const submissionId = text(form.get('submissionID') ?? form.get('submission_id'));
    const formId = text(form.get('formID') ?? form.get('form_id'));
    if (!/^\d{16,22}$/.test(submissionId) || formId !== FORMS[lane]) return response(400, { error: 'INVALID_SOURCE_IDENTITY' });
    const provider = await deps.fetch(`https://api.jotform.com/submission/${submissionId}`, { headers: { APIKEY: apiKey }, signal: AbortSignal.timeout(15000) });
    if (!provider.ok) return response(provider.status === 404 ? 400 : 503, { error: 'PROVIDER_LOOKUP_FAILED' });
    const body = await provider.json();
    if (body.responseCode !== 200 || body.content?.id !== submissionId) return response(503, { error: 'PROVIDER_RESPONSE_INVALID' });
    const envelope = normalizeSubmission(lane, body.content, now());
    receiptId = await admit(envelope);
    const existing = await read(store, receiptId);
    if (!existing) throw new Error('RECEIPT_WRITE_UNCONFIRMED');
    if (['done', 'exception'].includes(existing.data.status)) return response(200, { received: true, status: existing.data.status, replay: true, sourceEventKey: envelope.sourceKey });
    if (existing.data.status === 'failed') {
      if (!await cas(store, receiptId, { ...existing.data, status: 'queued', token: null, consumerToken: null }, existing)) return response(503, { error: 'RETRY_RACE' });
    }
    return response(202, { received: true, status: await dispatch(receiptId), sourceEventKey: envelope.sourceKey });
  } catch (error) {
    log({ lane, receiptId, status: 'failed_or_uncertain', code: error instanceof Error ? error.name : 'ERROR' });
    return response(503, { error: 'INTAKE_FAILED_OR_UNCERTAIN' });
  }
}
