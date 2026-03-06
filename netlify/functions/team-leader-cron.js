const fetch = require('node-fetch');
const { getStore } = require('@netlify/blobs');

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


exports.handler = async () => {
    const catalogStore  = getStore('oa-catalog');
    const activityStore = getStore('oa-activity');

    // ── 1. Lire toutes les données ─────────────────────────────────────────
    const [catalogProducts, retailers, dealHistory, activityLog] = await Promise.all([
        readBlob(catalogStore,  'products',     []),
        readBlob(catalogStore,  'retailers',    []),
        readBlob(catalogStore,  'deal-history', []),
        readBlob(activityStore, 'log',          []),
    ]);

    const now        = Date.now();

    // ── 2. Analyser les performances Agent Catalog ─────────────────────────
    const catalogRuns = activityLog.filter(e => e.agent === 'catalog');
    const dealRuns    = activityLog.filter(e => e.agent === 'sourcing');

    const totalScraped   = catalogRuns.reduce((s, r) => s + (r.stats?.scraped   || 0), 0);
    const totalMatched   = catalogRuns.reduce((s, r) => s + (r.stats?.matched   || 0), 0);
    const totalProfitable= catalogRuns.reduce((s, r) => s + (r.stats?.profitable|| 0), 0);
    const matchRate      = totalScraped > 0 ? Math.round(totalMatched / totalScraped * 100) : 0;

    // ── 3. Analyser les deals RSS (Agent Deal FR) ──────────────────────────
    const last30days = dealHistory.filter(d => (now - d.ts) < 30 * 86400000);
    const profitable = last30days.filter(d => d.netProfit >= 5 && d.roi >= 30);

    const retailerProfit = {};
    profitable.forEach(d => {
        const r = d.retailer || d.source || 'Inconnu';
        if (!retailerProfit[r]) retailerProfit[r] = { count: 0, totalProfit: 0 };
        retailerProfit[r].count++;
        retailerProfit[r].totalProfit += d.netProfit || 0;
    });
    const topRetailer = Object.entries(retailerProfit)
        .sort((a, b) => b[1].totalProfit - a[1].totalProfit)[0];

    // ── 4. Plan de scan hebdomadaire ───────────────────────────────────────
    // Distribuer les retailers sur la semaine pour éviter de tout scraper le même jour
    const activeRetailers = retailers.filter(r => r.active !== false);
    const weekPlan = {};
    const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    for (let d = 0; d < 7; d++) {
        weekPlan[DAY_NAMES[d]] = activeRetailers
            .filter(r => (r.days || [0,1,2,3,4,5,6]).includes(d))
            .map(r => r.name);
    }

    // Persister le plan pour les agents
    await writeBlob(catalogStore, 'week-plan', { ts: now, plan: weekPlan, updatedBy: 'team-leader' });

    // ── 5. Recommandations ────────────────────────────────────────────────
    const recommendations = [];

    // Taux de match faible
    if (matchRate < 20 && totalScraped > 50) {
        recommendations.push(
            `📉 Taux de match Amazon faible (${matchRate}%). ` +
            `Vérifier que les produits des retailers ont des EAN. Essayer des retailers avec des marques plus connues.`
        );
    }

    // Catalogue vide
    if (catalogProducts.length < 10) {
        recommendations.push(
            `📭 Catalogue faible (${catalogProducts.length} produits). ` +
            `Ajouter des retailers dans l'onglet Retailers pour alimenter le catalogue.`
        );
    } else {
        const profitableInCatalog = catalogProducts.filter(p => p.netProfit >= 5 && p.roi >= 30).length;
        recommendations.push(
            `✅ Catalogue actif : ${catalogProducts.length} produits · ${profitableInCatalog} rentables.`
        );
    }

    // Deals RSS
    if (profitable.length > 0) {
        recommendations.push(
            `⚡ ${profitable.length} deal(s) RSS rentable(s) ce mois.` +
            (topRetailer ? ` Top source : ${topRetailer[0]} (${topRetailer[1].count} deals, +${topRetailer[1].totalProfit.toFixed(0)}€).` : '')
        );
    }

    // Retailers non configurés
    if (!activeRetailers.length) {
        recommendations.push(`⚠️ Aucun retailer configuré. Allez dans l'onglet Retailers pour ajouter vos sources.`);
    } else {
        recommendations.push(`🏪 ${activeRetailers.length} retailer(s) actif(s) · Plan hebdo défini.`);
    }

    if (!recommendations.length) {
        recommendations.push('✅ Système opérationnel — aucune action requise cette semaine.');
    }

    // ── 6. Journal d'activité ──────────────────────────────────────────────
    const report = {
        ts:               now,
        catalogSize:      catalogProducts.length,
        retailers:        activeRetailers.length,
        dealsThisMonth:   last30days.length,
        profitableDeals:  profitable.length,
        matchRate,
        weekPlan,
        recommendations
    };

    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      now,
        agent:   'leader',
        summary: `Rapport hebdo · ${recommendations.length} reco(s) · ${catalogProducts.length} produits catalogue · ${activeRetailers.length} retailers`,
        stats:   { catalogSize: catalogProducts.length, dealsAnalyzed: last30days.length, profitable: profitable.length },
        report
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));
    await writeBlob(activityStore, 'last-report', report);

    // ── 7. Telegram ────────────────────────────────────────────────────────
    const planLines = Object.entries(weekPlan)
        .filter(([, rs]) => rs.length > 0)
        .map(([day, rs]) => `  ${day}: ${rs.join(', ')}`)
        .join('\n');

    const msg = `🧠 <b>Team Leader — Rapport hebdomadaire</b>\n\n` +
        `🏪 Catalogue : ${catalogProducts.length} produits · ${activeRetailers.length} retailers\n` +
        `📊 Match rate : ${matchRate}% · Deals ce mois : ${last30days.length}\n\n` +
        `<b>Plan de scan cette semaine :</b>\n${planLines || '  Aucun retailer configuré'}\n\n` +
        `<b>Recommandations :</b>\n` +
        recommendations.map(r => `• ${r}`).join('\n');

    await sendTelegram(msg);

    console.log(`[Team Leader] Rapport généré — ${recommendations.length} recommandations`);
    return { statusCode: 200 };
};
