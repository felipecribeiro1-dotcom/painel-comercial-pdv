// Netlify Function — revela o e-mail real do lead via Lusha
// Chamada APENAS quando o Felipe clica "Confirmar e Enviar" (gasta 1 crédito só em lead aprovado)
// POST /.netlify/functions/revelar-email  Body: { "lushaId": "v1.xxx" }
// Env var necessária no Netlify: LUSHA_API_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Use POST' }) };
  const apiKey = process.env.LUSHA_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'LUSHA_API_KEY não configurada no Netlify' }) };

  let lushaId;
  try { lushaId = JSON.parse(event.body).lushaId; } catch(e) {}
  if (!lushaId) return { statusCode: 400, body: JSON.stringify({ error: 'lushaId obrigatório' }) };

  try {
    const resp = await fetch('https://api.lusha.com/prospecting/api/v2/contact/enrich', {
      method: 'POST',
      headers: { 'api_key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [lushaId], fields: ['emails'] })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const insuficiente = resp.status === 402 || /credit/i.test(JSON.stringify(data));
      return { statusCode: resp.status, body: JSON.stringify({ error: insuficiente ? 'Créditos Lusha esgotados' : (data.message || 'Erro Lusha'), creditos_esgotados: insuficiente }) };
    }
    const contatos = data.contacts || data.results || data.data || [];
    const email = contatos[0]?.emails?.[0]?.email || null;
    return { statusCode: 200, headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ok: true, email }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
