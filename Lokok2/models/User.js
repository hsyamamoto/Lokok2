const bcrypt = require('bcryptjs');
<<<<<<< HEAD
const fs = require('fs');
const path = require('path');
const ALLOWED_COUNTRIES = ['US','CA','MX'];

class User {
    constructor(id, email, password, role, name, createdBy = null, allowedCountries = null) {
=======

class User {
    constructor(id, email, password, role, name, createdBy = null) {
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        this.id = id;
        this.email = email;
        this.password = password;
        this.role = role; // 'admin' ou 'gerente'
        this.name = name;
        this.createdBy = createdBy; // ID do usuário que criou este usuário
        this.createdAt = new Date();
        this.isActive = true;
<<<<<<< HEAD
        // Países permitidos por perfil
        const normalized = Array.isArray(allowedCountries) ? allowedCountries.map(c => String(c).toUpperCase()) : null;
        this.allowedCountries = (normalized && normalized.length > 0)
            ? normalized.filter(c => ALLOWED_COUNTRIES.includes(c))
            : (this.role === 'admin' ? ALLOWED_COUNTRIES : ['US']);
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    }

    // Método para verificar senha
    static comparePassword(plainPassword, hashedPassword) {
        return bcrypt.compareSync(plainPassword, hashedPassword);
    }

    // Método para hash da senha
    static hashPassword(password) {
        return bcrypt.hashSync(password, 10);
    }

    // Método para verificar se é administrador
    isAdmin() {
        return this.role === 'admin';
    }

    // Método para verificar se é gerente
    isManager() {
        return this.role === 'gerente';
    }

    // Método para converter para objeto simples (sem métodos)
    toJSON() {
        return {
            id: this.id,
            email: this.email,
<<<<<<< HEAD
            password: this.password,
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            role: this.role,
            name: this.name,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
<<<<<<< HEAD
            isActive: this.isActive,
            allowedCountries: this.allowedCountries
=======
            isActive: this.isActive
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        };
    }
}

<<<<<<< HEAD
// Base de dados em memória para usuários com persistência em arquivo JSON
=======
// Base de dados em memória para usuários
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
class UserRepository {
    constructor() {
        this.users = [];
        this.nextId = 1;
<<<<<<< HEAD
        this.usersFilePath = path.join(__dirname, '..', 'data', 'users.json');
        this.loadUsers();
    }

    // Carregar usuários do arquivo JSON
    loadUsers() {
        console.log('📂 Iniciando carregamento de usuários...');
        console.log('📍 Caminho do arquivo:', this.usersFilePath);
        
        try {
            // Criar diretório data se não existir
            const dataDir = path.dirname(this.usersFilePath);
            console.log('📁 Diretório de dados:', dataDir);
            
            if (!fs.existsSync(dataDir)) {
                console.log('🔨 Criando diretório de dados...');
                fs.mkdirSync(dataDir, { recursive: true });
            }

            if (fs.existsSync(this.usersFilePath)) {
                console.log('✅ Arquivo users.json encontrado, carregando...');
                const data = fs.readFileSync(this.usersFilePath, 'utf8');
                const userData = JSON.parse(data);
                this.users = userData.users.map(u => {
                    const user = new User(
                        u.id,
                        u.email,
                        u.password,
                        u.role,
                        u.name,
                        u.createdBy,
                        // manter compatibilidade com arquivos antigos sem allowedCountries
                        Array.isArray(u.allowedCountries) && u.allowedCountries.length > 0
                            ? u.allowedCountries
                            : (u.role === 'admin' ? ALLOWED_COUNTRIES : ['US'])
                    );
                    user.createdAt = new Date(u.createdAt);
                    user.isActive = u.isActive;
                    return user;
                });
                this.nextId = userData.nextId || 1;
                console.log(`📊 ${this.users.length} usuários carregados do arquivo`);
            } else {
                console.log('❌ Arquivo users.json não encontrado, inicializando usuários padrão...');
                this.initializeDefaultUsers();
                this.saveUsers();
                console.log('💾 Arquivo users.json criado com usuários padrão');
            }
        } catch (error) {
            console.error('❌ Erro ao carregar usuários:', error);
            console.log('🔄 Fallback: inicializando usuários padrão...');
            this.initializeDefaultUsers();
            this.saveUsers();
        }
    }

    // Salvar usuários no arquivo JSON
    saveUsers() {
        try {
            const data = {
                users: this.users.map(u => u.toJSON()),
                nextId: this.nextId
            };
            fs.writeFileSync(this.usersFilePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar usuários:', error);
        }
    }

    // Inicializar usuários padrão (apenas se não existir arquivo)
    initializeDefaultUsers() {
        console.log('🔧 Inicializando usuários padrão...');
        
=======
        this.initializeDefaultUsers();
    }

    // Inicializar usuários padrão
    initializeDefaultUsers() {
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        // Usuários de teste originais
        this.users.push(new User(
            this.nextId++,
            'admin@mylokok.com',
            User.hashPassword('admin123'),
            'admin',
            'Admin'
        ));
<<<<<<< HEAD
        console.log('✅ Usuário admin@mylokok.com criado');
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)

        this.users.push(new User(
            this.nextId++,
            'operador@mylokok.com',
            User.hashPassword('operador123'),
            'operador',
            'Operador'
        ));
<<<<<<< HEAD
        console.log('✅ Usuário operador@mylokok.com criado');
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)

        this.users.push(new User(
            this.nextId++,
            'gerente@mylokok.com',
            User.hashPassword('gerente123'),
            'gerente',
            'Gerente'
        ));
<<<<<<< HEAD
        console.log('✅ Usuário gerente@mylokok.com criado');
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)

        // Adicionar usuário Nacho
        this.users.push(new User(
            this.nextId++,
            'nacho@mylokok.com',
            User.hashPassword('nacho123'),
            'gerente',
            'Nacho'
        ));
<<<<<<< HEAD
        console.log('✅ Usuário nacho@mylokok.com criado');
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)

        // Adicionar usuários de teste conforme documentação
        this.users.push(new User(
            this.nextId++,
            'hubert',
            User.hashPassword('admin123'),
            'admin',
            'Hubert'
        ));
<<<<<<< HEAD
        console.log('✅ Usuário hubert criado');
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)

        this.users.push(new User(
            this.nextId++,
            'nacho',
            User.hashPassword('gerente123'),
            'gerente',
            'Nacho'
        ));
<<<<<<< HEAD
        console.log('✅ Usuário nacho criado');
        
        console.log(`🎯 Total de usuários criados: ${this.users.length}`);
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    }

    // Buscar usuário por email
    findByEmail(email) {
        return this.users.find(user => user.email === email && user.isActive);
    }

    // Buscar usuário por ID
    findById(id) {
        return this.users.find(user => user.id === id && user.isActive);
    }

    // Listar todos os usuários ativos
    findAll() {
        return this.users.filter(user => user.isActive);
    }

    // Listar usuários criados por um administrador específico
    findByCreator(creatorId) {
        return this.users.filter(user => user.createdBy === creatorId && user.isActive);
    }

    // Criar novo usuário
    create(userData) {
        const user = new User(
            this.nextId++,
            userData.email,
            User.hashPassword(userData.password),
            userData.role,
            userData.name,
<<<<<<< HEAD
            userData.createdBy,
            Array.isArray(userData.allowedCountries) && userData.allowedCountries.length > 0 ? userData.allowedCountries : null
        );
        this.users.push(user);
        this.saveUsers();
=======
            userData.createdBy
        );
        this.users.push(user);
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        return user;
    }

    // Atualizar usuário
    update(id, userData) {
        const userIndex = this.users.findIndex(user => user.id === id);
        if (userIndex !== -1) {
            const user = this.users[userIndex];
            user.name = userData.name || user.name;
            user.email = userData.email || user.email;
            if (userData.password) {
                user.password = User.hashPassword(userData.password);
            }
            user.role = userData.role || user.role;
<<<<<<< HEAD
            if (Array.isArray(userData.allowedCountries) && userData.allowedCountries.length > 0) {
                user.allowedCountries = userData.allowedCountries;
            }
            this.saveUsers();
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            return user;
        }
        return null;
    }

    // Desativar usuário (soft delete)
    deactivate(id) {
        const user = this.findById(id);
        if (user) {
            user.isActive = false;
<<<<<<< HEAD
            this.saveUsers();
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            return true;
        }
        return false;
    }

    // Deletar usuário permanentemente (hard delete)
    delete(id) {
        const userIndex = this.users.findIndex(user => user.id === id);
        if (userIndex !== -1) {
            this.users.splice(userIndex, 1);
<<<<<<< HEAD
            this.saveUsers();
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            return true;
        }
        return false;
    }

    // Verificar se email já existe
    emailExists(email, excludeId = null) {
        return this.users.some(user => 
            user.email === email && 
            user.isActive && 
            (excludeId ? user.id !== excludeId : true)
        );
    }
}

module.exports = { User, UserRepository };