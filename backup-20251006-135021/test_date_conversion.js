// Teste de conversão de números seriais do Excel

// Números seriais de exemplo encontrados nos dados
const testNumbers = [45155, 45220, 45182, 45202];

console.log('Testando conversão de números seriais do Excel:');
console.log('='.repeat(50));

testNumbers.forEach(serialNumber => {
    console.log(`\nNúmero serial: ${serialNumber}`);
    
    // Método atual (pode estar incorreto)
    const excelEpoch = new Date(1900, 0, 1);
    const currentMethod = new Date(excelEpoch.getTime() + (serialNumber - 1) * 24 * 60 * 60 * 1000);
    console.log(`Método atual: ${currentMethod.toDateString()} (${currentMethod.getFullYear()})`);
    
    // Método correto para Excel (considerando que Excel tem bug do ano 1900)
    // Excel considera 1900 como ano bissexto (incorretamente)
    const correctMethod = new Date(1899, 11, 30); // 30 de dezembro de 1899
    correctMethod.setDate(correctMethod.getDate() + serialNumber);
    console.log(`Método correto: ${correctMethod.toDateString()} (${correctMethod.getFullYear()})`);
    
    // Verificar se é uma data recente (2023-2025)
    const recentDate = new Date(2023, 0, 1); // 1 de janeiro de 2023
    const daysSince2023 = Math.floor((new Date() - recentDate) / (24 * 60 * 60 * 1000));
    console.log(`Dias desde 1/1/2023: ${daysSince2023}`);
    
    // Tentar conversão assumindo que é baseado em 1/1/1970 (Unix timestamp em dias)
    const unixMethod = new Date(1970, 0, 1);
    unixMethod.setDate(unixMethod.getDate() + serialNumber);
    console.log(`Método Unix: ${unixMethod.toDateString()} (${unixMethod.getFullYear()})`);
});

console.log('\n' + '='.repeat(50));
console.log('Testando data específica: 19 de junho de 2025');
const targetDate = new Date(2025, 5, 19); // Junho é mês 5 (0-indexado)
console.log(`Data alvo: ${targetDate.toDateString()}`);

// Calcular qual seria o número serial para 19/06/2025
const excelStart = new Date(1899, 11, 30);
const daysDiff = Math.floor((targetDate - excelStart) / (24 * 60 * 60 * 1000));
console.log(`Número serial esperado para 19/06/2025: ${daysDiff}`);

// Verificar se algum dos números de teste corresponde
if (testNumbers.includes(daysDiff)) {
    console.log('✅ Encontrado número serial correspondente!');
} else {
    console.log('❌ Nenhum número serial corresponde à data alvo');
    console.log('Números disponíveis:', testNumbers);
}