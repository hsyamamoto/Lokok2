/**
 * Correlaciona managers (dos registros US em suppliers_json) com usuários do app.
 * - Usa o mapeamento fornecido: nome ↔ email.
 * - Conecta ao Postgres via `DATABASE_URL`.
 * - Extrai managers de campos comuns e normaliza.
 * - Agrega contagens por usuário (email) e lista managers não mapeados.
 * - Exporta JSON e CSVs: `data/us_manager_user_correlation.json`,
 *   `data/us_manager_user_correlation.csv` (mapeados), `data/us_unmapped_managers.csv`.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Mapeamento fornecido pelo usuário
const USER_MANAGER_MAP = {
  'hubert@mylokok.com': 'hubert',
  'marcelogalvis@mylokok.com': 'marcelo',
  'jeisonanteliz@mylokok.com': 'jeison',
  'ignaciocortez@mylokok.com': 'nacho',
  'yeseikabeitia@mylokok.com': 'yesei',
  'admin@mylokok.com': 'admin'
};

const KNOWN_EMAILS = Object.keys(USER_MANAGER_MAP).map(e => e.toLowerCase());

function normalizeCountryAlias(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (['us','usa','united states','united states of america'].includes(s)) return 'US';
  return null;
}

function getManagerLikeValue(obj) {
  const rec = obj && obj.distributor && typeof obj.distributor === 'object' ? obj.distributor : obj;
  const candidates = [
    'Responsable','Manager','Buyer',
    'Responsable Buyer','Responsible Buyer','Buyer Responsable','Buyer Responsible',
    'Assigned','Assigned To','Assigned_To','AssignedTo',
    'Purchase Manager','Purchasing Manager','Purchasing Buyer','Buyer Manager',
    'Created_By_User_Name'
  ];
  for (const k of candidates) {
    const v = rec?.[k];
    if (v != null && String(v).trim().length > 0) return v;
  }
  const agg = [];
  for (const k of candidates) { const v = rec?.[k]; if (v) agg.push(String(v)); }
  return agg.join(' | ');
}

function splitManagers(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s
    .split(/\s*[\|;,\/&]+\s|\s+and\s+|\s+y\s+/i)
    .map(t => String(t).trim())
    .filter(Boolean);
}

function toKey(name) {
  const s = String(name || '').trim().toLowerCase();
  return s.replace(/["'`]+/g, '').replace(/\s+/g, ' ');
}

function resolveManagerToUser(token) {
  const raw = String(token || '').trim();
  const lower = raw.toLowerCase();
  // Se já é um email @mylokok.com
  if (lower.includes('@mylokok.com')) {
    if (KNOWN_EMAILS.includes(lower)) {
      const nameKey = USER_MANAGER_MAP[lower];
      return { email: lower, canonicalName: nameKey };
    }
    return null;
  }
  // Nomes → emails
  const key = toKey(raw);
  // Alias para Nacho / Ignacio
  if (key === 'nacho' || key === 'ignacio' || key.startsWith('ignacio ')) {
    return { email: 'ignaciocortez@mylokok.com', canonicalName: 'nacho' };
  }
  if (key === 'hubert') return { email: 'hubert@mylokok.com', canonicalName: 'hubert' };
  if (key === 'jeison') return { email: 'jeisonanteliz@mylokok.com', canonicalName: 'jeison' };
  if (key === 'marcelo') return { email: 'marcelogalvis@mylokok.com', canonicalName: 'marcelo' };
  if (key === 'yesei') return { email: 'yeseikabeitia@mylokok.com', canonicalName: 'yesei' };
  if (key === 'admin') return { email: 'admin@mylokok.com', canonicalName: 'admin' };
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
    const aliases = ['us','usa','united states','united states of america'];
    const res = await pool.query(
      `SELECT id, country, data
       FROM suppliers_json
       WHERE LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = ANY($1)`,
      [aliases]
    );
    rows = res.rows || [];
    console.log(`Registros US carregados: ${rows.length}`);
  } catch (err) {
    console.error('Falha ao consultar suppliers_json (US):', err.message);
    process.exit(3);
  }

  const mapped = new Map(); // email -> { count, samples: Set }
  const unmapped = new Map(); // nameKey -> { count, sample }

  for (const r of rows) {
    const d = r.data || {};
    const managerRaw = getManagerLikeValue(d);
    const tokens = splitManagers(managerRaw);
    if (tokens.length === 0) continue;
    for (const t of tokens) {
      const res = resolveManagerToUser(t);
      if (res) {
        const m = mapped.get(res.email) || { count: 0, samples: new Set() };
        m.count += 1;
        m.samples.add(t);
        mapped.set(res.email, m);
      } else {
        const key = toKey(t);
        const u = unmapped.get(key) || { count: 0, sample: t };
        u.count += 1;
        if (!u.sample) u.sample = t;
        unmapped.set(key, u);
      }
    }
  }

  // Buscar usuários do app para os emails mapeados
  const emails = Array.from(mapped.keys());
  let userInfos = [];
  if (emails.length > 0) {
    try {
      const resUsers = await pool.query(
        `SELECT id, email, username, name
         FROM users
         WHERE LOWER(email) = ANY($1)`,
        [emails.map(e => e.toLowerCase())]
      );
      userInfos = resUsers.rows || [];
    } catch (err) {
      console.error('Falha ao consultar users:', err.message);
    }
  }

  const infoByEmail = new Map();
  for (const u of userInfos) {
    infoByEmail.set(String(u.email || '').toLowerCase(), u);
  }

  const mappedList = Array.from(mapped.entries())
    .map(([email, obj]) => {
      const info = infoByEmail.get(email.toLowerCase()) || {};
      return {
        email,
        userId: info.id || null,
        userName: info.name || info.username || null,
        count: obj.count,
        managerSamples: Array.from(obj.samples)
      };
    })
    .sort((a, b) => b.count - a.count || String(a.email).localeCompare(String(b.email)));

  const unmappedList = Array.from(unmapped.entries())
    .map(([key, obj]) => ({ key, count: obj.count, sample: obj.sample }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    totalUS: rows.length,
    mappedTotals: mappedList.reduce((acc, x) => acc + x.count, 0),
    mappedUsers: mappedList,
    unmappedManagers: unmappedList
  };

  const jsonPath = path.join(process.cwd(), 'data', 'us_manager_user_correlation.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2), 'utf8');
  console.log(`JSON gerado: ${jsonPath}`);

  // CSV mapeados
  const csvMappedPath = path.join(process.cwd(), 'data', 'us_manager_user_correlation.csv');
  const headersMapped = ['email','user_id','user_name','count','manager_samples'];
  const linesMapped = [headersMapped.join(',')];
  for (const m of mappedList) {
    linesMapped.push([
      csvEscape(m.email),
      csvEscape(m.userId),
      csvEscape(m.userName),
      String(m.count),
      csvEscape(m.managerSamples.join(' | '))
    ].join(','));
  }
  fs.writeFileSync(csvMappedPath, linesMapped.join('\n'), 'utf8');
  console.log(`CSV mapeados gerado: ${csvMappedPath}`);

  // CSV não mapeados
  const csvUnmappedPath = path.join(process.cwd(), 'data', 'us_unmapped_managers.csv');
  const headersUnmapped = ['manager_key','count','sample'];
  const linesUnmapped = [headersUnmapped.join(',')];
  for (const u of unmappedList) {
    linesUnmapped.push([
      csvEscape(u.key),
      String(u.count),
      csvEscape(u.sample)
    ].join(','));
  }
  fs.writeFileSync(csvUnmappedPath, linesUnmapped.join('\n'), 'utf8');
  console.log(`CSV não mapeados gerado: ${csvUnmappedPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Erro na correlação managers→usuários (US):', err);
  process.exit(1);
});

