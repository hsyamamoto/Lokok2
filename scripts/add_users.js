// Adds or updates Marcelo and Jeison as manager/gerente users.
// Usage: node scripts/add_users.js
const { UserRepository } = require('../models/User');

async function main() {
  const repo = new UserRepository();

  const ensureUser = (name, email, role = 'gerente', password = 'manager123', allowedCountries = ['US']) => {
    const existing = repo.findByEmail(email);
    if (existing) {
      // Update role/name/allowedCountries if needed
      const updated = repo.update(existing.id, { name, role, allowedCountries });
      console.log(`Updated existing user: ${email} -> role=${updated.role}, name=${updated.name}`);
      return updated;
    }
    const created = repo.create({ name, email, password, role, createdBy: null, allowedCountries });
    console.log(`Created user: ${email} (role=${role})`);
    return created;
  };

  ensureUser('Marcelo', 'marcelogalvis@mylokok.com', 'gerente');
  ensureUser('Jeison', 'jeisonanteliz@mylokok.com', 'gerente');

  console.log('Done.');
}

main().catch(err => {
  console.error('Error adding users:', err);
  process.exit(1);
});

