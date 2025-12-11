const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

async function ensureDir(p) {
  try {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch (e) {
    console.error('Falha ao criar diretório de backup:', e?.message || e);
    throw e;
  }
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function runPgDump(dbUrl, outDir, ts) {
  return new Promise((resolve) => {
    const results = { sql: null, dump: null, errors: [] };
    const tryDump = (args, outPath, key) => new Promise((res) => {
      const child = spawn('pg_dump', [...args, dbUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      const out = fs.createWriteStream(outPath);
      child.stdout.pipe(out);
      child.on('close', (code) => {
        if (code === 0) {
          results[key] = outPath;
        } else {
          results.errors.push(`pg_dump ${key} failed: code=${code} err=${stderr}`);
        }
        res();
      });
    });
    const sqlPath = path.join(outDir, `db-${ts}.sql`);
    const dumpPath = path.join(outDir, `db-${ts}.dump`);
    // Plain SQL
    const a1 = ['-a']; // data only; omit schema for portability
    // Custom format
    const a2 = ['-Fc'];
    Promise.all([tryDump(a1, sqlPath, 'sql'), tryDump(a2, dumpPath, 'dump')]).then(() => resolve(results));
  });
}

async function fallbackJson(pool, outDir, ts) {
  const client = await pool.connect();
  try {
    const tables = [
      { name: 'users', query: 'SELECT id, email, name, role, allowed_countries, created_at, updated_at FROM users' },
      { name: 'suppliers_json', query: 'SELECT id, country, data, created_at, updated_at FROM suppliers_json' },
      { name: 'suppliers', query: 'SELECT * FROM suppliers' },
    ];
    const summary = [];
    for (const t of tables) {
      try {
        const res = await client.query(t.query);
        const filePath = path.join(outDir, `${t.name}-${ts}.json`);
        fs.writeFileSync(filePath, JSON.stringify(res.rows, null, 2), 'utf8');
        summary.push({ table: t.name, rows: res.rowCount, file: filePath });
      } catch (e) {
        // tabela pode não existir; registrar e continuar
        summary.push({ table: t.name, error: e?.message || String(e) });
      }
    }
    return summary;
  } finally {
    client.release();
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL não definido. Configure a string de conexão do Postgres.');
    process.exit(1);
  }
  const outDir = path.resolve(process.cwd(), 'backup');
  await ensureDir(outDir);
  const ts = nowStamp();

  console.log('Iniciando backup do Postgres em', outDir);
  let dumpResults = null;
  try {
    dumpResults = await runPgDump(dbUrl, outDir, ts);
    console.log('pg_dump resultados:', dumpResults);
  } catch (e) {
    console.warn('Falha ao executar pg_dump:', e?.message || e);
  }

  const needFallback = !dumpResults || (!dumpResults.sql && !dumpResults.dump);
  const ssl = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString: dbUrl, ssl });
  let jsonSummary = null;
  try {
    if (needFallback) {
      console.log('Executando fallback para exportar tabelas em JSON...');
      jsonSummary = await fallbackJson(pool, outDir, ts);
      console.log('Resumo JSON:', jsonSummary);
    }
  } finally {
    await pool.end();
  }

  const manifest = {
    timestamp: ts,
    directory: outDir,
    pg_dump: dumpResults,
    jsonFallback: jsonSummary,
  };
  fs.writeFileSync(path.join(outDir, `backup-${ts}.manifest.json`), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('Backup concluído. Manifesto:', manifest);
}

main().catch((e) => {
  console.error('Erro no backup:', e?.message || e);
  process.exit(1);
});

