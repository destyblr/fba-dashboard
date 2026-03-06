const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
        const body  = JSON.parse(event.body || '{}');
        const store = getStore('oa-portfolio');

        // Lire les settings actuels
        let settings = { activePreset: 1, page: 0 };
        try {
            settings = await store.get('settings', { type: 'json' }) || settings;
        } catch {}

        // Mettre à jour uniquement les champs fournis
        if (body.activePreset) {
            settings.activePreset = parseInt(body.activePreset);
            settings.page = 0; // Reset pagination quand on change de preset
        }

        await store.setJSON('settings', settings);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ ok: true, settings })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: err.message })
        };
    }
};
