import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../../automation/intake/provider-check/check.cjs';

const env = { SITE_ID: '0b736ac6-14f3-4766-9ed4-15561e64d17e', CONTEXT: 'production', JOTFORM_API_KEY: 'provider-secret', JOTFORM_ADMIN_SECRET: 'admin-secret' };
const now = Date.parse('2026-10-01T13:30:00Z');

test('provider release check is bounded to the existing production site and expires', async () => {
  for (const overrides of [{ SITE_ID: 'other' }, { CONTEXT: 'deploy-preview' }]) {
    const r = await plugin.checkProvider({ env: { ...env, ...overrides }, now, fetchImpl: () => assert.fail('must not call provider') });
    assert.equal(r.mode, 'SKIPPED_OUTSIDE_BOUNDED_PRODUCTION_CHECK');
  }
  const expired = await plugin.checkProvider({ env, now: Date.parse('2026-10-04'), fetchImpl: () => assert.fail('must not call provider') });
  assert.equal(expired.mode, 'SKIPPED_OUTSIDE_BOUNDED_PRODUCTION_CHECK');
});

test('provider check makes GETs only and never returns secrets, webhook URLs or source answers', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    if (url.startsWith('https://jefscouting.com')) return Response.json({ state: 'idle', counts: { done: 2 }, token: 'private-token', answers: 'private-answers' });
    if (url.endsWith('/webhooks')) {
      const lane = url.includes('261480775333056') ? 'candidate' : 'client';
      return Response.json({ responseCode: 200, content: { 1: 'https://jefscouting.com/api/' + lane + '-jotform-webhook', 2: 'https://hooks.airtable.com/private-secret?auth=hidden' } });
    }
    if (url.endsWith('/questions')) return Response.json({ responseCode: 200, content: { 3: { type: 'control_fullname', text: 'private-details' } } });
    return Response.json({ responseCode: 200, content: [{ id: '9000000000000000001', created_at: '2026-10-01 09:30:00', status: 'ACTIVE', answers: { email: 'private@example.invalid' } }] });
  };
  const result = await plugin.checkProvider({ env, now, fetchImpl });
  assert.equal(calls.length, 10);
  assert.equal(result.forms.candidate.webhooks.destinations[0].kind, 'EXISTING_CANONICAL_ADAPTER');
  assert.equal(result.forms.client.webhooks.destinations[1].kind, 'DIRECT_AIRTABLE');
  assert.equal(result.forms.client.adapter.counts.done, 2);
  for (const secret of ['provider-secret', 'admin-secret', 'private-token', 'private-secret', 'hidden', 'private-answers', 'private-details', 'private@example.invalid', 'https://']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('provider failures are sanitized and unexpected webhook shapes remain explicit', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/webhooks')) return Response.json({ responseCode: 200, content: { 1: { url: 'private-secret' } } });
    if (url.endsWith('/questions')) return Response.json({ responseCode: 401, content: 'provider-secret' });
    throw new Error('private-secret');
  };
  const r = await plugin.checkProvider({ env, now, fetchImpl });
  assert.equal(r.forms.client.webhooks.destinations[0].kind, 'UNEXPECTED_PROVIDER_SHAPE');
  assert.equal(r.forms.client.questions.error, 'PROVIDER_RESPONSE_REJECTED');
  assert.ok(!JSON.stringify(r).includes('private-secret'));
});
