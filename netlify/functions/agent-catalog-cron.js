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
    try {
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FBA-Dashboard/1.0' }, timeout: 8000 });
        if (!resp.ok) return null;
        return await resp.text();
    } catch { return null; }
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
    try {
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 FBA-Dashboard/1.0' },
            timeout: 8000
        });
        if (!resp.ok) return null;
        const html = await resp.text();
        return extractJsonLD(html);
    } catch { return null; }
}

// ─── Keepa lookup par EAN ─────────────────────────────────────────────────
async function keepaEANLookup(ean, keepaKey, cacheStore) {
    const cacheKey = 'ean_' + ean;
    try {
        const cached = await cacheStore.get(cacheKey, { type: 'json' });
        if (cached && (Date.now() - cached.ts) < 86400000) return cached.data;
    } catch {}

    try {
        const url = `https://api.keepa.com/product?key=${keepaKey}&domain=3&ean=${ean}&stats=1&history=0`;
        const resp = await fetch(url, { timeout: 10000 });
        const data = await resp.json();
        const p = (data.products || [])[0];
        if (!p) return null;

        const current  = (p.stats || {}).current || [];
        const newPrice = current[1] ?? -1;
        const bsr      = current[3] ?? -1;
        const result   = {
            asin:     p.asin || '',
            title:    p.title || '',
            brand:    p.brand || '',
            category: p.categoryTree?.slice(-1)[0]?.name || '',
            price:    newPrice > 0 ? +(newPrice / 100).toFixed(2) : null,
            bsr:      bsr > 0 ? bsr : null,
            sellers:  p.stats?.buyBoxSellerId ? 1 : 0,
            link:     `https://www.amazon.de/dp/${p.asin}`
        };
        await cacheStore.setJSON(cacheKey, { ts: Date.now(), data: result });
        return result;
    } catch { return null; }
}

// ─── Calcul profit FBA ────────────────────────────────────────────────────
function calcProfit(buyPrice, sellPrice, category) {
    if (!buyPrice || !sellPrice || sellPrice <= 0) return null;
    const commissionRate = (category || '').toLowerCase().includes('electronics') ? 0.08 : 0.15;
    const commission     = sellPrice * commissionRate;
    const fbaFees        = sellPrice < 10 ? 2.50 : sellPrice < 30 ? 3.50 : 4.80;
    const inbound        = 0.30;
    const prep           = 0.50;
    const totalCosts     = buyPrice + commission + fbaFees + inbound + prep;
    const grossProfit    = sellPrice - totalCosts;
    const netProfit      = grossProfit > 0 ? grossProfit * 0.878 : grossProfit; // URSSAF 12.2% micro BIC
    const roi            = buyPrice > 0 ? (netProfit / buyPrice) * 100 : 0;
    return { netProfit: +netProfit.toFixed(2), roi: +roi.toFixed(1) };
}

// ─── Handler principal ────────────────────────────────────────────────────
exports.handler = async () => {
    const KEEPA_KEY = process.env.KEEPA_API_KEY;
    if (!KEEPA_KEY) { console.error('[Catalog] KEEPA_API_KEY manquant'); return { statusCode: 500 }; }

    const catalogStore  = getStore('oa-catalog');
    const cacheStore    = getStore('oa-keepa-cache');
    const activityStore = getStore('oa-activity');

    // ── 1. Charger la liste des retailers ──────────────────────────────────
    const retailers = await readBlob(catalogStore, 'retailers', DEFAULT_RETAILERS);
    const today     = new Date().getDay(); // 0=dim, 1=lun, ...

    const activeToday = retailers.filter(r => r.active && (r.days || [0,1,2,3,4,5,6]).includes(today));
    if (!activeToday.length) {
        console.log('[Catalog] Aucun retailer actif aujourd\'hui');
        return { statusCode: 200 };
    }
    console.log(`[Catalog] ${activeToday.length} retailer(s) actif(s) aujourd'hui`);

    // ── 2. Charger le catalogue existant + historique ───────────────────────
    const existingCatalog = await readBlob(catalogStore, 'products', []);
    const seenEANs        = new Set(existingCatalog.map(p => p.ean).filter(Boolean));

    const allNewProducts  = [];
    const profitableItems = [];
    let totalScraped = 0, totalMatched = 0;

    // ── 3. Scraper chaque retailer ─────────────────────────────────────────
    for (const retailer of activeToday) {
        console.log(`[Catalog] Scraping ${retailer.name}...`);
        const maxP = retailer.maxProducts || 200;

        // Fetch URLs depuis sitemap
        const urls = await fetchSitemapUrls(retailer.url, maxP);
        if (!urls.length) {
            console.warn(`[Catalog] ${retailer.name}: pas d'URLs dans le sitemap`);
            continue;
        }
        console.log(`[Catalog] ${retailer.name}: ${urls.length} URLs`);

        // Scraper les pages en batch (max 20 par retailer pour limiter les tokens)
        const batch = urls.slice(0, 20);
        for (const url of batch) {
            const jsonlds = await scrapeProductPage(url);
            if (!jsonlds) continue;

            for (const jld of jsonlds) {
                const product = parseProduct(jld, retailer.name, retailer.url);
                if (!product) continue;
                totalScraped++;

                // Skip si déjà dans le catalogue
                if (product.ean && seenEANs.has(product.ean)) continue;
                if (product.ean) seenEANs.add(product.ean);

                // Keepa lookup si EAN disponible
                if (product.ean) {
                    const keepaData = await keepaEANLookup(product.ean, KEEPA_KEY, cacheStore);
                    if (keepaData && keepaData.price) {
                        const profit = calcProfit(product.price, keepaData.price, keepaData.category);
                        if (profit) {
                            totalMatched++;
                            const entry = {
                                ...product,
                                asin:       keepaData.asin,
                                amazonTitle:keepaData.title,
                                amazonPrice:keepaData.price,
                                bsr:        keepaData.bsr,
                                netProfit:  profit.netProfit,
                                roi:        profit.roi,
                                spApi:      'pending', // SP-API Production en attente
                                ts:         Date.now()
                            };
                            allNewProducts.push(entry);
                            if (profit.netProfit >= 5 && profit.roi >= 30) {
                                profitableItems.push(entry);
                            }
                        }
                    } else {
                        // Pas de prix Keepa → stocker sans profit
                        allNewProducts.push({ ...product, ts: Date.now() });
                    }
                } else {
                    // Pas d'EAN → stocker sans match Amazon
                    allNewProducts.push({ ...product, ts: Date.now() });
                }
            }
        }
    }

    // ── 4. Sauvegarder le catalogue mis à jour ─────────────────────────────
    const updatedCatalog = [...allNewProducts, ...existingCatalog].slice(0, 2000);
    await writeBlob(catalogStore, 'products', updatedCatalog);
    await writeBlob(catalogStore, 'last-run', { ts: Date.now(), scraped: totalScraped, matched: totalMatched, profitable: profitableItems.length });

    // ── 5. Telegram pour deals rentables ──────────────────────────────────
    for (const item of profitableItems.slice(0, 5)) {
        const msg = `🏪 <b>Agent Catalog — Produit rentable</b>\n\n` +
            `📦 <b>${(item.title || '').slice(0, 60)}</b>\n` +
            `🏷️ Retailer : ${item.retailer}\n` +
            `💰 ${item.price}€ → Amazon.de : ${item.amazonPrice}€\n` +
            `📈 Profit net : <b>${item.netProfit}€</b> | ROI : <b>${item.roi}%</b>\n` +
            (item.bsr ? `📊 BSR : ${Number(item.bsr).toLocaleString('fr')}\n` : '') +
            `🔗 <a href="${item.link}">Voir chez ${item.retailer}</a>` +
            (item.asin ? ` | <a href="https://www.amazon.de/dp/${item.asin}">Amazon.de</a>` : '');
        await sendTelegram(msg);
    }

    // ── 6. Journal d'activité ──────────────────────────────────────────────
    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      Date.now(),
        agent:   'catalog',
        summary: `${totalScraped} produits scrapés · ${totalMatched} matchés Amazon · ${profitableItems.length} rentables`,
        stats:   { scraped: totalScraped, matched: totalMatched, profitable: profitableItems.length, eligible: 0, pending: totalMatched }
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));

    // ── 7. Résumé Telegram ────────────────────────────────────────────────
    if (!profitableItems.length) {
        await sendTelegram(
            `🏪 <b>Agent Catalog</b> — ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n` +
            `📊 ${totalScraped} scrapés · ${totalMatched} matchés · 0 rentable\n` +
            `🏪 ${activeToday.length} retailer(s) scannés`
        );
    }

    console.log(`[Catalog] Terminé — ${totalScraped} scrapés, ${totalMatched} matchés, ${profitableItems.length} rentables`);
    return { statusCode: 200 };
};
