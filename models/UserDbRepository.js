const { pool } = require('../database');
const { User } = require('./User');

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'gerente') return 'manager';
  if (r === 'administrador') return 'admin';
  if (['admin','manager','operator','user'].includes(r)) return r;
  return r || 'user';
}

function toUser(row) {
  if (!row) return null;
  const allowed = Array.isArray(row.allowed_countries)
    ? row.allowed_countries.map((c) => String(c).toUpperCase())
    : (row.role === 'admin' ? ['US','CA','MX'] : ['US']);
  const role = normalizeRole(row.role);
  const u = new User(row.id, row.email, row.password_hash || row.password, role, row.name, row.created_by || null, allowed);
  u.createdAt = row.created_at ? new Date(row.created_at) : new Date();
  u.isActive = row.is_active !== false; // default true
  return u;
}

class DbUserRepository {
  constructor() {}

  async findByEmailAsync(email) {
    const { rows } = await pool.query(
      'SELECT id, email, name, role, allowed_countries, password_hash, password, created_at, is_active FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    return rows.length ? toUser(rows[0]) : null;
  }

  /**
   * Busca usuário por email OU username (case-insensitive).
   * Primeiro tenta email; se não encontrar, tenta username.
   * Se a coluna "username" não existir, ignora silenciosamente.
   */
  async findByEmailOrUsernameAsync(identifier) {
    const value = String(identifier || '').trim();
    if (!value) return null;
    // 1) Tenta por email
    const byEmail = await this.findByEmailAsync(value);
    if (byEmail) return byEmail;
    // 2) Tenta por username (compatível com bases legadas)
    try {
      const { rows } = await pool.query(
        'SELECT id, email, name, role, allowed_countries, password_hash, password, created_at, is_active FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [value]
      );
      return rows.length ? toUser(rows[0]) : null;
    } catch (err) {
      // Se a coluna não existir (bases sem username), apenas retornar null
      if (String(err.message || '').toLowerCase().includes('column "username"')) {
        return null;
      }
      // Outros erros devem ser propagados para diagnóstico
      throw err;
    }
  }

  // Síncrona compatível com código existente (retorna Promise value). Server.js usa chamada síncrona; vamos expor equivalente assíncrono e um wrapper.
  findByEmail(email) {
    // Retorna uma versão "degradada": não é possível consultar DB de maneira síncrona.
    // Para compatibilidade mínima, lançar erro para incentivar uso assíncrono onde necessário.
    throw new Error('DbUserRepository.findByEmail é assíncrono. Use findByEmailAsync(email).');
  }

  async findAllAsync() {
    const { rows } = await pool.query(
      'SELECT id, email, name, role, allowed_countries, created_at, is_active FROM users ORDER BY created_at ASC, id ASC'
    );
    return rows.map(toUser);
  }

  findAll() {
    throw new Error('DbUserRepository.findAll é assíncrono. Use findAllAsync().');
  }

  async createAsync({ email, password, role, name, allowedCountries }) {
    const bcrypt = require('bcryptjs');
    const hashed = bcrypt.hashSync(password, 10);
    const ac = Array.isArray(allowedCountries) ? allowedCountries.map((c) => String(c).toUpperCase()) : null;
    const normRole = normalizeRole(role);
    const username = String(email || '').includes('@')
      ? String(email).split('@')[0].toLowerCase()
      : String(email || '').toLowerCase();
    const { rows } = await pool.query(
      `INSERT INTO users (email, username, name, role, allowed_countries, password_hash, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, allowed_countries = EXCLUDED.allowed_countries, password_hash = EXCLUDED.password_hash, updated_at = NOW()
       RETURNING id, email, name, role, allowed_countries, password_hash, created_at, is_active`,
      [email, username, name, normRole, ac, hashed]
    );
    return toUser(rows[0]);
  }

  async findByIdAsync(id) {
    const { rows } = await pool.query(
      'SELECT id, email, name, role, allowed_countries, password_hash, created_at, is_active FROM users WHERE id = $1 LIMIT 1',
      [id]
    );
    return rows.length ? toUser(rows[0]) : null;
  }

  findById(id) {
    throw new Error('DbUserRepository.findById é assíncrono. Use findByIdAsync(id).');
  }

  async updateAsync(id, { name, email, password, role, allowedCountries }) {
    const setClauses = [];
    const values = [];
    let idx = 1;

    if (typeof name === 'string') {
      setClauses.push(`name = $${idx++}`);
      values.push(name);
    }
    if (typeof email === 'string') {
      setClauses.push(`email = $${idx++}`);
      values.push(email);
    }
    if (typeof role === 'string') {
      setClauses.push(`role = $${idx++}`);
      values.push(normalizeRole(role));
    }
    if (Array.isArray(allowedCountries)) {
      const ac = allowedCountries.map((c) => String(c).toUpperCase());
      setClauses.push(`allowed_countries = $${idx++}`);
      values.push(ac);
    }
    if (typeof password === 'string' && password.trim().length > 0) {
      const bcrypt = require('bcryptjs');
      const hashed = bcrypt.hashSync(password, 10);
      setClauses.push(`password_hash = $${idx++}`);
      values.push(hashed);
    }

    if (setClauses.length === 0) {
      return await this.findByIdAsync(id);
    }

    setClauses.push('updated_at = NOW()');
    const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, allowed_countries, password_hash, created_at, is_active`;
    values.push(id);
    const { rows } = await pool.query(sql, values);
    return rows.length ? toUser(rows[0]) : null;
  }

  async updatePasswordByEmailAsync(email, newPassword) {
    const bcrypt = require('bcryptjs');
    const hashed = bcrypt.hashSync(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($1)', [email, hashed]);
    const { rows } = await pool.query(
      'SELECT id, email, name, role, allowed_countries, password_hash, created_at, is_active FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    return rows.length ? toUser(rows[0]) : null;
  }

  async existsEmailAsync(email) {
    const { rows } = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    return rows.length > 0;
  }

  async deactivateAsync(id) {
    await pool.query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    return true;
  }

  async deleteAsync(id) {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return true;
  }
}

module.exports = { DbUserRepository };
