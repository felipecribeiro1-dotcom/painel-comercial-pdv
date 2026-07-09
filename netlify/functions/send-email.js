// Netlify Function — envia e-mail de prospecção via Resend
// POST /.netlify/functions/send-email
// Body: { "to": "email@destino.com", "subject": "Assunto", "html": "<p>Corpo</p>" }
//
// Env var necessária no Netlify: RESEND_API_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Use POST' }) };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY não configurada no Netlify' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido (esperado JSON)' }) };
  }

  const { to, subject, html, replyTo } = payload;
  if (!to || !subject || !html) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Campos obrigatórios: to, subject, html' }) };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Felipe Ribeiro <felipe.ribeiro@pdvquality.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        reply_to: replyTo || 'felipe.ribeiro@pdvquality.com'
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: data.message || 'Erro do Resend', details: data })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, id: data.id })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
