const fs = require('fs');
const path = require('path');
const { DbUserRepository } = require('../models/UserDbRepository');

// Heuristics to match manager by name/email on a supplier record
function matchesManager(record, manager) {
  const rec = record.distributor || record;
  const fields = [
    rec.Responsable,
    rec.Manager,
    rec.Buyer,
    rec.Created_By_User_Name,
    rec.Created_By_User_Email,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  const name = (manager.name || '').toLowerCase();
  const email = (manager.email || '').toLowerCase();
  const id = String(manager.id || '').trim();

  // direct id match
  if (rec.Created_By_User_ID && String(rec.Created_By_User_ID).trim() === id) {
    return true;
  }

  // name or email appears in known fields
  return fields.some((val) => val.includes(name) || (email && val.includes(email)));
}

function countByManager(records, managers) {
  const result = {};
  for (const m of managers) {
    result[m.email] = 0;
  }
  for (const r of records) {
    for (const m of managers) {
      if (matchesManager(r, m)) {
        result[m.email] += 1;
        break; // avoid double counting same record for multiple managers
      }
    }
  }
  return result;
}

function readSuppliersJson(jsonPath) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.suppliers)) return data.suppliers;
    return [];
  } catch (err) {
    console.error(`Erro ao carregar ${jsonPath}:`, err.message);
    return [];
  }
}

function loadLocalSuppliers() {
  // scan multiple possible locations to maximize recall
  const candidatePaths = [
    path.join(__dirname, '..', 'data', 'suppliers.json'),
    path.join(__dirname, '..', 'Lokok2', 'data', 'suppliers.json'),
    path.join(__dirname, '..', 'Lokok2', 'Lokok2', 'data', 'suppliers.json'),
  ];
  let total = [];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      const part = readSuppliersJson(p);
      if (part.length) {
        console.log(`Carregados ${part.length} registros de ${p}`);
        total = total.concat(part);
      }
    }
  }
  // dedupe by `id` if exists
  const byId = new Map();
  for (const r of total) {
    const id = r.id || r.distributor?.id || JSON.stringify(r).length; // weak fallback
    if (!byId.has(id)) byId.set(id, r);
  }
  return Array.from(byId.values());
}

async function loadManagersFromDb() {
  try {
    const repo = new DbUserRepository();
    const marcelo = await repo.findByEmailAsync('marcelogalvis@mylokok.com');
    const jeison = await repo.findByEmailAsync('jeisonanteliz@mylokok.com');
    return [marcelo, jeison].filter(Boolean);
  } catch (err) {
    console.error('Erro ao carregar gerentes do banco:', err?.message || err);
    return [];
  }
}

async function main() {
  const managers = await loadManagersFromDb();
  const marcelo = managers.find((u) => (u.email || '').toLowerCase() === 'marcelogalvis@mylokok.com');
  const jeison = managers.find((u) => (u.email || '').toLowerCase() === 'jeisonanteliz@mylokok.com');
  if (!marcelo || !jeison) {
    console.log('Nao encontrei Marcelo e/ou Jeison no banco de dados.');
  } else {
    console.log('Gerentes encontrados:', {
      marcelo: { id: marcelo.id, email: marcelo.email, name: marcelo.name },
      jeison: { id: jeison.id, email: jeison.email, name: jeison.name },
    });
  }

  // Try DB first, fallback to local
  let records = [];
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT data FROM suppliers_json');
      records = rows.map((r) => (typeof r.data === 'object' ? r.data : JSON.parse(r.data)));
      console.log(`Carregados ${records.length} registros do banco.`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.log('Falha ao conectar no banco, usando arquivo local. Motivo:', err.message);
    records = loadLocalSuppliers();
    console.log(`Total combinados localmente: ${records.length} registros.`);
  }

  const managersArr = [marcelo, jeison].filter(Boolean);
  if (managersArr.length === 0) {
    console.log('Sem gerentes para validar.');
    process.exit(0);
  }

  const counts = countByManager(records, managersArr);
  console.log('Contagens por gerente:', counts);

  const expected = { 'marcelogalvis@mylokok.com': 20, 'jeisonanteliz@mylokok.com': 8 };
  const okMarcelo = counts['marcelogalvis@mylokok.com'] === expected['marcelogalvis@mylokok.com'];
  const okJeison = counts['jeisonanteliz@mylokok.com'] === expected['jeisonanteliz@mylokok.com'];
  if (okMarcelo && okJeison) {
    console.log('VALIDACAO OK: 20 (Marcelo) e 8 (Jeison).');
    process.exit(0);
  } else {
    console.log('VALIDACAO FALHOU:', {
      esperado: expected,
      encontrado: counts,
    });
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Erro no validador:', err);
  process.exit(1);
});
