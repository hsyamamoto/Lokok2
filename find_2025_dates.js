const XLSX = require('xlsx');

// Caminho para a planilha
const excelPath = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

try {
    // Ler a planilha
    const workbook = XLSX.readFile(excelPath);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet);
    
    console.log('Procurando por datas de 2025...');
    console.log('Total de registros:', jsonData.length);
    
    // Calcular número serial para junho de 2025
    const june2025Start = new Date(2025, 5, 1); // 1 de junho de 2025
    const june2025End = new Date(2025, 5, 30);   // 30 de junho de 2025
    const excelStart = new Date(1899, 11, 30);
    
    const june2025StartSerial = Math.floor((june2025Start - excelStart) / (24 * 60 * 60 * 1000));
    const june2025EndSerial = Math.floor((june2025End - excelStart) / (24 * 60 * 60 * 1000));
    
    console.log(`Números seriais para junho/2025: ${june2025StartSerial} - ${june2025EndSerial}`);
    
    // Procurar por registros com datas de 2025
    const dates2025 = [];
    const allDates = [];
    
    jsonData.forEach((record, index) => {
        const dateValue = record['DATE'];
        if (typeof dateValue === 'number' && dateValue > 0) {
            const date = new Date(1899, 11, 30);
            date.setDate(date.getDate() + dateValue);
            
            allDates.push({
                linha: index + 2,
                serial: dateValue,
                data: date,
                ano: date.getFullYear(),
                nome: record['Name']
            });
            
            if (date.getFullYear() === 2025) {
                dates2025.push({
                    linha: index + 2,
                    serial: dateValue,
                    data: date,
                    nome: record['Name']
                });
            }
        }
    });
    
    console.log(`\nEncontrados ${dates2025.length} registros de 2025:`);
    dates2025.forEach(item => {
        console.log(`Linha ${item.linha}: ${item.nome} - ${item.data.toDateString()} (serial: ${item.serial})`);
    });
    
    // Mostrar distribuição por ano
    const anoStats = {};
    allDates.forEach(item => {
        anoStats[item.ano] = (anoStats[item.ano] || 0) + 1;
    });
    
    console.log('\nDistribuição por ano:');
    Object.entries(anoStats).sort().forEach(([ano, count]) => {
        console.log(`${ano}: ${count} registros`);
    });
    
    // Mostrar algumas datas recentes
    console.log('\nÚltimas 10 datas encontradas:');
    allDates
        .sort((a, b) => b.data - a.data)
        .slice(0, 10)
        .forEach(item => {
            console.log(`${item.data.toDateString()} - ${item.nome} (linha ${item.linha})`);
        });
    
} catch (error) {
    console.error('Erro ao procurar datas de 2025:', error.message);
}