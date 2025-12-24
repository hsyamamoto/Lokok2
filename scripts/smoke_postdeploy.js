// Post-deploy smoke test: validate /health and basic app readiness
// Usage:
//   node scripts/smoke_postdeploy.js <BASE_URL>
// or set SMOKE_BASE_URL env var.

const https = require('https');
const http = require('http');
const { URL } = require('url');

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.get(u, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
        }
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error(`Invalid JSON from ${urlStr}: ${err.message}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

async function main() {
  try {
    const baseUrl = process.env.SMOKE_BASE_URL || process.argv[2];
    if (!baseUrl) {
      console.error('[SMOKE:POST] Informe BASE_URL: node scripts/smoke_postdeploy.js https://seu-projeto.railway.app');
      process.exit(1);
    }

    const healthUrl = new URL('/health', baseUrl).toString();
    const versionUrl = new URL('/version', baseUrl).toString();

    const health = await fetchJson(healthUrl);
    console.log('[SMOKE:POST] /health OK');

    // Estrutura mínima esperada
    if (health.userSource !== 'database') {
      throw new Error('userSource não é "database"');
    }
    if (typeof health.usersCount !== 'number') {
      throw new Error('usersCount ausente ou inválido');
    }
    if (health.roleCounts && typeof health.roleCounts !== 'object') {
      throw new Error('roleCounts inválido');
    }
    if (health.usersActiveCount !== undefined && typeof health.usersActiveCount !== 'number') {
      throw new Error('usersActiveCount inválido');
    }
    if (health.usersInactiveCount !== undefined && typeof health.usersInactiveCount !== 'number') {
      throw new Error('usersInactiveCount inválido');
    }

    const version = await fetchJson(versionUrl);
    console.log('[SMOKE:POST] /version OK');
    if (!version || (!version.buildTime && !version.version)) {
      throw new Error('Versão sem buildTime ou version');
    }

    console.log('[SMOKE:POST] OK — verificação pós-deploy concluída.');
    process.exit(0);
  } catch (err) {
    console.error('[SMOKE:POST] Falha na verificação pós-deploy:', err?.message ?? err);
    process.exit(1);
  }
}

main();

