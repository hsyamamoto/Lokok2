const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Servidor básico funcionando!</h1><p>Teste de servidor HTTP nativo</p>');
});

const PORT = 3001;

server.listen(PORT, () => {
    console.log(`Servidor básico rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});

// Manter o processo vivo
setInterval(() => {
    console.log('Servidor ainda ativo:', new Date().toLocaleTimeString());
}, 5000);

// Capturar sinais
process.on('SIGINT', () => {
    console.log('\nRecebido SIGINT. Encerrando...');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\nRecebido SIGTERM. Encerrando...');
    server.close(() => {
        process.exit(0);
    });
});