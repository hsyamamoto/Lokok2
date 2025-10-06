const XLSX = require('xlsx');
const path = require('path');

// Caminho para a planilha
const excelPath = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

try {
    // Ler a planilha
    const workbook = XLSX.readFile(excelPath);
    
    // Obter nomes das abas
    const sheetNames = workbook.SheetNames;
    console.log('Abas encontradas:', sheetNames);
    
    // Examinar a primeira aba
    const firstSheet = workbook.Sheets[sheetNames[0]];
    
    // Converter para JSON para ver a estrutura
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    
    console.log('\nPrimeiras 5 linhas da planilha:');
    jsonData.slice(0, 5).forEach((row, index) => {
        console.log(`Linha ${index + 1}:`, row);
    });
    
    // Obter cabeçalhos (primeira linha)
    if (jsonData.length > 0) {
        console.log('\nCabeçalhos encontrados:');
        jsonData[0].forEach((header, index) => {
            console.log(`${index + 1}. ${header}`);
        });
    }
    
    // Informações gerais
    console.log(`\nTotal de linhas: ${jsonData.length}`);
    console.log(`Total de colunas: ${jsonData[0] ? jsonData[0].length : 0}`);
    
} catch (error) {
    console.error('Erro ao ler a planilha:', error.message);
    console.log('Verifique se o arquivo existe no caminho especificado.');
}