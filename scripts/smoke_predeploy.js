// Pre-deploy smoke test: verify DB connectivity and critical schema
// Usage: NODE_ENV=production node scripts/smoke_predeploy.js
// Optional: loads .env.production if present and env vars not already set

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvProduction() {
  const envPath = path.resolve(process.cwd(), '.env.production');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const rawVal = m[2];
    if (process.env[key] === undefined) {
      process.env[key] = rawVal;
    }
  }
}

async function main() {
  try {
    loadEnvProduction();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error('[SMOKE:PRE] DATABASE_URL ausente. Configure variável de ambiente.');
      process.exit(1);
    }

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    console.log('[SMOKE:PRE] Conectado ao PostgreSQL.');

    // Tabela users existe?
    const regRes = await client.query("SELECT to_regclass('public.users') AS tbl");
    const usersReg = regRes.rows[0]?.tbl;
    if (!usersReg) {
      console.error('[SMOKE:PRE] Tabela public.users não encontrada.');
      await client.end();
      process.exit(1);
    }

    // Colunas críticas existem?
    const colRes = await client.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_schema='public' AND table_name='users' 
       AND column_name IN ('id','email','password_hash','role','is_active')`
    );
    const colSet = new Set(colRes.rows.map(r => r.column_name));
    const required = ['id', 'email', 'password_hash', 'role', 'is_active'];
    for (const c of required) {
      if (!colSet.has(c)) {
        console.error(`[SMOKE:PRE] Coluna ausente em users: ${c}`);
        await client.end();
        process.exit(1);
      }
    }

    // Contagem de usuários
    const cntRes = await client.query('SELECT COUNT(*)::int AS cnt FROM public.users');
    const usersCount = cntRes.rows[0]?.cnt ?? 0;
    console.log(`[SMOKE:PRE] UsersCount = ${usersCount}`);

    // (Opcional) validar constraints únicas em email
    const uqRes = await client.query(
      `SELECT tc.constraint_name 
         FROM information_schema.table_constraints tc 
         JOIN information_schema.constraint_column_usage ccu 
           ON ccu.constraint_name = tc.constraint_name 
        WHERE tc.table_schema='public' AND tc.table_name='users' 
          AND tc.constraint_type='UNIQUE' AND ccu.column_name='email'`
    );
    if (uqRes.rowCount === 0) {
      console.warn('[SMOKE:PRE] Atenção: constraint UNIQUE em email não encontrada.');
    } else {
      console.log('[SMOKE:PRE] UNIQUE(email) presente.');
    }

    await client.end();
    console.log('[SMOKE:PRE] OK — verificação pré-deploy concluída.');
    process.exit(0);
  } catch (err) {
    console.error('[SMOKE:PRE] Falha na verificação pré-deploy:', err?.message ?? err);
    process.exit(1);
  }
}

main();

