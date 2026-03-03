const { getStore } = require('@netlify/blobs');

function openStore(name) {
    try { return getStore(name); } catch (e) {
        if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN)
            return getStore({ name: name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
        throw e;
    }
}

exports.handler = async (event) => {
    var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers, body: '' };

    try {
        var dealStore = openStore('deal-results');
        var notifiedStore = openStore('deal-notified');

        // Vider les deals accumules + latest (pas le cache ASIN)
        await Promise.all([
            dealStore.delete('accumulated'),
            dealStore.delete('latest')
        ]);

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({ ok: true, message: 'Deals reset. Le prochain cron repart de zero.' })
        };
    } catch (e) {
        return { statusCode: 500, headers: headers, body: JSON.stringify({ error: e.message }) };
    }
};
