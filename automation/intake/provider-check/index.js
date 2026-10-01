'use strict';
const { checkProvider } = require('./check.cjs');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { constants: cryptoConstants, publicEncrypt, randomBytes, createCipheriv } = require('node:crypto');
module.exports = {
  onPreBuild: async ({ utils, constants }) => {
    const report = await checkProvider({ env: process.env, fetchImpl: fetch, now: Date.now() });
    utils.status.show({ title: 'JEF intake provider check', summary: 'Read-only provider configuration and authenticated adapter status; no intake writes or activation.', text: JSON.stringify(report) });
    // Connector deploy metadata does not expose plugin reports. Provide the same
    // bounded readback encrypted to the operator; no plaintext report is published.
    const key = randomBytes(32), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(report), 'utf8'), cipher.final()]);
    const encryptedKey = publicEncrypt({ key: await readFile(join(__dirname, 'public.pem')), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
    const b64 = v => v.toString('base64');
    await writeFile(join(constants.PUBLISH_DIR, 'jef-intake-provider-check.enc.json'), JSON.stringify({ version: 1, algorithm: 'RSA-OAEP-SHA256+A256GCM', encryptedKey: b64(encryptedKey), iv: b64(iv), tag: b64(cipher.getAuthTag()), ciphertext: b64(ciphertext) }));
  },
};
