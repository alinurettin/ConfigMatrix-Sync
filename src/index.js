// ConfigMatrix-Sync v2.0.0 - Production HTTP Server & Dynamic Configuration Control Plane
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ConfigMatrixEngine } = require('./engine');

const engine = new ConfigMatrixEngine();
const PORT = parseInt(process.env.PORT, 10) || 6028;
const publicDir = path.join(__dirname, '..', 'public');
const startTime = Date.now();

// Pre-seed sample enterprise feature flags
engine.registerFlag('beta_dark_mode_ui', {
  description: 'Next-generation high-contrast dark UI palette',
  enabled: true,
  rolloutPercentage: 50,
  rules: [
    {
      ruleId: 'internal-employees',
      conditions: [{ attribute: 'email', operator: 'CONTAINS', value: '@company.internal' }],
      value: true
    }
  ]
});

engine.registerFlag('ai_code_completion_v2', {
  description: 'Real-time multi-token speculative decoding assistant',
  enabled: true,
  rolloutPercentage: 25,
  rules: [
    {
      ruleId: 'tier-pro-users',
      conditions: [{ attribute: 'role', operator: 'EQUALS', value: 'admin' }],
      value: true
    }
  ]
});

engine.registerFlag('payment_checkout_v3', {
  description: 'Stripe Elements 1-click checkout flow',
  enabled: false,
  rolloutPercentage: 0,
  defaultValue: false
});

function requestHandler(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // 1. SSE Real-Time Stream API
  if (pathname === '/api/events/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ event: 'CONNECTED', timestamp: Date.now() })}\n\n`);
    engine.subscribe(res);
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    // 2. Health API
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        status: 'UP',
        service: 'ConfigMatrix-Sync',
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString()
      }));
    }

    // 3. Stats API
    if (pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        success: true,
        service: 'ConfigMatrix-Sync',
        metrics: engine.getMetrics()
      }));
    }

    // 4. List Flags API
    if (req.method === 'GET' && pathname === '/api/flags') {
      const flags = Array.from(engine.flags.values());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: true, count: flags.length, flags }));
    }

    // 5. Create Flag API
    if (req.method === 'POST' && pathname === '/api/flags') {
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.key) throw new Error('"key" is required');
        const flag = engine.registerFlag(payload.key, payload);
        res.writeHead(201, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: true, flag }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 6. Update Flag API (POST /api/flags/update or PUT /api/flags/:key)
    if (req.method === 'POST' && pathname === '/api/flags/update') {
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.key) throw new Error('"key" is required');
        const flag = engine.updateFlag(payload.key, payload);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: true, flag }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 7. Evaluate Flags against User Context
    if (req.method === 'POST' && pathname === '/api/evaluate') {
      try {
        const payload = JSON.parse(body || '{}');
        const context = payload.context || payload;
        const evaluated = engine.evaluateAll(context);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: true, context, flags: evaluated }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 8. Reset API
    if (req.method === 'POST' && pathname === '/api/reset') {
      engine.reset();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: true, message: 'ConfigMatrix reset' }));
    }

    // 9. Static Web UI Files
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return res.end(fs.readFileSync(filePath));
    }

    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });
}

function startServer(portToUse = PORT, callback) {
  const server = http.createServer(requestHandler);
  server.listen(portToUse, callback);
  return server;
}

if (require.main === module) {
  startServer(PORT, () => {
    console.log('⚡ ConfigMatrix-Sync live at http://localhost:' + PORT);
  });
}

module.exports = { startServer, engine };
