/**
 * Outbox unit tests.
 *
 * The outbox is the thing standing between a dropped connection and lost text,
 * so its ordering, dedupe and give-up behaviour are worth pinning down.
 * Run with: node client/tests/outbox.test.mjs
 */
let failures = 0;

function check(label, cond, extra) {
  if (!cond) failures += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra)}` : ''}`);
}

// Minimal localStorage so the module under test runs unmodified in node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const outbox = await import('../src/lib/outbox.js');

const entry = (nonce, conversationId = 'c1', body = nonce) =>
  ({ clientNonce: nonce, conversationId, body, replyTo: null });

// --- basics -----------------------------------------------------------------
outbox.enqueue(entry('a'));
outbox.enqueue(entry('b'));
check('enqueues in order', outbox.list().map((e) => e.clientNonce).join(',') === 'a,b');

outbox.enqueue(entry('a'));
check('ignores a duplicate nonce', outbox.list().length === 2);

outbox.enqueue(entry('c', 'c2'));
check('filters by conversation', outbox.pendingFor('c1').length === 2);
check('filters by conversation (other)', outbox.pendingFor('c2').length === 1);

outbox.remove('a');
check('removes by nonce', outbox.list().map((e) => e.clientNonce).join(',') === 'b,c');

// --- survives a reload ------------------------------------------------------
const reloaded = await import(`../src/lib/outbox.js?reload=${Date.now()}`);
check('survives a page reload', reloaded.list().length === 2, reloaded.list());

// --- flush ------------------------------------------------------------------
store.clear();
outbox.enqueue(entry('1'));
outbox.enqueue(entry('2'));
outbox.enqueue(entry('3'));

const order = [];
let result = await outbox.flush(async (e) => { order.push(e.clientNonce); });
check('flush sends everything', result.sent === 3 && result.failed === 0, result);
check('flush preserves typing order', order.join(',') === '1,2,3', order);
check('flush empties the queue on success', outbox.list().length === 0);

// --- flush stops at the first failure ---------------------------------------
store.clear();
outbox.enqueue(entry('x'));
outbox.enqueue(entry('y'));
outbox.enqueue(entry('z'));

const attempted = [];
result = await outbox.flush(async (e) => {
  attempted.push(e.clientNonce);
  if (e.clientNonce === 'y') throw new Error('link down');
});

check('stops at the first failure', attempted.join(',') === 'x,y', attempted);
check('reports what got through', result.sent === 1 && result.failed === 1, result);
check('keeps the undelivered ones queued',
  outbox.list().map((e) => e.clientNonce).join(',') === 'y,z', outbox.list());

// A retry once the link is back must deliver the rest, in order.
const retried = [];
result = await outbox.flush(async (e) => { retried.push(e.clientNonce); });
check('retry delivers the remainder in order', retried.join(',') === 'y,z', retried);
check('queue is empty after a successful retry', outbox.list().length === 0);

// --- gives up eventually ----------------------------------------------------
store.clear();
outbox.enqueue(entry('doomed'));
for (let i = 0; i < 60; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  await outbox.flush(async () => { throw new Error('rejected'); });
}
check('drops a message that can never send', outbox.list().length === 0, outbox.list());

// --- corrupt storage --------------------------------------------------------
store.set('halo:outbox:v1', 'not json at all');
check('survives corrupt storage', Array.isArray(outbox.list()) && outbox.list().length === 0);

store.set('halo:outbox:v1', '{"not":"an array"}');
check('survives a non-array payload', outbox.list().length === 0);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
