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
    await createTables();
    await createInitialUsers();
    await migrateExcelData();
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