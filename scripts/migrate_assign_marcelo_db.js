// Migração Postgres: atribuir registros a Marcelo quando Manager/Buyer menciona Marcelo
// - Atualiza JSONB (data) para definir Created_By_User_* e garante que "Responsable" contenha Marcelo
// - Atualiza colunas created_by_user_id/nome na tabela suppliers_json
// Uso:
//   Dry-run:  node scripts/migrate_assign_marcelo_db.js
//   Aplicar:  node scripts/migrate_assign_marcelo_db.js --apply [--force-created-by]

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

function extractManagerLikeValue(rec) {
  const obj = rec && typeof rec === 'object' ? rec : {};
  const primary = obj.Responsable || obj.Manager || obj.Buyer || '';
  if (String(primary || '').trim().length > 0) return primary;
  const tokens = ['responsable','responsible','manager','buyer','assigned','purchase','purchasing'];
  const normalizeKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');
  for (const k of Object.keys(obj)) {
    const nk = normalizeKey(k);
    if (tokens.some(t => nk.includes(t))) {
      const v = obj[k];
      if (String(v || '').trim().length > 0) return v;
    }
  }
  return '';
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
    const { rows } = await client.query(`SELECT id, country, data FROM suppliers_json`);

    let examined = 0;
    let updated = 0;
    let updatedResponsable = 0;
    let updatedCreated = 0;

    for (const row of rows) {
      examined++;
      const rec = { ...(row.data || {}) };
      const before = JSON.stringify(rec);

      const mentionSource = extractManagerLikeValue(rec);
      const mentionsMarcelo = isUserMentionedIn(mentionSource, marcelo);
      if (!mentionsMarcelo) {
        // Ignorar registros que não mencionam Marcelo como responsável/manager/buyer
        continue;
      }

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

    console.log(`[migrate-db] Registros examinados: ${examined}`);
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
