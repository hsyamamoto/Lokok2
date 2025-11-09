const XLSX = require('xlsx');
const path = require('path');

// Função para formatar data no padrão brasileiro
function formatBrazilianDateTime(date) {
    return new Intl.DateTimeFormat('pt-BR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/Sao_Paulo'
    }).format(date).replace(/\//g, '/').replace(',', ' às');
}

function updateExcelTimestamps() {
    try {
        const excelPath = path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');
        
        // Ler o arquivo Excel
        const workbook = XLSX.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Converter para JSON
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        console.log(`Atualizando ${data.length} registros...`);
        
        // Atualizar cada registro
        const updatedData = data.map((record, index) => {
            const now = new Date();
            const brazilianDateTime = formatBrazilianDateTime(now);
            
            // Se não tem Created_At, adicionar
            if (!record.Created_At) {
                record.Created_At = brazilianDateTime;
                record.Created_By_User_Name = record.Created_By_User_Name || 'Sistema';
                record.Created_By_User_ID = record.Created_By_User_ID || 0;
            } else {
                // Se já tem Created_At em formato ISO, converter para brasileiro
                if (record.Created_At.includes('T') && record.Created_At.includes('Z')) {
                    const createdDate = new Date(record.Created_At);
                    record.Created_At = formatBrazilianDateTime(createdDate);
                }
            }
            
            // Adicionar campos de atualização se não existirem
            if (!record.Updated_At) {
                record.Updated_At = '';
            }
            if (!record.Updated_By_User_Name) {
                record.Updated_By_User_Name = '';
            }
            if (!record.Updated_By_User_ID) {
                record.Updated_By_User_ID = '';
            }
            
            return record;
        });
        
        // Criar nova planilha
        const newWorksheet = XLSX.utils.json_to_sheet(updatedData);
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);
        
        // Salvar arquivo
        XLSX.writeFile(newWorkbook, excelPath);
        
        console.log('✅ Timestamps atualizados com sucesso!');
        console.log('Campos adicionados/atualizados:');
        console.log('- Created_At (formato brasileiro)');
        console.log('- Updated_At (vazio, será preenchido nas próximas edições)');
        console.log('- Updated_By_User_Name (vazio, será preenchido nas próximas edições)');
        console.log('- Updated_By_User_ID (vazio, será preenchido nas próximas edições)');
        
    } catch (error) {
        console.error('❌ Erro ao atualizar timestamps:', error);
    }
}

// Executar a atualização
updateExcelTimestamps();