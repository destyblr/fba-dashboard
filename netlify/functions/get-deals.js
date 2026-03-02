const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
    var headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 'no-cache'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: headers, body: '' };
    }

    try {
        var dealStore = getStore('deal-results');
        var data = await dealStore.get('latest', { type: 'json' });

        if (!data) {
            return {
                statusCode: 200,
                headers: headers,
                body: JSON.stringify({ deals: [], updatedAt: null, stats: { total: 0, withAsin: 0, profitable: 0 } })
            };
        }

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify(data)
        };
    } catch (e) {
        console.log('[get-deals] Erreur: ' + e.message);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ error: e.message })
        };
    }
};
