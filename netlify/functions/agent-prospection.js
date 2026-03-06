const fetch = require('node-fetch');

// Keepa category IDs par marketplace
const KEEPA_CATEGORIES = {
    'all':         { label: 'Toutes catégories', de: null,       fr: null },
    'toys':        { label: 'Jouets',             de: 12950651,   fr: 322086011 },
    'electronics': { label: 'Électronique',       de: 599364031,  fr: 3023754031 },
    'sports':      { label: 'Sports & Loisirs',   de: 16435051,   fr: 325612011 },
    'kitchen':     { label: 'Cuisine & Maison',   de: 3167641,    fr: 3006084031 },
    'computers':   { label: 'Informatique',       de: 340843031,  fr: 13921051 },
    'beauty':      { label: 'Beauté',             de: 64252031,   fr: 197858031 },
    'baby':        { label: 'Bébé',               de: 1084822,    fr: 325669011 },
    'tools':       { label: 'Bricolage',          de: 3006192,    fr: 3002442031 },
    'pet':         { label: 'Animalerie',         de: 3036301,    fr: 3052502031 },
    'garden':      { label: 'Jardin',             de: 1981000031, fr: 2455335031 },
};

exports.handler = async (event) => {
    try {
        const params = event.queryStringParameters || {};
        const domain   = params.domain   || '3';       // 3=DE, 4=FR
        const category = params.category || 'all';
        const minPrice = parseInt(params.minPrice || '1500');   // Keepa cents (1500 = 15€)
        const maxPrice = parseInt(params.maxPrice || '15000');  // 15000 = 150€
        const maxBsr   = parseInt(params.maxBsr   || '100000');

        const KEEPA_KEY = process.env.KEEPA_API_KEY;
        if (!KEEPA_KEY) {
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'KEEPA_API_KEY manquant dans les variables d\'environnement Netlify' })
            };
        }

        // ── Step 1 : Keepa Product Finder ──────────────────────────────────────
        const catData = KEEPA_CATEGORIES[category] || KEEPA_CATEGORIES['all'];
        const catId   = domain === '3' ? catData.de : catData.fr;

        let finderUrl = `https://api.keepa.com/query?key=${KEEPA_KEY}&domain=${domain}` +
            `&current_SALES_gte=1&current_SALES_lte=${maxBsr}` +
            `&current_NEW_gte=${minPrice}&current_NEW_lte=${maxPrice}` +
            `&perPage=50&page=0`;

        if (catId) finderUrl += `&categories_include=${catId}`;

        const finderResp = await fetch(finderUrl);
        if (!finderResp.ok) {
            const txt = await finderResp.text();
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: `Keepa Finder ${finderResp.status}: ${txt.slice(0, 200)}` })
            };
        }

        const finderData = await finderResp.json();

        if (!finderData.asinList || finderData.asinList.length === 0) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ products: [], tokensLeft: finderData.tokensLeft || 0, total: 0 })
            };
        }

        // ── Step 2 : Détails produits (max 20 ASINs pour économiser les tokens) ─
        const asins = finderData.asinList.slice(0, 20).join(',');
        const productUrl = `https://api.keepa.com/product?key=${KEEPA_KEY}&domain=${domain}` +
            `&asin=${asins}&stats=1&history=0&offers=20`;

        const productResp = await fetch(productUrl);
        if (!productResp.ok) {
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: `Keepa Product API ${productResp.status}` })
            };
        }

        const productData = await productResp.json();
        if (!productData.products) {
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Réponse Keepa Product vide' })
            };
        }

        // ── Step 3 : Formater + filtrer ────────────────────────────────────────
        const marketplace = domain === '3' ? 'de' : 'fr';

        const products = productData.products
            .map(p => {
                const current     = (p.stats || {}).current || [];
                const amazonPrice = current[0] ?? -1;  // Prix Amazon (seller "Amazon")
                const newPrice    = current[1] ?? -1;  // Prix le plus bas (3P)
                const bsr         = current[3] ?? -1;  // BSR

                // Compter les offres FBA depuis la liste des offres
                let fbaCount = 0;
                if (Array.isArray(p.offers)) {
                    fbaCount = p.offers.filter(o => o.isFBA).length;
                }

                return {
                    asin:         p.asin,
                    title:        p.title || 'Titre inconnu',
                    brand:        p.brand || '',
                    category:     p.categoryTree?.length ? p.categoryTree[p.categoryTree.length - 1]?.name : '',
                    image:        p.imagesCSV
                        ? `https://images-na.ssl-images-amazon.com/images/I/${p.imagesCSV.split(',')[0]}._SL75_.jpg`
                        : null,
                    price:        newPrice > 0 ? +(newPrice / 100).toFixed(2) : null,
                    amazonPrice:  amazonPrice > 0 ? +(amazonPrice / 100).toFixed(2) : null,
                    bsr:          bsr > 0 ? bsr : null,
                    fbaCount,
                    amazonSelling: amazonPrice > 0,
                    link:         `https://www.amazon.${marketplace}/dp/${p.asin}`
                };
            })
            // Garder uniquement les produits sans Amazon + avec BSR + avec prix
            .filter(p => !p.amazonSelling && p.bsr && p.price)
            // Trier par BSR (meilleur en premier)
            .sort((a, b) => (a.bsr || 999999) - (b.bsr || 999999));

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                products,
                tokensLeft: productData.tokensLeft || 0,
                total:      finderData.totalResults || finderData.asinList.length,
                found:      products.length
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
