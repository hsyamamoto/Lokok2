const fs = require('fs');
const path = require('path');

// Criar diretório de logs se não existir
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

class AuditLogger {
    constructor() {
        this.accessLogFile = path.join(logsDir, 'access.log');
        this.activityLogFile = path.join(logsDir, 'activity.log');
        this.maxLogSize = 10 * 1024 * 1024; // 10MB
        this.maxBackups = 5; // Manter 5 backups
    }

    // Formatar timestamp brasileiro
    getTimestamp() {
        const now = new Date();
        return now.toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    // Verificar se o arquivo precisa ser rotacionado
    needsRotation(filePath) {
        try {
            if (!fs.existsSync(filePath)) return false;
            const stats = fs.statSync(filePath);
            return stats.size >= this.maxLogSize;
        } catch (error) {
            console.error(`Erro ao verificar tamanho do arquivo ${filePath}:`, error);
            return false;
        }
    }

    // Rotacionar arquivo de log
    rotateLogFile(filePath) {
        try {
            const dir = path.dirname(filePath);
            const ext = path.extname(filePath);
            const baseName = path.basename(filePath, ext);
            
            // Mover backups existentes
            for (let i = this.maxBackups - 1; i >= 1; i--) {
                const oldBackup = path.join(dir, `${baseName}.${i}${ext}`);
                const newBackup = path.join(dir, `${baseName}.${i + 1}${ext}`);
                
                if (fs.existsSync(oldBackup)) {
                    if (i === this.maxBackups - 1) {
                        // Remover o backup mais antigo
                        fs.unlinkSync(oldBackup);
                    } else {
                        fs.renameSync(oldBackup, newBackup);
                    }
                }
            }
            
            // Mover o arquivo atual para .1
            const firstBackup = path.join(dir, `${baseName}.1${ext}`);
            fs.renameSync(filePath, firstBackup);
            
            console.log(`Log rotacionado: ${filePath} -> ${firstBackup}`);
        } catch (error) {
            console.error(`Erro ao rotacionar log ${filePath}:`, error);
        }
    }

    // Log de acesso (login/logout)
    logAccess(action, username, ip, userAgent = '') {
        // Verificar se precisa rotacionar antes de escrever
        if (this.needsRotation(this.accessLogFile)) {
            this.rotateLogFile(this.accessLogFile);
        }
        
        const timestamp = this.getTimestamp();
        const logEntry = `${timestamp} | ${action} | ${username} | IP: ${ip} | UserAgent: ${userAgent}\n`;
        
        fs.appendFileSync(this.accessLogFile, logEntry, 'utf8');
        console.log(`[AUDIT ACCESS] ${action} - ${username} - ${ip}`);
    }

    // Log de atividades (CRUD operations)
    logActivity(action, username, resource, details = '', ip = '') {
        // Verificar se precisa rotacionar antes de escrever
        if (this.needsRotation(this.activityLogFile)) {
            this.rotateLogFile(this.activityLogFile);
        }
        
        const timestamp = this.getTimestamp();
        const logEntry = `${timestamp} | ${action} | ${username} | ${resource} | ${details} | IP: ${ip}\n`;
        
        fs.appendFileSync(this.activityLogFile, logEntry, 'utf8');
        console.log(`[AUDIT ACTIVITY] ${action} - ${username} - ${resource}`);
    }

    // Ler logs de acesso
    getAccessLogs(limit = 100) {
        try {
            if (!fs.existsSync(this.accessLogFile)) {
                return [];
            }
            
            const data = fs.readFileSync(this.accessLogFile, 'utf8');
            const lines = data.trim().split('\n').filter(line => line.length > 0);
            
            return lines.slice(-limit).reverse().map(line => {
                const parts = line.split(' | ');
                return {
                    timestamp: parts[0] || '',
                    action: parts[1] || '',
                    username: parts[2] || '',
                    ip: parts[3] || '',
                    userAgent: parts[4] || ''
                };
            });
        } catch (error) {
            console.error('Erro ao ler logs de acesso:', error);
            return [];
        }
    }

    // Ler logs de atividade
    getActivityLogs(limit = 100) {
        try {
            if (!fs.existsSync(this.activityLogFile)) {
                return [];
            }
            
            const data = fs.readFileSync(this.activityLogFile, 'utf8');
            const lines = data.trim().split('\n').filter(line => line.length > 0);
            
            return lines.slice(-limit).reverse().map(line => {
                const parts = line.split(' | ');
                return {
                    timestamp: parts[0] || '',
                    action: parts[1] || '',
                    username: parts[2] || '',
                    resource: parts[3] || '',
                    details: parts[4] || '',
                    ip: parts[5] || ''
                };
            });
        } catch (error) {
            console.error('Erro ao ler logs de atividade:', error);
            return [];
        }
    }

    // Limpar logs antigos (manter apenas os últimos N dias)
    cleanOldLogs(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        [this.accessLogFile, this.activityLogFile].forEach(logFile => {
            try {
                if (!fs.existsSync(logFile)) return;
                
                const data = fs.readFileSync(logFile, 'utf8');
                const lines = data.trim().split('\n');
                
                const filteredLines = lines.filter(line => {
                    const timestamp = line.split(' | ')[0];
                    const logDate = new Date(timestamp.replace(/\//, '-').replace(/\//, '-'));
                    return logDate >= cutoffDate;
                });
                
                fs.writeFileSync(logFile, filteredLines.join('\n') + '\n', 'utf8');
                console.log(`Logs antigos removidos de ${path.basename(logFile)} (mantidos ${daysToKeep} dias)`);
            } catch (error) {
                console.error(`Erro ao limpar logs antigos de ${logFile}:`, error);
            }
        });
        
        // Limpar também os arquivos de backup antigos
        this.cleanOldBackups(daysToKeep);
    }
    
    // Limpar backups antigos
    cleanOldBackups(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        try {
            const files = fs.readdirSync(logsDir);
            
            files.forEach(file => {
                if (file.match(/\.(\d+)\.log$/)) {
                    const filePath = path.join(logsDir, file);
                    const stats = fs.statSync(filePath);
                    
                    if (stats.mtime < cutoffDate) {
                        fs.unlinkSync(filePath);
                        console.log(`Backup antigo removido: ${file}`);
                    }
                }
            });
        } catch (error) {
            console.error('Erro ao limpar backups antigos:', error);
        }
    }
    
    // Obter estatísticas dos logs
    getLogStats() {
        const stats = {
            access: { size: 0, lines: 0, backups: 0 },
            activity: { size: 0, lines: 0, backups: 0 }
        };
        
        try {
            // Estatísticas do log de acesso
            if (fs.existsSync(this.accessLogFile)) {
                const accessStats = fs.statSync(this.accessLogFile);
                const accessData = fs.readFileSync(this.accessLogFile, 'utf8');
                stats.access.size = accessStats.size;
                stats.access.lines = accessData.split('\n').filter(line => line.trim()).length;
            }
            
            // Estatísticas do log de atividade
            if (fs.existsSync(this.activityLogFile)) {
                const activityStats = fs.statSync(this.activityLogFile);
                const activityData = fs.readFileSync(this.activityLogFile, 'utf8');
                stats.activity.size = activityStats.size;
                stats.activity.lines = activityData.split('\n').filter(line => line.trim()).length;
            }
            
            // Contar backups
            const files = fs.readdirSync(logsDir);
            stats.access.backups = files.filter(f => f.startsWith('access.') && f.endsWith('.log')).length;
            stats.activity.backups = files.filter(f => f.startsWith('activity.') && f.endsWith('.log')).length;
            
        } catch (error) {
            console.error('Erro ao obter estatísticas dos logs:', error);
        }
        
        return stats;
    }
}

module.exports = new AuditLogger();