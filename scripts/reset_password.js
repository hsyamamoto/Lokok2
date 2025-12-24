const { DbUserRepository } = require('../models/UserDbRepository');

function usage() {
  console.log('Usage: node scripts/reset_password.js <email> <newPassword>');
  console.log('Example: node scripts/reset_password.js admin@mylokok.com admin123');
}

async function main() {
  const [email, newPassword] = process.argv.slice(2);
  if (!email || !newPassword) {
    usage();
    process.exit(1);
  }

  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido');
    process.exit(1);
  }

  try {
    const repo = new DbUserRepository();
    const updated = await repo.updatePasswordByEmailAsync(email, newPassword);
    if (!updated) {
      console.error('Usuário não encontrado para email:', email);
      process.exit(1);
    }
    console.log('Senha atualizada para', updated.email);
  } catch (err) {
    console.error('Erro ao atualizar senha:', err?.message || err);
    process.exit(1);
  }
}

main();
