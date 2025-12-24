#!/usr/bin/env node
// Verifica se a senha informada confere com o hash do usuário no Postgres.
// Uso: node scripts/verify_login.js <email_or_username> <password>

const { DbUserRepository } = require('../models/UserDbRepository');
const { User } = require('../models/User');

function usage() {
  console.log('Uso: node scripts/verify_login.js <email_or_username> <password>');
  console.log('Exemplo: node scripts/verify_login.js dev@mylokok.com test12345');
}

async function main() {
  const [identifier, password] = process.argv.slice(2);
  if (!identifier || !password) {
    usage();
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definido');
    process.exit(1);
  }

  const repo = new DbUserRepository();
  let user = null;
  try {
    if (typeof repo.findByEmailOrUsernameAsync === 'function') {
      user = await repo.findByEmailOrUsernameAsync(identifier);
    } else {
      user = await repo.findByEmailAsync(identifier);
    }
  } catch (e) {
    console.error('Erro ao buscar usuário:', e?.message || e);
    process.exit(2);
  }

  if (!user) {
    console.log(JSON.stringify({ found: false }, null, 2));
    return;
  }

  const ok = User.comparePassword(password, user.password);
  const info = {
    found: true,
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive === true,
    allowedCountries: Array.isArray(user.allowedCountries) ? user.allowedCountries : [],
    passwordMatches: ok
  };
  console.log(JSON.stringify(info, null, 2));
}

main().catch((err) => {
  console.error('Erro:', err?.message || err);
  process.exit(1);
});

