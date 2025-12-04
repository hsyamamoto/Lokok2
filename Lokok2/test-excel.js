const XLSX = require('xlsx');
const path = require('path');

const EXCEL_PATH = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

console.log('Testando leitura do arquivo Excel...');
console.log('Caminho:', EXCEL_PATH);

try {
    console.log('Verificando se o arquivo existe...');
    const fs = require('fs');
    if (!fs.existsSync(EXCEL_PATH)) {
        console.error('Arquivo não encontrado!');
        process.exit(1);
    }
    
    console.log('Arquivo encontrado. Tentando ler...');
    const workbook = XLSX.readFile(EXCEL_PATH);
    console.log('Workbook carregado com sucesso');
    console.log('Sheets disponíveis:', workbook.SheetNames);
    
    const sheetName = workbook.SheetNames[0];
    console.log('Usando sheet:', sheetName);
    
    const worksheet = workbook.Sheets[sheetName];
    console.log('Worksheet carregado');
    
    const data = XLSX.utils.sheet_to_json(worksheet);
    console.log('Dados convertidos para JSON');
    console.log('Total de registros:', data.length);
    
    if (data.length > 0) {
        console.log('Primeiro registro:', JSON.stringify(data[0], null, 2));
    }
    
    console.log('Teste concluído com sucesso!');
} catch (error) {
    console.error('Erro durante o teste:', error);
    console.error('Stack trace:', error.stack);
}