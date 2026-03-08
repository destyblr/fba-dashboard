const fetch = require('node-fetch');
const { getStore: _getStore } = require('@netlify/blobs');
const { calcProfit, MIN_PROFIT, MIN_ROI } = require('./_shared');
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

// ─── IDs Amazon par marketplace ──────────────────────────────────────────
const AMAZON_SELLER_IDS = {
    3: 'A1PA6795UKMFR9', // Amazon.de
    4: 'A13V1IB3VIYZZH', // Amazon.fr
    8: 'A11IL2PNWYGU7H', // Amazon.it
    9: 'A1RKKUPIHCS9HS', // Amazon.es
};
const DOMAIN_NAMES = { 3: 'DE', 4: 'FR', 8: 'IT', 9: 'ES' };
const DOMAIN_LINKS = { 3: 'amazon.de', 4: 'amazon.fr', 8: 'amazon.it', 9: 'amazon.es' };

// ─── Keepa lookup pour un domaine ────────────────────────────────────────
async function keepaDomainLookup(ean, keepaKey, domain) {
    try {
        const url = `https://api.keepa.com/product?key=${keepaKey}&domain=${domain}&ean=${ean}&stats=1&history=0`;
        const resp = await fetch(url, { timeout: 12000 });
        const data = await resp.json();
        const p    = (data.products || [])[0];
        if (!p) return { price: null, tokensLeft: data.tokensLeft ?? null };

        const current        = (p.stats || {}).current || [];
        const newPrice       = current[1] ?? -1;
        const bsr            = current[3] ?? -1;
        const monthlySold    = p.monthlySold ?? null;
        const offerCountNew  = p.stats?.offerCountNew ?? null;
        const buyBoxSellerId = p.stats?.buyBoxSellerId ?? null;
        const amazonIsSeller = buyBoxSellerId === AMAZON_SELLER_IDS[domain];
        const price          = newPrice > 0 ? +(newPrice / 100).toFixed(2) : null;

        return {
            asin:            p.asin || '',
            amazonTitle:     p.title || '',
            brand:           p.brand || '',
            category:        p.categoryTree?.slice(-1)[0]?.name || '',
            price,
            bsr:             bsr > 0 ? bsr : null,
            monthlySold,
            offerCountNew,
            buyBoxSellerId,
            amazonIsSeller,
            packageWeight:   p.packageWeight > 0 ? p.packageWeight : null, // grammes
            link:            `https://www.${DOMAIN_LINKS[domain]}/dp/${p.asin}`,
            tokensLeft:      data.tokensLeft ?? null,
        };
    } catch { return { price: null, tokensLeft: null }; }
}

// ─── Keepa multi-marketplace : retourne la meilleure MP parmi DE/FR/IT/ES ─
async function keepaEANLookup(ean, keepaKey) {
    const [de, fr, it, es] = await Promise.all([
        keepaDomainLookup(ean, keepaKey, 3),
        keepaDomainLookup(ean, keepaKey, 4),
        keepaDomainLookup(ean, keepaKey, 8),
        keepaDomainLookup(ean, keepaKey, 9),
    ]);

    const candidates = [
        { mp: 'DE', data: de },
        { mp: 'FR', data: fr },
        { mp: 'IT', data: it },
        { mp: 'ES', data: es },
    ].filter(c => c.data.price && c.data.asin);

    if (!candidates.length) return null;

    // Choisir la marketplace avec le prix le plus élevé (meilleure marge)
    const best = candidates.reduce((a, b) => a.data.price >= b.data.price ? a : b);

    return {
        ...best.data,
        amazonPrice:     best.data.price,
        bestMarketplace: best.mp,
        bestPrice:       best.data.price,
        priceDE:         de.price,
        priceFR:         fr.price,
        priceIT:         it.price,
        priceES:         es.price,
        tokensLeft:      de.tokensLeft ?? fr.tokensLeft ?? it.tokensLeft ?? es.tokensLeft ?? null,
    };
}

// calcProfit importé depuis _shared.js

// ─── Handler principal ────────────────────────────────────────────────────
exports.handler = async () => {
    const KEEPA_KEY = process.env.KEEPA_API_KEY;
    if (!KEEPA_KEY) { console.error('[Enricher] KEEPA_API_KEY manquant'); return { statusCode: 500 }; }

    const catalogStore  = getStore('oa-catalog');
    const activityStore = getStore('oa-activity');

    // ── 1. Charger les produits bruts avec EAN ─────────────────────────────
    const [rawProducts, enrichedProducts, activityLog] = await Promise.all([
        readBlob(catalogStore,  'raw-products',       []),
        readBlob(catalogStore,  'enriched-products',  []),
        readBlob(activityStore, 'log',                []),
    ]);

    // Index des produits deja enrichis (EAN → timestamp d'enrichissement)
    const enrichedIndex = {};
    for (const p of enrichedProducts) {
        if (p.ean) enrichedIndex[p.ean] = p.enrichedAt || 0;
    }

    // Filtrer : produits avec EAN non encore enrichis OU enrichis il y a > 7 jours
    const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
    const toEnrich = rawProducts.filter(p =>
        p.ean && (!enrichedIndex[p.ean] || Date.now() - enrichedIndex[p.ean] > SEVEN_DAYS)
    );

    // Batch dynamique selon les tokens Keepa disponibles (4 appels/produit × DE+FR+IT+ES)
    const lastEnricherLog = activityLog.find(e => e.agent === 'enricher');
    const tokensLeft  = lastEnricherLog?.tokensLeft ?? 60;
    const safeTokens  = Math.max(0, tokensLeft - 20); // garder 20 tokens de réserve
    const batchSize   = Math.min(Math.floor(safeTokens / 4), 10); // max 10/run
    const batch       = toEnrich.slice(0, batchSize);
    console.log(`[Enricher] ${rawProducts.length} produits bruts · ${toEnrich.length} à enrichir · tokens=${tokensLeft} → batch de ${batch.length}`);

    if (!batch.length) {
        console.log('[Enricher] Rien à enrichir ce run');
        return { statusCode: 200 };
    }

    // ── 2. Enrichir via Keepa ──────────────────────────────────────────────
    let enrichedCount = 0;
    let profitableItems = [];
    let lastTokens = null;

    for (const product of batch) {
        const keepa = await keepaEANLookup(product.ean, KEEPA_KEY);
        if (!keepa) continue;
        if (keepa.tokensLeft !== null) lastTokens = keepa.tokensLeft;

        const profit = keepa.amazonPrice
            ? calcProfit(product.price, keepa.amazonPrice, keepa.category, keepa.packageWeight)
            : null;

        const enriched = {
            ...product,
            ...keepa,
            netProfit:  profit?.netProfit ?? null,
            roi:        profit?.roi ?? null,
            enrichedAt: Date.now(),
        };

        // Remplacer ou ajouter dans la liste enrichie
        const idx = enrichedProducts.findIndex(p => p.ean === product.ean);
        if (idx >= 0) enrichedProducts[idx] = enriched;
        else enrichedProducts.unshift(enriched);

        enrichedCount++;

        if (profit && profit.netProfit >= MIN_PROFIT && profit.roi >= MIN_ROI) {
            profitableItems.push(enriched);
        }

        console.log(`[Enricher] ${product.ean} → ASIN ${keepa.asin} · ${keepa.amazonPrice}€ · profit ${profit?.netProfit ?? 'N/A'}€`);
    }

    // ── 3. Sauvegarder les produits enrichis ──────────────────────────────
    const sorted = enrichedProducts.sort((a, b) => (b.enrichedAt || 0) - (a.enrichedAt || 0)).slice(0, 3000);
    await writeBlob(catalogStore, 'enriched-products', sorted);

    // ── 4. Telegram pour deals rentables ──────────────────────────────────
    for (const item of profitableItems.slice(0, 3)) {
        const mpFlag = { DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸' }[item.bestMarketplace] || '🇩🇪';
        const prices = [
            item.priceDE ? `🇩🇪 ${item.priceDE}€` : null,
            item.priceFR ? `🇫🇷 ${item.priceFR}€` : null,
            item.priceIT ? `🇮🇹 ${item.priceIT}€` : null,
            item.priceES ? `🇪🇸 ${item.priceES}€` : null,
        ].filter(Boolean).join(' · ');
        const priceInfo = prices
            ? `${prices}\n➡️ Meilleure MP : ${mpFlag} <b>${item.bestPrice}€</b>`
            : `${mpFlag} Amazon : ${item.bestPrice || item.amazonPrice}€`;
        const msg = `💎 <b>Agent Enricher — Deal rentable</b>\n\n` +
            `📦 <b>${(item.amazonTitle || item.title || '').slice(0, 60)}</b>\n` +
            `🏷️ Retailer : ${item.retailer} · ${item.price}€\n` +
            `${priceInfo}\n` +
            `📈 Profit net : <b>${item.netProfit}€</b> | ROI : <b>${item.roi}%</b>\n` +
            (item.bsr ? `📊 BSR : ${Number(item.bsr).toLocaleString('fr')}\n` : '') +
            (item.monthlySold ? `📦 Ventes/mois : ~${item.monthlySold}\n` : '') +
            (item.offerCountNew !== null ? `🏪 Vendeurs : ${item.offerCountNew}\n` : '') +
            `🤖 Amazon vendeur : ${item.amazonIsSeller ? 'Oui ⚠️' : 'Non ✅'}\n` +
            `🔗 <a href="${item.link || '#'}">Voir sur Amazon</a>`;
        await sendTelegram(msg);
    }

    // ── 5. Journal d'activité ──────────────────────────────────────────────
    activityLog.unshift({
        ts:      Date.now(),
        agent:   'enricher',
        summary: `${enrichedCount} produits enrichis · ${profitableItems.length} rentables` +
                 (lastTokens !== null ? ` · ${lastTokens} tokens Keepa restants` : ''),
        stats:   { enriched: enrichedCount, profitable: profitableItems.length },
        tokensLeft: lastTokens
    });
    await writeBlob(activityStore, 'log', activityLog.slice(0, 100));

    console.log(`[Enricher] Terminé — ${enrichedCount} enrichis, ${profitableItems.length} rentables`);
    return { statusCode: 200 };
};
