const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { email: null, add: [], remove: [], role: null, db: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--email') out.email = args[++i];
    else if (a === '--add') out.add.push(String(args[++i] || '').toUpperCase());
    else if (a === '--remove') out.remove.push(String(args[++i] || '').toUpperCase());
    else if (a === '--role') out.role = String(args[++i] || '').toLowerCase();
    else if (a === '--db') out.db = args[++i];
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'gerente') return 'manager';
  if (r === 'administrador') return 'admin';
  if (['manager','admin','operator','user'].includes(r)) return r;
  return r || 'user';
}

function normalizeCountries(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => String(c || '').toUpperCase()).filter(Boolean);
}

async function ensureDir(p) {
  try { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); } catch { /* ignore */ }
}

async function main() {
  const opts = parseArgs();
  if (!opts.email) {
    console.error('Uso: node scripts/update_user_allowed_countries.js --email <email> [--add CA] [--remove CA] [--role manager] [--db <DATABASE_URL>] [--dry-run]');
    process.exit(1);
  }
  const dbUrl = opts.db || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL não definido. Informe via --db ou variável de ambiente.');
    process.exit(1);
  }

  const ssl = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString: dbUrl, ssl });
  const client = await pool.connect();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.cwd(), 'backup');
  await ensureDir(outDir);

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, email, name, role, allowed_countries, created_at, updated_at FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [opts.email]
    );
    if (rows.length === 0) {
      console.error(`Usuário não encontrado: ${opts.email}`);
      await client.query('ROLLBACK');
      process.exit(2);
    }
    const user = rows[0];
    const beforeCountries = normalizeCountries(user.allowed_countries);
    const toAdd = normalizeCountries(opts.add);
    const toRemove = normalizeCountries(opts.remove);
    let afterCountries = beforeCountries.slice();
    for (const c of toAdd) if (!afterCountries.includes(c)) afterCountries.push(c);
    if (toRemove.length) afterCountries = afterCountries.filter((c) => !toRemove.includes(c));

    let afterRole = user.role;
    if (opts.role) afterRole = normalizeRole(opts.role);

    const manifest = {
      email: user.email,
      id: user.id,
      name: user.name,
      before: { role: user.role, allowed_countries: beforeCountries },
      after: { role: afterRole, allowed_countries: afterCountries },
      dryRun: opts.dryRun,
      timestamp,
    };

    console.log('Preview da atualização:', manifest);
    const file = path.join(outDir, `user-update-${user.id}-${timestamp}.json`);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('Manifest salvo em', file);

    if (opts.dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry-run concluído. Nenhuma alteração aplicada.');
    } else {
      // Tentar atualizar com updated_at se existir; senão, sem updated_at
      try {
        await client.query(
          'UPDATE users SET role = $2, allowed_countries = $3, updated_at = NOW() WHERE id = $1',
          [user.id, afterRole, afterCountries]
        );
      } catch (e) {
        console.warn('Falha ao definir updated_at, tentando sem updated_at:', e?.message || e);
        await client.query(
          'UPDATE users SET role = $2, allowed_countries = $3 WHERE id = $1',
          [user.id, afterRole, afterCountries]
        );
      }
      await client.query('COMMIT');
      console.log('Atualização aplicada com sucesso.');
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Erro na atualização:', e?.message || e);
    process.exit(3);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

