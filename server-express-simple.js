const express = require('express');
const path = require('path');

const app = express();
const PORT = 3002;

// Healthcheck
app.get('/health', (req, res) => {
  try {
    res.set('X-Server-File', __filename);
    res.set('X-Server-Dir', __dirname);
  } catch {}
  res.status(200).send(`OK - ${__filename}`);
});

// Version e diagnóstico rápido
const BUILD_TIME = new Date().toISOString();
app.get('/version', (req, res) => {
  let version = 'unknown';
  try {
    const pkg = require(path.join(__dirname, 'package.json'));
    version = pkg.version || version;
  } catch {}
  res.json({
    version,
    buildTime: BUILD_TIME,
    nodeEnv: process.env.NODE_ENV || 'development',
    serverDir: __dirname,
    viewsDir: app.get('views')
  });
});

// Health detalhado
app.get('/healthz', (req, res) => {
  res.json({
    status: 'OK',
    serverFile: __filename,
    serverDir: __dirname,
    viewsDir: app.get('views')
  });
});

// Quem está rodando? Rota simples para identificar o arquivo
app.get('/__whoami', (req, res) => {
  res.status(200).send(__filename);
});

// Runtime diagnóstico
app.get('/runtime', (req, res) => {
  try {
    res.json({
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      serverFile: __filename,
      serverDir: __dirname,
      viewsDir: app.get('views'),
      env: {
        NODE_ENV: process.env.NODE_ENV || null,
        PORT: process.env.PORT || null,
        RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || null,
        RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME || null,
        RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID || null,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// Debug: listar rotas registradas
app.get('/debug/routes', (req, res) => {
  try {
    const routes = [];
    const stack = app._router && app._router.stack ? app._router.stack : [];
    for (const layer of stack) {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
        routes.push({ path: layer.route.path, methods });
      }
    }
    res.json({ serverFile: __filename, serverDir: __dirname, routes });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get('/', (req, res) => {
  res.send('<h1>Express funcionando!</h1>');
});

// Manter o processo vivo
setInterval(() => {
  console.log('Express ainda ativo:', new Date().toLocaleTimeString());
}, 5000);

app.listen(PORT, () => {
  console.log(`Express simples rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});
