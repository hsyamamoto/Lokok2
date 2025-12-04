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

// Função para migrar dados do Excel para PostgreSQL
async function migrateExcelData() {
  const excelPath = process.env.EXCEL_PATH || './data/Wholesale Suppliers and Product Opportunities.xlsx';
  
  if (!fs.existsSync(excelPath)) {
    console.log('Arquivo Excel não encontrado. Pulando migração.');
    return;
  }

  const workbook = xlsx.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);

  const client = await pool.connect();
  try {
    // Limpar dados existentes
    await client.query('DELETE FROM suppliers');
    
    for (const row of data) {
      await client.query(`
        INSERT INTO suppliers (
          company_name, contact_person, email, phone, website,
          country, state, city, address, products, categories,
          minimum_order, payment_terms, certifications, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        row['Company Name'] || '',
        row['Contact Person'] || '',
        row['Email'] || '',
        row['Phone'] || '',
        row['Website'] || '',
        row['Country'] || '',
        row['State/Province'] || '',
        row['City'] || '',
        row['Address'] || '',
        row['Products/Services'] || '',
        row['Product Categories'] || '',
        row['Minimum Order'] || '',
        row['Payment Terms'] || '',
        row['Certifications'] || '',
        row['Notes'] || ''
      ]);
    }
    
    console.log(`${data.length} registros migrados com sucesso!`);
  } catch (err) {
    console.error('Erro na migração:', err);
  } finally {
    client.release();
  }
}

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

// Função principal de inicialização
async function initializeDatabase() {
  try {
    // Garantir estrutura mínima
    await createTables();
    await createInitialUsers();
    await createJsonTable();

    // Idempotência: só reseedar do Excel se tabela estiver vazia
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
      console.log('Migração para suppliers_json a partir do Excel...');
      await migrateExcelToJson();
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
  migrateExcelData,
  createInitialUsers,
  initializeDatabase
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
async function migrateExcelToJson() {
  const excelPath = process.env.EXCEL_PATH || path.join(process.cwd(), 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');

  if (!excelPath || !fs.existsSync(excelPath)) {
    console.log('Arquivo Excel não encontrado para migração JSON. Pulando.');
    return;
  }

  const workbook = xlsx.readFile(excelPath);
  const client = await pool.connect();
  try {
    // Clear existing data before seeding
    await client.query('DELETE FROM suppliers_json');

    const canonicalizeCountry = (value) => {
      if (!value) return null;
      let v = String(value).trim().toLowerCase();
      // Map common synonyms to ISO codes
      if (v === 'us' || v === 'u.s.' || v === 'usa' || v.includes('united states')) return 'US';
      if (v === 'ca' || v.includes('canada')) return 'CA';
      if (v === 'mx' || v.includes('mexico')) return 'MX';
      if (v === 'cn' || v.includes('china')) return 'CN';
      // If already a 2-letter code, return uppercased
      if (v.length === 2) return v.toUpperCase();
      return null;
    };

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const rows = xlsx.utils.sheet_to_json(ws);

      // Infer country from sheet name if it matches expected naming
      let inferredCountry = null;
      const normalized = sheetName.trim().toLowerCase();
      if (normalized.includes('lokok') || normalized.includes('usa') || normalized.includes('united states')) inferredCountry = 'US';
      else if (normalized.includes('canada')) inferredCountry = 'CA';
      else if (normalized.includes('mexico')) inferredCountry = 'MX';
      else if (normalized.includes('china')) inferredCountry = 'CN';

      for (const row of rows) {
        const country = canonicalizeCountry(inferredCountry || row.Country) || null;
        await client.query(
          `INSERT INTO suppliers_json (country, data) VALUES ($1, $2)`,
          [country, row]
        );
      }
    }
    console.log('Migração para suppliers_json concluída com sucesso.');
  } catch (err) {
    console.error('Erro ao migrar para suppliers_json:', err);
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
      result = await client.query(`SELECT data FROM suppliers_json WHERE country = ANY($1)`, [countries]);
    } else {
      result = await client.query(`SELECT data FROM suppliers_json`);
    }
    return result.rows.map(r => r.data);
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
module.exports.migrateExcelToJson = migrateExcelToJson;
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
    const toStr = (v) => (v === undefined || v === null) ? null : String(v).trim();
    const toLower = (v) => (v === undefined || v === null) ? null : String(v).trim().toLowerCase();
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

    // Fallback: Name + Country (+ Website when available)
    const name = toLower(
      oldRecord?.Name
      || oldRecord?.['Company Name']
      || oldRecord?.['COMPANY']
      || oldRecord?.['Empresa']
      || oldRecord?.['Distributor']
    );
    const country = toLower(countryHint || oldRecord?.Country || oldRecord?.['COUNTRY']);
    const websiteRaw = (
      oldRecord?.Website
      || oldRecord?.['WEBSITE']
      || oldRecord?.['URL']
      || oldRecord?.['Site']
    );
    const website = toLower(websiteRaw);
    const websiteNorm = normalizeWebsiteJs(websiteRaw);

    if (!name || !country) {
      // Insufficient identity to safely update
      return false;
    }

    const params = [updatedRecord, name, country];
    let where = `
      LOWER(COALESCE(data->>'Name', data->>'Company Name', data->>'COMPANY', data->>'Empresa', data->>'Distributor')) = $2
      AND LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = $3
    `;
    if (websiteNorm) {
      params.push(websiteNorm);
      // Normalizar Website no lado SQL para manter consistência com dedup/upsert
      where += ` AND regexp_replace(regexp_replace(regexp_replace(LOWER(COALESCE(data->>'Website', data->>'WEBSITE', data->>'URL', data->>'Site')), '^https?://', ''), '^www\\.', ''), '/$', '') = $4`;
    } else if (website) {
      // Fallback simples se não houver como normalizar
      params.push(website);
      where += ` AND LOWER(COALESCE(data->>'Website', data->>'WEBSITE', data->>'URL', data->>'Site')) = $4`;
    }

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
    const toStr = (v) => (v === undefined || v === null) ? null : String(v).trim();
    const toLower = (v) => (v === undefined || v === null) ? null : String(v).trim().toLowerCase();

    const createdCandidates = [
      toStr(oldRecord?.['Created_At']),
      toStr(oldRecord?.['Created At']),
      toStr(oldRecord?.['DATE']),
      toStr(oldRecord?.['Date'])
    ].filter(Boolean);

    if (createdCandidates.length > 0) {
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
