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

const PRESET_NAMES = {
    1:'Jouets premium', 2:'Électronique accessible', 3:'Sports & Loisirs',
    4:'Beauté & Santé', 5:'Bébé & Enfant', 6:'Cuisine & Maison',
    7:'Informatique', 8:'Animalerie', 9:'Bricolage & Outils', 10:'FR→DE'
};

exports.handler = async () => {
    const portfolioStore = getStore('oa-portfolio');
    const activityStore  = getStore('oa-activity');

    // ── 1. Lire toutes les données ────────────────────────────────────────
    const [portfolio, queue, blacklist, settings, dealHistory, activityLog] = await Promise.all([
        readBlob(portfolioStore, 'portfolio',    []),
        readBlob(portfolioStore, 'queue',        []),
        readBlob(portfolioStore, 'blacklist',    []),
        readBlob(portfolioStore, 'settings',     { activePreset: 1, page: 0 }),
        readBlob(portfolioStore, 'deal-history', []),
        readBlob(activityStore,  'log',          []),
    ]);

    // ── 2. Analyser les performances par preset ────────────────────────────
    const prospectionRuns = activityLog.filter(e => e.agent === 'prospection');
    const sourcingRuns    = activityLog.filter(e => e.agent === 'sourcing');

    // Stats par preset
    const presetStats = {};
    prospectionRuns.forEach(run => {
        const id = parseInt((run.preset || '').match(/^#(\d+)/)?.[1]) || 0;
        if (!id) return;
        if (!presetStats[id]) presetStats[id] = { eligible: 0, gated: 0, pending: 0, runs: 0 };
        presetStats[id].eligible += run.stats?.eligible || 0;
        presetStats[id].gated    += run.stats?.gated    || 0;
        presetStats[id].pending  += run.stats?.pending  || 0;
        presetStats[id].runs++;
    });

    // Preset le plus performant (ratio eligible/total)
    let bestPreset = settings.activePreset;
    let bestRatio  = -1;
    Object.entries(presetStats).forEach(([id, s]) => {
        const total = s.eligible + s.gated + s.pending;
        const ratio = total > 0 ? s.eligible / total : 0;
        if (ratio > bestRatio) { bestRatio = ratio; bestPreset = parseInt(id); }
    });

    // ── 3. Analyser les deals ──────────────────────────────────────────────
    const now         = Date.now();
    const last30days  = dealHistory.filter(d => (now - d.ts) < 30 * 86400000);
    const profitable  = last30days.filter(d => d.netProfit >= 5 && d.roi >= 35);

    // Marques les plus rentables
    const brandProfit = {};
    profitable.forEach(d => {
        if (!brandProfit[d.brand]) brandProfit[d.brand] = { count: 0, totalProfit: 0 };
        brandProfit[d.brand].count++;
        brandProfit[d.brand].totalProfit += d.netProfit;
    });
    const topBrands = Object.entries(brandProfit)
        .sort((a, b) => b[1].totalProfit - a[1].totalProfit)
        .slice(0, 3);

    // ── 4. Générer les recommandations ────────────────────────────────────
    const recommendations = [];

    // Recommandation preset
    if (bestPreset !== settings.activePreset && presetStats[bestPreset]?.runs >= 2) {
        recommendations.push(
            `🔄 Changer de preset : #${bestPreset} "${PRESET_NAMES[bestPreset]}" génère ` +
            `${Math.round(bestRatio * 100)}% d'éligibles vs preset actuel #${settings.activePreset}`
        );
        // Appliquer automatiquement la recommandation
        settings.activePreset = bestPreset;
        settings.page = 0;
        await writeBlob(portfolioStore, 'settings', settings);
    }

    // Portefeuille trop petit
    if (portfolio.length < 5 && queue.length > 0) {
        recommendations.push(
            `⚠️ Portefeuille faible (${portfolio.length} marques). ` +
            `${queue.length} en attente SP-API — brancher SP-API Production pour les valider.`
        );
    }

    // Beaucoup de gated → changer catégorie
    const totalGated    = Object.values(presetStats).reduce((s, p) => s + p.gated, 0);
    const totalEligible = Object.values(presetStats).reduce((s, p) => s + p.eligible, 0);
    if (totalGated > totalEligible * 2 && totalGated > 10) {
        recommendations.push(
            `📛 Taux de gating élevé (${totalGated} gated vs ${totalEligible} éligibles). ` +
            `Essayer Cuisine & Maison ou Animalerie (moins de marques protégées).`
        );
    }

    // Bonne performance
    if (profitable.length > 0) {
        recommendations.push(
            `✅ ${profitable.length} deal(s) rentable(s) ce mois. ` +
            (topBrands.length ? `Top marque : ${topBrands[0][0]} (${topBrands[0][1].count} deals, +${topBrands[0][1].totalProfit.toFixed(0)}€).` : '')
        );
    }

    if (!recommendations.length) {
        recommendations.push('✅ Système opérationnel — aucune action requise cette semaine.');
    }

    // ── 5. Journal d'activité ─────────────────────────────────────────────
    const report = {
        ts:              now,
        portfolioSize:   portfolio.length,
        queueSize:       queue.length,
        blacklistSize:   blacklist.length,
        dealsThisMonth:  last30days.length,
        profitableDeals: profitable.length,
        activePreset:    settings.activePreset,
        recommendations
    };

    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      now,
        agent:   'leader',
        summary: `Rapport mensuel · ${recommendations.length} recommandation(s) · preset actif: #${settings.activePreset}`,
        stats:   { portfolioSize: portfolio.length, dealsAnalyzed: last30days.length, profitable: profitable.length },
        report
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));
    await writeBlob(activityStore, 'last-report', report);

    // ── 6. Telegram ───────────────────────────────────────────────────────
    const msg = `🧠 <b>Team Leader — Rapport hebdomadaire</b>\n\n` +
        `📂 Portefeuille : ${portfolio.length} validées · ${queue.length} en attente · ${blacklist.length} gated\n` +
        `📊 Deals ce mois : ${last30days.length} analysés · ${profitable.length} rentables\n` +
        `🎯 Preset actif : #${settings.activePreset} ${PRESET_NAMES[settings.activePreset]}\n\n` +
        `<b>Recommandations :</b>\n` +
        recommendations.map(r => `• ${r}`).join('\n');

    await sendTelegram(msg);

    console.log(`[Team Leader] Rapport généré — ${recommendations.length} recommandations`);
    return { statusCode: 200 };
};
