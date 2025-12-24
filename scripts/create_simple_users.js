#!/usr/bin/env node
/**
 * Cria/atualiza usuários simples no Postgres para testes de login.
 * - Usa DbUserRepository.createAsync (INSERT ... ON CONFLICT(email) DO UPDATE)
 * - Senha padrão: test12345
 * - Usernames são derivados do email (parte antes do @)
 *
 * Uso: node scripts/create_simple_users.js
 */

const { DbUserRepository } = require('../models/UserDbRepository');

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido. Configure no ambiente do serviço (Railway) e tente novamente.');
    process.exit(1);
  }

  const repo = new DbUserRepository();
  const password = 'test12345';

  const users = [
    { name: 'QA', email: 'qa@mylokok.com', role: 'operator', allowedCountries: ['US'] },
    { name: 'Test', email: 'test@mylokok.com', role: 'operator', allowedCountries: ['US'] },
    { name: 'Manager', email: 'manager@mylokok.com', role: 'manager', allowedCountries: ['US','CA'] },
  ];

  const created = [];
  for (const u of users) {
    try {
      const res = await repo.createAsync({ ...u, password, createdBy: null });
      created.push(res);
      console.log('✔️  Usuário pronto:', { id: res.id, email: res.email, role: res.role, allowedCountries: res.allowedCountries });
    } catch (e) {
      console.error('❌ Falha ao criar/atualizar', u.email, '-', e?.message || e);
    }
  }

  console.log('\nResumo:');
  for (const r of created) {
    console.log(`- ${r.email} (username: ${String(r.email).split('@')[0].toLowerCase()}) role=${r.role}`);
  }

  console.log('\nTeste de login sugerido:');
  console.log('- node scripts/verify_login.js "qa@mylokok.com" "test12345"');
  console.log('- node scripts/verify_login.js "test@mylokok.com" "test12345"');
  console.log('- node scripts/verify_login.js "manager@mylokok.com" "test12345"');
}

main().catch((err) => {
  console.error('Erro:', err?.message || err);
  process.exit(1);
});

