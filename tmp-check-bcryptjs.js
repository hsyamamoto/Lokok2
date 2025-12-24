const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
(async () => {
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('NO_DATABASE_URL'); process.exit(2); }
  const ssl = { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: conn, ssl });
  const client = await pool.connect();
  try {
    const emails = ["ignaciocortez@mylokok.com","jeisonanteliz@mylokok.com"];
    for (const email of emails) {
      const res = await client.query('SELECT email, password_hash FROM users WHERE email=$1', [email]);
      if (res.rows.length === 0) { console.log(JSON.stringify({ email, found:false })); continue; }
      const row = res.rows[0];
      const ok = row.password_hash ? bcrypt.compareSync('mudar123', row.password_hash) : false;
      console.log(JSON.stringify({ email: row.email, found:true, matches_mudar123: ok }));
    }
  } finally { client.release(); await pool.end(); }
})();
