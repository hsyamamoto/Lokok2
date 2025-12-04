const XLSX = require('xlsx');

// Caminho para a planilha
const excelPath = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

try {
    // Ler a planilha
    const workbook = XLSX.readFile(excelPath);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet);
    
    console.log('Examinando coluna DATE...');
    console.log('Total de registros:', jsonData.length);
    
    // Contar tipos de valores na coluna DATE
    const dateTypes = {};
    const sampleDates = [];
    
    jsonData.forEach((record, index) => {
        const dateValue = record['DATE'];
        const type = typeof dateValue;
        const value = String(dateValue);
        
        if (!dateTypes[type]) {
            dateTypes[type] = 0;
        }
        dateTypes[type]++;
        
        // Coletar amostras de diferentes tipos
        if (sampleDates.length < 20) {
            sampleDates.push({
                linha: index + 2, // +2 porque index começa em 0 e primeira linha são cabeçalhos
                tipo: type,
                valor: value,
                original: dateValue
            });
        }
    });
    
    console.log('\nTipos de valores encontrados na coluna DATE:');
    Object.entries(dateTypes).forEach(([type, count]) => {
        console.log(`${type}: ${count} registros`);
    });
    
    console.log('\nAmostras de valores:');
    sampleDates.forEach(sample => {
        console.log(`Linha ${sample.linha}: [${sample.tipo}] "${sample.valor}" (original: ${JSON.stringify(sample.original)})`);
    });
    
    // Verificar valores específicos problemáticos
    console.log('\nProcurando valores problemáticos...');
    const problematicos = jsonData.filter((record, index) => {
        const dateValue = record['DATE'];
        const dateStr = String(dateValue);
        return dateStr.includes('1969') || dateStr.includes('NaN') || dateStr === 'undefined';
    });
    
    console.log(`Encontrados ${problematicos.length} registros com valores problemáticos:`);
    problematicos.slice(0, 10).forEach((record, index) => {
        console.log(`${index + 1}. Nome: "${record['Name']}", DATE: "${record['DATE']}"`);
    });
    
} catch (error) {
    console.error('Erro ao examinar datas:', error.message);
}