#!/usr/bin/env node
/**
 * General manager assignment migration for US/MX/CN.
 * - Detects manager from record fields (name/email) and assigns correct SQL user id
 * - Supports dry-run (default) and apply mode (--apply)
 * - Targets countries US/MX/CN by default; configurable via --countries=US,MX,CN
 *
 * Usage:
 *   node scripts/migrate_assign_managers_db.js "postgresql://.../?sslmode=no-verify" --apply
 *   node scripts/migrate_assign_managers_db.js --countries=US,MX,CN
 *   DATABASE_URL="postgresql://.../?sslmode=no-verify" node scripts/migrate_assign_managers_db.js --apply
 */

const { Pool } = require('pg');

function parseArgs() {
  const args = process.argv.slice(2);
  let dbUrl = process.env.DATABASE_URL || null;
  let apply = false;
  let force = false;
  let countries = ['US', 'MX', 'CN'];

  for (const a of args) {
    if (a.startsWith('postgres://') || a.startsWith('postgresql://')) {
      dbUrl = a;
    } else if (a === '--apply') {
      apply = true;
    } else if (a === '--force') {
      force = true;
    } else if (a.startsWith('--countries=')) {
      const list = a.split('=')[1];
      countries = list.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    }
  }

  if (!dbUrl) {
    throw new Error('DATABASE_URL not provided. Pass as first argument or set env DATABASE_URL');
  }

  return { dbUrl, apply, force, countries };
}

function normalizeStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') v = String(v);
  return v.trim();
}

function lower(v) { return normalizeStr(v).toLowerCase(); }

function pickCountry(row) {
  const direct = lower(row.country || '');
  const d = row.data || {};
  const byData = lower(d.Country || d.COUNTRY || '');
  return (direct || byData || '').toUpperCase();
}

function detectManager(row, managers) {
  const d = row.data || {};
  const candidates = [
    row.created_by_user_name,
    d.Created_By_User_Name,
    d.Created_By_User_Email,
    d.Responsable,
    d.Responsible,
    d.Manager,
    d.Buyer,
    d.Assigned,
    d['Assigned To']
  ].map(normalizeStr);

  // Priority order: Marcelo, Jeison, Nacho
  const order = ['marcelo', 'jeison', 'nacho'];

  for (const key of order) {
    const m = managers[key];
    if (!m) continue;
    const nameHits = m.names.some(name => candidates.some(c => lower(c).includes(lower(name))));
    const emailHits = m.emails.some(email => candidates.some(c => lower(c).includes(lower(email))));
    if (nameHits || emailHits) return { key, manager: m };
  }

  return null;
}

async function main() {
  const { dbUrl, apply, force, countries } = parseArgs();
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  console.log(`[info] Connecting to database...`);
  const client = await pool.connect();
  try {
    // Load manager ids from SQL users
    const wanted = ['marcelo', 'jeison', 'nacho'];
    const resUsers = await client.query(
      `SELECT id, username FROM users WHERE username = ANY($1)`,
      [wanted]
    );
    const managers = {};
    for (const row of resUsers.rows) {
      const key = row.username.toLowerCase();
      if (key === 'marcelo') {
        managers.marcelo = {
          id: row.id,
          username: row.username,
          displayName: 'Marcelo',
          names: ['marcelo', 'marcelo galvis'],
          emails: ['marcelogalvis@mylokok.com']
        };
      } else if (key === 'jeison') {
        managers.jeison = {
          id: row.id,
          username: row.username,
          displayName: 'Jeison',
          names: ['jeison', 'jeison anteliz'],
          emails: ['jeisonanteliz@mylokok.com']
        };
      } else if (key === 'nacho') {
        managers.nacho = {
          id: row.id,
          username: row.username,
          displayName: 'Nacho',
          names: ['nacho', 'ignacio', 'ignacio cortez'],
          emails: ['ignaciocortez@mylokok.com']
        };
      }
    }

    const missingManagers = wanted.filter(w => !managers[w]);
    if (missingManagers.length) {
      console.warn(`[warn] Missing managers in SQL users: ${missingManagers.join(', ')}`);
    }

    console.log(`[info] Managers loaded: ${Object.keys(managers).map(k => `${k}#${managers[k].id}`).join(', ')}`);

    const countryList = countries.map(c => c.toUpperCase());
    console.log(`[info] Target countries: ${countryList.join(', ')}`);

    const res = await client.query(
      `SELECT id, country, created_by_user_id, created_by_user_name, data
       FROM suppliers_json
       WHERE LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = ANY($1)`,
      [countryList.map(c => c.toLowerCase())]
    );

    const rows = res.rows.map(r => ({
      id: r.id,
      country: r.country,
      created_by_user_id: r.created_by_user_id,
      created_by_user_name: r.created_by_user_name,
      data: r.data || {}
    }));

    const stats = {
      total: rows.length,
      byCountry: Object.fromEntries(countryList.map(c => [c, 0])),
      wouldUpdate: 0,
      updated: 0,
      byManager: { marcelo: 0, jeison: 0, nacho: 0 }
    };

    console.log(`[info] Loaded ${rows.length} records from suppliers_json`);

    if (apply) await client.query('BEGIN');

    for (const row of rows) {
      const country = pickCountry(row);
      if (!countryList.includes(country)) continue;
      stats.byCountry[country]++;

      const match = detectManager(row, managers);
      if (!match) continue; // No known manager detected

      const { manager } = match;
      const needsUpdate = force || (row.created_by_user_id !== manager.id || lower(row.created_by_user_name) !== lower(manager.displayName));

      if (!needsUpdate) continue;

      stats.wouldUpdate++;
      stats.byManager[match.key]++;

      if (!apply) continue;

      // Build Responsable update: append name if not present
      const responsable = normalizeStr(row.data?.Responsable);
      const hasResp = lower(responsable).includes(lower(manager.displayName));

      const sql = `
        UPDATE suppliers_json
        SET
          created_by_user_id = $1,
          created_by_user_name = $2::text,
          data = jsonb_set(
            jsonb_set(
              jsonb_set(data, '{Created_By_User_Id}', to_jsonb($1::int), true),
              '{Created_By_User_Name}', to_jsonb($2::text), true
            ),
            '{Responsable}',
            CASE
              WHEN (data->>'Responsable') IS NULL THEN to_jsonb($2::text)
              WHEN $3 THEN data->'Responsable'
              ELSE to_jsonb((data->>'Responsable') || ', ' || $2::text)
            END,
            true
          )
        WHERE id = $4
      `;

      await client.query(sql, [manager.id, manager.displayName, hasResp, row.id]);
      stats.updated++;
    }

    if (apply) await client.query('COMMIT');

    console.log(JSON.stringify({
      apply,
      force,
      totalExamined: stats.total,
      byCountry: stats.byCountry,
      wouldUpdate: stats.wouldUpdate,
      updated: stats.updated,
      byManager: stats.byManager
    }, null, 2));

  } catch (err) {
    if (apply) await client.query('ROLLBACK').catch(() => {});
    console.error('[error]', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}
