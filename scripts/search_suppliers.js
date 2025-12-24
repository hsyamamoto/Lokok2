const { Pool } = require('pg');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { q: '', field: 'website' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--q' && args[i+1]) out.q = args[++i];
    else if (a === '--field' && args[i+1]) out.field = args[++i];
  }
  return out;
}

async function main() {
  const { q, field } = parseArgs();
  if (!q) {
    console.error('Uso: node scripts/search_suppliers.js --q "term" [--field website|name]');
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
    let sql;
    if (field === 'name') {
      sql = `SELECT id, country, data->>'Name' AS name, data->>'Website' AS website, created_by_user_name
             FROM suppliers_json
             WHERE (data->>'Name') ILIKE '%' || $1 || '%'
             ORDER BY id DESC
             LIMIT 10`;
    } else {
      sql = `SELECT id, country, data->>'Name' AS name, data->>'Website' AS website, created_by_user_name
             FROM suppliers_json
             WHERE (data->>'Website') ILIKE '%' || $1 || '%'
             ORDER BY id DESC
             LIMIT 10`;
    }
    const { rows } = await client.query(sql, [q]);
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

