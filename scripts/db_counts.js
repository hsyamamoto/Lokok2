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
      const all = await client.query(`SELECT country FROM suppliers_json`);
      const total = all.rowCount || 0;
      const canonicalize = (c) => {
        if (!c) return 'UNKNOWN';
        const v = String(c).trim().toLowerCase();
        if (v === 'us' || v === 'u.s.' || v === 'usa' || v.includes('united states')) return 'US';
        if (v === 'ca' || v.includes('canada')) return 'CA';
        if (v === 'mx' || v.includes('mexico')) return 'MX';
        if (v === 'cn' || v.includes('china')) return 'CN';
        if (v.length === 2) return v.toUpperCase();
        return 'UNKNOWN';
      };
      const counts = new Map();
      for (const r of all.rows) {
        const key = canonicalize(r.country);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const byCountry = Array.from(counts.entries()).map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count);
      console.log(JSON.stringify({ success: true, total, byCountry }, null, 2));
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    console.error('Erro ao consultar contagens:', err?.message || err);
    process.exit(1);
  }
}

main();