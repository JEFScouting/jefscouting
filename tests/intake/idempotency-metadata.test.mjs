import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIntake } from '../../netlify/functions/_shared/intake-transport.mts';
import { digest } from '../../netlify/functions/_shared/intake-normalize.mts';
import { FakeStore, source } from './harness.mjs';

function setup() {
  const store = new FakeStore(), sent = [], logs = [];
  let provider = source('candidate');
  const config = {
    JOTFORM_API_KEY: 'test-provider-key',
    JOTFORM_ADMIN_SECRET: 'test-admin-key',
    AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL: 'https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/test/candidate',
    JEF_CANDIDATE_INTAKE_V2_ENABLED: 'true',
  };
  const deps = {
    store,
    env: key => config[key],
    log: value => logs.push(value),
    now: () => '2026-10-05T18:35:00.000Z',
    fetch: async (url, options) => {
      if (String(url).startsWith('https://api.jotform.com/submission/')) return Response.json({ responseCode: 200, content: provider });
      sent.push(JSON.parse(options.body));
      return Response.json({ success: true });
    },
  };
  const request = () => {
    const body = new FormData();
    body.set('submissionID', provider.id);
    body.set('formID', provider.form_id);
    return new Request('https://jefscouting.com/api/candidate-jotform-webhook', { method: 'POST', body });
  };
  const deliver = () => handleIntake(request(), 'candidate', deps);
  const control = (action, extra = {}) => handleIntake(new Request('https://jefscouting.com/api/candidate-jotform-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...sent.at(-1), action, ...extra }),
  }), 'candidate', deps);
  const complete = async () => {
    const claim = await (await control('claim')).json();
    assert.equal(claim.skip, false);
    assert.equal((await control('complete', { consumerToken: claim.consumerToken, status: 'done', recordIds: [] })).status, 200);
  };
  return { store, sent, logs, deliver, complete, setProvider: value => { provider = value; } };
}

const receiptKeys = store => [...store.entries.keys()].filter(key => key.startsWith('receipt/candidate/'));

test('provider updated_at alone replays the same completed receipt', async () => {
  const x = setup();
  const first = source('candidate');
  first.updated_at = '2026-10-05 15:31:00';
  x.setProvider(first);
  assert.equal((await x.deliver()).status, 202);
  await x.complete();
  assert.equal(receiptKeys(x.store).length, 1);

  const replay = structuredClone(first);
  replay.updated_at = '2026-10-05 15:56:52';
  x.setProvider(replay);
  const response = await x.deliver();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replay, true);
  assert.equal(x.sent.length, 1);
  assert.equal(receiptKeys(x.store).length, 1);
});

test('a real answer change still creates a new semantic version', async () => {
  const x = setup();
  const first = source('candidate');
  first.updated_at = '2026-10-05 15:31:00';
  x.setProvider(first);
  assert.equal((await x.deliver()).status, 202);
  await x.complete();

  const changed = source('candidate', first.id, { 34: 'Server' });
  changed.updated_at = '2026-10-05 15:56:52';
  x.setProvider(changed);
  assert.equal((await x.deliver()).status, 202);
  assert.equal(x.sent.length, 2);
  assert.equal(receiptKeys(x.store).length, 2);
});

test('first post-patch replay reuses an equivalent pre-patch legacy receipt', async () => {
  const x = setup();
  const first = source('candidate');
  first.updated_at = '2026-10-05 15:31:00';
  x.setProvider(first);
  assert.equal((await x.deliver()).status, 202);
  await x.complete();

  const stableKey = receiptKeys(x.store)[0];
  const stored = x.store.entries.get(stableKey);
  const legacy = structuredClone(stored);
  legacy.data.envelope.version = digest(legacy.data.envelope.snapshot);
  const legacyKey = `receipt/candidate/${first.id}/${legacy.data.envelope.version}`;
  x.store.entries.delete(stableKey);
  // Emulate pre-patch storage, which had no occurrence admission head.
  x.store.entries.delete(`head/candidate/${first.id}`);
  x.store.entries.set(legacyKey, legacy);

  const replay = structuredClone(first);
  replay.updated_at = '2026-10-05 16:15:00';
  x.setProvider(replay);
  const response = await x.deliver();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replay, true);
  assert.equal(x.sent.length, 1);
  assert.deepEqual(receiptKeys(x.store), [legacyKey]);
});
