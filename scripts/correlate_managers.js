// Correlate existing supplier records to Marcelo and Jeison profiles
// - Updates record-level fields: Created_By_User_ID and Created_By_User_Name
// - Matches by Responsable/Manager/Buyer containing name/email heuristics
// - Works for Postgres suppliers_json (preferred) and local data/suppliers.json fallback

const fs = require('fs');
const path = require('path');
const { pool } = require('../database');

function loadUsers() {
  const usersPath = path.resolve(__dirname, '..', 'data', 'users.json');
  const raw = fs.readFileSync(usersPath, 'utf-8');
  const data = JSON.parse(raw);
  return data.users || data;
}

function findUser(users, email) {
  return users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
}

function normalize(s) {
  return ((s || '') + '').toLowerCase().trim();
}

function isRecordOf(record, user) {
  const name = normalize(user.name || '');
  const email = normalize(user.email || '');
  const responsible = normalize(record.Responsable || record.Manager || record.Buyer || '');
  const createdById = Number(record.Created_By_User_ID || 0);
  const createdByName = normalize(record.Created_By_User_Name || '');
  const createdByEmail = normalize(record.Created_By_User_Email || '');
  const contactEmail = normalize(record['E-Mail'] || record.Email || '');
  if (createdById && createdById === Number(user.id)) return true;
  if (createdByEmail && email && createdByEmail === email) return true;
  if (createdByName && name && createdByName.includes(name)) return true;
  // strict equality in known fields to avoid over-matching
  if (responsible && (responsible === name || responsible === email)) return true;
  if (contactEmail && contactEmail === email) return true;
  return false;
}

function assignCreator(record, user) {
  record.Created_By_User_ID = user.id;
  record.Created_By_User_Name = user.name || (user.email.split('@')[0]);
  return record;
}

async function correlateInDatabase(marcelo, jeison) {
  if (!pool) {
    console.log('[correlate] Pool indisponível, pulando DB.');
    return { dbUpdated: 0, dbChecked: 0 };
  }
  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query('SELECT id, country, data FROM suppliers_json');
    let dbUpdated = 0;
    let dbChecked = 0;
    for (const row of rows) {
      let changed = false;
      const data = Array.isArray(row.data) ? row.data : [];
      const updated = data.map(rec => {
        dbChecked++;
        if (isRecordOf(rec, marcelo)) { changed = true; return assignCreator(rec, marcelo); }
        if (isRecordOf(rec, jeison)) { changed = true; return assignCreator(rec, jeison); }
        return rec;
      });
      if (changed) {
        await client.query('UPDATE suppliers_json SET data=$2 WHERE id=$1', [row.id, JSON.stringify(updated)]);
        dbUpdated++;
        console.log(`[correlate][DB] Atualizado country=${row.country} id=${row.id}`);
      }
    }
    return { dbUpdated, dbChecked };
  } catch (err) {
    console.error('[correlate][DB] Erro:', err?.message || err);
    return { dbUpdated: 0, dbChecked: 0 };
  } finally {
    if (client) client.release();
  }
}

function correlateInLocalJson(marcelo, jeison) {
  const candidatePaths = [
    path.resolve(__dirname, '..', 'data', 'suppliers.json'),
    path.resolve(__dirname, '..', 'Lokok2', 'data', 'suppliers.json'),
    path.resolve(__dirname, '..', 'Lokok2', 'Lokok2', 'data', 'suppliers.json'),
  ];
  let totals = { localUpdated: 0, localChecked: 0 };
  for (const p of candidatePaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      let localUpdated = 0;
      let localChecked = 0;
      const updatedArr = arr.map(item => {
        const rec = item && item.distributor ? item.distributor : null;
        if (!rec) return item;
        localChecked++;
        const already = rec.Created_By_User_ID || rec.Created_By_User_Name || rec.Created_By_User_Email;
        if (already) { item.distributor = rec; return item; }
        if (isRecordOf(rec, marcelo)) {
          assignCreator(rec, marcelo);
          localUpdated++;
        } else if (isRecordOf(rec, jeison)) {
          assignCreator(rec, jeison);
          localUpdated++;
        }
        item.distributor = rec;
        return item;
      });
      fs.writeFileSync(p, JSON.stringify(updatedArr, null, 2));
      console.log(`[correlate][local] ${p}: verificados=${localChecked}, atualizados=${localUpdated}`);
      totals.localUpdated += localUpdated;
      totals.localChecked += localChecked;
    } catch (err) {
      console.error('[correlate][local] Erro em', p, ':', err?.message || err);
    }
  }
  return totals;
}

async function main() {
  const users = loadUsers();
  const marcelo = findUser(users, 'marcelogalvis@mylokok.com');
  const jeison = findUser(users, 'jeisonanteliz@mylokok.com');
  if (!marcelo || !jeison) {
    console.error('[correlate] Usuários Marcelo/Jeison não encontrados em users.json');
    process.exit(1);
    return;
  }
  console.log('[correlate] Marcelo:', marcelo.id, marcelo.name);
  console.log('[correlate] Jeison:', jeison.id, jeison.name);

  const dbRes = await correlateInDatabase(marcelo, jeison);
  const localRes = correlateInLocalJson(marcelo, jeison);

  console.log('[correlate] Resultado:', { ...dbRes, ...localRes });
}

main().catch(err => {
  console.error('[correlate] Falha geral:', err?.message || err);
  process.exit(1);
});
