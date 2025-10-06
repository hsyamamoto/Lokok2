const XLSX = require('xlsx');
const path = require('path');

// Caminho para a planilha Excel
const EXCEL_PATH = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

function readExcelData() {
    try {
        const workbook = XLSX.readFile(EXCEL_PATH);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(worksheet);
    } catch (error) {
        console.error('Erro ao ler arquivo Excel:', error);
        return [];
    }
}

console.log('🔍 DEBUG: Analisando dados do dashboard...');

const data = readExcelData();
console.log(`📊 Total de registros: ${data.length}`);

// Estatísticas mensais (replicando a lógica do server.js)
const monthlyStats = {};

data.forEach((record, index) => {
    const dateValue = record['DATE'];
    let date = null;
    
    // Log dos primeiros 10 registros para debug
    if (index < 10) {
        console.log(`\n📅 Registro ${index + 1}:`);
        console.log(`   DATE original: ${dateValue} (tipo: ${typeof dateValue})`);
    }
    
    // Verificar se há um valor de data válido
    if (dateValue !== undefined && dateValue !== null && dateValue !== '' && String(dateValue).trim() !== '' && String(dateValue) !== 'undefined') {
        try {
            // Se for um número (serial do Excel), converter para data
            if (typeof dateValue === 'number' && dateValue > 0) {
                // Converter número serial do Excel para data JavaScript
                // Excel conta dias desde 30/12/1899 (considerando o bug do ano 1900)
                const excelEpoch = new Date(1899, 11, 30); // 30 de dezembro de 1899
                date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
                
                if (index < 10) {
                    console.log(`   Convertido para: ${date.toISOString()} (${date.getFullYear()})`);
                }
            } else if (typeof dateValue === 'string') {
                // Tentar converter string para data
                date = new Date(dateValue);
                
                if (index < 10) {
                    console.log(`   String convertida para: ${date.toISOString()} (${date.getFullYear()})`);
                }
            }
            
            // Verificar se a data é válida e está em um range razoável (após 1990 e antes de 2030)
            if (date && !isNaN(date.getTime()) && date.getFullYear() >= 1990 && date.getFullYear() <= 2030) {
                const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                                  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
                const monthName = monthNames[date.getMonth()];
                const year = date.getFullYear().toString().slice(-2); // Últimos 2 dígitos do ano
                const monthYear = `${monthName}/${year}`;
                monthlyStats[monthYear] = (monthlyStats[monthYear] || 0) + 1;
                
                if (index < 10) {
                    console.log(`   ✅ Válida: ${monthYear}`);
                }
            } else {
                // Data inválida ou fora do range
                monthlyStats['Sem data'] = (monthlyStats['Sem data'] || 0) + 1;
                
                if (index < 10) {
                    console.log(`   ❌ Inválida ou fora do range`);
                }
            }
        } catch (e) {
            // Erro ao processar data
            monthlyStats['Sem data'] = (monthlyStats['Sem data'] || 0) + 1;
            
            if (index < 10) {
                console.log(`   💥 Erro: ${e.message}`);
            }
        }
    } else {
        // Contar registros sem data
        monthlyStats['Sem data'] = (monthlyStats['Sem data'] || 0) + 1;
        
        if (index < 10) {
            console.log(`   📭 Sem data`);
        }
    }
});

console.log('\n📈 ESTATÍSTICAS MENSAIS FINAIS:');
console.log('================================');

// Ordenar por ano e mês
const sortedEntries = Object.entries(monthlyStats).sort((a, b) => {
    if (a[0] === 'Sem data') return 1;
    if (b[0] === 'Sem data') return -1;
    return a[0].localeCompare(b[0]);
});

sortedEntries.forEach(([monthYear, count]) => {
    console.log(`${monthYear}: ${count} registros`);
});

console.log('\n🎯 VERIFICAÇÃO ESPECÍFICA:');
const junho25 = monthlyStats['junho/25'] || 0;
console.log(`junho/25: ${junho25} registros`);

if (junho25 > 0) {
    console.log('✅ SUCESSO: Dados de junho/2025 encontrados!');
} else {
    console.log('❌ PROBLEMA: Dados de junho/2025 NÃO encontrados!');
}