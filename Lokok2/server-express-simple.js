const express = require('express');

const app = express();
const PORT = 3002;

app.get('/', (req, res) => {
    res.send('<h1>Express funcionando!</h1>');
});

// Manter o processo vivo
setInterval(() => {
    console.log('Express ainda ativo:', new Date().toLocaleTimeString());
}, 5000);

app.listen(PORT, () => {
    console.log(`Express simples rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});