#!/usr/bin/env node
/**
 * Teste controlado: cria/atualiza um usuário no Postgres e confirma leitura.
 * - Carrega DATABASE_URL de env; se ausente, tenta .env.production
 * - Usa DbUserRepository.createAsync (INSERT ... ON CONFLICT(email) DO UPDATE)
 * - Loga host/porta/database do destino
 */

const fs = require('fs');
const path = require('path');
const { DbUserRepository } = require('../models/UserDbRepository');

function loadEnvFallback() {
  if (process.env.DATABASE_URL) return;
  const candidates = ['.env.production', '.env'];
  for (const file of candidates) {
    const p = path.join(__dirname, '..', file);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) {
          const key = m[1];
          let val = m[2];
          // strip quotes if present
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          process.env[key] = process.env[key] || val;
        }
      }
      console.log(`[env] Carregado ${file}`);
      break;
    } catch (e) {
      console.warn(`[env] Falha ao ler ${file}:`, e?.message || e);
    }
  }
}

function parseDbInfo(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port,
      database: (u.pathname || '').replace(/^\//,'') || null
    };
  } catch (_) {
    return { host: null, port: null, database: null };
  }
}

async function main() {
  loadEnvFallback();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Erro: DATABASE_URL não definido. Configure no ambiente ou em .env.production');
    process.exit(1);
  }
  const info = parseDbInfo(dbUrl);
  console.log(`[DB] Destino: host=${info.host} port=${info.port} db=${info.database}`);

  const repo = new DbUserRepository();
  const stamp = new Date().toISOString().replace(/[:.]/g,'');
  const email = `dev.test.user+${stamp}@mylokok.com`;
  const payload = {
    name: 'Dev Test User',
    email,
    password: 'test12345',
    role: 'operator',
    createdBy: null,
    allowedCountries: ['US']
  };

  console.log('[TEST] Criando usuário...', email);
  const created = await repo.createAsync(payload);
  console.log('[TEST] Criado:', { id: created.id, email: created.email, role: created.role, allowedCountries: created.allowedCountries });

  const fetched = await repo.findByEmailAsync(email);
  console.log('[TEST] Lido de volta:', fetched ? { id: fetched.id, email: fetched.email, role: fetched.role } : null);

  console.log('[OK] Teste concluído. Verifique o banco para confirmar registro.');
}

main().catch(err => {
  console.error('Erro no teste:', err?.message || err);
  process.exit(1);
});

