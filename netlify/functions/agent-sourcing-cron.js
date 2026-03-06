const fetch = require('node-fetch');
const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

// ─── RSS sources (Pepper network) ─────────────────────────────────────────
const RSS_SOURCES = [
    { name: 'Dealabs',      url: 'https://www.dealabs.com/rss/hot',         country: 'FR' },
    { name: 'MyDealz',      url: 'https://www.mydealz.de/rss/hot',          country: 'DE' },
    { name: 'Dealabs New',  url: 'https://www.dealabs.com/rss/new',         country: 'FR' },
    { name: 'MyDealz New',  url: 'https://www.mydealz.de/rss/new',          country: 'DE' },
];

// ─── Helpers Blobs ────────────────────────────────────────────────────────
async function readBlob(store, key, fallback) {
    try { return (await store.get(key, { type: 'json' })) ?? fallback; }
    catch { return fallback; }
}
async function writeBlob(store, key, data) {
    await store.setJSON(key, data);
}

// ─── Telegram ─────────────────────────────────────────────────────────────
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

// ─── Parser RSS XML simple ────────────────────────────────────────────────
function parseRSS(xml) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const get = (tag) => {
            const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
            return m ? (m[1] || m[2] || '').trim() : '';
        };
        const title       = get('title');
        const link        = get('link') || get('guid');
        const description = get('description');
        const pubDate     = get('pubDate');
        const price       = extractPrice(title + ' ' + description);
        if (title) items.push({ title, link, description, pubDate, price });
    }
    return items;
}

function extractPrice(text) {
    // Cherche des patterns comme "29,99€", "29.99 €", "29€"
    const m = text.match(/(\d+[.,]\d{2})\s*€|(\d+)\s*€/);
    if (!m) return null;
    return parseFloat((m[1] || m[2]).replace(',', '.'));
}

function extractASIN(text) {
    // Cherche un ASIN Amazon dans une URL (/dp/XXXXXXXXXX) ou seul (10 chars alphanum)
    const m = text.match(/\/dp\/([A-Z0-9]{10})/i) || text.match(/\basin[=: ]+([A-Z0-9]{10})\b/i);
    return m ? m[1].toUpperCase() : null;
}

// ─── Matching marque dans un texte ────────────────────────────────────────
function matchesBrand(text, brandName) {
    if (!text || !brandName) return false;
    return text.toLowerCase().includes(brandName.toLowerCase());
}

// ─── Calcul profit FBA simplifié ──────────────────────────────────────────
function calcProfit(buyPrice, sellPrice, category) {
    if (!buyPrice || !sellPrice || sellPrice <= 0) return null;
    // Commission Amazon ~15% (variable par catégorie, simplifiée)
    const commissionRate = category && category.toLowerCase().includes('électronique') ? 0.08 : 0.15;
    const commission     = sellPrice * commissionRate;
    // FBA fees simplifiées (poids moyen 500g, taille standard)
    const fbaFees        = sellPrice < 10 ? 2.50 : sellPrice < 30 ? 3.50 : 4.80;
    const inbound        = 0.30;
    const prep           = 0.50;
    const totalCosts     = buyPrice + commission + fbaFees + inbound + prep;
    const grossProfit    = sellPrice - totalCosts;
    // URSSAF micro-entreprise ~22%
    const netProfit      = grossProfit > 0 ? grossProfit * 0.78 : grossProfit;
    const roi            = buyPrice > 0 ? (netProfit / buyPrice) * 100 : 0;
    return { netProfit: +netProfit.toFixed(2), roi: +roi.toFixed(1), sellPrice, buyPrice };
}

// ─── Keepa lookup (avec cache Blobs) ─────────────────────────────────────
async function keepaLookup(asin, keepaKey, cacheStore) {
    // Vérifier cache (24h)
    const cacheKey = 'cache_' + asin;
    try {
        const cached = await cacheStore.get(cacheKey, { type: 'json' });
        if (cached && (Date.now() - cached.ts) < 86400000) return cached.data;
    } catch {}

    // Appel API
    try {
        const url = `https://api.keepa.com/product?key=${keepaKey}&domain=3&asin=${asin}&stats=1&history=0`;
        const resp = await fetch(url);
        const data = await resp.json();
        const p = (data.products || [])[0];
        if (!p) return null;
        const current   = (p.stats || {}).current || [];
        const newPrice  = current[1] ?? -1;
        const bsr       = current[3] ?? -1;
        const result    = {
            asin,
            title:    p.title || '',
            brand:    p.brand || '',
            category: p.categoryTree?.slice(-1)[0]?.name || '',
            price:    newPrice > 0 ? +(newPrice / 100).toFixed(2) : null,
            bsr:      bsr > 0 ? bsr : null,
            link:     `https://www.amazon.de/dp/${asin}`
        };
        // Mettre en cache
        await cacheStore.setJSON(cacheKey, { ts: Date.now(), data: result });
        return result;
    } catch { return null; }
}

// ─── Handler principal ────────────────────────────────────────────────────
exports.handler = async () => {
    const KEEPA_KEY = process.env.KEEPA_API_KEY;
    if (!KEEPA_KEY) { console.error('[Sourcing] KEEPA_API_KEY manquant'); return { statusCode: 500 }; }

    const catalogStore   = getStore('oa-catalog');
    const cacheStore     = getStore('oa-keepa-cache');
    const activityStore  = getStore('oa-activity');

    // ── 1. Lire le catalogue (produits avec marques connues) ───────────────
    const catalog     = await readBlob(catalogStore,   'products',    []);
    const dealHistory = await readBlob(catalogStore,   'deal-history',[]);
    const seenDeals   = new Set(dealHistory.map(d => d.asin + '_' + d.dealLink));

    // Extraire les marques et ASINs connus du catalogue
    const portfolio = catalog.filter(p => p.brand || p.asin).map(p => ({
        brand: p.brand || p.retailer,
        name:  p.brand || p.title,
        asin:  p.asin
    }));

    if (!portfolio.length) {
        console.log('[Deal FR] Catalogue vide — Agent Catalog doit tourner d\'abord');
        return { statusCode: 200 };
    }
    console.log(`[Deal FR] ${portfolio.length} produits dans le catalogue`);

    // ── 2. Fetch RSS ───────────────────────────────────────────────────────
    const allDeals = [];
    for (const source of RSS_SOURCES) {
        try {
            const resp = await fetch(source.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 FBA-Dashboard/1.0' },
                timeout: 8000
            });
            if (!resp.ok) continue;
            const xml   = await resp.text();
            const items = parseRSS(xml);
            items.forEach(item => { item.source = source.name; item.country = source.country; });
            allDeals.push(...items);
            console.log(`[Sourcing] ${source.name}: ${items.length} deals`);
        } catch (e) {
            console.warn(`[Sourcing] RSS ${source.name} erreur:`, e.message);
        }
    }
    console.log(`[Sourcing] Total RSS: ${allDeals.length} deals`);

    // ── 3. Matcher avec le portefeuille ────────────────────────────────────
    const matched = [];
    for (const deal of allDeals) {
        const text = deal.title + ' ' + deal.description;
        for (const brand of portfolio) {
            if (matchesBrand(text, brand.brand || brand.name || brand.title)) {
                deal.matchedBrand = brand.brand || brand.name;
                deal.asin = extractASIN(text) || extractASIN(deal.link) || brand.asin;
                matched.push(deal);
                break;
            }
        }
    }
    console.log(`[Sourcing] ${matched.length} deals matchés avec le portefeuille`);

    // ── 4. Dédupliquer + garder deals avec prix + ASIN ────────────────────
    const toAnalyze = matched.filter(d => {
        if (!d.price || !d.asin) return false;
        const key = d.asin + '_' + (d.link || '');
        if (seenDeals.has(key)) return false;
        seenDeals.add(key);
        return true;
    }).slice(0, 10); // max 10 lookups Keepa par heure

    // ── 5. Keepa lookup + calcul profit ───────────────────────────────────
    let tokensLeft = null;
    const profitableDeals = [];
    const newHistory = [];

    for (const deal of toAnalyze) {
        const keepaData = await keepaLookup(deal.asin, KEEPA_KEY, cacheStore);
        if (!keepaData || !keepaData.price) continue;

        const profit = calcProfit(deal.price, keepaData.price, keepaData.category);
        if (!profit) continue;

        const entry = {
            asin:        deal.asin,
            title:       keepaData.title || deal.title,
            brand:       deal.matchedBrand,
            buyPrice:    deal.price,
            sellPrice:   keepaData.price,
            netProfit:   profit.netProfit,
            roi:         profit.roi,
            bsr:         keepaData.bsr,
            source:      deal.source,
            dealLink:    deal.link,
            amazonLink:  keepaData.link,
            ts:          Date.now()
        };

        newHistory.push(entry);
        if (profit.netProfit >= 5 && profit.roi >= 35) {
            profitableDeals.push(entry);
        }
    }

    // ── 6. Sauvegarder historique deals ───────────────────────────────────
    const updatedHistory = [...newHistory, ...dealHistory].slice(0, 500);
    await writeBlob(catalogStore, 'deal-history', updatedHistory);

    // ── 7. Telegram pour chaque deal rentable ──────────────────────────────
    for (const d of profitableDeals) {
        const msg = `⚡ <b>Deal rentable — Agent Sourcing</b>\n\n` +
            `📦 <b>${d.title.slice(0, 60)}</b>\n` +
            `🏷️ Marque : ${d.brand}\n` +
            `💰 ${d.buyPrice}€ → Amazon.de : ${d.sellPrice}€\n` +
            `📈 Profit net : <b>${d.netProfit}€</b> | ROI : <b>${d.roi}%</b>\n` +
            (d.bsr ? `📊 BSR : ${Number(d.bsr).toLocaleString('fr')}\n` : '') +
            `🏪 Source : ${d.source}\n\n` +
            `🔗 <a href="${d.dealLink}">Voir le deal</a> | <a href="${d.amazonLink}">Amazon.de</a>`;
        await sendTelegram(msg);
    }

    // ── 8. Journal d'activité ─────────────────────────────────────────────
    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      Date.now(),
        agent:   'sourcing',
        summary: `${allDeals.length} deals RSS · ${matched.length} matchés · ${toAnalyze.length} analysés · ${profitableDeals.length} rentables`,
        stats:   { deals: toAnalyze.length, profitable: profitableDeals.length, matched: matched.length },
        tokensLeft
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));

    // ── 9. Telegram résumé (si 0 deals rentables, 1 message court) ────────
    if (!profitableDeals.length) {
        await sendTelegram(
            `⚡ <b>Agent Deal FR</b> — ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n` +
            `📭 ${matched.length} deals matchés · 0 rentable\n` +
            `🏪 Catalogue : ${portfolio.length} produits`
        );
    }

    console.log(`[Deal FR] Terminé — ${profitableDeals.length} rentables sur ${toAnalyze.length} analysés`);
    return { statusCode: 200 };
};
