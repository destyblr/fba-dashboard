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

async function answerCallback(callbackQueryId, text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false })
    }).catch(() => {});
}

async function sendTelegram(text) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    }).catch(() => {});
}

// ─── Exécution des actions approuvées ────────────────────────────────────
async function executeDecision(decision) {
    const catalogStore = getStore('oa-catalog');
    const retailers    = await readBlob(catalogStore, 'retailers', []);

    if (decision.action === 'boost_retailer') {
        const updated = retailers.map(r =>
            r.id === decision.params.retailerId
                ? { ...r, days: [0,1,2,3,4,5,6], maxProducts: 300 }
                : r
        );
        await writeBlob(catalogStore, 'retailers', updated);
        return `✅ Retailer <b>${decision.params.retailerName}</b> boosted — scan quotidien activé.`;
    }

    if (decision.action === 'disable_retailer') {
        const updated = retailers.map(r =>
            r.id === decision.params.retailerId
                ? { ...r, active: false }
                : r
        );
        await writeBlob(catalogStore, 'retailers', updated);
        return `⛔ Retailer <b>${decision.params.retailerName}</b> désactivé.`;
    }

    if (decision.action === 'reduce_retailer') {
        const updated = retailers.map(r =>
            r.id === decision.params.retailerId
                ? { ...r, days: [1, 4], maxProducts: 100 }
                : r
        );
        await writeBlob(catalogStore, 'retailers', updated);
        return `📉 Retailer <b>${decision.params.retailerName}</b> réduit à 2j/semaine.`;
    }

    return `✅ Action "${decision.action}" effectuée.`;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 200 }; }

    // ── Callback query (bouton YES/NO appuyé) ────────────────────────────
    const cq = body.callback_query;
    if (cq) {
        const parts       = (cq.data || '').split('__');
        const answer      = parts[0];
        const decisionId  = parts[1];

        // ── Réappro inventaire (reorder_yes / reorder_no) ──────────────
        if (answer === 'reorder_yes') {
            await answerCallback(cq.id, '✅ Réappro noté !');
            await sendTelegram(`🔄 <b>Réappro confirmé</b>\n\nPense à commander le produit et à l'ajouter dans l'inventaire une fois reçu.`);
            return { statusCode: 200 };
        }
        if (answer === 'reorder_no') {
            await answerCallback(cq.id, '❌ Réappro ignoré');
            return { statusCode: 200 };
        }

        const activityStore = getStore('oa-activity');
        const pending       = await readBlob(activityStore, 'pending-decisions', []);
        const decision      = pending.find(d => d.id === decisionId);

        if (!decision) {
            await answerCallback(cq.id, 'Décision introuvable ou expirée.');
            return { statusCode: 200 };
        }

        // Marquer comme traitée
        const remaining = pending.filter(d => d.id !== decisionId);
        await writeBlob(activityStore, 'pending-decisions', remaining);

        if (answer === 'yes') {
            const result = await executeDecision(decision);
            await answerCallback(cq.id, 'Approuvé ✅');
            await sendTelegram(`🧠 <b>Team Leader — Décision approuvée</b>\n\n${result}`);
        } else {
            await answerCallback(cq.id, 'Refusé ❌');
            await sendTelegram(`🧠 <b>Team Leader — Décision refusée</b>\n\nOK, noté pour : <i>${decision.label}</i>`);
        }

        return { statusCode: 200 };
    }

    return { statusCode: 200 };
};
