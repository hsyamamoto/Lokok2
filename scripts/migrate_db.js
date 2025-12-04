// Migração idempotente do Excel para Postgres
// - Garante tabelas (users, suppliers, suppliers_json)
// - Se suppliers_json já tiver dados, NÃO reseeda; apenas deduplica
// - Se estiver vazio, migra Excel para JSONB e depois deduplica

const {
  pool,
  createTables,
  createInitialUsers,
  createJsonTable,
  migrateExcelToJson,
  deduplicateSuppliersJson,
} = require('../database');

async function main() {
  try {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL não está definido. Configure e tente novamente.');
      process.exit(1);
    }

    console.log('Iniciando preparação do banco...');
    // Garantir estrutura mínima
    await createTables();
    await createInitialUsers();
    await createJsonTable();

    const client = await pool.connect();
    let existingCount = 0;
    try {
      const { rows } = await client.query('SELECT COUNT(*)::int AS cnt FROM suppliers_json');
      existingCount = rows?.[0]?.cnt || 0;
    } catch (err) {
      console.warn('Aviso: não foi possível contar registros em suppliers_json:', err?.message || err);
    } finally {
      client.release();
    }

    const allowReseed = process.env.ALLOW_RESEED === '1';
    if (existingCount > 0 && !allowReseed) {
      console.log(`Tabela suppliers_json já populada (registros: ${existingCount}). Pulando reseed.`);
    } else {
      console.log('Migração para suppliers_json a partir do Excel...');
      await migrateExcelToJson();
    }

    if (process.env.SKIP_DEDUP === '1') {
      console.log('Pulado: deduplicação SKIP_DEDUP=1. Mantendo todos os registros.');
    } else {
      console.log('Iniciando deduplicação...');
      const result = await deduplicateSuppliersJson();
      console.log('Deduplicação concluída:', result);
    }
    console.log('Ok. Banco de dados pronto para uso (USE_DB=true).');
    process.exit(0);
  } catch (err) {
    console.error('Falha na migração/deduplicação:', err?.message || err);
    process.exit(1);
  }
}

main();