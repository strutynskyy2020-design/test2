const assert = require('assert');
const { handler } = require('./netlify/functions/google-goals.js');

const run = async ({ user, scriptPayloadByLogin, query = {} }) => {
  process.env.BACKEND_API_URL = 'https://backend.test';
  process.env.GOOGLE_GOALS_SCRIPT_URL = 'https://script.test/exec';
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/auth/me')) {
      return { ok: true, json: async () => user };
    }
    const login = new URL(href).searchParams.get('goals_login');
    const payload = scriptPayloadByLogin[login];
    return { ok: true, status: 200, json: async () => payload };
  };
  const result = await handler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer test' },
    queryStringParameters: query,
  });
  assert.equal(result.statusCode, 200);
  return JSON.parse(result.body);
};

(async () => {
  const emailFallback = await run({
    user: { role: 'employee', email: 'mukovoz@example.com', goals_login: null },
    scriptPayloadByLogin: {
      mukovoz: { success: true, found: false, schedule: { found: true, employee: { login: 'mukovoz' }, days: [] }, api_version: 'v100' },
    },
  });
  assert.equal(emailFallback.schedule.found, true);
  assert.equal(emailFallback.schedule.lookup.matched_login, 'mukovoz');

  const staleScript = await run({
    user: { role: 'employee', email: 'mukovoz@example.com', goals_login: 'mukovoz' },
    scriptPayloadByLogin: {
      mukovoz: { success: true, found: true, goals: {} },
    },
  });
  assert.equal(staleScript.schedule.reason, 'schedule_payload_missing');

  const adminOverride = await run({
    user: { role: 'admin', email: 'admin@example.com', goals_login: null },
    query: { schedule_login: 'nechyolv' },
    scriptPayloadByLogin: {
      admin: { success: true, found: false, schedule: { found: false, reason: 'schedule_login_not_found', days: [] }, api_version: 'v100' },
      nechyolv: { success: true, found: false, schedule: { found: true, employee: { login: 'nechyolv' }, days: [] }, api_version: 'v100' },
    },
  });
  assert.equal(adminOverride.schedule.found, true);
  assert.equal(adminOverride.schedule.lookup.matched_login, 'nechyolv');

  console.log('Validated V100 schedule gateway fallbacks, stale deployment diagnostics, and admin override');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
