const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

class User {
    constructor(id, email, password, role, name, createdBy = null, allowedCountries = null) {
        this.id = id;
        this.email = email;
        this.password = password;
        this.role = role; // 'admin' ou 'gerente'
        this.name = name;
        this.createdBy = createdBy; // ID do usuário que criou este usuário
        this.createdAt = new Date();
        this.isActive = true;
        // Países permitidos por perfil
        this.allowedCountries = Array.isArray(allowedCountries) && allowedCountries.length > 0
            ? allowedCountries
            : (this.role === 'admin' ? ['US', 'CA', 'MX', 'CN'] : ['US']);
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
            password: this.password,
            role: this.role,
            name: this.name,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
            isActive: this.isActive,
            allowedCountries: this.allowedCountries
        };
    }
}

// Base de dados em memória para usuários com persistência em arquivo JSON
class UserRepository {
    constructor() {
        this.users = [];
        this.nextId = 1;
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
                            : (u.role === 'admin' ? ['US', 'CA', 'MX', 'CN'] : ['US'])
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
        
        // Usuários de teste originais
        this.users.push(new User(
            this.nextId++,
            'admin@mylokok.com',
            User.hashPassword('admin123'),
            'admin',
            'Admin'
        ));
        console.log('✅ Usuário admin@mylokok.com criado');

        this.users.push(new User(
            this.nextId++,
            'operador@mylokok.com',
            User.hashPassword('operador123'),
            'operador',
            'Operador'
        ));
        console.log('✅ Usuário operador@mylokok.com criado');

        this.users.push(new User(
            this.nextId++,
            'gerente@mylokok.com',
            User.hashPassword('gerente123'),
            'gerente',
            'Gerente'
        ));
        console.log('✅ Usuário gerente@mylokok.com criado');

        // Adicionar usuário Nacho
        this.users.push(new User(
            this.nextId++,
            'nacho@mylokok.com',
            User.hashPassword('nacho123'),
            'gerente',
            'Nacho'
        ));
        console.log('✅ Usuário nacho@mylokok.com criado');

        // Adicionar usuários de teste conforme documentação
        this.users.push(new User(
            this.nextId++,
            'hubert',
            User.hashPassword('admin123'),
            'admin',
            'Hubert'
        ));
        console.log('✅ Usuário hubert criado');

        this.users.push(new User(
            this.nextId++,
            'nacho',
            User.hashPassword('gerente123'),
            'gerente',
            'Nacho'
        ));
        console.log('✅ Usuário nacho criado');
        
        console.log(`🎯 Total de usuários criados: ${this.users.length}`);
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
            userData.createdBy,
            Array.isArray(userData.allowedCountries) && userData.allowedCountries.length > 0 ? userData.allowedCountries : null
        );
        this.users.push(user);
        this.saveUsers();
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
            if (Array.isArray(userData.allowedCountries) && userData.allowedCountries.length > 0) {
                user.allowedCountries = userData.allowedCountries;
            }
            this.saveUsers();
            return user;
        }
        return null;
    }

    // Desativar usuário (soft delete)
    deactivate(id) {
        const user = this.findById(id);
        if (user) {
            user.isActive = false;
            this.saveUsers();
            return true;
        }
        return false;
    }

    // Deletar usuário permanentemente (hard delete)
    delete(id) {
        const userIndex = this.users.findIndex(user => user.id === id);
        if (userIndex !== -1) {
            this.users.splice(userIndex, 1);
            this.saveUsers();
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