const http = require('http');
const url = require('url');
const path = require('path');

const BUILD_TIME = new Date().toISOString();

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);
  if (pathname === '/health') {
    const headers = {
      'Content-Type': 'text/plain',
      'X-Server-File': __filename,
      'X-Server-Dir': __dirname
    };
    res.writeHead(200, headers);
    return res.end('OK');
  }
  if (pathname === '/healthz') {
    const payload = JSON.stringify({
      status: 'OK',
      serverFile: __filename,
      serverDir: __dirname,
      viewsDir: null
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(payload);
  }
  if (pathname === '/version') {
    let version = 'unknown';
    try {
      const pkg = require(path.join(__dirname, 'package.json'));
      version = pkg.version || version;
    } catch {}
    const payload = JSON.stringify({
      version,
      buildTime: BUILD_TIME,
      nodeEnv: process.env.NODE_ENV || 'development',
      serverDir: __dirname,
      viewsDir: null
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(payload);
  }
  if (pathname === '/runtime') {
    const payload = JSON.stringify({
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      serverFile: __filename,
      serverDir: __dirname,
      viewsDir: null,
      env: {
        NODE_ENV: process.env.NODE_ENV || null,
        PORT: process.env.PORT || null,
        RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || null,
        RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME || null,
        RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID || null,
      }
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(payload);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Servidor básico funcionando!</h1><p>Teste de servidor HTTP nativo</p>');
});

const PORT = 3001;

server.listen(PORT, () => {
  console.log(`Servidor básico rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});

// Manter o processo vivo
setInterval(() => {
  console.log('Servidor ainda ativo:', new Date().toLocaleTimeString());
}, 5000);

// Capturar sinais
process.on('SIGINT', () => {
  console.log('\nRecebido SIGINT. Encerrando...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nRecebido SIGTERM. Encerrando...');
  server.close(() => {
    process.exit(0);
  });
});
