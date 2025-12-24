// Atualiza CA -> Marcelo usando ID do users (username='marcelo')
// Uso:
//   node scripts/apply_ca_marcelo_sql.js "postgresql://..."

const { Pool } = require('pg');

function makePool() {
  const conn = process.argv[2] || process.env.DATABASE_URL;
  if (!conn) {
    console.error('Informe a DATABASE_URL via argumento ou env.');
    process.exit(1);
  }
  return new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
}

(async () => {
  const pool = makePool();
  const client = await pool.connect();
  try {
    const u = await client.query(
      "SELECT id, username FROM users WHERE lower(username)='marcelo' ORDER BY id LIMIT 1"
    );
    if (!u.rows.length) throw new Error("Usuário 'marcelo' não encontrado em users");
    const marceloId = u.rows[0].id;
    const marceloName = 'Marcelo';

    const updateSql = `
      WITH marcelo AS (
        SELECT $1::bigint AS id, $2::text AS name
      )
      UPDATE suppliers_json AS s
      SET
        created_by_user_id   = m.id,
        created_by_user_name = m.name,
        data = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     s.data,
                     '{Created_By_User_ID}', to_jsonb(m.id::text), true
                   ),
                   '{Created_By_User_Name}', to_jsonb(m.name), true
                 ),
                 '{Responsable}',
                 to_jsonb(
                   CASE
                     WHEN position('marcelo' in lower(coalesce(s.data->>'Responsable',''))) > 0
                       THEN s.data->>'Responsable'
                     ELSE trim(both ' | ' from coalesce(s.data->>'Responsable','') || ' | Marcelo')
                   END
                 ),
                 true
               ),
        updated_at = CURRENT_TIMESTAMP
      FROM marcelo AS m
      WHERE s.country = 'CA';
    `;

    const upd = await client.query(updateSql, [marceloId, marceloName]);

    const counts = await client.query(
      `SELECT COUNT(*)::int AS total_ca,
              SUM(CASE WHEN COALESCE(created_by_user_id,0) = $1 THEN 1 ELSE 0 END)::int AS ca_marcelo
       FROM suppliers_json
       WHERE country = 'CA'`,
      [marceloId]
    );

    console.log(
      JSON.stringify({ updated_rows: upd.rowCount || 0, marcelo_user_id: marceloId, total_ca: counts.rows[0].total_ca, ca_with_marcelo_id: counts.rows[0].ca_marcelo })
    );
  } catch (err) {
    console.error('Erro:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();

