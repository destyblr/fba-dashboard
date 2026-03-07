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

function makeYesNo(decisionId) {
    return {
        inline_keyboard: [[
            { text: '✅ Oui', callback_data: `yes__${decisionId}` },
            { text: '❌ Non', callback_data: `no__${decisionId}` }
        ]]
    };
}

function genId() {
    return Math.random().toString(36).slice(2, 10);
}

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

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

exports.handler = async () => {
    const catalogStore  = getStore('oa-catalog');
    const activityStore = getStore('oa-activity');
    const SITE_URL      = process.env.URL || 'https://fba-dashboard.netlify.app';

    // ── 1. Lire toutes les données ─────────────────────────────────────────
    const [catalogProducts, retailers, dealHistory, activityLog] = await Promise.all([
        readBlob(catalogStore,  'products',     []),
        readBlob(catalogStore,  'retailers',    []),
        readBlob(catalogStore,  'deal-history', []),
        readBlob(activityStore, 'log',          []),
    ]);

    const now = Date.now();

    // ── 2. Initialiser les retailers si vide (premier lancement) ──────────
    let updatedRetailers = retailers.length ? [...retailers] : [...DEFAULT_RETAILERS];
    const isFirstRun     = retailers.length === 0;
    if (isFirstRun) {
        await writeBlob(catalogStore, 'retailers', updatedRetailers);
        console.log('[Team Leader] Premier run — retailers initialisés avec les defaults');
    }

    // ── 3. Analyser les performances par retailer ─────────────────────────
    const profitByRetailer = {};
    const matchByRetailer  = {};
    catalogProducts.forEach(p => {
        if (!p.retailer) return;
        if (!matchByRetailer[p.retailer]) matchByRetailer[p.retailer] = { total: 0, matched: 0, profitable: 0 };
        matchByRetailer[p.retailer].total++;
        if (p.asin) matchByRetailer[p.retailer].matched++;
        if (p.netProfit >= 5 && p.roi >= 30) matchByRetailer[p.retailer].profitable++;
    });
    dealHistory.filter(d => (now - d.ts) < 30 * 86400000).forEach(d => {
        const r = d.retailer || 'Inconnu';
        if (!profitByRetailer[r]) profitByRetailer[r] = { count: 0, total: 0 };
        profitByRetailer[r].count++;
        profitByRetailer[r].total += d.netProfit || 0;
    });

    // ── 4. Générer les décisions stratégiques (à soumettre au user) ───────
    const pendingDecisions = [];

    for (const r of updatedRetailers) {
        const perf      = matchByRetailer[r.name] || { total: 0, matched: 0, profitable: 0 };
        const profit    = profitByRetailer[r.name] || { count: 0, total: 0 };
        const matchRate = perf.total > 0 ? perf.matched / perf.total : 0;
        if (perf.total === 0) continue;

        // Retailer très performant → proposer boost
        if ((profit.count >= 3 || perf.profitable >= 5) && (r.days || []).length < 7) {
            pendingDecisions.push({
                id:     genId(),
                action: 'boost_retailer',
                label:  `Booster ${r.name} (scan quotidien)`,
                reason: `${perf.profitable} produits rentables trouvés`,
                params: { retailerId: r.id, retailerName: r.name }
            });
        }
        // Retailer très faible → proposer désactivation
        else if (matchRate < 0.05 && perf.total >= 80 && r.active !== false) {
            pendingDecisions.push({
                id:     genId(),
                action: 'disable_retailer',
                label:  `Désactiver ${r.name} (très faible match)`,
                reason: `Seulement ${Math.round(matchRate * 100)}% de match rate sur ${perf.total} produits`,
                params: { retailerId: r.id, retailerName: r.name }
            });
        }
        // Retailer sous-performant → proposer réduction
        else if (matchRate < 0.10 && perf.total >= 50 && (r.days || []).length > 2) {
            pendingDecisions.push({
                id:     genId(),
                action: 'reduce_retailer',
                label:  `Réduire ${r.name} à 2j/semaine`,
                reason: `Match rate faible (${Math.round(matchRate * 100)}%) sur ${perf.total} produits`,
                params: { retailerId: r.id, retailerName: r.name }
            });
        }
    }

    // Sauvegarder les décisions en attente
    const existingPending = await readBlob(activityStore, 'pending-decisions', []);
    const allPending = [...pendingDecisions, ...existingPending].slice(0, 20);
    await writeBlob(activityStore, 'pending-decisions', allPending);

    await writeBlob(catalogStore, 'retailers', updatedRetailers);

    // ── 5. Plan hebdo pour affichage ──────────────────────────────────────
    const activeRetailers = updatedRetailers.filter(r => r.active !== false);
    const weekPlan = {};
    for (let d = 0; d < 7; d++) {
        weekPlan[DAY_NAMES[d]] = activeRetailers
            .filter(r => (r.days || []).includes(d))
            .map(r => r.name);
    }
    await writeBlob(catalogStore, 'week-plan', { ts: now, plan: weekPlan, updatedBy: 'team-leader' });

    // ── 6. Stats globales ─────────────────────────────────────────────────
    const catalogRuns  = activityLog.filter(e => e.agent === 'catalog');
    const totalScraped = catalogRuns.reduce((s, r) => s + (r.stats?.scraped || 0), 0);
    const totalMatched = catalogRuns.reduce((s, r) => s + (r.stats?.matched || 0), 0);
    const matchRate    = totalScraped > 0 ? Math.round(totalMatched / totalScraped * 100) : 0;

    const last30days   = dealHistory.filter(d => (now - d.ts) < 30 * 86400000);
    const profitable   = last30days.filter(d => d.netProfit >= 5 && d.roi >= 30);
    const topRetailer  = Object.entries(profitByRetailer).sort((a, b) => b[1].total - a[1].total)[0];

    // ── 7. Recommandations ────────────────────────────────────────────────
    const recommendations = [];

    if (isFirstRun) {
        recommendations.push(`🚀 Premier lancement — ${updatedRetailers.length} retailers configurés automatiquement. L'Agent Catalog va commencer à scraper à la prochaine heure.`);
    }

    const profitableInCatalog = catalogProducts.filter(p => p.netProfit >= 5 && p.roi >= 30).length;
    if (catalogProducts.length === 0) {
        recommendations.push(`📭 Catalogue vide — Agent Catalog n'a pas encore tourné. Prochain run à la prochaine heure.`);
    } else {
        recommendations.push(`✅ Catalogue : ${catalogProducts.length} produits · ${profitableInCatalog} rentables · match rate ${matchRate}%.`);
    }

    if (profitable.length > 0) {
        recommendations.push(`⚡ ${profitable.length} deal(s) RSS rentable(s) ce mois.` +
            (topRetailer ? ` Top : ${topRetailer[0]} (+${topRetailer[1].total.toFixed(0)}€).` : ''));
    }

    // Retailers ajustés
    const boosted  = updatedRetailers.filter(r => (r.days || []).length === 7);
    const reduced  = updatedRetailers.filter(r => (r.days || []).length <= 2 && (matchByRetailer[r.name]?.total || 0) >= 50);
    if (boosted.length)  recommendations.push(`📈 Retailers boostés (scan quotidien) : ${boosted.map(r => r.name).join(', ')}.`);
    if (reduced.length)  recommendations.push(`📉 Retailers réduits (faible match) : ${reduced.map(r => r.name).join(', ')}.`);

    if (matchRate < 15 && totalScraped > 100) {
        recommendations.push(`⚠️ Match rate global faible (${matchRate}%). Les produits des retailers ont peu d'EAN. Envisager d'autres sources.`);
    }

    if (!recommendations.length) {
        recommendations.push('✅ Système opérationnel — aucun ajustement nécessaire cette semaine.');
    }

    // ── 8. Journal d'activité ──────────────────────────────────────────────
    const report = {
        ts:              now,
        catalogSize:     catalogProducts.length,
        retailers:       activeRetailers.length,
        dealsThisMonth:  last30days.length,
        profitableDeals: profitable.length,
        matchRate,
        weekPlan,
        recommendations,
        adjustments:     { boosted: boosted.map(r => r.name), reduced: reduced.map(r => r.name) }
    };

    const activity = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:      now,
        agent:   'leader',
        summary: `Rapport hebdo · ${catalogProducts.length} produits · ${activeRetailers.length} retailers · ${profitableInCatalog} rentables`,
        stats:   { catalogSize: catalogProducts.length, dealsAnalyzed: last30days.length, profitable: profitable.length },
        report
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100));
    await writeBlob(activityStore, 'last-report', report);

    // ── 9. Telegram — résumé global ───────────────────────────────────────
    const planLines = Object.entries(weekPlan)
        .filter(([, rs]) => rs.length > 0)
        .map(([day, rs]) => `  ${day}: ${rs.join(', ')}`)
        .join('\n');

    const summary = `🧠 <b>Team Leader — Rapport hebdomadaire</b>\n\n` +
        `🏪 ${activeRetailers.length} retailers · ${catalogProducts.length} produits catalogue\n` +
        `📊 Match rate : ${matchRate}% · ${profitable.length} deals rentables ce mois\n\n` +
        `<b>Plan de scan :</b>\n${planLines || '  En attente du premier run'}\n\n` +
        `<b>Analyse :</b>\n` +
        recommendations.map(r => `• ${r}`).join('\n') +
        (pendingDecisions.length ? `\n\n⚡ <b>${pendingDecisions.length} décision(s) en attente de ta validation</b>` : '');

    await sendTelegram(summary);

    // ── 10. Envoyer chaque décision avec boutons YES/NO ────────────────────
    for (const decision of pendingDecisions) {
        const msg = `🧠 <b>Team Leader — Décision stratégique</b>\n\n` +
            `📋 <b>${decision.label}</b>\n` +
            `💡 Raison : ${decision.reason}\n\n` +
            `Approuves-tu cette action ?`;
        await sendTelegram(msg, makeYesNo(decision.id));
        // Petit délai pour éviter le flood Telegram
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Team Leader] Rapport généré — ${recommendations.length} reco · ${pendingDecisions.length} décisions soumises`);
    return { statusCode: 200 };
};
