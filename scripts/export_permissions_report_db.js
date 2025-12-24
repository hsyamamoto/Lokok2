/**
 * Gera relatório de permissões (edição/deleção) direto do Postgres.
 * - Usa `DATABASE_URL` para conectar.
 * - Lê usuários da tabela `users` e registros da `suppliers_json`.
 * - Aplica regras: admin tudo; manager por menção, país permitido, criador, caso Marcelo/CA; operador não.
 * - Salva JSON em `data/permissions_report_db.json` com totais por país.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'gerente') return 'manager';
  if (r === 'operador') return 'operator';
  if (['admin','manager','operator','user'].includes(r)) return r;
  return r || 'user';
}

function normalizeCountryCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  if (['US','USA','UNITED STATES','UNITED STATES OF AMERICA'].includes(c)) return 'US';
  if (['CA','CAN','CANADA'].includes(c)) return 'CA';
  if (['MX','MEX','MEXICO','MÉXICO'].includes(c)) return 'MX';
  return null;
}

function normalizeAllowedCountries(list) {
  const arr = Array.isArray(list) ? list : [];
  const normalized = arr.map(normalizeCountryCode).filter(Boolean);
  const withoutCN = normalized.filter((c) => c !== 'CN');
  return Array.from(new Set(withoutCN));
}

function getManagerLikeValue(obj) {
  const rec = obj && obj.distributor && typeof obj.distributor === 'object' ? obj.distributor : obj;
  const candidates = [
    'Responsable','Manager','Buyer',
    'Responsable Buyer','Responsible Buyer','Buyer Responsable','Buyer Responsible',
    'Assigned','Assigned To','Assigned_To','AssignedTo',
    'Purchase Manager','Purchasing Manager','Purchasing Buyer','Buyer Manager'
  ];
  for (const k of candidates) {
    const v = rec?.[k];
    if (v != null && String(v).trim().length > 0) return v;
  }
  const agg = [];
  for (const k of candidates) { const v = rec?.[k]; if (v) agg.push(String(v)); }
  const createdName = rec?.['Created_By_User_Name'];
  const createdEmail = rec?.['Created_By_User_Email'];
  if (createdName) agg.push(String(createdName));
  if (createdEmail) agg.push(String(createdEmail));
  return agg.join(' | ');
}

function isUserMentionedIn(value, user) {
  const v = String(value || '').toLowerCase();
  if (!v) return false;
  const email = String(user?.email || '').toLowerCase();
  const fullName = String(user?.name || '').toLowerCase();
  const tokens = fullName.split(/\s+/).filter(t => t && t.length >= 3);
  if (email && v.includes(email)) return true;
  if (fullName && v.includes(fullName)) return true;
  return tokens.some(t => v.includes(t));
}

function isCreator(rec, user) {
  const r = rec && rec.distributor ? rec.distributor : rec;
  const idOk = r?.Created_By_User_ID && String(r.Created_By_User_ID).trim() === String(user.id).trim();
  const nameOk = r?.Created_By_User_Name && String(r.Created_By_User_Name).toLowerCase().includes(String(user.name || '').toLowerCase());
  const emailOk = r?.Created_By_User_Email && String(r.Created_By_User_Email).toLowerCase() === String(user.email || '').toLowerCase();
  return !!(idOk || nameOk || emailOk);
}

function getRecordCountry(row) {
  // Preferir coluna `country` da tabela; fallback para JSON `data`.
  const explicit = normalizeCountryCode(row.country);
  if (explicit) return explicit;
  const d = row.data || row.distributor || {};
  const candidates = [d?.Country, d?.COUNTRY, d?._countryCode];
  for (const c of candidates) {
    const n = normalizeCountryCode(c);
    if (n) return n;
  }
  return null;
}

async function loadUsers(pool) {
  const { rows } = await pool.query(
    'SELECT id, email, name, role, allowed_countries, is_active FROM users ORDER BY created_at ASC, id ASC'
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeRole(row.role),
    isActive: row.is_active !== false,
    allowedCountries: normalizeAllowedCountries(row.allowed_countries || [])
  })).filter(u => u.isActive);
}

async function loadSuppliers(pool) {
  const { rows } = await pool.query('SELECT id, country, data FROM suppliers_json');
  return rows.map(r => ({ id: r.id, country: r.country, distributor: r.data || {} }));
}

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido. Configure a variável de ambiente para conectar no Postgres.');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: conn });
  let users, suppliers;
  try {
    users = await loadUsers(pool);
    suppliers = await loadSuppliers(pool);
  } catch (err) {
    console.error('Falha ao consultar o banco:', err.message);
    process.exit(3);
  } finally {
    // Pool será fechado no final
  }

  // Totais por país dinâmicos com base nos dados
  const totalByCountry = suppliers.reduce((acc, rec) => {
    const country = getRecordCountry(rec) || 'unknown';
    acc[country] = (acc[country] || 0) + 1;
    return acc;
  }, {});

  const resultUsers = [];
  for (const u of users) {
    const perCountry = {};
    for (const c of Object.keys(totalByCountry)) {
      perCountry[c] = { editable: 0, deletable: 0, total: totalByCountry[c] };
    }

    const editable = [];
    const deletable = [];

    for (const rec of suppliers) {
      const country = getRecordCountry(rec) || 'unknown';
      const distributor = rec.distributor || {};
      const managerVal = getManagerLikeValue(distributor);
      const managerBlank = String(managerVal || '').trim().length === 0;
      const mention = managerBlank || isUserMentionedIn(managerVal, u);
      const allowed = (u.role === 'admin') || (u.role === 'manager' && u.allowedCountries.includes(country));
      const creator = isCreator(distributor, u);
      const isMarceloCA = (String(u.email || '').toLowerCase() === 'marcelogalvis@mylokok.com' && country === 'CA');

      let canEdit = false, canDelete = false;
      if (u.role === 'admin') {
        canEdit = true; canDelete = true;
      } else if (u.role === 'manager') {
        canEdit = !!(mention || allowed || creator || isMarceloCA);
        canDelete = !!(mention || allowed || creator || isMarceloCA);
      } else {
        canEdit = false; canDelete = false;
      }

      if (canEdit) {
        perCountry[country] = perCountry[country] || { editable: 0, deletable: 0, total: totalByCountry[country] || 0 };
        perCountry[country].editable++;
        editable.push({ id: rec.id, name: distributor.Name || null, country });
      }
      if (canDelete) {
        perCountry[country] = perCountry[country] || { editable: 0, deletable: 0, total: totalByCountry[country] || 0 };
        perCountry[country].deletable++;
        deletable.push({ id: rec.id, name: distributor.Name || null, country });
      }
    }

    resultUsers.push({
      user: { id: u.id, email: u.email, name: u.name, role: u.role, allowedCountries: u.allowedCountries },
      summary: {
        editable: editable.length,
        deletable: deletable.length,
        byCountry: perCountry
      },
      records: { editable, deletable }
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'database',
    totals: totalByCountry,
    users: resultUsers
  };

  const outPath = path.join(process.cwd(), 'data', 'permissions_report_db.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Relatório (DB) gerado em: ${outPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Erro no gerador de relatório (DB):', err);
  process.exit(1);
});

