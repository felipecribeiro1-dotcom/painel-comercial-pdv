// Verificador de e-mail gratuito — substitui o Lusha no reveal
// Gera padrões comuns de e-mail corporativo BR + verifica via DNS/SMTP
// POST /.netlify/functions/verificar-email
// Body: { "nome": "Julya Moreira", "dominio": "ambev.com.br" }

const dns = require('dns').promises;
const net = require('net');

function gerarCandidatos(nome, dominio) {
  // Normaliza: remove acentos, lowercase
  const partes = nome.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  
  if (partes.length < 2) return [`${partes[0]}@${dominio}`];
  
  const primeiro = partes[0];
  const ultimo = partes[partes.length - 1];
  const meio = partes.length > 2 ? partes[1] : null;
  
  // Padrões em ordem de probabilidade para empresas BR
  return [
    `${primeiro}.${ultimo}@${dominio}`,           // nome.sobrenome (mais comum BR)
    `${primeiro}@${dominio}`,                      // nome
    `${primeiro[0]}${ultimo}@${dominio}`,          // nsobrenome
    `${primeiro}_${ultimo}@${dominio}`,            // nome_sobrenome
    `${primeiro}${ultimo[0]}@${dominio}`,          // nomes
    `${primeiro}.${ultimo[0]}@${dominio}`,         // nome.s
    meio ? `${primeiro}.${meio}@${dominio}` : null, // nome.nomemeio
    `${ultimo}.${primeiro}@${dominio}`,            // sobrenome.nome
    `${primeiro[0]}.${ultimo}@${dominio}`,         // n.sobrenome
  ].filter(Boolean);
}

async function getMX(dominio) {
  try {
    const records = await dns.resolveMx(dominio);
    return records.sort((a, b) => a.priority - b.priority)[0]?.exchange;
  } catch (e) {
    return null;
  }
}

function smtpVerify(mx, email, timeout = 8000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mx);
    let buf = '';
    let step = 0;
    const timer = setTimeout(() => { socket.destroy(); resolve('timeout'); }, timeout);
    
    socket.on('data', chunk => {
      buf += chunk.toString();
      
      if (step === 0 && buf.includes('220')) {
        buf = '';
        socket.write('EHLO pdvquality.com\r\n');
        step = 1;
      } else if (step === 1 && buf.includes('250')) {
        buf = '';
        socket.write('MAIL FROM:<verificacao@pdvquality.com>\r\n');
        step = 2;
      } else if (step === 2 && buf.includes('250')) {
        buf = '';
        socket.write(`RCPT TO:<${email}>\r\n`);
        step = 3;
      } else if (step === 3) {
        clearTimeout(timer);
        const code = parseInt(buf.match(/^(\d{3})/m)?.[1] || '0');
        socket.write('QUIT\r\n');
        socket.destroy();
        
        if (code === 250 || code === 251) resolve('valido');
        else if (code === 550 || code === 551 || code === 553 || code === 452) resolve('invalido');
        else resolve('inconclusivo');
      }
    });
    
    socket.on('error', () => { clearTimeout(timer); resolve('erro'); });
    socket.on('timeout', () => { clearTimeout(timer); socket.destroy(); resolve('timeout'); });
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '{"error":"POST"}' };
  
  let nome, dominio;
  try {
    const body = JSON.parse(event.body);
    nome = body.nome;
    dominio = body.dominio;
  } catch (e) {}
  
  if (!nome || !dominio) {
    return { statusCode: 400, body: JSON.stringify({ error: 'nome e dominio obrigatórios' }) };
  }
  
  // 1) Resolve MX
  const mx = await getMX(dominio);
  if (!mx) {
    // Tenta domínio alternativo (ex: .com.br → .com)
    const alt = dominio.replace('.com.br', '.com');
    const mx2 = alt !== dominio ? await getMX(alt) : null;
    if (!mx2) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: `Sem servidor MX para ${dominio}`, email: null }) };
    }
  }
  
  const mxHost = mx || await getMX(dominio.replace('.com.br', '.com'));
  
  // 2) Gera candidatos e testa cada um
  const candidatos = gerarCandidatos(nome, dominio);
  let emailValido = null;
  let catchAll = false;
  
  // Primeiro testa se o servidor é catch-all (aceita qualquer coisa)
  const testeRandom = await smtpVerify(mxHost, `xyzinexistente99999@${dominio}`);
  if (testeRandom === 'valido') {
    // Catch-all: servidor aceita tudo, não dá pra verificar
    // Usa o padrão mais comum mesmo assim
    catchAll = true;
    emailValido = candidatos[0];
  } else {
    // Servidor rejeita inválidos — testa candidato por candidato
    for (const email of candidatos) {
      const resultado = await smtpVerify(mxHost, email);
      if (resultado === 'valido') {
        emailValido = email;
        break;
      }
      if (resultado === 'erro' || resultado === 'timeout') {
        // Servidor não deixa verificar — usa padrão mais comum
        emailValido = candidatos[0];
        catchAll = true; // marca como não-verificado
        break;
      }
    }
  }
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: !!emailValido,
      email: emailValido,
      verificado: !catchAll && !!emailValido,
      catch_all: catchAll,
      dominio,
      mx: mxHost,
      candidatos_testados: candidatos.length,
    })
  };
};
