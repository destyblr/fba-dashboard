/**
 * Agent Inventaire — tourne tous les jours à 8h UTC
 *
 * MODE ACTUEL   : lit l'inventaire depuis Netlify Blobs (sync depuis localStorage)
 * MODE SP-API   : dès que SP_CLIENT_ID + SP_CLIENT_SECRET + SP_REFRESH_TOKEN sont
 *                 configurés dans Netlify → utilise automatiquement les vraies données FBA
 *
 * Fonctions :
 *   - Alertes délais (produit bloqué trop longtemps dans une étape)
 *   - Ruptures de stock FBA
 *   - Calcul capital immobilisé par étape
 *   - Recommandations de réappro (stock < seuil)
 *   - Vélocité de vente (SP-API uniquement)
 *   - Jours de stock restants (SP-API uniquement)
 */

const fetch = require('node-fetch');
const { getStore: _getStore } = require('@netlify/blobs');

// ─── SP-API Helper (activé automatiquement si variables configurées) ─────
let spapi = null;
try { spapi = require('./spapi-helper'); } catch {}

function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}
async function readBlob(store, key, fallback) {
    try { return (await store.get(key, { type: 'json' })) ?? fallback; }
    catch { return fallback; }
}
async function writeBlob(store, key, data) { await store.setJSON(key, data); }

async function sendTelegram(msg, replyMarkup) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const payload = { chat_id: chatId, text: msg, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(() => {});
}

function makeYesNo(id) {
    return { inline_keyboard: [[
        { text: '✅ Oui, commander', callback_data: `reorder_yes__${id}` },
        { text: '❌ Non',            callback_data: `reorder_no__${id}`  }
    ]]};
}

const STAGE_LABELS = {
    achete: 'Acheté', recu: 'Reçu', fnsku: 'FNSKU',
    expedie: 'Expédié', en_vente: 'En vente', vendu: 'Vendu', retire: 'Retiré'
};
const STAGE_DELAY_MAX = { achete: 14, recu: 7, fnsku: 5, expedie: 21 };

function daysSince(ts) {
    if (!ts) return 0;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

// ─── Normalise un item SP-API vers le format interne ─────────────────────
function normalizeSPAPIItem(item) {
    return {
        asin:          item.asin,
        name:          item.title,
        status:        'en_vente',
        quantity:      item.available,
        inbound:       item.inbound,
        reserved:      item.reserved,
        purchasePrice: null,   // non disponible via SP-API inventaire
        _source:       'spapi'
    };
}

exports.handler = async () => {
    const invStore      = getStore('oa-inventory');
    const activityStore = getStore('oa-activity');
    const usingSPAPI    = spapi && spapi.isSPAPIAvailable();

    console.log(`[Inventory] Mode : ${usingSPAPI ? '🟢 SP-API' : '🟡 localStorage (Blobs)'}`);

    // ── 1. Charger l'inventaire ───────────────────────────────────────────
    let items = [];
    let fbaLive = [];    // données FBA temps réel (SP-API uniquement)
    let salesVelocity = {};

    if (usingSPAPI) {
        // ── SP-API : stock FBA réel ─────────────────────────────────────
        try {
            fbaLive = await spapi.getFBAInventory();
            console.log(`[Inventory] SP-API → ${fbaLive.length} ASINs en FBA`);
            items = fbaLive.map(normalizeSPAPIItem);

            // Vélocité de vente (unités/jour sur 30j)
            const sales = await spapi.getSalesVelocity();
            if (sales.length) {
                const totalUnits = sales.reduce((s, d) => s + (d.unitCount || 0), 0);
                salesVelocity._global = +(totalUnits / 30).toFixed(1);
            }
        } catch (e) {
            console.error('[Inventory] SP-API erreur:', e.message);
            items = await readBlob(invStore, 'items', []);
        }
    } else {
        // ── Fallback : inventaire localStorage syncé dans Blobs ─────────
        items = await readBlob(invStore, 'items', []);
    }

    if (!items.length) {
        console.log('[Inventory] Inventaire vide');
        const activity = await readBlob(activityStore, 'log', []);
        activity.unshift({ ts: Date.now(), agent: 'inventory',
            summary: 'Inventaire vide — aucun produit à surveiller',
            stats: { total: 0, alerts: 0, reorders: 0 } });
        await writeBlob(activityStore, 'log', activity.slice(0, 100));
        return { statusCode: 200 };
    }

    const activeItems = items.filter(p => !['vendu', 'retire'].includes(p.status));

    // ── 2. Stats par étape ────────────────────────────────────────────────
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

    // ── 3. Alertes délais pipeline ────────────────────────────────────────
    const alerts = [];
    for (const item of activeItems) {
        const maxDays = STAGE_DELAY_MAX[item.status];
        if (!maxDays) continue;
        const refDate = item.status === 'achete'  ? item.dateAdded :
                        item.status === 'expedie' ? item.dateShipped :
                        item.dateReceived;
        const days = daysSince(refDate);
        if (days >= maxDays) {
            alerts.push({ type: 'delay', item, days,
                msg: `⚠️ <b>${item.name || item.asin}</b> bloqué en "<b>${STAGE_LABELS[item.status]}</b>" depuis <b>${days}j</b>` });
        }
    }

    // ── 4. Ruptures de stock FBA ──────────────────────────────────────────
    const enVente = activeItems.filter(p => p.status === 'en_vente');
    for (const item of enVente) {
        if ((item.quantity || 0) <= 0) {
            alerts.push({ type: 'stockout', item,
                msg: `🚨 <b>${item.name || item.asin}</b> — <b>Rupture de stock FBA</b>` });
        }
    }

    // ── 5. Recommandations de réappro ────────────────────────────────────
    const reorders = [];
    const REORDER_THRESHOLD = 3; // unités
    const REORDER_DAYS_THRESHOLD = 14; // jours de stock restants

    for (const item of enVente) {
        const qty = item.quantity || 0;
        if (qty > REORDER_THRESHOLD) continue;

        // Calculer les jours de stock restants si vélocité connue
        const velocity = salesVelocity[item.asin] || salesVelocity._global || null;
        const daysLeft  = velocity && velocity > 0 ? Math.floor(qty / velocity) : null;

        if (qty <= REORDER_THRESHOLD || (daysLeft !== null && daysLeft <= REORDER_DAYS_THRESHOLD)) {
            const id = Math.random().toString(36).slice(2, 8);
            reorders.push({ id, item, qty, daysLeft,
                msg: `📦 <b>${item.name || item.asin}</b>\n` +
                     `   Stock actuel : <b>${qty} unité(s)</b>` +
                     (daysLeft !== null ? ` · ~${daysLeft}j restants` : '') +
                     (item.inbound ? ` · ${item.inbound} en cours d'envoi` : '') +
                     `\nCommander un réappro ?`
            });
        }
    }

    console.log(`[Inventory] ${activeItems.length} actifs · ${alerts.length} alertes · ${reorders.length} réappros`);

    // ── 6. Telegram alertes ───────────────────────────────────────────────
    if (alerts.length) {
        const alertLines = alerts.map(a => a.msg).join('\n');
        await sendTelegram(
            `📦 <b>Agent Inventaire — Alertes</b>\n\n` +
            alertLines + '\n\n' +
            `💰 Capital immobilisé : <b>${capitalTotal.toFixed(2)}€</b>` +
            (usingSPAPI ? '\n<i>🟢 Données SP-API temps réel</i>' : '')
        );
    }

    // ── 7. Telegram réappros (avec boutons YES/NO) ────────────────────────
    for (const r of reorders) {
        await sendTelegram(
            `🔄 <b>Agent Inventaire — Réapprovisionnement</b>\n\n` + r.msg,
            makeYesNo(r.id)
        );
        await new Promise(res => setTimeout(res, 400));
    }

    // ── 8. Telegram résumé quotidien ──────────────────────────────────────
    const stageLines = Object.entries(statsByStage)
        .filter(([s]) => !['vendu','retire'].includes(s))
        .map(([s, d]) => `  • ${STAGE_LABELS[s] || s} : ${d.count} unité(s)` +
             (d.capital > 0 ? ` — ${d.capital.toFixed(2)}€` : ''))
        .join('\n');

    await sendTelegram(
        `📦 <b>Agent Inventaire — Rapport quotidien</b>\n\n` +
        (usingSPAPI ? `🟢 Connecté à Seller Central\n` : `🟡 Mode manuel (SP-API non connectée)\n`) +
        `\n📊 ${activeItems.length} produit(s) actif(s)\n` +
        (stageLines ? stageLines + '\n' : '') +
        `💰 Capital total : <b>${capitalTotal.toFixed(2)}€</b>\n` +
        (alerts.length ? `\n⚠️ ${alerts.length} alerte(s)` : '\n✅ Aucune alerte') +
        (reorders.length ? `\n🔄 ${reorders.length} réappro(s) suggéré(s)` : '')
    );

    // ── 9. Journal ────────────────────────────────────────────────────────
    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      Date.now(),
        agent:   'inventory',
        summary: `${activeItems.length} produits actifs · ${alerts.length} alerte(s) · ${reorders.length} réappro(s) · ${capitalTotal.toFixed(2)}€`,
        stats:   { total: activeItems.length, alerts: alerts.length, reorders: reorders.length, capital: +capitalTotal.toFixed(2) },
        spapi:   usingSPAPI
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));

    return { statusCode: 200 };
};
