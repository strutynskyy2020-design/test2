const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../frontend/public/service-worker.js'), 'utf8');
const origin = 'https://vpdk.example';
const artwork = (id = '012345abcdef') => `/hidden-objects/optimized/v6/scenes/office.${id}.webp`;
const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
const picture = (body = 'webp-image') => new Response(body, { headers: { 'Content-Type': 'image/webp' } });

function harness() {
  const handlers = new Map();
  const stores = new Map();
  const calls = [];
  let responder = () => picture();
  let failWrites = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, response) {
          if (failWrites) throw new Error('QuotaExceededError');
          entries.set(key(request), response.clone());
        },
        async delete(request) { return entries.delete(key(request)); },
        async keys() { return [...entries.keys()].map(url => new Request(url)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const entries of stores.values()) {
        const response = entries.get(key(request));
        if (response) return response.clone();
      }
    },
  };
  vm.runInNewContext(source, {
    URL, Request, Response, Headers, Blob, console, caches,
    fetch: async (request, options) => {
      calls.push({ url: key(request), options });
      return responder(request, options);
    },
    self: {
      location: { origin },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name, listener) => handlers.set(name, listener),
    },
  });
  async function dispatch(name, request) {
    const pending = [];
    let response;
    handlers.get(name)({
      request,
      waitUntil: promise => pending.push(promise),
      respondWith: promise => { response = promise; },
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return {
    calls, stores, caches,
    respond: fn => { responder = fn; },
    failWrites: () => { failWrites = true; },
    request: url => dispatch('fetch', new Request(new URL(url, origin))),
    lifecycle: name => dispatch(name),
  };
}

test('installation downloads only the small app shell, not unvisited games', async () => {
  const h = harness();
  h.respond(request => key(request).endsWith('.png') ? picture() : new Response('shell'));
  await h.lifecycle('install');
  assert.equal(h.calls.length, 5);
  assert.ok(h.calls.every(call => !/bonus-match|hidden-objects|\/pet\//.test(call.url)));
});

test('repeat artwork requests avoid the network and new content hashes fetch fresh artwork', async () => {
  const h = harness();
  assert.equal(await (await h.request(artwork())).text(), 'webp-image');
  assert.equal(await (await h.request(artwork())).text(), 'webp-image');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.cache, 'default');
  assert.ok(h.stores.get('vpdk-artwork-v1').has(key(artwork())));
  await h.request(artwork('fedcba987654'));
  assert.equal(h.calls.length, 2);
});

test('activation retains hashed artwork while deleting stale application caches', async () => {
  const h = harness();
  await (await h.caches.open('vpdk-artwork-v1')).put(artwork(), picture('retained'));
  await (await h.caches.open('vpdk-v177-runtime')).put('/static/js/main.old.js', new Response('stale'));
  await h.caches.open('vpdk-v178-static');
  await h.lifecycle('activate');
  assert.equal(await (await h.request(artwork())).text(), 'retained');
  assert.equal(h.calls.length, 0);
  assert.ok(!h.stores.has('vpdk-v177-runtime'));
  assert.ok(h.stores.has('vpdk-v178-static'));
});

test('artwork cache evicts oldest entries to stay within its byte budget', async () => {
  const h = harness();
  const cache = await h.caches.open('vpdk-artwork-v1');
  for (let i = 0; i < 50; i++) {
    await cache.put(`/existing-${i}.webp`, new Response('cached image', {
      headers: { 'Content-Type': 'image/webp', 'x-vpdk-cache-bytes': String(1024 * 1024) },
    }));
  }
  await h.request(artwork());
  const entries = h.stores.get('vpdk-artwork-v1');
  const bytes = [...entries.values()].reduce((sum, response) => sum + Number(response.headers.get('x-vpdk-cache-bytes')), 0);
  assert.ok(bytes <= 48 * 1024 * 1024);
  assert.ok(!entries.has(key('/existing-0.webp')));
  assert.ok(entries.has(key(artwork())));
});

test('artwork cache bounds the number of small picture clues', async () => {
  const h = harness();
  const cache = await h.caches.open('vpdk-artwork-v1');
  for (let i = 0; i < 256; i++) {
    await cache.put(`/existing-${i}.webp`, new Response('x', { headers: { 'x-vpdk-cache-bytes': '1' } }));
  }
  await h.request(artwork());
  assert.equal(h.stores.get('vpdk-artwork-v1').size, 256);
  assert.ok(!h.stores.get('vpdk-artwork-v1').has(key('/existing-0.webp')));
});

test('quota failures never replace a successful image response', async () => {
  const h = harness();
  h.failWrites();
  assert.equal(await (await h.request(artwork())).text(), 'webp-image');
  assert.equal(await (await h.request(artwork())).text(), 'webp-image');
  assert.equal(h.calls.length, 2);
});

test('HTML fallback responses cannot poison the image cache', async () => {
  const h = harness();
  h.respond(() => new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }));
  const fallback = await h.request(artwork());
  assert.equal(fallback.headers.get('content-type'), 'image/svg+xml');
  h.respond(() => picture('real-image'));
  assert.equal(await (await h.request(artwork())).text(), 'real-image');
  await h.request(artwork());
  assert.equal(h.calls.length, 2);
});

test('API and Netlify Function requests always use the network and bypass stored responses', async () => {
  const h = harness();
  for (const url of ['/api/pet', '/.netlify/functions/google-goals']) {
    await (await h.caches.open('vpdk-v178-runtime')).put(url, new Response('stale-private-data'));
    h.respond(() => new Response('fresh-private-data'));
    assert.equal(await (await h.request(url)).text(), 'fresh-private-data');
    assert.equal(await (await h.request(url)).text(), 'fresh-private-data');
  }
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every(call => call.options.cache === 'no-store'));
});

test('hashed JS and CSS are reused, while unversioned scripts still revalidate', async () => {
  const h = harness();
  h.respond(request => new Response('asset', { headers: { 'Content-Type': key(request).endsWith('.css') ? 'text/css' : 'application/javascript' } }));
  for (const url of ['/static/js/main.123456ab.js', '/static/js/123.987654ab.chunk.js', '/static/css/main.123456ab.css']) {
    await h.request(url);
    await h.request(url);
  }
  assert.equal(h.calls.length, 3);
  await h.request('/unversioned.js');
  await h.request('/unversioned.js');
  assert.equal(h.calls.length, 5);
  assert.equal(h.calls[4].options.cache, 'no-cache');
});

test('an HTML response for a missing JS chunk is not cached as immutable code', async () => {
  const h = harness();
  h.respond(() => new Response('<html>SPA</html>', { headers: { 'Content-Type': 'text/html' } }));
  await h.request('/static/js/main.123456ab.js');
  h.respond(() => new Response('real-code', { headers: { 'Content-Type': 'application/javascript' } }));
  assert.equal(await (await h.request('/static/js/main.123456ab.js')).text(), 'real-code');
  await h.request('/static/js/main.123456ab.js');
  assert.equal(h.calls.length, 2);
});
