const fetch = require('node-fetch');
const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

// ─── Helpers Blobs ─────────────────────────────────────────────────────────
async function readBlob(store, key, fallback) {
    try { return (await store.get(key, { type: 'json' })) ?? fallback; }
    catch { return fallback; }
}
async function writeBlob(store, key, data) { await store.setJSON(key, data); }

// ─── Telegram ──────────────────────────────────────────────────────────────
async function sendTelegram(msg) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
    }).catch(() => {});
}

// ─── Retailers par défaut (si aucun configuré dans Blobs) ──────────────────
const DEFAULT_RETAILERS = [
    // ── BEAUTÉ / PARAPHARMACIE ──────────────────────────────────────────────
    { id: 'easypara',           name: 'Easypara',          url: 'https://www.easypara.fr',             type: 'prestashop', category: 'beaute',       days: [1,4],   maxProducts: 200, active: true },
    { id: 'sante-discount',     name: 'Santé Discount',    url: 'https://www.sante-discount.fr',       type: 'prestashop', category: 'beaute',       days: [0,3],   maxProducts: 150, active: true },
    { id: 'aroma-zone',         name: 'Aroma Zone',        url: 'https://www.aroma-zone.com',          type: 'generic',    category: 'beaute',       days: [2,5],   maxProducts: 150, active: true },
    { id: 'pharma-gdd',         name: 'Pharma GDD',        url: 'https://www.pharma-gdd.com',          type: 'prestashop', category: 'beaute',       days: [1,6],   maxProducts: 150, active: true },
    // ── JOUETS / LOISIRS ────────────────────────────────────────────────────
    { id: '1001hobbies',        name: '1001Hobbies',       url: 'https://www.1001hobbies.fr',          type: 'prestashop', category: 'jouets',       days: [0,2,5], maxProducts: 200, active: true },
    { id: 'joueclub',           name: 'Joué Club',         url: 'https://www.joueclub.fr',             type: 'prestashop', category: 'jouets',       days: [2,5],   maxProducts: 200, active: true },
    { id: 'kingjouet',          name: 'King Jouet',        url: 'https://www.king-jouet.com',          type: 'generic',    category: 'jouets',       days: [1,4],   maxProducts: 200, active: true },
    { id: 'lagranderecre',      name: 'La Grande Récré',   url: 'https://www.lagranderecre.fr',        type: 'generic',    category: 'jouets',       days: [0,3],   maxProducts: 150, active: true },
    { id: 'maxitoys',           name: 'Maxi Toys',         url: 'https://www.maxitoys.fr',             type: 'prestashop', category: 'jouets',       days: [2,6],   maxProducts: 150, active: true },
    { id: 'oxybul',             name: 'Oxybul',            url: 'https://www.oxybul.com',              type: 'generic',    category: 'jouets',       days: [0,4],   maxProducts: 150, active: true },
    { id: 'picwictoys',         name: 'Picwic Toys',       url: 'https://www.picwictoys.com',          type: 'prestashop', category: 'jouets',       days: [1,5],   maxProducts: 150, active: true },
    // ── INFORMATIQUE / ÉLECTRONIQUE ─────────────────────────────────────────
    { id: 'bureauvallee',       name: 'Bureau Vallée',     url: 'https://www.bureauvallee.fr',         type: 'generic',    category: 'informatique', days: [1,4],   maxProducts: 150, active: true },
    { id: 'topachat',           name: 'Top Achat',         url: 'https://www.topachat.com',            type: 'generic',    category: 'informatique', days: [0,3],   maxProducts: 150, active: true },
    { id: 'materielnet',        name: 'Materiel.net',      url: 'https://www.materiel.net',            type: 'generic',    category: 'informatique', days: [2,5],   maxProducts: 150, active: true },
    { id: 'ldlc',               name: 'LDLC',              url: 'https://www.ldlc.com',                type: 'generic',    category: 'informatique', days: [1,6],   maxProducts: 150, active: true },
    // ── ANIMALERIE ──────────────────────────────────────────────────────────
    { id: 'zoomalia',           name: 'Zoomalia',          url: 'https://www.zoomalia.com',            type: 'prestashop', category: 'animalerie',   days: [0,3],   maxProducts: 200, active: true },
    { id: 'wanimo',             name: 'Wanimo',            url: 'https://www.wanimo.com',              type: 'prestashop', category: 'animalerie',   days: [2,5],   maxProducts: 150, active: true },
    { id: 'animalis',           name: 'Animalis',          url: 'https://www.animalis.com',            type: 'generic',    category: 'animalerie',   days: [1,4],   maxProducts: 150, active: true },
    // ── CUISINE / MAISON ────────────────────────────────────────────────────
    { id: 'alicedelice',        name: 'Alice Délice',      url: 'https://www.alicedelice.com',         type: 'prestashop', category: 'cuisine',      days: [0,4],   maxProducts: 150, active: true },
    { id: 'mathon',             name: 'Mathon',            url: 'https://www.mathon.fr',               type: 'prestashop', category: 'cuisine',      days: [2,6],   maxProducts: 150, active: true },
    { id: 'cuisineaddict',      name: 'Cuisine Addict',    url: 'https://www.cuisineaddict.com',       type: 'prestashop', category: 'cuisine',      days: [1,5],   maxProducts: 150, active: true },
    { id: 'meilleurduchef',     name: 'Meilleur du Chef',  url: 'https://www.meilleurduchef.com',      type: 'prestashop', category: 'cuisine',      days: [3,6],   maxProducts: 100, active: true },
    // ── SPORT / VÉLO ────────────────────────────────────────────────────────
    { id: 'probikeshop',        name: 'Probikeshop',       url: 'https://www.probikeshop.fr',          type: 'prestashop', category: 'sport',        days: [0,3],   maxProducts: 150, active: true },
    { id: 'alltricks',          name: 'Alltricks',         url: 'https://www.alltricks.fr',            type: 'generic',    category: 'sport',        days: [2,5],   maxProducts: 150, active: true },
    // ── CULTURE / LOISIRS ───────────────────────────────────────────────────
    { id: 'cultura',            name: 'Cultura',           url: 'https://www.cultura.com',             type: 'generic',    category: 'culture',      days: [1,4],   maxProducts: 150, active: true },
    // ── BÉBÉ / PUÉRICULTURE ─────────────────────────────────────────────────
    { id: 'aubert',             name: 'Aubert',            url: 'https://www.aubert.com',              type: 'generic',    category: 'bebe',         days: [0,4],   maxProducts: 150, active: true },
    { id: 'bambinou',           name: 'Bambinou',          url: 'https://www.bambinou.com',            type: 'prestashop', category: 'bebe',         days: [2,5],   maxProducts: 100, active: true },
    // ── JARDINAGE ───────────────────────────────────────────────────────────
    { id: 'jardindeco',         name: 'Jardindeco',        url: 'https://www.jardindeco.com',          type: 'prestashop', category: 'jardin',       days: [1,5],   maxProducts: 100, active: true },
    { id: 'plantes-et-jardins', name: 'Plantes & Jardins', url: 'https://www.plantes-et-jardins.com', type: 'prestashop', category: 'jardin',       days: [3,6],   maxProducts: 100, active: true },
    { id: 'fnac',               name: 'Fnac',              url: 'https://www.fnac.com',                type: 'generic',    category: 'informatique', days: [1,4],   maxProducts: 150, active: true },
    // ── GRANDS RETAILERS MULTI-CATÉGORIES ───────────────────────────────────
    { id: 'leclerc',            name: 'E.Leclerc',         url: 'https://www.e.leclerc',               type: 'generic',    category: 'multi',        days: [3,6],   maxProducts: 200, active: true },
    { id: 'darty',              name: 'Darty',             url: 'https://www.darty.com',               type: 'generic',    category: 'informatique', days: [0,4],   maxProducts: 150, active: true },
    { id: 'cdiscount',          name: 'Cdiscount',         url: 'https://www.cdiscount.com',           type: 'generic',    category: 'multi',        days: [2,3],   maxProducts: 200, active: true },
    { id: 'boulanger',          name: 'Boulanger',         url: 'https://www.boulanger.com',           type: 'generic',    category: 'informatique', days: [0,3],   maxProducts: 150, active: true },
    { id: 'conforama',          name: 'Conforama',         url: 'https://www.conforama.fr',            type: 'generic',    category: 'maison',       days: [3,6],   maxProducts: 150, active: true },
    { id: 'manomano',           name: 'ManoMano',          url: 'https://www.manomano.fr',             type: 'generic',    category: 'bricolage',    days: [0,6],   maxProducts: 150, active: true },
    { id: 'decathlon',          name: 'Decathlon',         url: 'https://www.decathlon.fr',            type: 'generic',    category: 'sport',        days: [4,6],   maxProducts: 200, active: true },
    { id: 'maisonsdumonde',     name: 'Maisons du Monde',  url: 'https://www.maisonsdumonde.com',      type: 'generic',    category: 'maison',       days: [2,6],   maxProducts: 100, active: true },
    { id: 'natureetdecouvertes',name: 'Nature & Découvertes', url: 'https://www.natureetdecouvertes.com', type: 'generic', category: 'culture',     days: [3,6],   maxProducts: 100, active: true },
];

// ─── Extraction JSON-LD depuis HTML ─────────────────────────────────────────
function extractJsonLD(html) {
    const results = [];
    const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
        try {
            const data = JSON.parse(m[1].trim());
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (item['@type'] === 'Product') results.push(item);
                if (item['@graph']) {
                    for (const node of item['@graph']) {
                        if (node['@type'] === 'Product') results.push(node);
                    }
                }
            }
        } catch {}
    }
    return results;
}

// ─── Parser produit depuis JSON-LD ─────────────────────────────────────────
function parseProduct(jsonld, retailerName, retailerUrl) {
    try {
        const offers = jsonld.offers || (Array.isArray(jsonld.offers) ? jsonld.offers[0] : jsonld.offers);
        const offer  = Array.isArray(jsonld.offers) ? jsonld.offers[0] : jsonld.offers;
        if (!offer) return null;

        const price = parseFloat(String(offer.price || offer.lowPrice || 0).replace(',', '.'));
        if (!price || price <= 0) return null;

        const ean = (jsonld.gtin13 || jsonld.gtin8 || jsonld.gtin || jsonld.isbn ||
                     offer.gtin13 || offer.gtin8 || offer.gtin || '').replace(/[^0-9]/g, '');

        const title = (jsonld.name || '').trim();
        if (!title) return null;

        const image = Array.isArray(jsonld.image) ? jsonld.image[0] : (jsonld.image || '');
        const link  = offer.url || jsonld.url || '';
        const brand = (jsonld.brand?.name || jsonld.brand || '').toString().trim();

        return { title, price, ean: ean.length >= 8 ? ean : null, image, link, brand, retailer: retailerName, retailerUrl };
    } catch { return null; }
}

// ─── Scrape sitemap.xml d'un retailer (gère sitemap index) ─────────────────
function isProductUrl(url) {
    return url.match(/\/(p|produit[s]?|product[s]?|catalogue|shop|artikel|item|fiche)\/|\/[^/]+-\d{3,}(\.html?)?$|\/[^/?]{10,}(\.html?)$/i)
        && !url.match(/\/categori|\/category|\/tag|\/marque|\/brand|\/blog|\/news|\/page\/|sitemap|\.xml$/i);
}

async function fetchXml(url) {
    // Sitemaps XML : fetch direct sans ScraperAPI (XML ne nécessite pas de rendu JS)
    try {
        const resp = await fetch(url, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
        });
        console.log(`[Catalog] fetchXml ${url} → ${resp.status}`);
        if (!resp.ok) return null;
        return await resp.text();
    } catch (e) {
        console.log(`[Catalog] fetchXml ${url} → erreur: ${e.message}`);
        return null;
    }
}

async function fetchSitemapUrls(baseUrl, maxUrls) {
    const candidates = [
        baseUrl + '/sitemap.xml',
        baseUrl + '/sitemap_products.xml',
        baseUrl + '/sitemap-products.xml',
        baseUrl + '/fr/sitemap.xml',
    ];

    const extractLocs = (xml) => {
        const locs = [];
        const re = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/g;
        let m;
        while ((m = re.exec(xml)) !== null) locs.push(m[1].trim());
        return locs;
    };

    for (const sitemapUrl of candidates) {
        const xml = await fetchXml(sitemapUrl);
        if (!xml) continue;

        const allLocs = extractLocs(xml);
        if (!allLocs.length) continue;

        // Sitemap index ? → chercher les sous-sitemaps produits
        const subSitemaps = allLocs.filter(u => u.match(/sitemap/i) && u.match(/\.xml/i));
        if (subSitemaps.length > 0) {
            // Prioriser les sitemaps avec "product" dans le nom
            const sorted = subSitemaps.sort((a, b) => {
                const aScore = /product|produit|artikel/i.test(a) ? 1 : 0;
                const bScore = /product|produit|artikel/i.test(b) ? 1 : 0;
                return bScore - aScore;
            });
            for (const sub of sorted.slice(0, 3)) {
                const subXml = await fetchXml(sub);
                if (!subXml) continue;
                const urls = extractLocs(subXml).filter(isProductUrl);
                if (urls.length > 0) return urls.slice(0, maxUrls);
            }
        }

        // Sitemap direct
        const urls = allLocs.filter(isProductUrl);
        if (urls.length > 0) return urls.slice(0, maxUrls);
    }
    return [];
}

// ─── Scrape une page produit ────────────────────────────────────────────────
async function scrapeProductPage(url) {
    const scraperKey = process.env.SCRAPER_API_KEY;
    const fetchUrl = scraperKey
        ? `https://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}`
        : url;
    try {
        const resp = await fetch(fetchUrl, { timeout: 15000 });
        if (!resp.ok) return null;
        const html = await resp.text();
        return extractJsonLD(html);
    } catch { return null; }
}

// ─── Handler principal ────────────────────────────────────────────────────
exports.handler = async () => {
    const catalogStore  = getStore('oa-catalog');
    const activityStore = getStore('oa-activity');

    // ── 1. Charger la liste des retailers + rotation (1 retailer par run) ──
    const retailers = await readBlob(catalogStore, 'retailers', DEFAULT_RETAILERS);
    const today     = new Date().getDay();

    const activeToday = retailers.filter(r => r.active !== false && (r.days || [0,1,2,3,4,5,6]).includes(today));
    if (!activeToday.length) {
        console.log('[Catalog] Aucun retailer actif aujourd\'hui');
        return { statusCode: 200 };
    }

    // Rotation : 1 retailer par run via curseur persisté
    const cursor  = (await readBlob(catalogStore, 'catalog-cursor', 0)) % activeToday.length;
    const retailerToProcess = activeToday[cursor];
    await writeBlob(catalogStore, 'catalog-cursor', cursor + 1);
    console.log(`[Catalog] Run ${cursor + 1}/${activeToday.length} → ${retailerToProcess.name}`);

    // ── 2. Charger les produits bruts existants ────────────────────────────
    const rawProducts = await readBlob(catalogStore, 'raw-products', []);
    const seenEANs    = new Set(rawProducts.map(p => p.ean).filter(Boolean));

    const newProducts = [];
    let totalScraped = 0, totalWithEan = 0;

    // ── 3. Scraper le retailer du run ─────────────────────────────────────
    console.log(`[Catalog] Scraping ${retailerToProcess.name}...`);
    const maxP = retailerToProcess.maxProducts || 200;

    const urls = await fetchSitemapUrls(retailerToProcess.url, maxP);
    if (!urls.length) {
        console.warn(`[Catalog] ${retailerToProcess.name}: pas d'URLs dans le sitemap`);
    } else {
        console.log(`[Catalog] ${retailerToProcess.name}: ${urls.length} URLs`);

        // Scraper les pages en batch (max 15 via ScraperAPI pour tenir dans les 60s)
        const batch = urls.slice(0, 15);
        let debugSample = true; // log le 1er résultat pour diagnostic
        for (const url of batch) {
            const jsonlds = await scrapeProductPage(url);
            if (debugSample) {
                if (!jsonlds) { console.log(`[Catalog] DEBUG ${url} → null (fetch failed ou HTML vide)`); }
                else if (jsonlds.length === 0) { console.log(`[Catalog] DEBUG ${url} → 0 JSON-LD Product trouvés`); }
                else { console.log(`[Catalog] DEBUG ${url} → ${jsonlds.length} JSON-LD, ex: type=${jsonlds[0]['@type']} name=${jsonlds[0].name?.slice(0,40)} price=${jsonlds[0].offers?.price ?? jsonlds[0].offers?.[0]?.price}`); }
                debugSample = false;
            }
            if (!jsonlds) continue;

            for (const jld of jsonlds) {
                const product = parseProduct(jld, retailerToProcess.name, retailerToProcess.url);
                if (!product) continue;
                totalScraped++;

                // Déduplications par EAN
                if (product.ean && seenEANs.has(product.ean)) continue;
                if (product.ean) {
                    seenEANs.add(product.ean);
                    totalWithEan++;
                }

                newProducts.push({ ...product, scrapedAt: Date.now() });
            }
        }
    }

    // ── 4. Sauvegarder les produits bruts ─────────────────────────────────
    const updatedRaw = [...newProducts, ...rawProducts].slice(0, 5000);
    await writeBlob(catalogStore, 'raw-products', updatedRaw);
    await writeBlob(catalogStore, 'catalog-last-run', {
        ts: Date.now(), retailer: retailerToProcess.name,
        scraped: totalScraped, withEan: totalWithEan,
        nextCursor: (cursor + 1) % activeToday.length,
        todayRetailerNames: activeToday.map(r => r.name)
    });

    // ── 5. Journal d'activité ──────────────────────────────────────────────
    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      Date.now(),
        agent:   'catalog',
        retailer: retailerToProcess.name,
        summary: `${totalScraped} produits scrapés · ${totalWithEan} avec EAN`,
        stats:   { scraped: totalScraped, withEan: totalWithEan }
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));

    console.log(`[Catalog] Terminé — ${totalScraped} scrapés, ${totalWithEan} avec EAN`);
    return { statusCode: 200 };
};
