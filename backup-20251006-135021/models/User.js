const bcrypt = require('bcryptjs');

class User {
    constructor(id, email, password, role, name, createdBy = null) {
        this.id = id;
        this.email = email;
        this.password = password;
        this.role = role; // 'admin' ou 'gerente'
        this.name = name;
        this.createdBy = createdBy; // ID do usuário que criou este usuário
        this.createdAt = new Date();
        this.isActive = true;
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
            role: this.role,
            name: this.name,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
            isActive: this.isActive
        };
    }
}

// Base de dados em memória para usuários
class UserRepository {
    constructor() {
        this.users = [];
        this.nextId = 1;
        this.initializeDefaultUsers();
    }

    // Inicializar usuários padrão
    initializeDefaultUsers() {
        // Usuários de teste originais
        this.users.push(new User(
            this.nextId++,
            'admin@mylokok.com',
            User.hashPassword('admin123'),
            'admin',
            'Admin'
        ));

        this.users.push(new User(
            this.nextId++,
            'operador@mylokok.com',
            User.hashPassword('operador123'),
            'operador',
            'Operador'
        ));

        this.users.push(new User(
            this.nextId++,
            'gerente@mylokok.com',
            User.hashPassword('gerente123'),
            'gerente',
            'Gerente'
        ));

        // Adicionar usuário Nacho
        this.users.push(new User(
            this.nextId++,
            'nacho@mylokok.com',
            User.hashPassword('nacho123'),
            'gerente',
            'Nacho'
        ));
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
            userData.createdBy
        );
        this.users.push(user);
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
            return user;
        }
        return null;
    }

    // Desativar usuário (soft delete)
    deactivate(id) {
        const user = this.findById(id);
        if (user) {
            user.isActive = false;
            return true;
        }
        return false;
    }

    // Deletar usuário permanentemente (hard delete)
    delete(id) {
        const userIndex = this.users.findIndex(user => user.id === id);
        if (userIndex !== -1) {
            this.users.splice(userIndex, 1);
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