const { Pool } = require('pg');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// Configuração do banco PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Função para criar tabelas
async function createTables() {
  const client = await pool.connect();
  try {
    // Tabela de usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'gerente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Garantir colunas modernas para o modelo atual (email, name, allowed_countries, password_hash, timestamps, is_active)
    await ensureUsersTable(client);

    // Tabela de fornecedores (dados do Excel)
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255),
        contact_person VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(100),
        website VARCHAR(255),
        country VARCHAR(100),
        state VARCHAR(100),
        city VARCHAR(100),
        address TEXT,
        products TEXT,
        categories TEXT,
        minimum_order VARCHAR(100),
        payment_terms VARCHAR(255),
        certifications TEXT,
        notes TEXT,
        assigned_to INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Tabelas criadas com sucesso!');
  } catch (err) {
    console.error('Erro ao criar tabelas:', err);
  } finally {
    client.release();
  }
}

// (Removida) migração direta para tabela legacy suppliers baseada em EXCEL_PATH

// Função para criar usuários iniciais
async function createInitialUsers() {
  const bcrypt = require('bcryptjs');
  const client = await pool.connect();
  
  const users = [
    { username: 'hubert', password: 'admin123', role: 'admin' },
    { username: 'nacho', password: 'gerente123', role: 'gerente' },
    { username: 'marcelo', password: 'gerente123', role: 'gerente' },
    { username: 'jeison', password: 'gerente123', role: 'gerente' },
    { username: 'ana', password: 'gerente123', role: 'gerente' }
  ];

  try {
    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await client.query(`
        INSERT INTO users (username, password, role) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (username) DO NOTHING
      `, [user.username, hashedPassword, user.role]);
    }
    console.log('Usuários iniciais criados!');
  } catch (err) {
    console.error('Erro ao criar usuários:', err);
  } finally {
    client.release();
  }
}

// Garante que a tabela users possui as colunas esperadas pelo app atual
async function ensureUsersTable(clientMaybe) {
  const client = clientMaybe || (await pool.connect());
  let needRelease = !clientMaybe;
  try {
    const alter = async (sql) => {
      try { await client.query(sql); } catch (e) {
        // ignora erros não críticos (ex.: tipos diferentes em bases antigas)
        if (!String(e?.message || '').includes('already exists')) {
          console.warn('ensureUsersTable aviso:', e?.message || e);
        }
      }
    };
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE");
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)");
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_countries TEXT[]");
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)");
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE");
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    // Manter compatibilidade com endpoints legados que consultam username
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE");
    // Ajustar coluna role para valores atuais (apenas garantir existência)
    await alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20)");
    // Tornar coluna legada password opcional para compatibilidade com novo modelo
    try {
      await client.query("ALTER TABLE users ALTER COLUMN password DROP NOT NULL");
    } catch (e) {
      if (!String(e?.message || '').includes('column "password" of relation "users" does not exist')) {
        console.warn('ensureUsersTable aviso (DROP NOT NULL password):', e?.message || e);
      }
    }
  } finally {
    if (needRelease) client.release();
  }
}


// Função principal de inicialização
async function initializeDatabase() {
  try {
    // Garantir estrutura mínima
    await createTables();
    await createInitialUsers();
    await createJsonTable();

    // Migração antiga baseada em arquivo foi removida. Sistema usa apenas banco.

    // Idempotência: só reseedar da planilha do Google Drive se tabela estiver vazia
    // ou quando explicitamente permitido por ALLOW_RESEED=1
    const client = await pool.connect();
    let existingCount = 0;
    try {
      const { rows } = await client.query('SELECT COUNT(*)::int AS cnt FROM suppliers_json');
      existingCount = rows?.[0]?.cnt || 0;
    } catch (err) {
      console.warn('Aviso: não foi possível contar registros em suppliers_json:', err?.message || err);
    } finally {
      client.release();
    }

    const allowReseed = process.env.ALLOW_RESEED === '1';
    if (existingCount > 0 && !allowReseed) {
      console.log(`Tabela suppliers_json já populada (registros: ${existingCount}). Pulando reseed do Excel.`);
    } else {
      console.log('Migração para suppliers_json a partir do Google Drive...');
      await migrateDriveToJson();
    }

    // Deduplicação opcional: pula se SKIP_DEDUP=1
    if (process.env.SKIP_DEDUP === '1') {
      console.log('Pulado: deduplicação SKIP_DEDUP=1. Mantendo todos os registros.');
    } else {
      console.log('Iniciando deduplicação...');
      const result = await deduplicateSuppliersJson();
      console.log('Deduplicação concluída:', result);
    }

    console.log('Banco de dados inicializado com sucesso!');
  } catch (err) {
    console.error('Erro na inicialização:', err);
  }
}

module.exports = {
  pool,
  createTables,
  createInitialUsers,
  initializeDatabase,
  ensureUsersTable,
  // Migração baseada em arquivo removida
};

// -----------------------------
// JSONB-based storage (canonical)
// -----------------------------

/**
 * Create a JSONB table to store full supplier records without losing fields.
 * This allows the app to persist the exact Excel record structure.
 */
async function createJsonTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers_json (
        id SERIAL PRIMARY KEY,
        country VARCHAR(10),
        data JSONB NOT NULL,
        created_by_user_id INTEGER,
        created_by_user_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Tabela suppliers_json pronta.');
  } catch (err) {
    console.error('Erro ao criar suppliers_json:', err);
  } finally {
    client.release();
  }
}

/**
 * Seed JSONB table from Excel, preserving original headers.
 * - If a country can be inferred from the sheet name, it is set.
 */
// Migração para suppliers_json lendo diretamente do Google Drive
async function migrateDriveToJson() {
  const GoogleDriveService = require('./googleDriveService');
  const service = new GoogleDriveService();

  const client = await pool.connect();
  try {
    await client.query('DELETE FROM suppliers_json');

    const canonicalizeCountry = (value) => {
      if (!value) return null;
      let v = String(value).trim().toLowerCase();
      if (v === 'us' || v === 'u.s.' || v === 'usa' || v.includes('united states')) return 'US';
      if (v === 'ca' || v.includes('canada')) return 'CA';
      if (v === 'mx' || v.includes('mexico')) return 'MX';
      if (v === 'cn' || v.includes('china')) return 'CN';
      if (v.length === 2) return v.toUpperCase();
      return null;
    };

    const countries = ['US','CA','MX','CN'];
    for (const c of countries) {
      let rows = [];
      try {
        rows = await service.readSpreadsheetData(c);
      } catch (e) {
        console.warn(`Aviso: falha ao ler sheet do país ${c}:`, e?.message || e);
        rows = [];
      }
      for (const row of rows) {
        const country = canonicalizeCountry(row.Country || c) || c;
        await client.query(
          `INSERT INTO suppliers_json (country, data) VALUES ($1, $2)`,
          [country, row]
        );
      }
      console.log(`Seed Drive: país ${c} -> ${rows.length} registros.`);
    }

    console.log('Migração para suppliers_json a partir do Google Drive concluída com sucesso.');
  } catch (err) {
    console.error('Erro ao migrar do Google Drive para suppliers_json:', err);
  } finally {
    client.release();
  }
}

/**
 * Fetch supplier records (JSONB) by country filter; if no country is provided, return all.
 */
async function getJsonSuppliers(countries) {
  const client = await pool.connect();
  try {
    let result;
    if (Array.isArray(countries) && countries.length > 0) {
      result = await client.query(`SELECT id, country, data FROM suppliers_json WHERE country = ANY($1)`, [countries]);
    } else {
      result = await client.query(`SELECT id, country, data FROM suppliers_json`);
    }
    // Merge DB id/country into the data object so the app can perform precise updates/deletions
    return result.rows.map(r => ({
      ...r.data,
      _dbId: r.id,
      _dbCountry: r.country || (r.data && (r.data.Country || r.data['COUNTRY'])) || null,
    }));
  } catch (err) {
    console.error('Erro ao consultar suppliers_json:', err);
    return [];
  } finally {
    client.release();
  }
}

/**
 * Insert a new supplier record into JSONB table.
 */
async function insertJsonSupplier(record, country, createdByUser) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO suppliers_json (country, data, created_by_user_id, created_by_user_name)
       VALUES ($1, $2, $3, $4)`,
      [country || null, record, createdByUser?.id || null, createdByUser?.name || null]
    );
    return true;
  } catch (err) {
    console.error('Erro ao inserir em suppliers_json:', err);
    return false;
  } finally {
    client.release();
  }
}

// Export new helpers
module.exports.createJsonTable = createJsonTable;
module.exports.migrateDriveToJson = migrateDriveToJson;
module.exports.getJsonSuppliers = getJsonSuppliers;
module.exports.insertJsonSupplier = insertJsonSupplier;
/**
 * Update an existing supplier record in JSONB table.
 * Match priority:
 * 1) Exact Created_At/Created At/DATE/Date embedded in JSON
 * 2) Fallback: Name + Country (+ Website when available)
 */
async function updateJsonSupplier(oldRecord, updatedRecord, countryHint) {
  const client = await pool.connect();
  try {
    // Prefer exact match by DB id when available to avoid multi-updates
    const idFromOld = oldRecord && (oldRecord._dbId || oldRecord.id);
    const idFromNew = updatedRecord && (updatedRecord._dbId || updatedRecord.id);
    const targetId = idFromNew || idFromOld;
    if (targetId && Number(targetId) > 0) {
      const resById = await client.query(
        `UPDATE suppliers_json SET data = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
        [updatedRecord, Number(targetId)]
      );
      if (resById.rowCount > 0) {
        return true;
      }
      // if id path failed, continue with legacy matching below
    }

    const toStr = (v) => (v === undefined || v === null) ? null : String(v).trim();
    const toLower = (v) => (v === undefined || v === null) ? null : String(v).trim().toLowerCase();
    const normalizeCountryAliases = (raw) => {
      const s = toLower(raw);
      if (!s) return [];
      // Mapear aliases comuns para US/CA/MX
      if (['us','usa','united states','united states of america'].includes(s)) {
        return ['us','usa','united states','united states of america'];
      }
      if (['ca','canada'].includes(s)) {
        return ['ca','canada'];
      }
      if (['mx','mexico','méxico'].includes(s)) {
        return ['mx','mexico','méxico'];
      }
      return [s];
    };
    const normalizeWebsiteJs = (v) => {
      if (v === undefined || v === null) return null;
      let s = String(v).trim().toLowerCase();
      if (!s) return null;
      s = s.replace(/^https?:\/\//, '');
      s = s.replace(/^www\./, '');
      s = s.replace(/:\d+$/, '');
      s = s.replace(/\/$/, '');
      return s;
    };

    // Try match by embedded created timestamp first
    const createdCandidates = [
      toStr(oldRecord?.['Created_At']),
      toStr(oldRecord?.['Created At']),
      toStr(oldRecord?.['DATE']),
      toStr(oldRecord?.['Date'])
    ].filter(Boolean);

    if (createdCandidates.length > 0) {
      const res = await client.query(
        `UPDATE suppliers_json
         SET data = $1, updated_at = NOW()
         WHERE (data->>'Created_At' = ANY($2)
             OR data->>'Created At' = ANY($2)
             OR data->>'DATE' = ANY($2)
             OR data->>'Date' = ANY($2))
         RETURNING id`,
        [updatedRecord, createdCandidates]
      );
      if (res.rowCount > 0) {
        return true;
      }
    }

    // Fallback 1: Website normalizado (apenas Website)
    const websiteRaw = (
      oldRecord?.Website
      || oldRecord?.['WEBSITE']
      || oldRecord?.['URL']
      || oldRecord?.['Site']
    );
    const websiteNormOnly = normalizeWebsiteJs(websiteRaw);
    if (websiteNormOnly) {
      const resWebsite = await client.query(
        `UPDATE suppliers_json
         SET data = $1, updated_at = NOW()
         WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(data->>'Website', data->>'WEBSITE', data->>'URL', data->>'Site'), '^https?://', ''), '^www\.', ''), '/$', '')) = $2
         RETURNING id`,
        [updatedRecord, websiteNormOnly]
      );
      if (resWebsite.rowCount > 0) {
        return true;
      }
    }

    // Fallback 2: Name + Country (com aliases; Website opcional)
    const name = toLower(
      oldRecord?.Name
      || oldRecord?.['Company Name']
      || oldRecord?.['COMPANY']
      || oldRecord?.['Empresa']
      || oldRecord?.['Distributor']
    );
    const country = toLower(countryHint || oldRecord?.Country || oldRecord?.['COUNTRY']);
    const countryAliases = normalizeCountryAliases(country);

    if (!name || !country) {
      // Insufficient identity to safely update
      return false;
    }

    const params = [updatedRecord, name, countryAliases];
    let where = `
      LOWER(COALESCE(data->>'Name', data->>'Company Name', data->>'COMPANY', data->>'Empresa', data->>'Distributor')) = $2
      AND LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = ANY($3)
    `;

    const res = await client.query(
      `UPDATE suppliers_json SET data = $1, updated_at = NOW() WHERE ${where} RETURNING id`,
      params
    );
    return res.rowCount > 0;
  } catch (err) {
    console.error('Erro ao atualizar suppliers_json:', err);
    return false;
  } finally {
    client.release();
  }
}
module.exports.updateJsonSupplier = updateJsonSupplier;

/**
 * Delete an existing supplier record from JSONB table.
 * Match priority:
 * 1) Exact Created_At/Created At/DATE/Date embedded in JSON
 * 2) Fallback: Name + Country (+ Website when available)
 */
async function deleteJsonSupplier(oldRecord, countryHint) {
  const client = await pool.connect();
  try {
    // Prefer exact delete by DB id when available to avoid multi-deletions
    const idFromOld = oldRecord && (oldRecord._dbId || oldRecord.id);
    if (idFromOld && Number(idFromOld) > 0) {
      const resById = await client.query(
        `DELETE FROM suppliers_json WHERE id = $1 RETURNING id`,
        [Number(idFromOld)]
      );
      if (resById.rowCount > 0) {
        return true;
      }
      // if id path failed, continue with legacy matching below
    }

    const toStr = (v) => (v === undefined || v === null) ? null : String(v).trim();
    const toLower = (v) => (v === undefined || v === null) ? null : String(v).trim().toLowerCase();

    const createdCandidates = [
      toStr(oldRecord?.['Created_At']),
      toStr(oldRecord?.['Created At']),
      toStr(oldRecord?.['DATE']),
      toStr(oldRecord?.['Date'])
    ].filter(Boolean);

    if (createdCandidates.length > 0) {
      // Make timestamp match safer by also constraining by Name + Country when present
      const nameLc = toLower(
        oldRecord?.Name
        || oldRecord?.['Company Name']
        || oldRecord?.['COMPANY']
        || oldRecord?.['Empresa']
        || oldRecord?.['Distributor']
      );
      const countryLc = toLower(countryHint || oldRecord?.Country || oldRecord?.['COUNTRY']);
      if (nameLc && countryLc) {
        const res = await client.query(
          `DELETE FROM suppliers_json
           WHERE (data->>'Created_At' = ANY($1)
               OR data->>'Created At' = ANY($1)
               OR data->>'DATE' = ANY($1)
               OR data->>'Date' = ANY($1))
             AND LOWER(COALESCE(data->>'Name', data->>'Company Name', data->>'COMPANY', data->>'Empresa', data->>'Distributor')) = $2
             AND LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = $3
           RETURNING id`,
          [createdCandidates, nameLc, countryLc]
        );
        if (res.rowCount > 0) {
          return true;
        }
      } else {
        // Fall back to pure timestamp delete if no identity context is available
        const res = await client.query(
          `DELETE FROM suppliers_json
           WHERE (data->>'Created_At' = ANY($1)
               OR data->>'Created At' = ANY($1)
               OR data->>'DATE' = ANY($1)
               OR data->>'Date' = ANY($1))
           RETURNING id`,
          [createdCandidates]
        );
        if (res.rowCount > 0) {
          return true;
        }
      }
    }

    const name = toLower(
      oldRecord?.Name
      || oldRecord?.['Company Name']
      || oldRecord?.['COMPANY']
      || oldRecord?.['Empresa']
      || oldRecord?.['Distributor']
    );
    const country = toLower(countryHint || oldRecord?.Country || oldRecord?.['COUNTRY']);
    const website = toLower(
      oldRecord?.Website
      || oldRecord?.['WEBSITE']
      || oldRecord?.['URL']
      || oldRecord?.['Site']
    );

    if (!name || !country) {
      return false;
    }

    const params = [name, country];
    let where = `
      LOWER(COALESCE(data->>'Name', data->>'Company Name', data->>'COMPANY', data->>'Empresa', data->>'Distributor')) = $1
      AND LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = $2
    `;
    if (website) {
      params.push(website);
      where += ` AND LOWER(COALESCE(data->>'Website', data->>'WEBSITE', data->>'URL', data->>'Site')) = $3`;
    }
    const res = await client.query(
      `DELETE FROM suppliers_json WHERE ${where} RETURNING id`,
      params
    );
    return res.rowCount > 0;
  } catch (err) {
    console.error('Erro ao deletar em suppliers_json:', err);
    return false;
  } finally {
    client.release();
  }
}
module.exports.deleteJsonSupplier = deleteJsonSupplier;

/**
 * Upsert supplier record into JSONB table using normalized keys.
 * Try match by Website (normalized), else Email, else Name+Country.
 */
async function upsertJsonSupplier(record, countryHint, createdByUser) {
  const client = await pool.connect();
  try {
    const lower = (v) => (v === undefined || v === null) ? null : String(v).trim().toLowerCase();

    const websiteRaw = record?.Website || record?.['WEBSITE'] || record?.['URL'] || record?.['Site'];
    const emailRaw = record?.['E-Mail'] || record?.['Email'] || record?.['EMAIL'];
    const nameRaw = record?.Name || record?.['Company Name'] || record?.['COMPANY'] || record?.['Empresa'] || record?.['Distributor'];
    const countryRaw = countryHint || record?.Country || record?.['COUNTRY'] || null;
    const country = lower(countryRaw);
    const name = lower(nameRaw);
    const email = lower(emailRaw);
    const websiteNorm = (() => {
      let s = lower(websiteRaw);
      if (!s) return null;
      // Normalize like deduplicate: strip protocol, www., trailing slash
      s = s.replace(/^https?:\/\//, '');
      s = s.replace(/^www\./, '');
      s = s.replace(/\/$/, '');
      return s;
    })();

    let existingId = null;
    if (websiteNorm) {
      const res = await client.query(
        `SELECT id FROM suppliers_json
         WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(data->>'Website', data->>'WEBSITE', data->>'URL', data->>'Site'), '^https?://', ''), '^www\.', ''), '/$', '')) = $1
         LIMIT 1`,
        [websiteNorm]
      );
      existingId = res.rows?.[0]?.id || null;
    }
    if (!existingId && email) {
      const res = await client.query(
        `SELECT id FROM suppliers_json
         WHERE LOWER(COALESCE(data->>'E-Mail', data->>'Email', data->>'EMAIL')) = $1
         LIMIT 1`,
        [email]
      );
      existingId = res.rows?.[0]?.id || null;
    }
    if (!existingId && name && country) {
      const res = await client.query(
        `SELECT id FROM suppliers_json
         WHERE LOWER(COALESCE(data->>'Name', data->>'Company Name', data->>'COMPANY', data->>'Empresa', data->>'Distributor')) = $1
           AND LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = $2
         LIMIT 1`,
        [name, country]
      );
      existingId = res.rows?.[0]?.id || null;
    }

    if (existingId) {
      await client.query(
        `UPDATE suppliers_json SET data = $1, updated_at = NOW() WHERE id = $2`,
        [record, existingId]
      );
      return { inserted: false, updated: true, id: existingId };
    } else {
      const res = await client.query(
        `INSERT INTO suppliers_json (country, data, created_by_user_id, created_by_user_name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [countryRaw || null, record, createdByUser?.id || null, createdByUser?.name || null]
      );
      return { inserted: true, updated: false, id: res.rows?.[0]?.id };
    }
  } catch (err) {
    console.error('Erro em upsert suppliers_json:', err);
    throw err;
  } finally {
    client.release();
  }
}
module.exports.upsertJsonSupplier = upsertJsonSupplier;

/**
 * Remove duplicated records from suppliers_json using normalized keys.
 * Priority of key:
 * 1) Website (normalized without protocol/trailing slash)
 * 2) E-Mail/Email (lowercase)
 * 3) Name/Company Name + Country
 * Keeps the most recent (by created_at) for each key and deletes others.
 * Returns a summary with counts.
 */
async function deduplicateSuppliersJson() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT id, country, data, created_at FROM suppliers_json`);
    const normalizeWebsite = (w) => {
      if (!w) return null;
      let s = String(w).trim().toLowerCase();
      s = s.replace(/^https?:\/\//, '');
      s = s.replace(/^www\./, '');
      s = s.replace(/\/$/, '');
      return s || null;
    };
    const normalizeEmail = (e) => {
      if (!e) return null;
      return String(e).trim().toLowerCase();
    };
    const normalizeText = (t) => {
      if (!t) return null;
      return String(t).trim().toLowerCase();
    };

    const pickKey = (row) => {
      const d = row.data || {};
      const website = d.Website || d['WEBSITE'] || d['Site'] || d['URL'];
      const email = d['E-Mail'] || d['Email'] || d['EMAIL'];
      const name = d.Name || d['Company Name'] || d['COMPANY'] || d['Empresa'] || d['Distributor'];
      const country = row.country || d.Country || d['COUNTRY'] || null;

      const w = normalizeWebsite(website);
      if (w) return `w:${w}`;
      const em = normalizeEmail(email);
      if (em) return `e:${em}`;
      const nm = normalizeText(name);
      if (nm) return `n:${nm}|${normalizeText(country) || ''}`;
      // Fallback to unique id to avoid accidental deletions
      return `id:${row.id}`;
    };

    // Group by key and keep most recent
    const groups = new Map();
    for (const r of rows) {
      const key = pickKey(r);
      const prev = groups.get(key);
      if (!prev) {
        groups.set(key, r);
      } else {
        const prevTime = new Date(prev.created_at).getTime();
        const curTime = new Date(r.created_at).getTime();
        if (curTime > prevTime) {
          // current is newer, mark prev for deletion
          const deletions = (groups.get(`${key}:del`) || []);
          deletions.push(prev.id);
          groups.set(`${key}:del`, deletions);
          groups.set(key, r);
        } else {
          const deletions = (groups.get(`${key}:del`) || []);
          deletions.push(r.id);
          groups.set(`${key}:del`, deletions);
        }
      }
    }

    // Collect all deletions
    const toDelete = [];
    for (const [k, v] of groups.entries()) {
      if (String(k).endsWith(':del')) {
        toDelete.push(...v);
      }
    }

    let deleted = 0;
    if (toDelete.length > 0) {
      await client.query(`DELETE FROM suppliers_json WHERE id = ANY($1)`, [toDelete]);
      deleted = toDelete.length;
    }

    return {
      total: rows.length,
      deleted,
      kept: rows.length - deleted,
    };
  } catch (err) {
    console.error('Erro ao deduplicar suppliers_json:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports.deduplicateSuppliersJson = deduplicateSuppliersJson;
