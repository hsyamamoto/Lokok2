#!/usr/bin/env node
// Inspeciona colunas, índices e constraints da tabela `users` para diagnosticar falhas de criação.
// Uso: node scripts/inspect_users_constraints.js

const { Pool } = require('pg');

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido');
    process.exit(1);
  }
  const ssl = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString: conn, ssl });
  const client = await pool.connect();
  try {
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users'
      ORDER BY ordinal_position;
    `);

    const constraints = await client.query(`
      SELECT c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'public' AND t.relname = 'users'
      ORDER BY c.conname;
    `);

    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname='public' AND tablename='users'
      ORDER BY indexname;
    `);

    // Sinalizações úteis
    const hasEmailUnique = constraints.rows.some(r => /UNIQUE \(email\)/i.test(r.definition)) ||
      indexes.rows.some(r => /UNIQUE INDEX.*\(email\)/i.test(r.indexdef));
    const hasUsernameNotNull = columns.rows.some(r => r.column_name === 'username' && r.is_nullable === 'NO');

    console.log(JSON.stringify({
      success: true,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      checks: {
        hasEmailUnique,
        hasUsernameNotNull
      }
    }, null, 2));
  } catch (e) {
    console.error('Erro ao inspecionar tabela users:', e?.message || e);
    process.exit(2);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

