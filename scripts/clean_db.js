/*
  Limpeza segura de tabelas no Postgres.
  Uso:
    - Via npm: `npm run clean-db -- --yes` (trunca suppliers_json por padrão)
    - Com tabelas específicas: `npm run clean-db -- --tables=suppliers_json,suppliers --yes`

  Requer:
    - DATABASE_URL definido (Railway injeta automaticamente quando Postgres está anexado)
*/

const { Pool } = require('pg');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { tables: ['suppliers_json'], yes: false };
  for (const a of args) {
    if (a.startsWith('--tables=')) {
      const list = a.split('=')[1];
      opts.tables = list.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (a === '--include-suppliers') {
      opts.tables.push('suppliers');
    }
    if (a === '--yes') opts.yes = true;
  }
  if (process.env.CONFIRM === '1') opts.yes = true;
  return opts;
}

async function tableExists(client, table) {
  const { rows } = await client.query('SELECT to_regclass($1) as reg', [`public.${table}`]);
  return !!rows[0]?.reg;
}

async function truncateTables(pool, tables) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of tables) {
      const exists = await tableExists(client, t);
      if (!exists) {
        console.log(`Tabela não existe, pulando: ${t}`);
        continue;
      }
      console.log(`Truncando tabela: ${t}`);
      await client.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE;`);
    }
    await client.query('COMMIT');
    console.log('Concluído.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao truncar tabelas:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

async function main() {
  const { tables, yes } = parseArgs();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL não está definido. Configure e tente novamente.');
    process.exit(1);
  }

  if (!yes) {
    console.error('Confirmação necessária. Reexecute com --yes (ou CONFIRM=1).');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  console.log('Tabelas alvo:', tables.join(', '));
  await truncateTables(pool, tables);
  await pool.end();
}

main().catch(err => {
  console.error('Falha inesperada:', err);
  process.exit(1);
});