const fetch = require('node-fetch');
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

// === CONFIG (memes valeurs que deal-scanner-cron) ===
const FEES = { commissionPct: 15, fbaFee: 3.50, inboundShipping: 2.00, prepCost: 0.25, urssafPct: 12.3 };
const EFN_SURCHARGE = 3.50;
const MIN_TOKENS = 10;
const MAX_TELEGRAM = 2;
const MAX_LOOKUPS = 15; // Max lookups par cycle (leger)

const SOURCE_DOMAINS = { 'Dealabs': 4 };
const DOMAIN_NAMES = { 4: 'amazon.fr' };

const GATED_CATEGORIES = [
    'epicerie','grocery','gourmet','lebensmittel','alimentari','alimentacion',
    'beaute','beauty','parfum','kosmetik','bellezza',
    'hygiene','sante','health','gesundheit','salute','salud',
    'vetement','clothing','shoes','chaussure','bijou','jewelry','schmuck','bekleidung','mode',
    'accessoires mode',
    'auto','automotive','moto','fahrzeug','kfz',
    'montre','watches','uhren','orologi',
    'vin','wine','wein','biere','alcool','spiritueux',
    'fine art','collectible','sammler'
];

// === HELPERS ===
function elapsed(start) { return ((Date.now() - start) / 1000).toFixed(1) + 's'; }

function openStore(name) {
    try { return getStore(name); } catch (e) {
        if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN)
            return getStore({ name: name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
        throw e;
    }
}

function getSellStatus(keepaData) {
    if (!keepaData) return null;
    var cat = (keepaData.categoryName || '').toLowerCase();
    if (cat) {
        for (var i = 0; i < GATED_CATEGORIES.length; i++) {
            if (cat.indexOf(GATED_CATEGORIES[i]) !== -1) {
                return { status: 'gated', reason: keepaData.categoryName };
            }
        }
    }
    // Amazon vendeur direct — filtre
    if (keepaData.amazonSells) {
        return { status: 'amazon_sells', reason: 'Amazon vendeur direct' };
    }

    // 0 vendeur FBA — filtre
    var fbaSellers = keepaData.fbaSellers;
    if (!fbaSellers || fbaSellers <= 0) {
        return { status: 'no_fba', reason: '0 vendeur FBA' };
    }

    // Trop de vendeurs (>30) — filtre
    var offerCount = keepaData.newOfferCount;
    if (offerCount && offerCount > 30) {
        return { status: 'too_competitive', reason: offerCount + ' vendeurs (>30)' };
    }

    // Info supplementaire pour le reason
    var sellerInfo = fbaSellers + ' FBA';
    if (offerCount) sellerInfo += ', ' + offerCount + ' total';
    var monthlySoldInfo = keepaData.monthlySold ? ', ~' + keepaData.monthlySold + ' ventes/mois' : '';

    // Categorie ouverte + vendeurs FBA
    var bsr = keepaData.bsr;
    if (bsr && bsr > 0) {
        return { status: 'ok', reason: sellerInfo + monthlySoldInfo + ', BSR ' + bsr };
    }
    return { status: 'check', reason: sellerInfo + monthlySoldInfo + ', pas de BSR' };
}

function calculateProfit(dealPrice, kd, efnSurcharge) {
    var sell = kd && (kd.buyBoxPrice || kd.price);
    if (!sell || sell <= 0) return null;
    var comm = sell * ((kd.referralFeePct || FEES.commissionPct) / 100);
    var fba = kd.fbaPickAndPack || FEES.fbaFee;
    var inbound = kd.weight ? Math.max(0.50, (kd.weight / 1000) * 1.20) : FEES.inboundShipping;
    var efn = efnSurcharge || 0;
    var total = comm + fba + inbound + FEES.prepCost + (sell * FEES.urssafPct / 100) + efn;
    var profit = sell - dealPrice - total;
    var roi = dealPrice > 0 ? (profit / dealPrice) * 100 : 0;
    return { profit: Math.round(profit * 100) / 100, roi: Math.round(roi * 10) / 10 };
}

async function keepaLookupOne(apiKey, asin, domain) {
    try {
        var resp = await fetch('https://api.keepa.com/product?key=' + apiKey + '&domain=' + domain + '&asin=' + asin + '&stats=180&fbafees=1');
        if (resp.status === 429) { console.log('[LOOKUP] 429: ' + asin); return { data: null, tokensLeft: 0 }; }
        var json = await resp.json();
        var tokensLeft = json.tokensLeft !== undefined ? json.tokensLeft : -1;
        if (json.products && json.products[0]) {
            var p = json.products[0];
            var amazonPrice = null;
            var priceIsAvg = false;
            var amazonSells = false;
            if (p.csv && p.csv[0]) { var ph = p.csv[0]; if (ph.length >= 2 && ph[ph.length - 1] > 0) { amazonPrice = ph[ph.length - 1] / 100; amazonSells = true; } }
            if (!amazonPrice && p.stats && p.stats.current && p.stats.current[0] > 0) { amazonPrice = p.stats.current[0] / 100; amazonSells = true; }
            if (!amazonPrice && p.stats && p.stats.avg && p.stats.avg[0] > 0) { amazonPrice = p.stats.avg[0] / 100; priceIsAvg = true; }
            if (!amazonPrice && p.stats && p.stats.avg180 && p.stats.avg180[0] > 0) { amazonPrice = p.stats.avg180[0] / 100; priceIsAvg = true; }
            var catName = null;
            if (p.categoryTree && p.categoryTree.length > 0) catName = p.categoryTree[0].name || null;
            // Buy Box price (index 18)
            var buyBoxPrice = null;
            if (p.stats && p.stats.current && p.stats.current[18] > 0) {
                buyBoxPrice = p.stats.current[18] / 100;
            }
            // New offer count = total vendeurs (index 7)
            var newOfferCount = (p.stats && p.stats.current && p.stats.current[7] > 0) ? p.stats.current[7] : null;
            // Monthly sold
            var monthlySold = p.monthlySold || null;
            return {
                data: {
                    price: amazonPrice, priceIsAvg: priceIsAvg,
                    buyBoxPrice: buyBoxPrice,
                    newOfferCount: newOfferCount,
                    monthlySold: monthlySold,
                    bsr: (p.stats && p.stats.current) ? p.stats.current[3] : null,
                    fbaSellers: (p.stats && p.stats.current) ? p.stats.current[10] : null,
                    fbaPickAndPack: p.fbaFees && p.fbaFees.pickAndPackFee ? p.fbaFees.pickAndPackFee / 100 : null,
                    referralFeePct: p.referralFeePercent || null,
                    weight: p.packageWeight || null,
                    amazonSells: amazonSells,
                    rootCategory: p.rootCategory || null,
                    categoryName: catName
                },
                tokensLeft: tokensLeft
            };
        }
        return { data: null, tokensLeft: tokensLeft };
    } catch (e) { console.log('[LOOKUP] Erreur ' + asin + ': ' + e.message); return { data: null, tokensLeft: -1 }; }
}

async function sendTelegram(botToken, chatId, msg) {
    try {
        var r = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown', disable_web_page_preview: true })
        });
        var d = await r.json(); return d.ok;
    } catch (e) { return false; }
}

// === MAIN ===
const handler = async () => {
    var T = Date.now();
    console.log('[LOOKUP] === Start ===');

    var apiKey = process.env.KEEPA_API_KEY;
    var botToken = process.env.TELEGRAM_BOT_TOKEN;
    var chatId = process.env.TELEGRAM_CHAT_ID;
    if (!apiKey || !botToken || !chatId) { console.log('[LOOKUP] Env manquantes'); return { statusCode: 200, body: 'no env' }; }

    var dealStore, notifiedStore;
    try {
        dealStore = openStore('deal-results');
        notifiedStore = openStore('deal-notified');
    } catch (e) { console.log('[LOOKUP] Blobs: ' + e.message); return { statusCode: 200, body: 'blobs error' }; }

    // Charger les deals accumules
    var accumulated;
    try {
        accumulated = await dealStore.get('accumulated', { type: 'json' });
    } catch (e) { accumulated = null; }
    if (!accumulated) { console.log('[LOOKUP] Aucun deal en base'); return { statusCode: 200, body: 'no deals' }; }

    // Trouver les deals avec ASIN mais sans prix (en attente de lookup)
    var pending = Object.values(accumulated).filter(function(d) {
        return d.asin && !d.priceCheckedAt;
    }).sort(function(a, b) {
        return (b.temperature || 0) - (a.temperature || 0);
    });

    if (pending.length === 0) {
        console.log('[LOOKUP] Aucun deal en attente | ' + elapsed(T));
        return { statusCode: 200, body: 'nothing to do' };
    }

    console.log('[LOOKUP] ' + pending.length + ' deals en attente de lookup');

    // Verifier tokens disponibles
    var lastTokens = 999;
    try {
        var tokenResp = await fetch('https://api.keepa.com/token?key=' + apiKey);
        var tokenData = await tokenResp.json();
        if (tokenData.tokensLeft !== undefined) lastTokens = tokenData.tokensLeft;
    } catch (e) {}
    console.log('[LOOKUP] Tokens au depart: ' + lastTokens);

    if (lastTokens <= MIN_TOKENS) {
        console.log('[LOOKUP] Pas assez de tokens (' + lastTokens + ') | ' + elapsed(T));
        return { statusCode: 200, body: 'no tokens' };
    }

    // Phase 1 : Lookups prix
    var processed = 0;
    var profitableCount = 0;
    var pendingNotifs = [];
    var now = Date.now();

    for (var i = 0; i < Math.min(pending.length, MAX_LOOKUPS); i++) {
        if (lastTokens <= MIN_TOKENS) { console.log('[LOOKUP] STOP: tokens=' + lastTokens); break; }

        var deal = pending[i];
        var dom = SOURCE_DOMAINS[deal.source] || 4;
        var result = await keepaLookupOne(apiKey, deal.asin, dom);

        if (result.tokensLeft !== undefined && result.tokensLeft >= 0) lastTokens = result.tokensLeft;

        if (result.data) {
            deal.amazonPrice = result.data.buyBoxPrice || result.data.price;
            deal.priceIsAvg = result.data.priceIsAvg || false;
            deal.buyBoxPrice = result.data.buyBoxPrice || null;
            deal.newOfferCount = result.data.newOfferCount || null;
            deal.monthlySold = result.data.monthlySold || null;
            deal.bsr = result.data.bsr;
            deal.fbaSellers = result.data.fbaSellers;
            deal.keepaData = result.data;
            deal.categoryName = result.data.categoryName || null;
            deal.priceCheckedAt = new Date().toISOString();

            var ss = getSellStatus(result.data);
            deal.sellStatus = ss ? ss.status : null;
            deal.sellReason = ss ? ss.reason : null;

            if (deal.sellStatus === 'gated' || deal.sellStatus === 'amazon_sells' || deal.sellStatus === 'no_fba' || deal.sellStatus === 'too_competitive') {
                console.log('[LOOKUP]   ' + deal.asin + ': ' + deal.sellStatus.toUpperCase() + ' (' + (deal.sellReason || '') + ') — skip | tokens=' + lastTokens);
                processed++;
                continue;
            }

            if (deal.amazonPrice && deal.price > 0) {
                var r = calculateProfit(deal.price, result.data);
                if (r) {
                    deal.profit = r.profit;
                    deal.roi = r.roi;
                    if (r.profit > 0) profitableCount++;
                }
            }
            processed++;
            console.log('[LOOKUP]   ' + deal.asin + ': ' + (deal.amazonPrice ? deal.amazonPrice.toFixed(2) + '€' : 'N/A') + (deal.profit ? ' profit=' + deal.profit.toFixed(2) + '€' : '') + ' [' + (deal.sellStatus || '?') + '] (tokens=' + lastTokens + ')');

            if (deal.profit > 0 && deal.amazonPrice > 0) {
                pendingNotifs.push(deal);
            }
        }
    }
    console.log('[LOOKUP] Phase 1 done: ' + processed + ' traites, ' + profitableCount + ' rentables | ' + elapsed(T));

    // Phase 4 mini : Multi-MKT pour les deals rentables sans multiMarket
    var needMultiMkt = Object.values(accumulated).filter(function(d) {
        return d.asin && d.profit > 0 && !d.multiMarket && d.sellStatus !== 'gated';
    });
    var multiProcessed = 0;

    for (var mi = 0; mi < needMultiMkt.length; mi++) {
        if (lastTokens <= MIN_TOKENS + 3) { console.log('[LOOKUP] Multi-MKT STOP: tokens=' + lastTokens); break; }
        var md = needMultiMkt[mi];
        var markets = {};
        var bestMarket = null;
        var bestProfit = -Infinity;

        var frData = md.keepaData;
        if (frData && frData.price > 0) {
            var frCalc = calculateProfit(md.price, frData);
            markets['fr'] = { price: frData.price, profit: frCalc ? frCalc.profit : 0, roi: frCalc ? frCalc.roi : 0 };
            if (frCalc && frCalc.profit > bestProfit) { bestProfit = frCalc.profit; bestMarket = 'fr'; }
        }

        var otherDomains = [3, 8, 9];
        var domainKeys = { 3: 'de', 8: 'it', 9: 'es' };
        for (var mdi = 0; mdi < otherDomains.length; mdi++) {
            if (lastTokens <= MIN_TOKENS) break;
            var domId = otherDomains[mdi];
            var mktKey = domainKeys[domId];
            var mktResult = await keepaLookupOne(apiKey, md.asin, domId);
            if (mktResult.tokensLeft !== undefined && mktResult.tokensLeft >= 0) lastTokens = mktResult.tokensLeft;
            if (mktResult.data && mktResult.data.price > 0) {
                var mktCalc = calculateProfit(md.price, mktResult.data, EFN_SURCHARGE);
                markets[mktKey] = { price: mktResult.data.price, profit: mktCalc ? mktCalc.profit : 0, roi: mktCalc ? mktCalc.roi : 0 };
                if (mktCalc && mktCalc.profit > bestProfit) { bestProfit = mktCalc.profit; bestMarket = mktKey; }
            } else {
                markets[mktKey] = { price: 0, profit: 0, roi: 0 };
            }
        }

        md.multiMarket = { best: bestMarket, markets: markets };
        multiProcessed++;
        console.log('[LOOKUP]   Multi ' + md.asin + ': best=' + (bestMarket || '?').toUpperCase() + ' (' + bestProfit.toFixed(2) + '€) | tokens=' + lastTokens);
    }
    if (multiProcessed > 0) console.log('[LOOKUP] Multi-MKT: ' + multiProcessed + ' traites | ' + elapsed(T));

    // Telegram pour les deals rentables (avec Best MKT si dispo)
    var newNotifs = 0;
    for (var ni = 0; ni < pendingNotifs.length && newNotifs < MAX_TELEGRAM; ni++) {
        var nd = pendingNotifs[ni];
        var nk = 'notif_' + nd.asin;
        var skipNotif = false;
        try {
            var exNotif = await notifiedStore.get(nk);
            if (exNotif) { var parsed = JSON.parse(exNotif); if (parsed.date && (now - new Date(parsed.date).getTime() < 7 * 86400000)) skipNotif = true; }
        } catch (e) {}
        if (skipNotif) continue;

        var nDom = SOURCE_DOMAINS[nd.source] || 4;
        var nDomName = DOMAIN_NAMES[nDom] || 'amazon.fr';
        var bestMktLine = '';
        if (nd.multiMarket && nd.multiMarket.best) {
            var mktFlags = { fr: '\u{1F1EB}\u{1F1F7}', de: '\u{1F1E9}\u{1F1EA}', it: '\u{1F1EE}\u{1F1F9}', es: '\u{1F1EA}\u{1F1F8}' };
            var bm = nd.multiMarket.best;
            var bmData = nd.multiMarket.markets[bm];
            if (bmData) {
                bestMktLine = '\n\u{1F3C6} Best: ' + (mktFlags[bm] || '') + ' ' + bm.toUpperCase() + ' (+' + bmData.profit.toFixed(2) + '\u20AC, ' + bmData.roi.toFixed(0) + '%)';
                if (bm !== 'fr') bestMktLine += ' _(EFN -' + EFN_SURCHARGE.toFixed(2) + '\u20AC inclus)_';
            }
        }

        var tgMsg = '\u{1F514} *Deal rentable !*\n\n\u{1F4E6} ' + nd.title.substring(0, 80) +
            '\n\u{1F4B0} ' + Number(nd.price).toFixed(2) + '\u20AC \u2192 Amazon: ' + Number(nd.amazonPrice).toFixed(2) + '\u20AC' +
            '\n\u2705 Profit: +' + Number(nd.profit).toFixed(2) + '\u20AC | ROI: ' + Number(nd.roi).toFixed(0) + '%' +
            bestMktLine +
            (nd.bsr ? '\n\u{1F4CA} BSR: ' + Number(nd.bsr).toLocaleString() : '') +
            (nd.newOfferCount ? ' | \u{1F465} ' + nd.newOfferCount + ' vendeurs' : '') +
            (nd.monthlySold ? ' | \u{1F4E6} ~' + nd.monthlySold + ' ventes/mois' : '') +
            '\n\u{1F3EA} ' + nd.source + (nd.temperature > 0 ? ' ' + nd.temperature + '\u00B0' : '') +
            '\n\u{1F517} [Deal](' + nd.link + ')' + (nd.asin ? ' | [Amazon](https://www.' + nDomName + '/dp/' + nd.asin + ')' : '');
        var tgSent = await sendTelegram(botToken, chatId, tgMsg);
        if (tgSent) {
            try { await notifiedStore.set(nk, JSON.stringify({ asin: nd.asin, date: new Date().toISOString() })); } catch (e) {}
            newNotifs++;
        }
    }
    if (newNotifs > 0) console.log('[LOOKUP] Telegram: ' + newNotifs + ' notifs | ' + elapsed(T));

    // Sauvegarder les deals mis a jour
    if (processed > 0 || multiProcessed > 0) {
        try {
            // Mettre a jour le blob accumulated
            await dealStore.set('accumulated', JSON.stringify(accumulated));

            // Regenerer latest pour le browser
            var allDeals = Object.values(accumulated);
            allDeals.sort(function(a, b) {
                var ra = (a.roi !== null && a.roi !== undefined) ? a.roi : -999;
                var rb = (b.roi !== null && b.roi !== undefined) ? b.roi : -999;
                return rb - ra;
            });

            var dealsForBrowser = allDeals.map(function(d) {
                return {
                    title: d.title, link: d.link, price: d.price, merchant: d.merchant, isAmazon: d.isAmazon,
                    asin: d.asin || null,
                    amazonPrice: (d.amazonPrice !== undefined && d.amazonPrice !== null) ? d.amazonPrice : null,
                    profit: (d.profit !== undefined && d.profit !== null) ? d.profit : null,
                    roi: (d.roi !== undefined && d.roi !== null) ? d.roi : null,
                    priceIsAvg: d.priceIsAvg || false,
                    searchStatus: d.searchStatus || null,
                    multiMarket: d.multiMarket || null,
                    buyBoxPrice: d.buyBoxPrice || null,
                    newOfferCount: d.newOfferCount || null,
                    monthlySold: d.monthlySold || null,
                    bsr: d.bsr || null, fbaSellers: d.fbaSellers || null,
                    sellStatus: d.sellStatus || null, sellReason: d.sellReason || null,
                    categoryName: d.categoryName || null,
                    temperature: d.temperature, source: d.source, date: d.date,
                    firstSeen: d.firstSeen, scanHour: d.scanHour || null,
                    priceCheckedAt: d.priceCheckedAt || null
                };
            });

            var profitCount = dealsForBrowser.filter(function(d) { return d.profit > 0; }).length;
            var asinCount = dealsForBrowser.filter(function(d) { return d.asin; }).length;
            var latest = {
                deals: dealsForBrowser,
                updatedAt: new Date().toISOString(),
                stats: { total: dealsForBrowser.length, withAsin: asinCount, profitable: profitCount }
            };
            await dealStore.set('latest', JSON.stringify(latest));
            console.log('[LOOKUP] Saved: ' + dealsForBrowser.length + ' deals | ' + elapsed(T));
        } catch (e) {
            console.log('[LOOKUP] Save erreur: ' + e.message);
        }
    }

    console.log('[LOOKUP] === Done: ' + processed + ' lookups, ' + multiProcessed + ' multi-MKT, ' + newNotifs + ' notifs | ' + elapsed(T) + ' ===');
    return { statusCode: 200, body: 'ok' };
};

// Toutes les 15 min SAUF a l'heure pile (le cron principal tourne a :00)
exports.handler = schedule('15,30,45 * * * *', handler);
