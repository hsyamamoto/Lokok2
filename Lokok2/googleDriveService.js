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
<<<<<<< HEAD
     * Infere cabeçalhos da primeira linha da worksheet ou fornece um conjunto padrão
     */
    inferHeadersFromWorksheet(ws) {
        try {
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
            const headerRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : [];
            if (Array.isArray(headerRow) && headerRow.length > 0) return headerRow;
        } catch (_) {}
        return [
            'Name','Website','CATEGORÍA','Account Request Status','DATE','Responsable',
            'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)',
            'Description/Notes','Contact Name','Contact Phone','E-Mail','Address','User','PASSWORD',
            'LLAMAR','PRIO (1 - TOP, 5 - baixo)','Comments','Country','Created_By_User_ID','Created_By_User_Name','Created_At'
        ];
    }

    /**
     * Garante que existam abas vazias para CANADA/MEXICO/CHINA com a mesma estrutura
     */
    ensureCountrySheets(workbook) {
        if (!workbook || !workbook.SheetNames) return { changed: false };
        const sheetNames = workbook.SheetNames;
        const hasUS = sheetNames.includes('Wholesale LOKOK');
        const hasCA = sheetNames.includes('Wholesale CANADA');
        const hasMX = sheetNames.includes('Wholesale MEXICO');
        const hasCN = sheetNames.includes('Wholesale CHINA');
        let changed = false;

        const baseWs = hasUS ? workbook.Sheets['Wholesale LOKOK'] : workbook.Sheets[sheetNames[0]];
        const headers = baseWs ? this.inferHeadersFromWorksheet(baseWs) : this.inferHeadersFromWorksheet({});
        const emptySheetAoA = [headers];

        if (!hasCA) {
            const emptyWS_CA = XLSX.utils.aoa_to_sheet(emptySheetAoA);
            workbook.Sheets['Wholesale CANADA'] = emptyWS_CA;
            workbook.SheetNames.push('Wholesale CANADA');
            changed = true;
            console.log('📄 [PRODUCTION DEBUG] Criada aba vazia: Wholesale CANADA');
        }
        if (!hasMX) {
            const emptyWS_MX = XLSX.utils.aoa_to_sheet(emptySheetAoA);
            workbook.Sheets['Wholesale MEXICO'] = emptyWS_MX;
            workbook.SheetNames.push('Wholesale MEXICO');
            changed = true;
            console.log('📄 [PRODUCTION DEBUG] Criada aba vazia: Wholesale MEXICO');
        }
        if (!hasCN) {
            const emptyWS_CN = XLSX.utils.aoa_to_sheet(emptySheetAoA);
            workbook.Sheets['Wholesale CHINA'] = emptyWS_CN;
            workbook.SheetNames.push('Wholesale CHINA');
            changed = true;
            console.log('📄 [PRODUCTION DEBUG] Criada aba vazia: Wholesale CHINA');
        }

        return { changed };
    }

    /**
     * Retorna o nome da aba correspondente ao país
     */
    getSheetNameForCountry(country) {
        const c = String(country || '').toUpperCase();
        if (c === 'CA') return 'Wholesale CANADA';
        if (c === 'MX') return 'Wholesale MEXICO';
        if (c === 'CN') return 'Wholesale CHINA';
        return 'Wholesale LOKOK'; // US padrão
    }

    /**
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
     * Converte URL do Google Drive para URL de download direto
     */
    getDirectDownloadUrl() {
        return `https://drive.google.com/uc?export=download&id=${this.fileId}`;
    }
    
    // URLs candidatas: Google Sheets export (xlsx) e fallback Drive
    getCandidateDownloadUrls() {
        const id = this.fileId;
        const urls = [];
        if (id) {
            urls.push(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
            urls.push(`https://drive.google.com/uc?export=download&id=${id}`);
        }
        return urls;
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
            console.log('📥 [PRODUCTION DEBUG] Tentando baixar planilha do Google Drive...');
            console.log('📥 [PRODUCTION DEBUG] File ID:', this.fileId);

            const urls = this.getCandidateDownloadUrls();
            if (!urls || urls.length === 0) throw new Error('GOOGLE_DRIVE_FILE_ID não definido');

            let response;
            for (const url of urls) {
                try {
                    console.log('🔎 Tentando URL:', url);
                    response = await axios({
                        method: 'GET',
                        url,
                        responseType: 'arraybuffer',
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        maxRedirects: 5
                    });
                    if (response && response.status === 200 && response.data) {
                        console.log('✅ Download efetuado com sucesso via:', url);
                        break;
                    }
                } catch (err) {
                    console.log('⚠️ Falha ao baixar via', url, '-', err.message);
                }
            }
            if (!response || !response.data) throw new Error('Não foi possível baixar a planilha de nenhuma URL');

            // Criar diretório data se não existir
            const dataDir = path.dirname(this.localCachePath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Salvar arquivo localmente
            fs.writeFileSync(this.localCachePath, response.data);
            
<<<<<<< HEAD
            console.log('✅ [PRODUCTION DEBUG] Planilha baixada e salva em cache');
            console.log('✅ [PRODUCTION DEBUG] Arquivo salvo em:', this.localCachePath);
=======
            console.log('✅ Planilha baixada e salva em cache');
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
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
<<<<<<< HEAD
    async readSpreadsheetData(selectedCountry) {
        try {
            console.log('📖 [PRODUCTION DEBUG] Iniciando leitura dos dados da planilha...');
            const spreadsheetPath = await this.getSpreadsheetPath();
            
            console.log('📖 [PRODUCTION DEBUG] Caminho da planilha:', spreadsheetPath);
            console.log('📖 [PRODUCTION DEBUG] Arquivo existe:', fs.existsSync(spreadsheetPath));
            
            if (fs.existsSync(spreadsheetPath)) {
                const stats = fs.statSync(spreadsheetPath);
                console.log('📖 [PRODUCTION DEBUG] Tamanho do arquivo:', stats.size, 'bytes');
                
                // Verificar se o arquivo não está vazio
                if (stats.size === 0) {
                    throw new Error('Arquivo da planilha está vazio');
                }
                
                // Verificar se o arquivo é realmente um Excel válido
                const buffer = fs.readFileSync(spreadsheetPath);
                const header = buffer.toString('utf8', 0, 100);
                console.log('📖 [PRODUCTION DEBUG] Header do arquivo:', header.substring(0, 50));
                
                if (header.includes('<html') || header.includes('<!DOCTYPE')) {
                    throw new Error('Arquivo contém HTML em vez de dados Excel');
                }
            }
            
            console.log('📖 [PRODUCTION DEBUG] Lendo arquivo Excel...');
            const workbook = XLSX.readFile(spreadsheetPath);
            // Garantir que existam abas específicas de país
            const ensured = this.ensureCountrySheets(workbook);
            if (ensured.changed) {
                try {
                    XLSX.writeFile(workbook, this.localCachePath);
                    console.log('🔧 [PRODUCTION DEBUG] Abas de país garantidas e cache atualizado');
                } catch (e) {
                    console.warn('⚠️ [PRODUCTION DEBUG] Falha ao atualizar cache após garantir abas:', e?.message);
                }
            }
            const sheetNames = workbook.SheetNames || [];
            console.log('📖 [PRODUCTION DEBUG] Sheets disponíveis:', sheetNames);

            let data = [];
            if (selectedCountry) {
                const target = this.getSheetNameForCountry(selectedCountry);
                console.log('📖 [PRODUCTION DEBUG] Usando sheet por país:', target);
                const ws = workbook.Sheets[target];
                data = XLSX.utils.sheet_to_json(ws);
            } else {
                // Sem país selecionado: concatenar abas preferidas se existirem, senão usar a primeira
                const preferred = ['Wholesale LOKOK', 'Wholesale CANADA', 'Wholesale MEXICO', 'Wholesale CHINA'].filter(n => sheetNames.includes(n));
                if (preferred.length > 0) {
                    for (const name of preferred) {
                        const ws = workbook.Sheets[name];
                        const rows = XLSX.utils.sheet_to_json(ws);
                        console.log('📖 [PRODUCTION DEBUG] Lendo sheet preferida:', name, 'Registros:', rows.length);
                        data = data.concat(rows);
                    }
                } else {
                    const ws = workbook.Sheets[sheetNames[0]];
                    data = XLSX.utils.sheet_to_json(ws);
                }
            }
            
            console.log(`✅ [PRODUCTION DEBUG] ${data.length} registros carregados da planilha`);
            if (data.length > 0) {
                console.log('📖 [PRODUCTION DEBUG] Primeiro registro:', JSON.stringify(data[0]));
            }
            return data;
            
        } catch (error) {
            console.error('❌ [PRODUCTION DEBUG] Erro ao ler dados da planilha:', error.message);
            console.error('❌ [PRODUCTION DEBUG] Stack trace:', error.stack);
=======
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
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            throw error;
        }
    }

    /**
     * Salva dados na planilha (funcionalidade limitada - apenas local)
     * Nota: Para salvar no Google Drive seria necessário usar a API completa
     */
<<<<<<< HEAD
    async saveSpreadsheetData(data, selectedCountry) {
        try {
            console.log('💾 Salvando dados na planilha local (cache)...');

            let workbook;
            if (fs.existsSync(this.localCachePath)) {
                try {
                    workbook = XLSX.readFile(this.localCachePath);
                } catch (_) {
                    workbook = XLSX.utils.book_new();
                }
            } else {
                workbook = XLSX.utils.book_new();
            }

            const sheetName = this.getSheetNameForCountry(selectedCountry);
            const worksheet = XLSX.utils.json_to_sheet(data || []);

            // Remover sheet existente com mesmo nome, se houver
            if (workbook.SheetNames?.includes(sheetName)) {
                delete workbook.Sheets[sheetName];
                workbook.SheetNames = workbook.SheetNames.filter(n => n !== sheetName);
            }
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

            // Salvar localmente
            XLSX.writeFile(workbook, this.localCachePath);
            
            console.log('✅ Dados salvos na planilha local (aba:', sheetName, ')');
=======
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
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
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