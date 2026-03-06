const { getStore } = require('@netlify/blobs');

async function readBlob(store, key, fallback) {
    try {
        const val = await store.get(key, { type: 'json' });
        return val ?? fallback;
    } catch { return fallback; }
}

exports.handler = async (event) => {
    try {
        const includeActivity = (event.queryStringParameters?.include || '').includes('activity');
        const portfolioStore  = getStore('oa-portfolio');
        const activityStore   = getStore('oa-activity');

        const [portfolio, queue, blacklist, settings] = await Promise.all([
            readBlob(portfolioStore, 'portfolio', []),
            readBlob(portfolioStore, 'queue',     []),
            readBlob(portfolioStore, 'blacklist', []),
            readBlob(portfolioStore, 'settings',  { activePreset: 1, page: 0 }),
        ]);

        const result = { portfolio, queue, blacklist, settings };
        if (includeActivity) {
            result.activity = await readBlob(activityStore, 'log', []);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(result)
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: err.message })
        };
    }
};
