const axios = require('axios');
const XLSX = require('xlsx');

class GoogleDriveService {
    constructor() {
        this.fileId = process.env.GOOGLE_DRIVE_FILE_ID;
        this.email = process.env.GOOGLE_DRIVE_EMAIL;
        this.password = process.env.GOOGLE_DRIVE_PASSWORD;
        // Removido cache/local: leitura sempre direto do Google Drive
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
            'Name','Website','CATEGORÍA','Type','Account Request Status','DATE','Responsable',
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
     * Converte URL do Google Drive para URL de download direto
     */
    getDirectDownloadUrl() {
        return `https://drive.google.com/uc?export=download&id=${this.fileId}`;
    }

    // Cache local removido

    /**
     * Baixa a planilha do Google Drive
     */
    async downloadSpreadsheet() {
        try {
            console.log('📥 [PRODUCTION DEBUG] Tentando baixar planilha do Google Drive...');
            console.log('📥 [PRODUCTION DEBUG] File ID:', this.fileId);
            
            const downloadUrl = this.getDirectDownloadUrl();
            console.log('📥 [PRODUCTION DEBUG] Download URL:', downloadUrl);
            
            const response = await axios({
                method: 'GET',
                url: downloadUrl,
                responseType: 'arraybuffer',
                timeout: 30000, // 30 segundos
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                maxRedirects: 5
            });

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
            console.log('✅ [PRODUCTION DEBUG] Planilha baixada em memória');
            return Buffer.from(response.data);
            
        } catch (error) {
            console.error('❌ Erro ao baixar planilha do Google Drive:', error.message);
            throw new Error('Não foi possível baixar a planilha do Google Drive');
        }
    }

    /**
     * Obtém o caminho da planilha (baixa se necessário)
     */
    // getSpreadsheetPath removido (uso direto do buffer)

    /**
     * Lê os dados da planilha
     */
    async readSpreadsheetData(selectedCountry) {
        try {
            console.log('📖 [PRODUCTION DEBUG] Iniciando leitura dos dados da planilha...');
            const buffer = await this.downloadSpreadsheet();
            console.log('📖 [PRODUCTION DEBUG] Tamanho do buffer:', buffer.length, 'bytes');
            const header = buffer.toString('utf8', 0, 100);
            console.log('📖 [PRODUCTION DEBUG] Header do buffer:', header.substring(0, 50));
            if (header.includes('<html') || header.includes('<!DOCTYPE')) {
                throw new Error('Resposta contém HTML em vez de dados Excel');
            }
            console.log('📖 [PRODUCTION DEBUG] Lendo workbook a partir do buffer...');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            // Garantir que existam abas específicas de país
            const ensured = this.ensureCountrySheets(workbook);
            if (ensured.changed) {
                console.log('🔧 [PRODUCTION DEBUG] Abas de país garantidas');
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
            throw error;
        }
    }

    /**
     * Salva dados na planilha (funcionalidade limitada - apenas local)
     * Nota: Para salvar no Google Drive seria necessário usar a API completa
     */
    async saveSpreadsheetData() {
        console.log('🚫 saveSpreadsheetData não implementado sem cache/local.');
        throw new Error('Salvar no Google Drive não está implementado');
    }

    /**
     * Força atualização do cache
     */
    async refreshCache() {
        // Sem cache; apenas rebaixa para validar acesso
        return await this.downloadSpreadsheet();
    }
}

module.exports = GoogleDriveService;
