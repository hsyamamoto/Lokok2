const { Pool } = require('pg');

function normalizeWebsite(w) {
  if (!w) return null;
  let s = String(w).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/\/$/, '');
  return s || null;
}

async function main() {
  const websiteArg = process.argv[2] || '';
  const norm = normalizeWebsite(websiteArg);
  if (!norm) {
    console.error('Uso: node scripts/find_supplier_by_website.js <website>');
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
    const { rows } = await client.query(
      `SELECT id, country, data, created_by_user_id, created_by_user_name
       FROM suppliers_json
       WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(data->>'Website', data->>'WEBSITE', data->>'URL', data->>'Site'), '^https?://', ''), '^www\.', ''), '/$', '')) = $1
       LIMIT 5`,
      [norm]
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

