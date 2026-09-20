// ConfigMatrix-Sync Comprehensive Verification Suite
const assert = require('assert');
const http = require('http');
const CoreEngine = require('../src/engine');

console.log('====================================================');
console.log('🧪 Running Verification Suite: ConfigMatrix-Sync');
console.log('====================================================');

// 1. Unit Tests
console.log('[UNIT] Testing Core Algorithmic Engine...');
const engine = new CoreEngine();
const r1 = engine.process({ id: 'test-1', data: 'sample' });
assert.strictEqual(r1.status, 'PROCESSED');
assert.strictEqual(engine.count(), 1);
assert.strictEqual(engine.get('test-1').id, 'test-1');
console.log('✓ Unit Test 1 Passed: Core process & state management verified.');

// 2. Integration HTTP Server Tests
console.log('[INTEGRATION] Booting Ephemeral HTTP Server...');
const { startServer } = require('../src/index');
const server = startServer(0, () => {
  const ephemeralPort = server.address().port;
  console.log('[INTEGRATION] Active on ephemeral test port ' + ephemeralPort);

  http.get('http://127.0.0.1:' + ephemeralPort + '/api/health', (res) => {
    assert.strictEqual(res.statusCode, 200);
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      const json = JSON.parse(body);
      assert.strictEqual(json.status, 'UP');
      console.log('✓ Integration Health Test Passed.');

      // POST /api/process
      const postData = JSON.stringify({ id: 'req-http', payload: 'test' });
      const req = http.request({
        hostname: '127.0.0.1',
        port: ephemeralPort,
        path: '/api/process',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, (postRes) => {
        assert.strictEqual(postRes.statusCode, 200);
        console.log('✓ Integration POST /api/process Passed.');

        server.close(() => {
          console.log('🎉 ALL TESTS PASSED (100% assertions verified).');
          process.exit(0);
        });
      });
      req.write(postData);
      req.end();
    });
  });
});
