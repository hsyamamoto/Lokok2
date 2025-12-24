const { Pool } = require('pg');

async function main() {
  try {
    const conn = process.env.DATABASE_URL;
    if (!conn) {
      console.error('DATABASE_URL não definido');
      process.exit(1);
    }
    const ssl = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
    const pool = new Pool({ connectionString: conn, ssl });
    const client = await pool.connect();
    try {
      const existsRes = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='users'
        ) AS exists;
      `);
      const exists = !!(existsRes.rows[0] && existsRes.rows[0].exists);

      let columns = [];
      let count = null;
      let sample = [];
      if (exists) {
        const colsRes = await client.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='users'
          ORDER BY ordinal_position;
        `);
        columns = colsRes.rows;

        const countRes = await client.query(`SELECT COUNT(*)::int AS total FROM users;`);
        count = countRes.rows[0]?.total ?? null;

        try {
          const sampleRes = await client.query(`SELECT email, name, is_active FROM users ORDER BY updated_at DESC NULLS LAST LIMIT 5;`);
          sample = sampleRes.rows;
        } catch (e) {
          // Colunas podem não existir; tenta um fallback genérico
          try {
            const anyRes = await client.query(`SELECT * FROM users LIMIT 5;`);
            sample = anyRes.rows;
          } catch (e2) {
            sample = [];
          }
        }
      }

      console.log(JSON.stringify({ success: true, exists, columns, count, sample }, null, 2));
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    console.error('Erro ao verificar tabela users:', err?.message || err);
    process.exit(1);
  }
}

main();
