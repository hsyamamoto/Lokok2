const axios = require('axios');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

class GoogleDriveService {
    constructor() {
        this.fileId = process.env.GOOGLE_DRIVE_FILE_ID;
        this.email = process.env.GOOGLE_DRIVE_EMAIL;
        this.password = process.env.GOOGLE_DRIVE_PASSWORD;
        this.localCachePath = path.join(__dirname, 'data', 'cached_spreadsheet.xlsx');
        this.cacheMaxAge = 5 * 60 * 1000; // 5 minutos em milliseconds
    }

    /**
     * Converte URL do Google Drive para URL de download direto
     */
    getDirectDownloadUrl() {
        return `https://drive.google.com/uc?export=download&id=${this.fileId}`;
    }

    /**
     * Verifica se o cache local é válido
     */
    isCacheValid() {
        try {
            if (!fs.existsSync(this.localCachePath)) {
                return false;
            }
            
            const stats = fs.statSync(this.localCachePath);
            const now = new Date().getTime();
            const fileTime = new Date(stats.mtime).getTime();
            
            return (now - fileTime) < this.cacheMaxAge;
        } catch (error) {
            console.error('Erro ao verificar cache:', error);
            return false;
        }
    }

    /**
     * Baixa a planilha do Google Drive
     */
    async downloadSpreadsheet() {
        try {
            console.log('📥 Tentando baixar planilha do Google Drive...');
            
            const downloadUrl = this.getDirectDownloadUrl();
            
            const response = await axios({
                method: 'GET',
                url: downloadUrl,
                responseType: 'arraybuffer',
                timeout: 30000, // 30 segundos
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            // Criar diretório data se não existir
            const dataDir = path.dirname(this.localCachePath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Salvar arquivo localmente
            fs.writeFileSync(this.localCachePath, response.data);
            
            console.log('✅ Planilha baixada e salva em cache');
            return this.localCachePath;
            
        } catch (error) {
            console.error('❌ Erro ao baixar planilha do Google Drive:', error.message);
            
            // Se falhar, tentar usar cache antigo se existir
            if (fs.existsSync(this.localCachePath)) {
                console.log('⚠️ Usando cache antigo da planilha');
                return this.localCachePath;
            }
            
            // Tentar usar arquivo local como fallback
            const localFallbackPath = path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');
            if (fs.existsSync(localFallbackPath)) {
                console.log('📁 Usando arquivo local como fallback...');
                
                // Criar diretório cache se não existir
                const cacheDir = path.dirname(this.localCachePath);
                if (!fs.existsSync(cacheDir)) {
                    fs.mkdirSync(cacheDir, { recursive: true });
                }
                
                // Copiar arquivo local para cache
                fs.copyFileSync(localFallbackPath, this.localCachePath);
                console.log('✅ Arquivo local copiado para cache');
                return this.localCachePath;
            }
            
            throw new Error('Não foi possível baixar a planilha e não há arquivo local disponível');
        }
    }

    /**
     * Obtém o caminho da planilha (baixa se necessário)
     */
    async getSpreadsheetPath() {
        try {
            // Verificar se o cache é válido
            if (this.isCacheValid()) {
                console.log('📋 Usando planilha em cache');
                return this.localCachePath;
            }

            // Cache inválido ou inexistente, baixar nova versão
            return await this.downloadSpreadsheet();
            
        } catch (error) {
            console.error('Erro ao obter planilha:', error);
            throw error;
        }
    }

    /**
     * Lê os dados da planilha
     */
    async readSpreadsheetData() {
        try {
            const spreadsheetPath = await this.getSpreadsheetPath();
            
            console.log('📖 Lendo dados da planilha...');
            const workbook = XLSX.readFile(spreadsheetPath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);
            
            console.log(`✅ ${data.length} registros carregados da planilha`);
            return data;
            
        } catch (error) {
            console.error('Erro ao ler dados da planilha:', error);
            throw error;
        }
    }

    /**
     * Salva dados na planilha (funcionalidade limitada - apenas local)
     * Nota: Para salvar no Google Drive seria necessário usar a API completa
     */
    async saveSpreadsheetData(data) {
        try {
            console.log('💾 Salvando dados na planilha local...');
            
            // Criar workbook
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
            
            // Salvar localmente
            XLSX.writeFile(workbook, this.localCachePath);
            
            console.log('✅ Dados salvos na planilha local');
            console.log('⚠️ Nota: Para sincronizar com Google Drive, seria necessário implementar upload via API');
            
        } catch (error) {
            console.error('Erro ao salvar dados:', error);
            throw error;
        }
    }

    /**
     * Força atualização do cache
     */
    async refreshCache() {
        try {
            // Remover cache existente
            if (fs.existsSync(this.localCachePath)) {
                fs.unlinkSync(this.localCachePath);
            }
            
            // Baixar nova versão
            return await this.downloadSpreadsheet();
            
        } catch (error) {
            console.error('Erro ao atualizar cache:', error);
            throw error;
        }
    }
}

module.exports = GoogleDriveService;