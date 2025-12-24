/**
 * Exporta registros da tabela suppliers_json com país desconhecido (unknown) para CSV.
 * - Conecta no Postgres via `DATABASE_URL`.
 * - Normaliza país a partir de `country` da tabela ou `data.Country/COUNTRY/_countryCode`.
 * - Filtra registros onde a normalização não retorna US/CA/MX.
 * - Gera `data/unknown_suppliers.csv` com campos chave para revisão.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function normalizeCountryCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  if (['US','USA','UNITED STATES','UNITED STATES OF AMERICA'].includes(c)) return 'US';
  if (['CA','CAN','CANADA'].includes(c)) return 'CA';
  if (['MX','MEX','MEXICO','MÉXICO'].includes(c)) return 'MX';
  return null;
}

function getCountryFromRow(row) {
  const exp = normalizeCountryCode(row.country);
  if (exp) return exp;
  const d = row.data || {};
  const candidates = [d.Country, d.COUNTRY, d._countryCode];
  for (const c of candidates) {
    const n = normalizeCountryCode(c);
    if (n) return n;
  }
  return null;
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido. Configure para conectar no Postgres.');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: conn });
  let rows;
  try {
    const res = await pool.query('SELECT id, country, data, created_by_user_id, created_by_user_name, created_at, updated_at FROM suppliers_json');
    rows = res.rows || [];
  } catch (err) {
    console.error('Falha ao consultar suppliers_json:', err.message);
    process.exit(3);
  }

  const unknowns = [];
  for (const r of rows) {
    const norm = getCountryFromRow(r);
    if (norm) continue; // conhecido
    const d = r.data || {};
    unknowns.push({
      id: r.id,
      country: 'unknown',
      name: d.Name || d['Company Name'] || d['COMPANY'] || d['Empresa'] || d['Distributor'] || '',
      website: d.Website || d['WEBSITE'] || d['URL'] || d['Site'] || '',
      email: d['E-Mail'] || d['Email'] || d['EMAIL'] || '',
      responsable: d.Responsable || '',
      manager: d.Manager || '',
      buyer: d.Buyer || d['Responsible Buyer'] || d['Buyer Responsable'] || d['Purchasing Buyer'] || '',
      created_by_user_id: d['Created_By_User_ID'] ?? r.created_by_user_id ?? '',
      created_by_user_name: d['Created_By_User_Name'] ?? r.created_by_user_name ?? '',
      created_by_user_email: d['Created_By_User_Email'] ?? '',
      created_at: d['Created_At'] || d['Created At'] || d['DATE'] || d['Date'] || r.created_at || '',
      updated_at: r.updated_at || ''
    });
  }

  const headers = [
    'id','country','name','website','email','responsable','manager','buyer',
    'created_by_user_id','created_by_user_name','created_by_user_email','created_at','updated_at'
  ];
  const lines = [headers.join(',')];
  for (const row of unknowns) {
    const vals = headers.map(h => csvEscape(row[h]));
    lines.push(vals.join(','));
  }

  const outPath = path.join(process.cwd(), 'data', 'unknown_suppliers.csv');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`CSV gerado com ${unknowns.length} registros: ${outPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Erro no exportador de unknown:', err);
  process.exit(1);
});

