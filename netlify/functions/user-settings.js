const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

exports.handler = async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const store   = getStore('oa-user-settings');

    if (event.httpMethod === 'GET') {
        try {
            const settings = await store.get('settings', { type: 'json' }) || {};
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, settings }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const { settings } = JSON.parse(event.body || '{}');
            if (!settings || typeof settings !== 'object') {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'settings object requis' }) };
            }
            // Ne pas stocker les clés API sensibles côté serveur (elles restent en localStorage)
            const safeSettings = { ...settings };
            delete safeSettings.keepaApiKey;
            delete safeSettings.telegramBotToken;
            delete safeSettings.emailjsPublicKey;

            await store.setJSON('settings', safeSettings);
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
