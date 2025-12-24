const { Pool } = require('pg');

async function main() {
  const emails = process.argv.slice(2).filter(Boolean);
  if (emails.length === 0) {
    console.log('Uso: node scripts/find_users_by_email.js <email1> [email2 ...]');
    process.exit(1);
  }

  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido');
    process.exit(1);
  }

  const ssl = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString: conn, ssl });
  const client = await pool.connect();
  try {
    const results = {};
    for (const email of emails) {
      try {
        const { rows } = await client.query(
          'SELECT id, email, username, role, is_active, updated_at FROM users WHERE email = $1 ORDER BY id',
          [email]
        );
        results[email] = rows;
      } catch (e) {
        results[email] = { error: e?.message || String(e) };
      }
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Erro:', err?.message || err);
  process.exit(1);
});

