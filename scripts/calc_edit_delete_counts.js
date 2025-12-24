/**
 * Calculate per-user, per-country counts of records they can edit/delete.
 * Uses rules from server.js:
 * - Admin: can edit/delete all records.
 * - Manager: can edit/delete if (mentioned in Manager-like fields) OR (country in allowedCountries) OR (is creator).
 *   Additionally, if Manager-like field is blank, permission is granted (treated as mentioned).
 * - Operator/User: cannot edit/delete.
 *
 * Output: JSON with users and counts by country.
 */
const { Pool } = require('pg');

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'gerente') return 'manager';
  if (r === 'operador') return 'operator';
  if (['admin','manager','operator','user'].includes(r)) return r;
  return r || 'user';
}

function normalizeCountryCode(code) {
  const c = String(code || '').toUpperCase();
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
  // Fallback: aggregate multiple fields
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

async function main() {
  const db = process.env.DATABASE_URL;
  if (!db) {
    console.error('DATABASE_URL não definido. Configure e tente novamente.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: db, ssl: { rejectUnauthorized: false } });
  try {
    const usersRes = await pool.query(
      'SELECT id, email, name, role, allowed_countries, is_active FROM users'
    );
    const users = usersRes.rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: normalizeRole(u.role),
      isActive: u.is_active !== false,
      allowedCountries: normalizeAllowedCountries(u.allowed_countries || [])
    }));

    const supRes = await pool.query('SELECT country, data FROM suppliers_json');
    const rows = supRes.rows.map((r) => ({
      country: normalizeCountryCode(r.country || r.data?.Country || r.data?.COUNTRY),
      data: r.data
    })).filter((r) => !!r.country);

    const totalByCountry = rows.reduce((acc, r) => { acc[r.country] = (acc[r.country] || 0) + 1; return acc; }, {});

    const counts = [];
    for (const u of users) {
      const perCountry = { US: { editable: 0, deletable: 0, total: totalByCountry.US || 0 }, CA: { editable: 0, deletable: 0, total: totalByCountry.CA || 0 }, MX: { editable: 0, deletable: 0, total: totalByCountry.MX || 0 } };
      for (const r of rows) {
        const country = r.country;
        const managerVal = getManagerLikeValue(r.data);
        const managerBlank = String(managerVal || '').trim().length === 0;
        const mention = managerBlank || isUserMentionedIn(managerVal, u);
        const allowed = (u.role === 'admin') || (u.role === 'manager' && u.allowedCountries.includes(country));
        const creator = isCreator(r.data, u);

        let canEdit = false, canDelete = false;
        if (u.role === 'admin') {
          canEdit = true; canDelete = true;
        } else if (u.role === 'manager') {
          canEdit = !!(mention || allowed || creator);
          canDelete = !!(mention || allowed || creator);
        } else {
          canEdit = false; canDelete = false;
        }

        if (canEdit) perCountry[country].editable++;
        if (canDelete) perCountry[country].deletable++;
      }

      counts.push({
        user: { id: u.id, email: u.email, name: u.name, role: u.role, allowedCountries: u.allowedCountries },
        countries: perCountry
      });
    }

    const summary = { totals: totalByCountry, users: counts };
    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    console.error('Erro ao calcular contagens:', e?.message || e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

