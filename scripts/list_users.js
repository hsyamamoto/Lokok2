#!/usr/bin/env node
// Lista usuários da tabela `users` com campos principais
const { Pool } = require('pg');

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido. Configure e tente novamente.');
    process.exit(1);
  }
  const ssl = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    ? { rejectUnauthorized: false }
    : false;
  const pool = new Pool({ connectionString: conn, ssl });

  const sql = `
    SELECT id, email, username, name, role, is_active, allowed_countries, updated_at
    FROM users
    ORDER BY email NULLS LAST, id ASC
  `;

  try {
    const { rows } = await pool.query(sql);
    const simplified = rows.map(r => ({
      id: r.id,
      email: r.email || null,
      username: r.username || null,
      name: r.name || null,
      role: r.role || null,
      is_active: r.is_active === true,
      allowed_countries: Array.isArray(r.allowed_countries) ? r.allowed_countries : [],
      updated_at: r.updated_at || null,
    }));
    console.log(JSON.stringify({ count: simplified.length, users: simplified }, null, 2));
  } catch (e) {
    console.error('Falha ao consultar usuários:', e?.message || e);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

main();

