const XLSX = require('xlsx');
const path = require('path');

function readExcelData() {
    try {
        const filePath = path.join(__dirname, 'LOKOK.xlsx');
        const workbook = XLSX.readFile(filePath);
        let allData = [];
        
        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            allData = allData.concat(jsonData);
        });
        
        return allData;
    } catch (error) {
        console.error('Erro ao ler arquivo Excel:', error);
        return [];
    }
}

const data = readExcelData();
console.log('Total de registros:', data.length);
console.log('\nPrimeiros 5 registros com informações de criador:');
data.slice(0, 5).forEach((record, i) => {
    console.log(`Registro ${i+1}:`, {
        Created_By_User_ID: record.Created_By_User_ID,
        Created_By_User_Name: record.Created_By_User_Name,
        FORNECEDOR: record.FORNECEDOR || record.Fornecedor || 'N/A'
    });
});

// Verificar quantos registros têm Created_By_User_ID
const recordsWithCreator = data.filter(record => record.Created_By_User_ID);
console.log('\nRegistros com Created_By_User_ID:', recordsWithCreator.length);

// Mostrar IDs únicos de criadores
const uniqueCreatorIds = [...new Set(data.map(record => record.Created_By_User_ID).filter(id => id))];
console.log('IDs únicos de criadores:', uniqueCreatorIds);