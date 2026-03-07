const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

exports.handler = async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const store = getStore('oa-inventory');

    if (event.httpMethod === 'GET') {
        try {
            const data = await store.get('items', { type: 'json' }) || [];
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items: data }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const { items } = JSON.parse(event.body || '{}');
            if (!Array.isArray(items)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'items[] requis' }) };
            await store.setJSON('items', items);
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: items.length }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
