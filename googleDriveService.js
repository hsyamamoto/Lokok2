const axios = require('axios');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { google } = require('googleapis');

class GoogleDriveService {
    constructor() {
        this.fileId = process.env.GOOGLE_DRIVE_FILE_ID;
        this.email = process.env.GOOGLE_DRIVE_EMAIL;
        this.password = process.env.GOOGLE_DRIVE_PASSWORD;
        this.localCachePath = path.join(__dirname, 'data', 'cached_spreadsheet.xlsx');
        this.cacheMaxAge = 5 * 60 * 1000; // 5 minutos em milliseconds
        this.serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        this.serviceAccountKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
        this.sheetGid = process.env.GOOGLE_SHEET_GID; // opcional: alvo exato via gid da aba
        this.cachePinFile = path.join(__dirname, 'data', 'cache_pin.json');
    }

    /**
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
     * Garante que existam abas vazias para CANADA/MEXICO com a mesma estrutura
     */
    ensureCountrySheets(workbook) {
        if (!workbook || !workbook.SheetNames) return { changed: false };
        const sheetNames = workbook.SheetNames;
        const hasUS = sheetNames.includes('Wholesale LOKOK');
        const hasCA = sheetNames.includes('Wholesale CANADA');
        const hasMX = sheetNames.includes('Wholesale MEXICO');
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
        // Sem suporte a CN/CHINA

        return { changed };
    }

    /**
     * Retorna o nome da aba correspondente ao país
     */
    getSheetNameForCountry(country) {
        const c = String(country || '').toUpperCase();
        if (c === 'CA') return 'Wholesale CANADA';
        if (c === 'MX') return 'Wholesale MEXICO';
        return 'Wholesale LOKOK'; // US padrão
    }

    /**
     * Resolve de forma tolerante o nome da aba para o país,
     * aceitando variações de capitalização como "Wholesale Mexico"/"Wholesale CANADA".
     */
    findSheetTitleForCountry(sheetNames, country) {
        const normalize = (s) => String(s || '').trim().toUpperCase();
        const preferred = this.getSheetNameForCountry(country);
        const preferredNorm = normalize(preferred);
        const namesMap = new Map(sheetNames.map(n => [normalize(n), n]));

        console.log('[TELEMETRY] resolveSheetDrive:start', {
            country: String(country || '').toUpperCase(),
            preferred,
            candidatesCount: (sheetNames || []).length,
            candidates: sheetNames || [],
        });

        if (namesMap.has(preferredNorm)) {
            const result = namesMap.get(preferredNorm);
            console.log('[TELEMETRY] resolveSheetDrive:exact', { result });
            return result;
        }

        // Tentar por tokens do país na aba (tolerante, incluindo variantes comuns)
        const c = String(country || '').toUpperCase();
        const tokens = (c === 'MX')
            ? ['MEXICO']
            : (c === 'CA')
                ? ['CANADA']
                : ['LOKOK', 'USA', 'UNITED STATES']; // US
        for (const token of tokens) {
            const tokenMatch = sheetNames.find(n => normalize(n).includes(token));
            if (tokenMatch) {
                console.log('[TELEMETRY] resolveSheetDrive:token', { token, result: tokenMatch });
                return tokenMatch;
            }
        }

        // Variações comuns de capitalização
        const variants = [
            preferred,
            preferred.toLowerCase(),
            preferred.toUpperCase(),
            // MX
            (c === 'MX') ? 'Wholesale Mexico' : null,
            // CA
            (c === 'CA') ? 'Wholesale Canada' : null,
            // US
            (c === 'US') ? 'Wholesale Lokok' : null,
        ].filter(Boolean);
        for (const v of variants) {
            const vNorm = normalize(v);
            if (namesMap.has(vNorm)) {
                const result = namesMap.get(vNorm);
                console.log('[TELEMETRY] resolveSheetDrive:variant', { tried: v, result });
                return result;
            }
        }

        console.log('[TELEMETRY] resolveSheetDrive:none', { country: String(country || '').toUpperCase() });
        return null; // não encontrada
    }

    /**
     * Inicializa auth e cliente da API Google Sheets quando credenciais estão presentes
     */
    async getSheetsClient() {
        try {
            if (!this.serviceAccountEmail || !this.serviceAccountKey) return null;
            const auth = new google.auth.JWT(
                this.serviceAccountEmail,
                null,
                this.serviceAccountKey,
                ['https://www.googleapis.com/auth/spreadsheets']
            );
            await auth.authorize();
            return google.sheets({ version: 'v4', auth });
        } catch (error) {
            console.error('❌ Falha ao inicializar Google Sheets API:', error.message);
            return null;
        }
    }

    /**
     * Obtém o título da aba pelo GID, se fornecido nas variáveis de ambiente
     */
    async resolveSheetTitleByGidIfProvided(sheetsClient) {
        try {
            if (!this.sheetGid) return null;
            const gidNum = Number(this.sheetGid);
            if (!Number.isFinite(gidNum)) return null;
            const meta = await sheetsClient.spreadsheets.get({
                spreadsheetId: this.fileId,
            });
            const tabs = meta?.data?.sheets || [];
            const match = tabs.find(t => t?.properties?.sheetId === gidNum);
            return match?.properties?.title || null;
        } catch (error) {
            console.warn('⚠️ Não foi possível resolver título por GID:', error.message);
            return null;
        }
    }

    /**
     * Retorna URLs candidatas para download: export de Google Sheets e fallback do Drive
     */
    getCandidateDownloadUrls() {
        const id = this.fileId;
        return [
            // Google Sheets (export em XLSX)
            `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
            // Fallback genérico do Drive
            `https://drive.google.com/uc?export=download&id=${id}`
        ];
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
            // Respeitar pin de cache (se presente) para evitar re-download que sobrescreva dados salvos localmente
            try {
                if (fs.existsSync(this.cachePinFile)) {
                    const raw = fs.readFileSync(this.cachePinFile, 'utf8');
                    const obj = JSON.parse(raw);
                    const pinUntil = Number(obj.pinUntil) || 0;
                    if (pinUntil > 0 && now < pinUntil) {
                        return true;
                    }
                }
            } catch (_) {
                // Ignorar erros ao ler pin
            }
            return (now - fileTime) < this.cacheMaxAge;
        } catch (error) {
            console.error('Erro ao verificar cache:', error);
            return false;
        }
    }

    /**
     * Pina o cache por um período específico (ms). Útil quando apenas
     * salvamos localmente e queremos manter a leitura no cache atualizado.
     */
    pinCacheFor(ms) {
        try {
            const dataDir = path.dirname(this.cachePinFile);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            const obj = { pinUntil: Date.now() + Math.max(0, Number(ms) || 0) };
            fs.writeFileSync(this.cachePinFile, JSON.stringify(obj));
            console.log('📌 [PRODUCTION DEBUG] Cache pinned until:', new Date(obj.pinUntil).toISOString());
        } catch (error) {
            console.warn('⚠️ [PRODUCTION DEBUG] Falha ao pinar cache:', error?.message);
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
            let response;
            let lastError;
            for (const downloadUrl of urls) {
                try {
                    console.log('📥 [PRODUCTION DEBUG] Tentando URL:', downloadUrl);
                    response = await axios({
                        method: 'GET',
                        url: downloadUrl,
                        responseType: 'arraybuffer',
                        timeout: 30000, // 30 segundos
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        maxRedirects: 5
                    });
                    // sucesso, quebra loop
                    break;
                } catch (err) {
                    lastError = err;
                    console.warn('⚠️ [PRODUCTION DEBUG] Falha ao baixar por', downloadUrl, '-', err?.message);
                }
            }
            if (!response) {
                throw lastError || new Error('Falha ao baixar a planilha por todas URLs candidatas');
            }

            console.log('📥 [PRODUCTION DEBUG] Response status:', response.status);
            console.log('📥 [PRODUCTION DEBUG] Response headers:', response.headers['content-type']);
            console.log('📥 [PRODUCTION DEBUG] Response size:', response.data.length);
            
            // Verificar se a resposta é HTML (página de confirmação do Google Drive)
            const responseText = response.data.toString('utf8', 0, 500);
            if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
                console.log('⚠️ [PRODUCTION DEBUG] Resposta é HTML, tentando extrair link de download...');
                
                // Tentar extrair o link de download real da página HTML
                const confirmMatch = responseText.match(/href="([^"]*&confirm=[^"]*)"/i);
                if (confirmMatch) {
                    const confirmUrl = confirmMatch[1].replace(/&amp;/g, '&');
                    console.log('📥 [PRODUCTION DEBUG] Tentando URL de confirmação:', confirmUrl);
                    
                    const confirmResponse = await axios({
                        method: 'GET',
                        url: confirmUrl,
                        responseType: 'arraybuffer',
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    response.data = confirmResponse.data;
                    console.log('✅ [PRODUCTION DEBUG] Download com confirmação bem-sucedido');
                } else {
                    throw new Error('Não foi possível extrair link de download da página de confirmação');
                }
            }

            // Criar diretório data se não existir
            const dataDir = path.dirname(this.localCachePath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Salvar arquivo localmente
            fs.writeFileSync(this.localCachePath, response.data);
            
            console.log('✅ [PRODUCTION DEBUG] Planilha baixada e salva em cache');
            console.log('✅ [PRODUCTION DEBUG] Arquivo salvo em:', this.localCachePath);
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
                const target = this.findSheetTitleForCountry(sheetNames, selectedCountry) || this.getSheetNameForCountry(selectedCountry);
                console.log('📖 [PRODUCTION DEBUG] Usando sheet por país (resolvida):', target);
                const ws = workbook.Sheets[target];
                data = ws ? XLSX.utils.sheet_to_json(ws) : [];
            } else {
                // Sem país selecionado: concatenar abas preferidas se existirem, senão usar a primeira
                const preferred = ['Wholesale LOKOK', 'Wholesale CANADA', 'Wholesale MEXICO'].filter(n => sheetNames.includes(n));
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
            throw error;
        }
    }

    /**
     * Salva dados na planilha (funcionalidade limitada - apenas local)
     * Nota: Para salvar no Google Drive seria necessário usar a API completa
     */
    async saveSpreadsheetData(data, selectedCountry) {
        try {
            const sheetsClient = await this.getSheetsClient();

            // Prepara headers e linhas
            const arr = Array.isArray(data) ? data : [];
            // Usar a união de chaves de todas as linhas para garantir inclusão de novos campos (ex.: Updated_*)
            let headers;
            if (arr.length > 0) {
                const set = new Set();
                for (const row of arr) {
                    Object.keys(row || {}).forEach(k => set.add(k));
                }
                headers = Array.from(set);
            } else {
                headers = this.inferHeadersFromWorksheet({});
            }
            const values = [headers, ...arr.map(row => headers.map(h => row[h] ?? ''))];

            // Determina a aba alvo
            let targetSheet = this.getSheetNameForCountry(selectedCountry);
            if (sheetsClient) {
                const byGid = await this.resolveSheetTitleByGidIfProvided(sheetsClient);
                if (byGid) targetSheet = byGid;
            }

            if (sheetsClient) {
                console.log(`💾 Escrevendo na Google Sheets (aba: ${targetSheet})...`);
                // Limpa aba e escreve valores a partir de A1
                try {
                    await sheetsClient.spreadsheets.values.clear({
                        spreadsheetId: this.fileId,
                        range: `${targetSheet}`,
                    });
                } catch (_) {}

                await sheetsClient.spreadsheets.values.update({
                    spreadsheetId: this.fileId,
                    range: `${targetSheet}!A1`,
                    valueInputOption: 'RAW',
                    requestBody: { values }
                });
                console.log('✅ Dados salvos na Google Sheets com sucesso');
            } else {
                console.log('⚠️ Credenciais da Google API não configuradas; salvando apenas no cache local');
            }

            // Atualiza cache local para manter consistência
            let workbook;
            try {
                if (fs.existsSync(this.localCachePath)) {
                    workbook = XLSX.readFile(this.localCachePath);
                } else {
                    workbook = XLSX.utils.book_new();
                }
            } catch (_) {
                workbook = XLSX.utils.book_new();
            }
            const worksheet = XLSX.utils.aoa_to_sheet(values);
            if (workbook.SheetNames?.includes(targetSheet)) {
                delete workbook.Sheets[targetSheet];
                workbook.SheetNames = workbook.SheetNames.filter(n => n !== targetSheet);
            }
            XLSX.utils.book_append_sheet(workbook, worksheet, targetSheet);
            XLSX.writeFile(workbook, this.localCachePath);
            console.log('💾 Cache local atualizado (aba:', targetSheet, ')');

            // Fixar cache por um período para evitar re-download que sobrescreva alterações locais
            try {
                const pin = { pinUntil: Date.now() + (15 * 60 * 1000) }; // 15 minutos
                fs.writeFileSync(this.cachePinFile, JSON.stringify(pin));
                console.log('📌 Cache fixado após gravação por 15 minutos');
            } catch (e) {
                console.warn('⚠️ Falha ao fixar cache após gravação:', e?.message);
            }
            if (!sheetsClient) {
                // Sem credenciais para escrever no Drive: manter leitura no cache atualizado
                this.pinCacheFor(24 * 60 * 60 * 1000);
            }
            
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
