const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

exports.handler = async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const store = getStore('oa-portfolio');

    if (event.httpMethod === 'GET') {
        try {
            const instructions = await store.get('agent-instructions', { type: 'json' }) || {};
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, instructions }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const { agent, instruction } = JSON.parse(event.body || '{}');
            if (!agent) return { statusCode: 400, headers, body: JSON.stringify({ error: 'agent requis' }) };

            let instructions = {};
            try { instructions = await store.get('agent-instructions', { type: 'json' }) || {}; } catch {}

            instructions[agent] = { text: instruction, ts: new Date().toISOString() };
            await store.setJSON('agent-instructions', instructions);

            return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
