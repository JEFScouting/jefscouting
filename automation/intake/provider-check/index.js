'use strict';
const { checkProvider } = require('./check.cjs');
module.exports = {
  onPreBuild: async ({ utils }) => {
    const report = await checkProvider({ env: process.env, fetchImpl: fetch, now: Date.now() });
    utils.status.show({ title: 'JEF intake provider check', summary: 'Read-only provider configuration and authenticated adapter status; no intake writes or activation.', text: JSON.stringify(report) });
  },
};
