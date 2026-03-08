const { getStore: _getStore } = require('@netlify/blobs');
const { DEFAULT_RETAILERS } = require('./_shared');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' } };
    }

    const store = getStore('oa-catalog');

    if (event.httpMethod === 'GET') {
        try {
            let retailers = await store.get('retailers', { type: 'json' });
            // Auto-restaure si blob absent ou corrompu (< 5 retailers)
            if (!retailers || retailers.length < 5) {
                retailers = DEFAULT_RETAILERS;
                await store.setJSON('retailers', retailers);
            }
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ retailers })
            };
        } catch (err) {
            return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body || '{}');
            let retailers = [];
            try { retailers = await store.get('retailers', { type: 'json' }) ?? []; } catch {}

            if (body.action === 'save') {
                const r = body.retailer;
                if (!r || !r.name || !r.url) return { statusCode: 400, body: 'name and url required' };
                r.id = r.id || r.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
                const idx = retailers.findIndex(x => x.id === r.id);
                if (idx >= 0) retailers[idx] = r;
                else retailers.push(r);
            } else if (body.action === 'delete') {
                retailers = retailers.filter(r => r.id !== body.id);
            } else if (body.action === 'toggle') {
                const r = retailers.find(r => r.id === body.id);
                if (r) r.active = !r.active;
            }

            await store.setJSON('retailers', retailers);
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ ok: true, retailers })
            };
        } catch (err) {
            return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) };
        }
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
};
