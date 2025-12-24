// Migração Postgres: atribuir registros do Canadá (CA) ao Marcelo
// - Atualiza campo JSONB: inclui "Marcelo" em Responsable (a partir de Manager/Buyer)
// - Define Created_By_* dentro de data (JSONB) e também nas colunas created_by_user_*
// Uso:
//   Dry-run:  node scripts/migrate_assign_marcelo_ca_db.js
//   Aplicar:  node scripts/migrate_assign_marcelo_ca_db.js --apply [--force-created-by]

const fs = require('fs');
const path = require('path');
const { pool } = require('../database');
const { DbUserRepository } = require('../models/UserDbRepository');

async function loadMarceloFromDb() {
  const repo = new DbUserRepository();
  return await repo.findByEmailAsync('marcelogalvis@mylokok.com');
}

function findUserByEmail(users, email) {
  const e = String(email || '').toLowerCase();
  return (users || []).find(u => String(u.email || '').toLowerCase() === e);
}

function norm(s) { return String(s || '').trim(); }
function normLower(s) { return String(s || '').trim().toLowerCase(); }

function ensureResponsable(rec, personName) {
  const managerRaw = ((rec.Responsable || rec.Manager || rec.Buyer || '') + '').trim();
  const responsaveis = managerRaw ? managerRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const hasPerson = responsaveis.some(r => normLower(r) === normLower(personName));
  if (!hasPerson) {
    responsaveis.push(personName);
  }
  rec.Responsable = responsaveis.join(', ');
  return rec;
}

function setCreatedBy(rec, user, force) {
  const idOk = rec.Created_By_User_ID && String(rec.Created_By_User_ID).trim() === String(user.id).trim();
  const nameOk = rec.Created_By_User_Name && normLower(rec.Created_By_User_Name).includes(normLower(user.name));
  const emailOk = rec.Created_By_User_Email && normLower(rec.Created_By_User_Email) === normLower(user.email);
  if (force || !(idOk || nameOk || emailOk)) {
    rec.Created_By_User_ID = user.id;
    rec.Created_By_User_Name = user.name || (String(user.email).split('@')[0]);
    rec.Created_By_User_Email = user.email;
    if (!rec.Created_At) rec.Created_At = new Date().toISOString();
    return true;
  }
  return false;
}

async function run(apply = false, forceCreatedBy = false) {
  const marcelo = await loadMarceloFromDb();
  if (!marcelo) throw new Error('Usuário Marcelo não encontrado no banco de dados');

  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query(
      `SELECT id, country, data FROM suppliers_json
       WHERE LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = 'ca'`
    );

    let examined = 0;
    let updated = 0;
    let updatedResponsable = 0;
    let updatedCreated = 0;

    for (const row of rows) {
      examined++;
      const rec = { ...(row.data || {}) };
      const before = JSON.stringify(rec);

      // Garantir Responsable inclui Marcelo
      const prevResp = rec.Responsable || rec.Manager || rec.Buyer || '';
      ensureResponsable(rec, marcelo.name);
      if ((rec.Responsable || '') !== (prevResp || '')) {
        updatedResponsable++;
      }

      // Set Created_By_* conforme flag
      const changedCreated = setCreatedBy(rec, marcelo, forceCreatedBy);
      if (changedCreated) updatedCreated++;

      const after = JSON.stringify(rec);
      const changed = before !== after;
      if (changed) {
        updated++;
        if (apply) {
          await client.query(
            `UPDATE suppliers_json
             SET data = $2, created_by_user_id = $3, created_by_user_name = $4, updated_at = NOW()
             WHERE id = $1`,
            [row.id, rec, marcelo.id, marcelo.name]
          );
        }
      }
    }

    console.log(`[migrate-db] CA registros examinados: ${examined}`);
    console.log(`[migrate-db] Ajustes em Responsable: ${updatedResponsable}`);
    console.log(`[migrate-db] Ajustes em Created_By_*: ${updatedCreated}`);
    if (apply) {
      console.log(`[migrate-db] Registros atualizados: ${updated}`);
    } else {
      console.log('[migrate-db] Dry-run. Reexecute com --apply para persistir.');
    }
  } catch (err) {
    console.error('[migrate-db] Erro:', err?.message || err);
    process.exit(1);
  } finally {
    if (client) client.release();
  }
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const forceCreatedBy = args.includes('--force-created-by');

run(apply, forceCreatedBy);
