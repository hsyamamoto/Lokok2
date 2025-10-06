const express = require('express');
const app = express();
const PORT = 3001;

app.get('/', (req, res) => {
    res.send('Servidor de teste funcionando!');
});

app.listen(PORT, () => {
    console.log(`Servidor de teste rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});

// Manter o processo vivo
process.on('SIGINT', () => {
    console.log('Servidor sendo encerrado...');
    process.exit(0);
});