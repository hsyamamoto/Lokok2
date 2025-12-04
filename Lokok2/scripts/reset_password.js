const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

function usage() {
  console.log('Usage: node scripts/reset_password.js <email> <newPassword>');
  console.log('Example: node scripts/reset_password.js admin@mylokok.com admin123');
}

function main() {
  const [email, newPassword] = process.argv.slice(2);
  if (!email || !newPassword) {
    usage();
    process.exit(1);
  }

  const usersFile = path.resolve(__dirname, '..', 'data', 'users.json');
  if (!fs.existsSync(usersFile)) {
    console.error('users.json not found at', usersFile);
    process.exit(1);
  }

  const raw = fs.readFileSync(usersFile, 'utf8');
  const data = JSON.parse(raw);
  const users = Array.isArray(data.users) ? data.users : [];
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) {
    console.error('User not found for email:', email);
    process.exit(1);
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  users[idx].password = hashed;
  data.users = users;

  fs.writeFileSync(usersFile, JSON.stringify(data, null, 2));
  console.log('Password updated for', email);
}

main();