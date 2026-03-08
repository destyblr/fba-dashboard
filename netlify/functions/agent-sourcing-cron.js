const fetch = require('node-fetch');
const { getStore: _getStore } = require('@netlify/blobs');
const { calcProfit, MIN_PROFIT, MIN_ROI } = require('./_shared');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

async function readBlob(store, key, fallback) {
    try { return (await store.get(key, { type: 'json' })) ?? fallback; }
    catch { return fallback; }
}
async function writeBlob(store, key, data) { await store.setJSON(key, data); }

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

// calcProfit importé depuis _shared.js

const MP_DOMAIN = { DE: 'amazon.de', FR: 'amazon.fr', IT: 'amazon.it', ES: 'amazon.es' };

async function getThresholds(portfolioStore) {
    try {
        const s = await portfolioStore.get('user-settings', { type: 'json' }) || {};
        return {
            minProfit: s.strictMinProfit ?? MIN_PROFIT,
            minRoi:    s.strictMinRoi    ?? MIN_ROI,
        };
    } catch { return { minProfit: MIN_PROFIT, minRoi: MIN_ROI }; }
}

exports.handler = async () => {
    const catalogStore   = getStore('oa-catalog');
    const activityStore  = getStore('oa-activity');
    const portfolioStore = getStore('oa-portfolio');
    const { minProfit, minRoi } = await getThresholds(portfolioStore);
    console.log(`[Sourcing] Seuils : profit ≥ ${minProfit}€, ROI ≥ ${minRoi}%`);

    // ── 1. Lire les produits enrichis (avec prix Amazon) ──────────────────
    const enriched = await readBlob(catalogStore, 'enriched-products', []);

    if (!enriched.length) {
        console.log('[Sourcing] Aucun produit enrichi — Agent Enricher doit tourner d\'abord');
        const activity = await readBlob(activityStore, 'log', []);
        activity.unshift({
            ts:      Date.now(),
            agent:   'sourcing',
            summary: 'Aucun produit enrichi disponible — en attente Agent Enricher',
            stats:   { analyzed: 0, profitable: 0 }
        });
        await writeBlob(activityStore, 'log', activity.slice(0, 100));
        return { statusCode: 200 };
    }

    console.log(`[Sourcing] ${enriched.length} produits enrichis à analyser`);

    // ── 2. Lire l'historique pour éviter les doublons (48h) ───────────────
    const dealHistory = await readBlob(catalogStore, 'deal-history', []);
    const cutoff      = Date.now() - 48 * 3600000;
    const seenKeys    = new Set(
        dealHistory.filter(d => d.ts > cutoff).map(d => d.asin)
    );

    // ── 3. Calculer la rentabilité de chaque produit enrichi ──────────────
    const profitable = [];
    let analyzed = 0;

    for (const p of enriched) {
        if (!p.price || !p.amazonPrice || !p.asin) continue;
        if (seenKeys.has(p.asin)) continue;

        analyzed++;
        const profit = calcProfit(p.price, p.amazonPrice, p.category, p.packageWeight);
        if (!profit) continue;

        if (profit.netProfit >= minProfit && profit.roi >= minRoi) {
            const mp = p.bestMarketplace || 'DE';
            profitable.push({
                asin:       p.asin,
                title:      p.amazonTitle || p.title,
                retailer:   p.retailer,
                buyPrice:   p.price,
                sellPrice:  p.amazonPrice,
                netProfit:  profit.netProfit,
                roi:        profit.roi,
                bsr:        p.bsr,
                marketplace: mp,
                amazonLink: `https://www.${MP_DOMAIN[mp] || 'amazon.de'}/dp/${p.asin}`,
                retailLink: p.retailerUrl || p.link || '',
                ts:         Date.now()
            });
            seenKeys.add(p.asin);
        }
    }

    console.log(`[Sourcing] ${analyzed} analysés · ${profitable.length} rentables`);

    // ── 4. Sauvegarder les nouveaux deals rentables ───────────────────────
    if (profitable.length) {
        const updated = [...profitable, ...dealHistory].slice(0, 500);
        await writeBlob(catalogStore, 'deal-history', updated);
    }

    // ── 5. Telegram pour chaque deal rentable ────────────────────────────
    for (const d of profitable) {
        const mpFlag = { DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸' }[d.marketplace] || '🇩🇪';
        const msg =
            `⚡ <b>Deal rentable — Agent Sourcing</b>\n\n` +
            `📦 <b>${(d.title || '').slice(0, 60)}</b>\n` +
            `🏪 Source : ${d.retailer || '—'}\n` +
            `💰 Achat : ${d.buyPrice}€ → ${mpFlag} Amazon : ${d.sellPrice}€\n` +
            `📈 Profit net : <b>${d.netProfit}€</b> | ROI : <b>${d.roi}%</b>\n` +
            (d.bsr ? `📊 BSR : ${Number(d.bsr).toLocaleString('fr')}\n` : '') +
            (d.retailLink ? `\n🔗 <a href="${d.retailLink}">Voir le deal</a> | ` : '\n') +
            `<a href="${d.amazonLink}">${MP_DOMAIN[d.marketplace] || 'amazon.de'}</a>`;
        await sendTelegram(msg);
    }

    // ── 6. Journal d'activité ─────────────────────────────────────────────
    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      Date.now(),
        agent:   'sourcing',
        summary: `${analyzed} produits analysés · ${profitable.length} rentable(s) trouvé(s)`,
        stats:   { analyzed, profitable: profitable.length }
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));

    return { statusCode: 200 };
};
