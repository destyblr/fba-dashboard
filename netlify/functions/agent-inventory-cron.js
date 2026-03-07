const fetch = require('node-fetch');
const { getStore: _getStore } = require('@netlify/blobs');
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

const STAGE_LABELS = {
    achete:   'Acheté',
    recu:     'Reçu',
    fnsku:    'FNSKU',
    expedie:  'Expédié',
    en_vente: 'En vente',
    vendu:    'Vendu',
    retire:   'Retiré'
};

// Délais max acceptables par étape (en jours)
const STAGE_DELAY_MAX = {
    achete:  14,   // > 14j sans réception → alerte
    recu:     7,   // > 7j reçu sans envoi → alerte
    fnsku:    5,   // > 5j étiquetage sans expédition → alerte
    expedie: 21,   // > 21j expédié sans arrivée FBA → alerte
};

function daysSince(ts) {
    if (!ts) return 0;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

exports.handler = async () => {
    const invStore      = getStore('oa-inventory');
    const activityStore = getStore('oa-activity');

    // ── 1. Lire l'inventaire ──────────────────────────────────────────────
    const items = await readBlob(invStore, 'items', []);

    if (!items.length) {
        console.log('[Inventory] Inventaire vide');
        const activity = await readBlob(activityStore, 'log', []);
        activity.unshift({
            ts:      Date.now(),
            agent:   'inventory',
            summary: 'Inventaire vide — aucun produit à surveiller',
            stats:   { total: 0, alerts: 0 }
        });
        await writeBlob(activityStore, 'log', activity.slice(0, 100));
        return { statusCode: 200 };
    }

    // ── 2. Stats par étape ────────────────────────────────────────────────
    const activeItems = items.filter(p => !['vendu', 'retire'].includes(p.status));
    const statsByStage = {};
    let capitalTotal = 0;

    for (const item of activeItems) {
        const s = item.status || 'achete';
        if (!statsByStage[s]) statsByStage[s] = { count: 0, capital: 0 };
        statsByStage[s].count++;
        const cost = (item.purchasePrice || 0) * (item.quantity || 1);
        statsByStage[s].capital += cost;
        capitalTotal += cost;
    }

    // ── 3. Détecter les alertes ───────────────────────────────────────────
    const alerts = [];

    for (const item of activeItems) {
        const s = item.status;
        const maxDays = STAGE_DELAY_MAX[s];
        if (!maxDays) continue;

        const refDate = s === 'achete'  ? item.dateAdded :
                        s === 'recu'    ? item.dateReceived :
                        s === 'fnsku'   ? item.dateReceived :
                        s === 'expedie' ? item.dateShipped : null;

        const days = daysSince(refDate);
        if (days >= maxDays) {
            alerts.push({
                item,
                days,
                stage: s,
                message: `<b>${item.name || item.asin || 'Produit'}</b> — bloqué en "<b>${STAGE_LABELS[s]}</b>" depuis <b>${days}j</b>`
            });
        }
    }

    // Ruptures de stock : produits en_vente avec qté ≤ 0
    const outOfStock = activeItems.filter(p => p.status === 'en_vente' && (p.quantity || 0) <= 0);
    for (const item of outOfStock) {
        alerts.push({
            item,
            stage: 'en_vente',
            message: `<b>${item.name || item.asin || 'Produit'}</b> — <b>Rupture de stock</b> FBA`
        });
    }

    console.log(`[Inventory] ${activeItems.length} produits actifs · ${alerts.length} alertes`);

    // ── 4. Telegram si alertes ────────────────────────────────────────────
    if (alerts.length) {
        const alertLines = alerts.map(a => `⚠️ ${a.message}`).join('\n');
        await sendTelegram(
            `📦 <b>Agent Inventaire — Alertes</b>\n\n` +
            alertLines + '\n\n' +
            `💰 Capital immobilisé : <b>${capitalTotal.toFixed(2)}€</b>`
        );
    }

    // ── 5. Telegram résumé quotidien ──────────────────────────────────────
    const stageLines = Object.entries(statsByStage)
        .map(([s, d]) => `  • ${STAGE_LABELS[s] || s} : ${d.count} unité(s) — ${d.capital.toFixed(2)}€`)
        .join('\n');

    await sendTelegram(
        `📦 <b>Agent Inventaire — Rapport quotidien</b>\n\n` +
        `📊 ${activeItems.length} produit(s) actif(s)\n` +
        (stageLines ? stageLines + '\n' : '') +
        `💰 Capital total : <b>${capitalTotal.toFixed(2)}€</b>\n` +
        (alerts.length ? `\n⚠️ ${alerts.length} alerte(s) détectée(s)` : '\n✅ Aucune alerte')
    );

    // ── 6. Journal d'activité ─────────────────────────────────────────────
    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      Date.now(),
        agent:   'inventory',
        summary: `${activeItems.length} produits actifs · ${alerts.length} alerte(s) · ${capitalTotal.toFixed(2)}€ immobilisé`,
        stats:   { total: activeItems.length, alerts: alerts.length, capital: +capitalTotal.toFixed(2) }
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));

    return { statusCode: 200 };
};
