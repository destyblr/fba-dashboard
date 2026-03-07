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
        const params    = event.queryStringParameters || {};
        const mode      = params.mode      || 'enriched'; // 'enriched' | 'raw' | 'stats'
        const retailer  = params.retailer  || 'all';
        const category  = params.category  || 'all';
        const minProfit = parseFloat(params.minProfit || '0');
        const minRoi    = parseFloat(params.minRoi    || '0');
        const page      = parseInt(params.page        || '0');
        const pageSize  = 50;

        const catalogStore  = getStore('oa-catalog');
        const activityStore = getStore('oa-activity');

        const [rawProducts, enrichedProducts, retailers, lastRun, activity] = await Promise.all([
            readBlob(catalogStore,  'raw-products',      []),
            readBlob(catalogStore,  'enriched-products', []),
            readBlob(catalogStore,  'retailers',         []),
            readBlob(catalogStore,  'catalog-last-run',  null),
            readBlob(activityStore, 'log',               []),
        ]);

        // Stats pipeline
        const stats = {
            rawTotal:       rawProducts.length,
            withEan:        rawProducts.filter(p => p.ean).length,
            enrichedTotal:  enrichedProducts.length,
            profitable:     enrichedProducts.filter(p => p.netProfit >= 5 && p.roi >= 30).length,
            // Compat ancien format
            total:          enrichedProducts.length,
            matched:        enrichedProducts.filter(p => p.asin).length,
        };

        if (mode === 'stats') {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ stats, lastRun })
            };
        }

        // Source selon le mode
        const source = mode === 'raw' ? rawProducts : enrichedProducts;

        // Filtrer
        let filtered = source.filter(p => {
            if (retailer !== 'all' && p.retailer !== retailer) return false;
            if (category !== 'all' && p.category !== category) return false;
            if (minProfit > 0 && (!p.netProfit || p.netProfit < minProfit)) return false;
            if (minRoi    > 0 && (!p.roi       || p.roi       < minRoi))    return false;
            return true;
        });

        const total     = filtered.length;
        const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize);

        const retailerNames = [...new Set(source.map(p => p.retailer).filter(Boolean))];

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                products: paginated,
                total,
                page,
                pageSize,
                stats,
                retailers:      retailerNames,
                retailerConfig: retailers,
                lastRun,
                lastActivity:   activity.filter(e => ['catalog', 'enricher'].includes(e.agent)).slice(0, 5)
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
