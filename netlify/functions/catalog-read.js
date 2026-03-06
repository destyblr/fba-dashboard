const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

async function readBlob(store, key, fallback) {
    try {
        const val = await store.get(key, { type: 'json' });
        return val ?? fallback;
    } catch { return fallback; }
}

exports.handler = async (event) => {
    try {
        const params      = event.queryStringParameters || {};
        const retailer    = params.retailer    || 'all';
        const category    = params.category    || 'all';
        const minProfit   = parseFloat(params.minProfit || '0');
        const minRoi      = parseFloat(params.minRoi    || '0');
        const page        = parseInt(params.page         || '0');
        const pageSize    = 50;

        const catalogStore  = getStore('oa-catalog');
        const activityStore = getStore('oa-activity');

        const [products, retailers, lastRun, activity] = await Promise.all([
            readBlob(catalogStore,  'products',  []),
            readBlob(catalogStore,  'retailers', []),
            readBlob(catalogStore,  'last-run',  null),
            readBlob(activityStore, 'log',       []),
        ]);

        // Filtrer
        let filtered = products.filter(p => {
            if (retailer !== 'all' && p.retailer !== retailer) return false;
            if (category !== 'all' && p.category !== category) return false;
            if (minProfit > 0 && (!p.netProfit || p.netProfit < minProfit)) return false;
            if (minRoi    > 0 && (!p.roi       || p.roi       < minRoi))    return false;
            return true;
        });

        // Stats
        const stats = {
            total:      products.length,
            matched:    products.filter(p => p.asin).length,
            profitable: products.filter(p => p.netProfit >= 5 && p.roi >= 30).length,
            eligible:   products.filter(p => p.spApi === 'eligible').length,
        };

        // Pagination
        const total      = filtered.length;
        const paginated  = filtered.slice(page * pageSize, (page + 1) * pageSize);

        // Retailer list pour filtre
        const retailerNames = [...new Set(products.map(p => p.retailer).filter(Boolean))];

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                products: paginated,
                total,
                page,
                pageSize,
                stats,
                retailers: retailerNames,
                retailerConfig: retailers,
                lastRun,
                lastActivity: activity.filter(e => e.agent === 'catalog').slice(0, 5)
            })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: err.message })
        };
    }
};
