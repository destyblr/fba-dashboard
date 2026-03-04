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

    function openStore(name) {
        try {
            return getStore(name);
        } catch (e) {
            if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
                return getStore({ name: name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
            }
            throw e;
        }
    }

    try {
        var dealStore = openStore('deal-results');
        var results = await Promise.all([
            dealStore.get('latest', { type: 'json' }).catch(function() { return null; }),
            dealStore.get('pipeline-history', { type: 'json' }).catch(function() { return null; })
        ]);
        var data = results[0];
        var pipelineHistory = results[1];

        if (!data) {
            return {
                statusCode: 200,
                headers: headers,
                body: JSON.stringify({ deals: [], updatedAt: null, stats: { total: 0, withAsin: 0, profitable: 0 }, pipelineHistory: {} })
            };
        }

        // Ajouter l'historique pipeline aux donnees
        data.pipelineHistory = pipelineHistory || {};

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
