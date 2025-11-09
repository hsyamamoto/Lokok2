const XLSX = require('xlsx');

// Caminho para a planilha
const excelPath = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

try {
    // Ler a planilha
    const workbook = XLSX.readFile(excelPath);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet);
    
    console.log('Testando nova conversão de datas...');
    
    // Simular a lógica do servidor
    const monthlyStats = {};
    
    jsonData.forEach(record => {
        const dateValue = record['DATE'];
        let date = null;
        
        // Verificar se há um valor de data válido
        if (dateValue !== undefined && dateValue !== null && dateValue !== '' && String(dateValue).trim() !== '' && String(dateValue) !== 'undefined') {
            try {
                // Se for um número (serial do Excel), converter para data
                if (typeof dateValue === 'number' && dateValue > 0) {
                    // Converter número serial do Excel para data JavaScript
                    // Excel conta dias desde 30/12/1899 (considerando o bug do ano 1900)
                    const excelEpoch = new Date(1899, 11, 30); // 30 de dezembro de 1899
                    date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
                } else if (typeof dateValue === 'string') {
                    // Tentar converter string para data
                    date = new Date(dateValue);
                }
                
                // Verificar se a data é válida e está em um range razoável (após 1990 e antes de 2030)
                if (date && !isNaN(date.getTime()) && date.getFullYear() >= 1990 && date.getFullYear() <= 2030) {
                    const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                                      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
                    const monthName = monthNames[date.getMonth()];
                    const year = date.getFullYear().toString().slice(-2); // Últimos 2 dígitos do ano
                    const monthYear = `${monthName}/${year}`;
                    monthlyStats[monthYear] = (monthlyStats[monthYear] || 0) + 1;
                } else {
                    // Data inválida ou fora do range
                    monthlyStats['Sem data'] = (monthlyStats['Sem data'] || 0) + 1;
                }
            } catch (e) {
                // Erro ao processar data
                monthlyStats['Sem data'] = (monthlyStats['Sem data'] || 0) + 1;
            }
        } else {
            // Contar registros sem data
            monthlyStats['Sem data'] = (monthlyStats['Sem data'] || 0) + 1;
        }
    });
    
    console.log('\nEstatísticas mensais geradas:');
    console.log('=' .repeat(40));
    
    // Ordenar por ano e mês
    const sortedStats = Object.entries(monthlyStats).sort((a, b) => {
        if (a[0] === 'Sem data') return 1;
        if (b[0] === 'Sem data') return -1;
        
        const [monthA, yearA] = a[0].split('/');
        const [monthB, yearB] = b[0].split('/');
        
        if (yearA !== yearB) {
            return yearA.localeCompare(yearB);
        }
        
        const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                          'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        return monthNames.indexOf(monthA) - monthNames.indexOf(monthB);
    });
    
    sortedStats.forEach(([monthYear, count]) => {
        console.log(`${monthYear}: ${count} registros`);
    });
    
    // Verificar especificamente junho/25
    const junho25 = monthlyStats['junho/25'] || 0;
    console.log(`\n🎯 JUNHO/25: ${junho25} registros`);
    
    if (junho25 > 0) {
        console.log('✅ Sucesso! Dados de junho/2025 encontrados!');
    } else {
        console.log('❌ Problema: Nenhum dado de junho/2025 encontrado.');
    }
    
} catch (error) {
    console.error('Erro ao testar conversão:', error.message);
}