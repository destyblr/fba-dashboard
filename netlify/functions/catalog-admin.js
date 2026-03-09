const { getStore: _getStore } = require('@netlify/blobs');

function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const { action } = JSON.parse(event.body || '{}');
    const catalogStore = getStore('oa-catalog');

    try {
        if (action === 'clear-enriched') {
            await catalogStore.set('enriched-products', JSON.stringify([]));
            console.log('[Admin] enriched-products vidé');
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ ok: true, message: 'Cache enriched-products vidé — recalcul au prochain run enricher' })
            };
        }
        return { statusCode: 400, body: JSON.stringify({ error: 'Action inconnue' }) };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
