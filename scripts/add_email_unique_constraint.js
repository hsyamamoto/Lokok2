#!/usr/bin/env node
// Adiciona UNIQUE(email) na tabela `users` se ainda não existir.
// - Se houver duplicatas, exibe quais são e aborta.

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
    const dup = await client.query(`
      SELECT email, COUNT(*) AS count
      FROM users
      WHERE email IS NOT NULL
      GROUP BY email
      HAVING COUNT(*) > 1
      ORDER BY count DESC, email ASC;
    `);
    if (dup.rowCount > 0) {
      console.error('Não foi possível adicionar UNIQUE(email): existem duplicatas.');
      console.error('Resolva as duplicatas abaixo e rode novamente:');
      console.error(JSON.stringify(dup.rows, null, 2));
      process.exit(2);
    }

    // Verifica se já existe constraint única para email
    const cons = await client.query(`
      SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'public' AND t.relname = 'users' AND c.contype = 'u';
    `);
    const hasEmailUnique = cons.rows.some(r => /UNIQUE \(email\)/i.test(r.definition));
    if (hasEmailUnique) {
      console.log('Constraint UNIQUE(email) já existe. Nada a fazer.');
      return;
    }

    // Adiciona constraint única
    await client.query('ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email)');
    console.log('Constraint UNIQUE(email) adicionada com sucesso.');
  } catch (e) {
    console.error('Falha ao adicionar UNIQUE(email):', e?.message || e);
    process.exit(3);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

