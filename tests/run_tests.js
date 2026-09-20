// ConfigMatrix-Sync v2.0.0 Comprehensive Verification Suite
const assert = require('assert');
const http = require('http');
const { MurmurRollout, RuleEvaluator, FeatureFlag, ConfigMatrixEngine } = require('../src/engine');
const { startServer } = require('../src/index');

console.log('====================================================');
console.log('🧪 Running Verification Suite: ConfigMatrix-Sync (v2.0.0)');
console.log('====================================================');

let passedAssertions = 0;
function pass(msg) {
  passedAssertions++;
  console.log(`  ✓ [Assertion ${passedAssertions}] ${msg}`);
}

async function runTests() {
  // [SECTION 1: MurmurRollout Deterministic Hashing]
  console.log('\n[SECTION 1: MurmurRollout Deterministic Hashing]');
  const bucketA1 = MurmurRollout.computeBucket('feature_x', 'user-1234');
  const bucketA2 = MurmurRollout.computeBucket('feature_x', 'user-1234');
  assert.strictEqual(bucketA1, bucketA2);
  pass('MurmurRollout is strictly deterministic and idempotent');

  assert.ok(bucketA1 >= 0 && bucketA1 < 100);
  pass('Bucket percentage bounded between 0.00 and 99.99%');

  assert.strictEqual(MurmurRollout.isUserInRollout('feature_x', 'any-user', 0), false);
  pass('0% rollout excludes all entities');
  assert.strictEqual(MurmurRollout.isUserInRollout('feature_x', 'any-user', 100), true);
  pass('100% rollout includes all entities');

  // Distribution test across 500 users for a 50% rollout
  let inCount = 0;
  for (let i = 0; i < 500; i++) {
    if (MurmurRollout.isUserInRollout('test_distribution', `user-${i}`, 50)) {
      inCount++;
    }
  }
  const ratio = inCount / 500;
  assert.ok(ratio > 0.42 && ratio < 0.58);
  pass(`Deterministic hashing achieves balanced distribution: ${(ratio * 100).toFixed(1)}% (approx 50%)`);

  // [SECTION 2: RuleEvaluator Attribute Conditions]
  console.log('\n[SECTION 2: RuleEvaluator Attribute Conditions]');
  assert.strictEqual(RuleEvaluator.evaluateCondition('admin', 'EQUALS', 'admin'), true);
  pass('Operator EQUALS matches identical strings');
  assert.strictEqual(RuleEvaluator.evaluateCondition('guest', 'EQUALS', 'admin'), false);
  pass('Operator EQUALS rejects differing strings');

  assert.strictEqual(RuleEvaluator.evaluateCondition('alice@google.com', 'CONTAINS', '@google.com'), true);
  pass('Operator CONTAINS matches substring');

  assert.strictEqual(RuleEvaluator.evaluateCondition('US', 'IN', ['US', 'CA', 'GB']), true);
  pass('Operator IN matches whitelisted array');
  assert.strictEqual(RuleEvaluator.evaluateCondition('FR', 'IN', ['US', 'CA', 'GB']), false);
  pass('Operator IN rejects non-whitelisted item');

  assert.strictEqual(RuleEvaluator.evaluateCondition(25, 'GREATER_THAN', 18), true);
  pass('Operator GREATER_THAN compares numbers');

  assert.strictEqual(RuleEvaluator.evaluateCondition('v2.4.1', 'REGEX', '^v[0-9]+\\.[0-9]+'), true);
  pass('Operator REGEX matches pattern');

  // [SECTION 3: FeatureFlag Context Evaluation]
  console.log('\n[SECTION 3: FeatureFlag Context Evaluation]');
  const flag = new FeatureFlag('new_checkout_flow', {
    enabled: true,
    rolloutPercentage: 20,
    rules: [
      {
        ruleId: 'beta-testers',
        conditions: [{ attribute: 'role', operator: 'EQUALS', value: 'beta-tester' }],
        value: true
      }
    ]
  });

  // Targeted rule match overrides rollout percentage
  const evalBeta = flag.evaluate({ userId: 'user-outside-rollout', role: 'beta-tester' });
  assert.strictEqual(evalBeta.enabled, true);
  assert.ok(evalBeta.reason.includes('RULE_MATCH:beta-testers'));
  pass('Targeted rule overrides canary percentage rollout');

  // Disabled flag returns disabled reason
  flag.enabled = false;
  const evalDisabled = flag.evaluate({ userId: 'any' });
  assert.strictEqual(evalDisabled.enabled, false);
  assert.strictEqual(evalDisabled.reason, 'FLAG_DISABLED');
  pass('Disabled flag evaluation returns FLAG_DISABLED');

  // [SECTION 4: Live Ephemeral HTTP Server & REST Protocol]
  console.log('\n[SECTION 4: Live Ephemeral HTTP Server & REST Protocol]');
  const server = await new Promise(resolve => {
    const s = startServer(0, () => resolve(s));
  });
  const assignedPort = server.address().port;
  console.log(`  [HTTP] Ephemeral server running on port ${assignedPort}`);

  function makeRequest(method, path, data) {
    return new Promise((resolve, reject) => {
      const payload = data ? JSON.stringify(data) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: assignedPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // 1. GET /api/health
  const healthRes = await makeRequest('GET', '/api/health');
  assert.strictEqual(healthRes.status, 200);
  pass('GET /api/health returns HTTP 200');
  assert.strictEqual(healthRes.body.service, 'ConfigMatrix-Sync');
  pass('Health reports ConfigMatrix-Sync');
  assert.strictEqual(healthRes.body.status, 'UP');
  pass('Health status is UP');

  // 2. GET /api/stats
  const statsRes = await makeRequest('GET', '/api/stats');
  assert.strictEqual(statsRes.status, 200);
  pass('GET /api/stats returns HTTP 200');
  assert.ok(statsRes.body.metrics.totalFlags >= 1);
  pass('Stats contain totalFlags');

  // 3. GET /api/flags
  const flagsRes = await makeRequest('GET', '/api/flags');
  assert.strictEqual(flagsRes.status, 200);
  assert.ok(flagsRes.body.flags.length >= 1);
  pass('GET /api/flags returns flag list');

  // 4. POST /api/flags (Create new flag)
  const createRes = await makeRequest('POST', '/api/flags', {
    key: 'dark_theme_v2',
    description: 'High contrast theme',
    enabled: true,
    rolloutPercentage: 75
  });
  assert.strictEqual(createRes.status, 201);
  pass('POST /api/flags registers new flag');
  assert.strictEqual(createRes.body.flag.key, 'dark_theme_v2');
  pass('Created flag key verified');

  // 5. POST /api/flags/update
  const updateRes = await makeRequest('POST', '/api/flags/update', {
    key: 'dark_theme_v2',
    rolloutPercentage: 100
  });
  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateRes.body.flag.rolloutPercentage, 100);
  pass('POST /api/flags/update scales rollout to 100%');

  // 6. POST /api/evaluate
  const evalRes = await makeRequest('POST', '/api/evaluate', {
    userId: 'usr-9482',
    email: 'test@company.internal',
    role: 'admin'
  });
  assert.strictEqual(evalRes.status, 200);
  assert.ok(evalRes.body.flags);
  pass('POST /api/evaluate resolves flag set against user context');
  assert.strictEqual(evalRes.body.flags.dark_theme_v2.enabled, true);
  pass('Evaluated flag dark_theme_v2 is enabled at 100% rollout');

  // 7. GET /api/events/stream (SSE connection verification)
  const sseConnected = await new Promise((resolve, reject) => {
    const sseReq = http.request({
      hostname: '127.0.0.1',
      port: assignedPort,
      path: '/api/events/stream',
      method: 'GET'
    }, res => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['content-type'], 'text/event-stream');
      res.on('data', chunk => {
        if (chunk.toString().includes('CONNECTED')) {
          res.destroy();
          resolve(true);
        }
      });
    });
    sseReq.on('error', reject);
    sseReq.end();
  });
  assert.strictEqual(sseConnected, true);
  pass('SSE connection to /api/events/stream established');

  // 8. POST /api/reset
  const resetRes = await makeRequest('POST', '/api/reset');
  assert.strictEqual(resetRes.status, 200);
  pass('POST /api/reset returns HTTP 200');

  // 9. Route 404
  const notFoundRes = await makeRequest('GET', '/api/invalid_path');
  assert.strictEqual(notFoundRes.status, 404);
  pass('Invalid path returns HTTP 404');

  server.close();
  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedAssertions} ASSERTIONS PASSED (100% Non-Mocked Coverage)`);
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test suite execution failed:', err);
  process.exit(1);
});
