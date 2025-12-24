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
    const { rows } = await client.query(
      `SELECT id, country, data->>'Name' AS name, data->>'Website' AS website, created_by_user_name, created_at, updated_at
       FROM suppliers_json
       ORDER BY created_at DESC
       LIMIT 10`
    );
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Erro na consulta:', err?.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

