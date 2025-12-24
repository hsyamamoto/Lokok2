const bcrypt = require('bcryptjs');

class User {
  constructor(id, email, password, role, name, createdBy = null, allowedCountries = []) {
    this.id = id;
    this.email = email;
    this.password = password; // expects bcrypt hash from DB
    this.role = role;
    this.name = name;
    this.createdBy = createdBy;
    this.allowedCountries = Array.isArray(allowedCountries)
      ? allowedCountries.map((c) => String(c).toUpperCase())
      : [];
    this.createdAt = new Date();
    this.isActive = true;
  }

  static comparePassword(plain, hashed) {
    try {
      if (!hashed || typeof hashed !== 'string') return false;
      return bcrypt.compareSync(String(plain || ''), hashed);
    } catch (_) {
      return false;
    }
  }

  static async comparePasswordAsync(plain, hashed) {
    try {
      if (!hashed || typeof hashed !== 'string') return false;
      return await bcrypt.compare(String(plain || ''), hashed);
    } catch (_) {
      return false;
    }
  }
}

module.exports = { User };

