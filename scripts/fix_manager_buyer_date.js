// Corrige registros onde campos Manager/Buyer/Responsable estão com data "2025-12-04"
// Substitui valores de data indevida por o nome informado (padrão: "Marcelo")
// Uso:
//   node scripts/fix_manager_buyer_date.js --date 2025-12-04 --name "Marcelo"
//   [opcional] --country CA para limitar por país

const { pool } = require('../database');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { date: '2025-12-04', name: 'Marcelo', country: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--date' && args[i+1]) out.date = args[++i];
    else if (a === '--name' && args[i+1]) out.name = args[++i];
    else if (a === '--country' && args[i+1]) out.country = args[++i];
  }
  return out;
}

function isDateLike(value, needle) {
  if (!value) return false;
  const s = String(value).trim();
  if (!s) return false;
  const n = String(needle || '').trim();
  if (!n) return false;
  // Igualdade exata ou contém a data alvo (ex.: Thu Dec 04 2025 ...)
  if (s === n) return true;
  if (s.includes(n)) return true;
  // Variações comuns de 04/12/2025 e 12/04/2025
  const variants = [
    '04/12/2025','12/04/2025','Dec 04 2025','04 Dec 2025','2025/12/04','2025-12-04'
  ];
  return variants.some(v => s.includes(v));
}

async function fetchCandidates(client, dateStr, country) {
  const like = `%${dateStr}%`;
  let sql = `
    SELECT id, country, data
    FROM suppliers_json
    WHERE (
      (data->>'Manager') ILIKE $1 OR
      (data->>'Buyer') ILIKE $1 OR
      (data->>'Responsable') ILIKE $1
    )`;
  const params = [like];
  if (country) {
    sql += ` AND (country = $2)`;
    params.push(country);
  }
  const { rows } = await client.query(sql, params);
  return rows;
}

async function fixRow(client, row, name, dateStr) {
  const data = row.data;
  const records = Array.isArray(data) ? data : [data];
  let changed = false;
  const fixed = records.map(rec => {
    const r = { ...rec };
    if (isDateLike(r.Manager, dateStr)) { r.Manager = name; changed = true; }
    if (isDateLike(r.Buyer, dateStr)) { r.Buyer = name; changed = true; }
    if (isDateLike(r.Responsable, dateStr)) { r.Responsable = name; changed = true; }
    return r;
  });
  if (!changed) return { changed: false };
  const payload = Array.isArray(data) ? fixed : fixed[0];
  await client.query(`UPDATE suppliers_json SET data = $1, updated_at = NOW() WHERE id = $2`, [payload, row.id]);
  return { changed: true };
}

async function verifyRemaining(client, dateStr, country) {
  const like = `%${dateStr}%`;
  let sql = `
    SELECT id
    FROM suppliers_json
    WHERE (
      (data->>'Manager') ILIKE $1 OR
      (data->>'Buyer') ILIKE $1 OR
      (data->>'Responsable') ILIKE $1
    )`;
  const params = [like];
  if (country) { sql += ` AND (country = $2)`; params.push(country); }
  const { rows } = await client.query(sql, params);
  return rows.map(r => r.id);
}

async function main() {
  const { date, name, country } = parseArgs();
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definido');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    const candidates = await fetchCandidates(client, date, country);
    let checked = 0, updated = 0;
    const affected = [];
    for (const row of candidates) {
      checked++;
      const res = await fixRow(client, row, name, date);
      if (res.changed) { updated++; affected.push(row.id); }
    }
    const remaining = await verifyRemaining(client, date, country);
    console.log(JSON.stringify({ checked, updated, affected, remaining }, null, 2));
  } catch (err) {
    console.error('Erro ao corrigir Manager/Buyer:', err?.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();

