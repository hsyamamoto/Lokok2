// Atualiza a senha de um usuário diretamente no Postgres (tabela users)
// Uso:
//   node scripts/reset_db_password.js <email> <novaSenha> [DATABASE_URL]
// Se o terceiro argumento não for passado, usa process.env.DATABASE_URL.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

function usage() {
  console.log('Uso: node scripts/reset_db_password.js <email> <novaSenha> [DATABASE_URL]');
  console.log('Exemplo (env): DATABASE_URL="postgresql://..." node scripts/reset_db_password.js marcelogalvis@mylokok.com marcelo123');
  console.log('Exemplo (arg): node scripts/reset_db_password.js marcelogalvis@mylokok.com marcelo123 "postgresql://..."');
}

function makePool(connStr) {
  if (!connStr) {
    console.error('DATABASE_URL não informado. Passe como 3º argumento ou defina no ambiente.');
    usage();
    process.exit(1);
  }
  // Compatível com Railway: SSL sem validação do certificado
  return new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
}

async function main() {
  const [email, newPassword, connArg] = process.argv.slice(2);
  if (!email || !newPassword) {
    usage();
    process.exit(1);
  }
  const connStr = connArg || process.env.DATABASE_URL;
  const pool = makePool(connStr);

  const client = await pool.connect();
  try {
    // Confirma existência do usuário
    const { rows: pre } = await client.query(
      'SELECT id, email, is_active FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    if (!pre.length) {
      console.error('Usuário não encontrado no banco para email:', email);
      process.exit(1);
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    const upd = await client.query(
      'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($1)',
      [email, hashed]
    );

    const { rows: post } = await client.query(
      'SELECT id, email, is_active FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    const info = post[0] || { id: null, email, is_active: null };

    console.log(
      JSON.stringify(
        {
          success: upd.rowCount > 0,
          updated_rows: upd.rowCount || 0,
          user: { id: info.id, email: info.email, is_active: info.is_active },
        },
        null,
        2
      )
    );
    process.exit(0);
  } catch (err) {
    console.error('Erro ao atualizar senha:', err?.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

