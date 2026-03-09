const fetch = require('node-fetch');
const { getStore: _getStore } = require('@netlify/blobs');
const { DEFAULT_RETAILERS } = require('./_shared');
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

// DEFAULT_RETAILERS importé depuis _shared.js

// ─── Extraction JSON-LD depuis HTML ─────────────────────────────────────────
function isProductType(t) {
    if (!t) return false;
    const accepted = ['product', 'productgroup'];
    if (Array.isArray(t)) return t.some(v => accepted.includes(String(v).toLowerCase()));
    return accepted.includes(String(t).toLowerCase());
}

function extractJsonLD(html) {
    const results = [];
    const allTypes = []; // pour debug
    const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
        try {
            const data = JSON.parse(m[1].trim());
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                allTypes.push(item['@type']);
                if (isProductType(item['@type'])) results.push(item);
                if (item['@graph']) {
                    for (const node of item['@graph']) {
                        allTypes.push(node['@type']);
                        if (isProductType(node['@type'])) results.push(node);
                    }
                }
            }
        } catch {}
    }
    results._allTypes = allTypes; // pour debug
    return results;
}

// ─── Parser produit depuis JSON-LD ─────────────────────────────────────────
function parseProduct(jsonld, retailerName, retailerUrl, html) {
    try {
        const offer = Array.isArray(jsonld.offers) ? jsonld.offers[0] : jsonld.offers;
        if (!offer) return null;

        const price = parseFloat(String(offer.price || offer.lowPrice || 0).replace(',', '.'));
        if (!price || price <= 0) return null;
        if (price < 8 || price > 150) return null; // hors plage OA

        // ── Détection promo : prix barré > prix actuel ──────────────────────
        // Source 1 : JSON-LD highPrice / priceSpecification
        const highRaw = offer.highPrice ?? offer.priceSpecification?.maxPrice ?? null;
        let originalPrice = highRaw ? parseFloat(String(highRaw).replace(',', '.')) : null;
        // Source 2 : HTML brut (PrestaShop et autres sans highPrice en JSON-LD)
        if ((!originalPrice || originalPrice <= price) && html) {
            originalPrice = extractOriginalPriceFromHtml(html);
        }
        if (!originalPrice || originalPrice <= price * 1.05) return null; // pas de vraie promo (< 5%)

        const discount = Math.round(((originalPrice - price) / originalPrice) * 100);

        const ean = (jsonld.gtin13 || jsonld.gtin8 || jsonld.gtin || jsonld.isbn ||
                     offer.gtin13 || offer.gtin8 || offer.gtin || '').replace(/[^0-9]/g, '');

        const title = (jsonld.name || '').trim();
        if (!title) return null;

        const image       = Array.isArray(jsonld.image) ? jsonld.image[0] : (jsonld.image || '');
        const retailerLink = offer.url || jsonld.url || '';  // URL produit chez le retailer
        const brand        = (jsonld.brand?.name || jsonld.brand || '').toString().trim();

        return { title, price, originalPrice, discount, ean: ean.length >= 8 ? ean : null, image, retailerLink, brand, retailer: retailerName, retailerUrl };
    } catch { return null; }
}

// ─── Extraction EAN depuis HTML brut (fallback si JSON-LD sans EAN) ─────────
function extractEanFromHtml(html) {
    const patterns = [
        // JSON-LD inline
        /"gtin13"\s*:\s*"(\d{8,14})"/,
        /"gtin8"\s*:\s*"(\d{8,14})"/,
        /"gtin"\s*:\s*"(\d{8,14})"/,
        /"ean"\s*:\s*"(\d{8,14})"/,
        /"barcode"\s*:\s*"(\d{8,14})"/,
        /"isbn"\s*:\s*"(\d{8,14})"/,
        // PrestaShop reference quand c'est un EAN13 (13 chiffres)
        /"reference"\s*:\s*"(\d{13})"/,
        // Attributs data-*
        /data-ean="(\d{8,14})"/,
        /data-barcode="(\d{8,14})"/,
        /data-product-ean="(\d{8,14})"/,
        /data-gtin="(\d{8,14})"/,
        /data-isbn="(\d{8,14})"/,
        // Microdata / itemprop
        /itemprop="gtin13"[^>]*content="(\d{8,14})"/,
        /content="(\d{13})"[^>]*itemprop="gtin13"/,
        // Meta tags
        /<meta[^>]+name="[^"]*ean[^"]*"[^>]+content="(\d{8,14})"/i,
        /<meta[^>]+content="(\d{13})"[^>]+name="[^"]*ean[^"]*"/i,
        // Variables JS / window.dataLayer
        /['"](ean|EAN|gtin|GTIN)['"]\s*:\s*['"](\d{8,14})['"]/,
        // Aubert / sites custom
        /"product_ean"\s*:\s*"(\d{8,14})"/,
        /"ean_code"\s*:\s*"(\d{8,14})"/,
    ];
    for (const re of patterns) {
        const m = html.match(re);
        const val = m?.[2] || m?.[1]; // group 2 pour le pattern avec clé variable
        if (val && val.length >= 8) return val;
    }
    return null;
}

// ─── Extraction prix original (barré) depuis HTML brut ──────────────────────
function extractOriginalPriceFromHtml(html) {
    const patterns = [
        // PrestaShop — données JSON injectées dans le JS de la page
        /"price_without_reduction"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"originalPrice"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"regular_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"priceBeforeDiscount"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"initial_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"list_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"base_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"old_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"normal_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"full_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        /"crossed_price"\s*:\s*"?([\d]+[.,][\d]*)"?/,
        // Shopify compare_at_price (en centimes → diviser par 100)
        /"compare_at_price"\s*:\s*(\d{4,6})[^.]/,
        // Attributs data-*
        /data-original-price="([\d]+[.,][\d]*)"/,
        /data-regular-price="([\d]+[.,][\d]*)"/,
        /data-price-without-reduction="([\d]+[.,][\d]*)"/,
        /data-compare-price="([\d]+[.,][\d]*)"/,
        /data-base-price="([\d]+[.,][\d]*)"/,
        // HTML sémantique — balises strikethrough
        /<del[^>]*>(?:[^<]|<(?!\/del))*?([\d]+[.,][\d]*)\s*€/i,
        /<s\b[^>]*>(?:[^<]|<(?!\/s))*?([\d]+[.,][\d]*)\s*€/i,
        // Classes CSS communes pour les prix barrés
        /<[^>]+class="[^"]*(?:regular-price|old-price|price-old|prix-barre|was-price|crossed-out|strikethrough|price-before)[^"]*"[^>]*>(?:[^<]|<(?!\/[a-z]))*?([\d]+[.,][\d]*)\s*€/i,
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m?.[1]) {
            let p = parseFloat(m[1].replace(',', '.'));
            // Shopify compare_at_price est en centimes
            if (re.source.includes('compare_at_price') && p > 1000) p = p / 100;
            if (p > 0) return p;
        }
    }
    return null;
}

// ─── Scrape sitemap.xml d'un retailer (gère sitemap index) ─────────────────
function isProductUrl(url) {
    return url.match(
        /\/(p|produit[s]?|product[s]?|catalogue|shop|artikel|item|fiche)\// // segment /produit/ etc.
        + /|\/[^/]+-\d{3,}(\.html?)?$/.source                               // slug-123 ou slug-123.html
        + /|\/[^/?]{10,}\.html?$/.source                                     // anything.html (10+ chars)
        + /|\/[^/]+\/[^/?]{20,}$/.source                                     // categorie/nom-produit-long
    , 'i')
    && !url.match(/\/categori|\/category|\/tag|\/marque|\/brand|\/blog|\/news|\/page\/|sitemap|\.xml$|outlet|occasion|reconditionn|destockage|pack-promo/i);
}

async function fetchXml(url, allowScraperFallback = false) {
    const scraperKey = process.env.SCRAPER_API_KEY;
    try {
        const resp = await fetch(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'application/xml, text/xml, */*'
            }
        });
        const status = resp.status;
        console.log(`[Catalog] fetchXml ${url} → ${status} (${resp.headers.get('content-type') || 'no-ct'})`);

        if (resp.ok) {
            const text = await resp.text();
            // Valider que c'est bien un sitemap XML (pas une page HTML d'erreur/bot-detection)
            if (!text.includes('<urlset') && !text.includes('<sitemapindex')) {
                console.log(`[Catalog] fetchXml ${url} → pas un sitemap valide (${text.length} chars, début: ${text.slice(0,80)})`);
                return null;
            }
            return text;
        }

        // 403/502/503 → fallback ScraperAPI uniquement si explicitement autorisé
        // (URLs connues via robots.txt — pas les candidats hardcodés qui peuvent ne pas exister)
        if (allowScraperFallback && [403, 502, 503].includes(status) && scraperKey) {
            console.log(`[Catalog] fetchXml ${url} → ${status}, retry via ScraperAPI`);
            const resp2 = await fetch(`https://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}`, { timeout: 25000 });
            console.log(`[Catalog] fetchXml (ScraperAPI) ${url} → ${resp2.status}`);
            if (!resp2.ok) return null;
            const text2 = await resp2.text();
            // Valider que c'est bien un sitemap XML (ScraperAPI peut retourner une page HTML anti-bot)
            if (!text2.includes('<urlset') && !text2.includes('<sitemapindex')) {
                console.log(`[Catalog] fetchXml (ScraperAPI) ${url} → pas un sitemap valide (${text2.length} chars)`);
                return null;
            }
            return text2;
        }

        return null;
    } catch (e) {
        console.log(`[Catalog] fetchXml ${url} → erreur: ${e.message}`);
        return null;
    }
}

// ─── Extrait l'URL du sitemap depuis robots.txt ─────────────────────────────
async function getSitemapFromRobots(baseUrl) {
    const scraperKey = process.env.SCRAPER_API_KEY;
    const robotsUrl  = baseUrl + '/robots.txt';
    const parseRobots = (text) => {
        const urls = [];
        for (const line of text.split('\n')) {
            const m = line.match(/^Sitemap:\s*(https?:\/\/\S+)/i);
            if (m) urls.push(m[1].trim());
        }
        if (urls.length) console.log(`[Catalog] robots.txt ${baseUrl} → sitemaps: ${urls.join(', ')}`);
        return urls;
    };
    try {
        const resp = await fetch(robotsUrl, {
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
        });
        if (resp.ok) return parseRobots(await resp.text());

        // 403/502/503 → retry via ScraperAPI (1 seul crédit pour découvrir le sitemap)
        if (scraperKey && [403, 502, 503].includes(resp.status)) {
            console.log(`[Catalog] robots.txt ${baseUrl} → ${resp.status}, retry via ScraperAPI`);
            const resp2 = await fetch(`https://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(robotsUrl)}`, { timeout: 12000 });
            if (resp2.ok) return parseRobots(await resp2.text());
        }
        return [];
    } catch { return []; }
}

async function fetchSitemapUrls(baseUrl, maxUrls, overrideSitemapUrl, scraperSitemap = false) {
    // 0. Chercher les sitemaps déclarés dans robots.txt (le plus fiable)
    const robotsSitemaps = await getSitemapFromRobots(baseUrl);

    // URLs depuis robots.txt = connues valides → ScraperAPI autorisé si 403/502
    // Candidats hardcodés = guesses → ScraperAPI seulement si scraperSitemap=true (gros retailers anti-bot)
    const candidates = [
        ...(overrideSitemapUrl ? [{ url: overrideSitemapUrl, scraperFallback: true }] : []),
        ...robotsSitemaps.map(u => ({ url: u, scraperFallback: true })),
        { url: baseUrl + '/sitemap.xml',          scraperFallback: scraperSitemap },
        { url: baseUrl + '/sitemap_index.xml',    scraperFallback: scraperSitemap },
        { url: baseUrl + '/sitemap-index.xml',    scraperFallback: scraperSitemap },
        { url: baseUrl + '/sitemap_products.xml', scraperFallback: scraperSitemap },
        { url: baseUrl + '/sitemap-products.xml', scraperFallback: scraperSitemap },
        { url: baseUrl + '/fr/sitemap.xml',       scraperFallback: scraperSitemap },
    ];

    // Extrait les entrées {url, lastmod} depuis un XML de sitemap
    const extractEntries = (xml) => {
        const entries = [];
        let m;
        // Format standard <url><loc>...</loc><lastmod>...</lastmod></url>
        const reUrl = /<url>([\s\S]*?)<\/url>/g;
        while ((m = reUrl.exec(xml)) !== null) {
            const locM     = m[1].match(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/);
            if (!locM) continue;
            const lastmodM = m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/);
            const lastmod  = lastmodM ? new Date(lastmodM[1]) : null;
            entries.push({ url: locM[1].trim(), lastmod });
        }
        // Fallback : sitemap index ou format simple (pas de <url>)
        if (entries.length === 0) {
            const re = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/g;
            while ((m = re.exec(xml)) !== null) entries.push({ url: m[1].trim(), lastmod: null });
        }
        return entries;
    };

    // Applique le filtre isProductUrl sur un tableau d'entrées (sans filtre lastmod)
    const applyFilters = (entries) => {
        let productEntries = entries.filter(e => isProductUrl(e.url));
        const rejectedEx = entries.filter(e => !isProductUrl(e.url) && !e.url.match(/sitemap.*\.xml/i));
        if (rejectedEx.length > 0) console.log(`[Catalog] URLs rejetées isProductUrl (ex): ${rejectedEx.slice(0,3).map(e => e.url).join(' | ')}`);
        // Fallback permissif si le filtre strict donne 0 résultats (ex: PrestaShop URLs propres)
        if (productEntries.length === 0 && entries.length > 10) {
            productEntries = entries.filter(e =>
                !e.url.match(/\/categori|\/category|\/tag|\/marque|\/brand|\/blog|\/news|sitemap|\.xml$|outlet|occasion|reconditionn|destockage/i)
                && !e.url.match(/\.(jpg|png|gif|css|js)$/i)
            );
            if (productEntries.length > 0)
                console.log(`[Catalog] Fallback isProductUrl → ${productEntries.length} URLs (mode permissif)`);
        }
        return productEntries.map(e => e.url);
    };

    for (const candidate of candidates) {
        const sitemapUrl = candidate.url ?? candidate;
        const xml = await fetchXml(sitemapUrl, candidate.scraperFallback === true);
        if (!xml) continue;

        const allEntries = extractEntries(xml);
        const allLocs    = allEntries.map(e => e.url);
        if (!allLocs.length) { console.log(`[Catalog] sitemap ${sitemapUrl} → 0 <loc> extraites`); continue; }

        console.log(`[Catalog] sitemap ${sitemapUrl} → ${allLocs.length} locs. Ex: ${allLocs.slice(0,3).join(' | ')}`);

        // Sitemap index ? → chercher les sous-sitemaps produits
        const subSitemaps = allLocs.filter(u => u.match(/sitemap/i) && u.match(/\.xml/i));
        if (subSitemaps.length > 0) {
            console.log(`[Catalog] sitemap index → ${subSitemaps.length} sous-sitemaps: ${subSitemaps.slice(0,5).join(', ')}`);
            const sorted = subSitemaps.sort((a, b) => {
                const aScore = /product|produit|artikel/i.test(a) ? 1 : 0;
                const bScore = /product|produit|artikel/i.test(b) ? 1 : 0;
                return bScore - aScore;
            });
            for (const sub of sorted.slice(0, 10)) {
                const subXml = await fetchXml(sub, candidate.scraperFallback === true);
                if (!subXml) continue;
                const subEntries = extractEntries(subXml);
                const urls       = applyFilters(subEntries);
                console.log(`[Catalog] sous-sitemap ${sub} → ${subEntries.length} locs, ${urls.length} produits après filtres. Ex: ${subEntries.slice(0,2).map(e=>e.url).join(' | ')}`);
                if (urls.length > 0) return urls.slice(0, maxUrls);
            }
        }

        // Sitemap direct
        const urls = applyFilters(allEntries);
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
        return { jsonlds: extractJsonLD(html), html };
    } catch { return null; }
}

// ─── Handler principal ────────────────────────────────────────────────────
exports.handler = async () => {
    const catalogStore  = getStore('oa-catalog');
    const activityStore = getStore('oa-activity');

    // ── 1. Charger la liste des retailers + rotation (1 retailer par run) ──
    // Merge blob (état runtime) + DEFAULT_RETAILERS (config statique : sitemapUrl, includePaths…)
    const blobRetailers = await readBlob(catalogStore, 'retailers', DEFAULT_RETAILERS);
    // Merge : blob = état runtime (sitemapError, lastSitemapError…)
    //         DEFAULT_RETAILERS = source de vérité pour active, days, sitemapUrl, includePaths
    const retailers = DEFAULT_RETAILERS.map(def => {
        const blob = blobRetailers.find(r => r.id === def.id) || {};
        return {
            ...def,                          // config statique (active, days, sitemapUrl…)
            sitemapError:     blob.sitemapError     ?? 0,
            lastSitemapError: blob.lastSitemapError ?? undefined,
        };
    });
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

    // ── 2. Charger état scraping (EANs vus, URLs vues, offsets sitemap) ──────
    const rawProducts     = (await readBlob(catalogStore, 'raw-products', [])).filter(p => p.ean); // purge legacy sans EAN
    const seenEANs        = new Set(rawProducts.map(p => p.ean).filter(Boolean));
    const seenUrlsArr     = await readBlob(catalogStore, 'scraped-urls', []);
    const seenUrls        = new Set(seenUrlsArr);
    const sitemapOffsets  = await readBlob(catalogStore, 'sitemap-offsets', {});

    const newProducts    = [];
    const noEanProducts  = [];
    let totalScraped = 0, totalWithEan = 0, totalNoEan = 0;

    // ── 3. Scraper le retailer du run ─────────────────────────────────────
    console.log(`[Catalog] Scraping ${retailerToProcess.name}...`);
    const maxP = Math.min(retailerToProcess.maxProducts || 30, 30); // plafonné à 30 pour respecter le timeout 60s

    // Récupère toutes les URLs du sitemap (jusqu'à 5000 pour la rotation)
    const allUrls = await fetchSitemapUrls(retailerToProcess.url, 5000, retailerToProcess.sitemapUrl, retailerToProcess.scraperSitemap === true);

    // ── Mettre à jour le statut sitemap du retailer dans le blob ───────────
    const rIdx = retailers.findIndex(r => r.id === retailerToProcess.id);
    if (rIdx >= 0) {
        if (!allUrls.length) {
            retailers[rIdx].sitemapError = (retailers[rIdx].sitemapError || 0) + 1;
            retailers[rIdx].lastSitemapError = Date.now();
        } else {
            retailers[rIdx].sitemapError = 0; // reset si le sitemap revient
            delete retailers[rIdx].lastSitemapError;
        }
        await writeBlob(catalogStore, 'retailers', retailers);
    }

    if (!allUrls.length) {
        console.warn(`[Catalog] ${retailerToProcess.name}: pas d'URLs dans le sitemap (erreur #${retailers[rIdx]?.sitemapError || 1})`);
    } else {
        // Filtre catégories par chemin URL (si configuré sur le retailer)
        let filteredUrls = allUrls;
        if (retailerToProcess.includePaths && retailerToProcess.includePaths.length > 0) {
            const pathRe = new RegExp(retailerToProcess.includePaths.join('|'), 'i');
            filteredUrls = allUrls.filter(u => pathRe.test(u));
            console.log(`[Catalog] ${retailerToProcess.name}: filtre includePaths → ${filteredUrls.length}/${allUrls.length} URLs`);
        }

        // Rotation : reprend là où on s'était arrêté la dernière fois
        const offset  = sitemapOffsets[retailerToProcess.id] || 0;
        const rotated = [...filteredUrls.slice(offset), ...filteredUrls.slice(0, offset)];

        // Déduplication URL : skip les pages déjà scrapées
        const freshUrls = rotated.filter(u => !seenUrls.has(u));
        const batch     = (freshUrls.length > 0 ? freshUrls : rotated).slice(0, maxP);

        // Sauvegarder le nouvel offset pour le prochain run
        sitemapOffsets[retailerToProcess.id] = (offset + maxP) % Math.max(filteredUrls.length, 1);

        console.log(`[Catalog] ${retailerToProcess.name}: ${allUrls.length} URLs total, ${filteredUrls.length} après filtres, offset=${offset}, batch=${batch.length} (${freshUrls.length} nouvelles)`);

        // Scraping en lots parallèles de 5 (séquentiel = trop lent pour le timeout 60s)
        const CHUNK_SIZE = 5;
        let debugSample = true;
        for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
            const chunk   = batch.slice(i, i + CHUNK_SIZE);
            const results = await Promise.all(chunk.map(async (url) => {
                const result = await scrapeProductPage(url);
                seenUrls.add(url);
                return { url, jsonlds: result?.jsonlds ?? null, html: result?.html ?? null };
            }));

            for (const { url, jsonlds, html } of results) {
                if (debugSample) {
                    if (!jsonlds) { console.log(`[Catalog] DEBUG ${url} → null (fetch failed)`); }
                    else if (jsonlds.length === 0) {
                        const types = (jsonlds._allTypes || []).join(', ') || 'aucun';
                        console.log(`[Catalog] DEBUG ${url} → 0 Product. @types: [${types}]`);
                    } else {
                        const jld    = jsonlds[0];
                        const offer  = Array.isArray(jld.offers) ? jld.offers[0] : jld.offers;
                        const price  = offer?.price ?? offer?.lowPrice ?? null;
                        const high   = offer?.highPrice ?? offer?.priceSpecification?.maxPrice ?? null;
                        const ean    = jld.gtin13 || jld.gtin8 || jld.gtin || offer?.gtin13 || offer?.gtin || null;
                        const htmlOriginal = html ? extractOriginalPriceFromHtml(html) : null;
                        console.log(`[Catalog] DEBUG ${url} → type=${JSON.stringify(jld['@type'])} name="${(jld.name||'').slice(0,40)}" price=${price} highPrice=${high} htmlOriginal=${htmlOriginal} ean=${ean}`);
                    }
                    debugSample = false;
                }
                if (!jsonlds) continue;

                for (const jld of jsonlds) {
                    const product = parseProduct(jld, retailerToProcess.name, retailerToProcess.url, html);
                    if (!product) continue;
                    // Garantir retailerLink = URL du produit (l'URL scrapée est toujours exacte)
                    if (!product.retailerLink || product.retailerLink === retailerToProcess.url) {
                        product.retailerLink = url;
                    }
                    totalScraped++;

                    // Fallback EAN : cherche dans le HTML brut si JSON-LD n'a pas d'EAN
                    if (!product.ean && html) {
                        product.ean = extractEanFromHtml(html);
                    }

                    if (!product.ean) {
                        noEanProducts.push({ ...product, scrapedAt: Date.now() });
                        totalNoEan++;
                        continue;
                    }

                    if (seenEANs.has(product.ean)) continue;
                    seenEANs.add(product.ean);
                    totalWithEan++;
                    newProducts.push({ ...product, scrapedAt: Date.now() });
                }
            }
        }

        // Sauvegarder URLs vues + offsets
        await writeBlob(catalogStore, 'scraped-urls', [...seenUrls].slice(-15000));
        await writeBlob(catalogStore, 'sitemap-offsets', sitemapOffsets);
    }

    // ── 4a. Sauvegarder les produits bruts AVEC EAN ────────────────────────
    const updatedRaw = [...newProducts, ...rawProducts].slice(0, 5000);
    await writeBlob(catalogStore, 'raw-products', updatedRaw);

    // ── 4b. Sauvegarder les produits SANS EAN ─────────────────────────────
    if (noEanProducts.length > 0) {
        const existingNoEan   = await readBlob(catalogStore, 'raw-products-no-ean', []);
        const seenNoEanTitles = new Set(existingNoEan.map(p => p.title + '|' + p.retailer));
        const freshNoEan      = noEanProducts.filter(p => !seenNoEanTitles.has(p.title + '|' + p.retailer));
        await writeBlob(catalogStore, 'raw-products-no-ean', [...freshNoEan, ...existingNoEan].slice(0, 2000));
    }
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
        summary: `${totalScraped} produits scrapés · ${totalWithEan} avec EAN · ${totalNoEan} sans EAN`,
        stats:   { scraped: totalScraped, withEan: totalWithEan, noEan: totalNoEan, matched: totalWithEan }
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));

    console.log(`[Catalog] Terminé — ${totalScraped} scrapés, ${totalWithEan} avec EAN, ${totalNoEan} sans EAN`);
    return { statusCode: 200 };
};
