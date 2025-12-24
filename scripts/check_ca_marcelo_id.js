// Diagnóstico: verificar ID de 'marcelo' em users e contagens CA
// Uso:
//   NODE_ENV=production DATABASE_URL=postgresql://... node scripts/check_ca_marcelo_id.js

const { Pool } = require('pg');

function getPool() {
  const conn = process.env.DATABASE_URL || process.argv[2];
  if (!conn) {
    console.error('DATABASE_URL não definido. Informe via env ou argumento.');
    process.exit(1);
  }
  const sslNeeded = true;
  return new Pool({ connectionString: conn, ssl: sslNeeded ? { rejectUnauthorized: false } : false });
}

(async () => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const ures = await client.query(
      "SELECT id, username FROM users WHERE lower(username) = 'marcelo' ORDER BY id LIMIT 1"
    );
    if (!ures.rows.length) {
      console.log(JSON.stringify({ error: "Usuário 'marcelo' não encontrado na tabela users" }));
      return;
    }
    const marceloId = ures.rows[0].id;

    const cres = await client.query(
      `SELECT COUNT(*)::int AS total_ca,
              SUM(CASE WHEN COALESCE(created_by_user_id,0) = $1 THEN 1 ELSE 0 END)::int AS ca_marcelo
       FROM suppliers_json
       WHERE country = 'CA'`,
      [marceloId]
    );
    const info = cres.rows[0];

    console.log(
      JSON.stringify({ marcelo_user_id: marceloId, total_ca: info.total_ca, ca_with_marcelo_id: info.ca_marcelo })
    );
  } catch (err) {
    console.error('Erro:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();

