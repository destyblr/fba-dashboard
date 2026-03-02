const fetch = require('node-fetch');
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

// === CONFIG ===
const KEEPA_DOMAINS = { de: 3, fr: 4, it: 8, es: 9 };
const RSS_SOURCES = [
    { name: 'Dealabs', baseUrl: 'https://www.dealabs.com/rss/' },
    { name: 'MyDealz', baseUrl: 'https://www.mydealz.de/rss/' },
    { name: 'Chollometro', baseUrl: 'https://www.chollometro.com/rss/' },
    { name: 'Pepper.it', baseUrl: 'https://www.pepper.it/rss/' }
];

const BLACKLIST = 'iphone,ipad,macbook,airpods,apple watch,samsung,galaxy,sony,playstation,ps5,ps4,xbox,surface,nintendo,switch,huawei,xiaomi,oppo,oneplus,dyson,nike,adidas,lego,bose,rolex,canon,nikon,gopro,televiseur,television,ordinateur portable,laptop,pc portable,smartphone,lave-linge,lave-vaisselle,refrigerateur,congelateur,micro-ondes,climatiseur,canape,matelas,pneu'.split(',');

const FEES = {
    commissionPct: 15,
    fbaFee: 3.50,
    inboundShipping: 2.00,
    prepCost: 0.25,
    urssafPct: 12.3
};

const FILTERS = {
    minPrice: 8,
    maxPrice: 100
};

const BATCH_SIZE = 5; // Deals a chercher par cycle (5 x 10 tokens = 50 max)

// === RSS FETCHING ===
async function fetchRSS(source, mode) {
    var url = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(source.baseUrl + mode);
    try {
        var resp = await fetch(url);
        var data = await resp.json();
        if (data.status === 'ok' && data.items) {
            return data.items.map(function(item) { return parseItem(item, source.name, mode); });
        }
    } catch (e) {
        console.log('[CRON] RSS ' + source.name + '/' + mode + ' erreur: ' + e.message);
    }
    return [];
}

function parseItem(item, sourceName, feedType) {
    var title = (item.title || '').replace(/\s*\d+°\s*$/, '').trim();
    var description = item.description || item.content || '';

    var tempMatch = (item.title || '').match(/(\d+)°\s*$/);
    var temperature = tempMatch ? parseInt(tempMatch[1]) : 0;

    var price = 0;
    var priceMatch = description.match(/<strong>\s*(\d+[\.,]?\d*)\s*€/i);
    if (priceMatch) price = parseFloat(priceMatch[1].replace(',', '.'));
    if (!price) {
        var genericPrice = (title + ' ' + description).match(/(\d+[\.,]\d{2})\s*€/);
        if (genericPrice) price = parseFloat(genericPrice[1].replace(',', '.'));
    }

    var merchant = '';
    var merchantMatch = description.match(/<strong>[^<]*€\s*-\s*([^<]+)<\/strong>/i);
    if (merchantMatch) merchant = merchantMatch[1].trim();

    var link = item.link || '';

    var isAmazon = /amazon\.(fr|de|it|es|co\.uk|com)/i.test(link) ||
        /amazon/i.test(merchant) ||
        /amazon\.(fr|de|it|es)/i.test(description);

    var asin = null;
    if (isAmazon) {
        var asinMatch = (link + ' ' + description).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        if (asinMatch) asin = asinMatch[1].toUpperCase();
        if (!asin) {
            var b0Match = (link + ' ' + description).match(/\b(B0[A-Z0-9]{8})\b/);
            if (b0Match) asin = b0Match[1];
        }
    }

    return {
        title: title, link: link, price: price, merchant: merchant,
        isAmazon: isAmazon, asin: asin, temperature: temperature,
        source: sourceName, feedType: feedType,
        date: item.pubDate || new Date().toISOString()
    };
}

// === BLACKLIST + PRE-FILTERS ===
function filterDeals(deals) {
    return deals.filter(function(d) {
        if (!d.title || d.price <= 0) return false;
        if (d.price < FILTERS.minPrice || d.price > FILTERS.maxPrice) return false;
        var titleLower = d.title.toLowerCase();
        for (var i = 0; i < BLACKLIST.length; i++) {
            if (titleLower.includes(BLACKLIST[i].trim())) return false;
        }
        return true;
    });
}

// === KEEPA SEARCH ===
function buildSearchTerms(title) {
    if (!title) return [];
    var terms = [];
    var base = title.replace(/\s*\d+°\s*/, '').replace(/\([^)]*\)/g, ' ').replace(/\s+[-–—]\s+/g, ' ').replace(/[|€$£%]/g, '').replace(/\d+[,.]?\d*\s*€/g, '').replace(/\s+/g, ' ').trim();

    var promoNoise = /\b(promo|offre|bon plan|deal|livraison gratuite|en stock|disponible|gratuit|soldes?|destockage|vente flash|code promo|reduction|remise|pas cher|meilleur prix)\b/gi;
    var colorWords = /\b(noir|noire|blanc|blanche|rouge|bleu|bleue|vert|verte|gris|grise|argent|or|rose|beige|violet|orange|jaune|marine|anthracite)\b/gi;
    var genericAdj = /\b(avec|pour|sans|fil|filaire|edition|version|pack|lot|kit|set|paire|neuf|occasion|reconditionne|compatible|inclus|fourni|effet|coton|100)\b/gi;

    var v2 = base.replace(promoNoise, ' ').replace(colorWords, ' ').replace(genericAdj, ' ').replace(/\s+/g, ' ').trim();
    var v2words = v2.split(' ').filter(function(w) { return w.length > 1; });
    if (v2words.length > 8) v2words = v2words.slice(0, 8);
    if (v2words.length >= 2) terms.push(v2words.join(' '));

    var v1 = base.replace(promoNoise, ' ').replace(/\s+/g, ' ').trim();
    var v1words = v1.split(' ').filter(function(w) { return w.length > 1; });
    if (v1words.length > 10) v1words = v1words.slice(0, 10);
    if (v1words.length >= 2 && v1words.join(' ') !== (terms[0] || '')) terms.push(v1words.join(' '));

    return terms;
}

async function keepaSearch(apiKey, title) {
    var terms = buildSearchTerms(title);
    if (terms.length === 0) return null;

    var attempts = [];
    if (terms[0]) { attempts.push({ term: terms[0], domain: 4 }); attempts.push({ term: terms[0], domain: 3 }); }
    if (terms[1]) attempts.push({ term: terms[1], domain: 4 });

    for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        try {
            var url = 'https://api.keepa.com/search?key=' + apiKey + '&domain=' + a.domain + '&type=product&term=' + encodeURIComponent(a.term) + '&asins-only=1&page=0';
            var resp = await fetch(url);
            var data = await resp.json();
            if (data.asinList && data.asinList.length > 0) {
                console.log('[CRON] FOUND: "' + a.term.substring(0, 25) + '" → ' + data.asinList[0] + ' (tokens=' + data.tokensLeft + ')');
                return { asin: data.asinList[0], tokensLeft: data.tokensLeft };
            }
            if (data.tokensLeft !== undefined && data.tokensLeft <= 2) {
                console.log('[CRON] Tokens bas (' + data.tokensLeft + '), arret search');
                return null;
            }
        } catch (e) { /* skip */ }
    }
    return null;
}

async function keepaBatchLookup(apiKey, asins) {
    if (asins.length === 0) return {};
    var url = 'https://api.keepa.com/product?key=' + apiKey + '&domain=4&asin=' + asins.join(',') + '&stats=180&fbafees=1';
    try {
        var resp = await fetch(url);
        if (resp.status === 429) {
            console.log('[CRON] Batch lookup 429 - plus de tokens');
            return {};
        }
        var data = await resp.json();
        if (!data.products) return {};
        var results = {};
        data.products.forEach(function(p) {
            if (!p || !p.asin) return;
            var amazonPrice = null;
            if (p.csv && p.csv[0]) {
                var priceHistory = p.csv[0];
                if (priceHistory.length >= 2) {
                    var lastPrice = priceHistory[priceHistory.length - 1];
                    if (lastPrice > 0) amazonPrice = lastPrice / 100;
                }
            }
            if (!amazonPrice && p.stats && p.stats.current) {
                var amzCurrent = p.stats.current[0];
                if (amzCurrent > 0) amazonPrice = amzCurrent / 100;
            }
            results[p.asin] = {
                price: amazonPrice,
                bsr: (p.stats && p.stats.current) ? p.stats.current[3] : null,
                fbaSellers: (p.stats && p.stats.current) ? p.stats.current[10] : null,
                fbaPickAndPack: p.fbaFees && p.fbaFees.pickAndPackFee ? p.fbaFees.pickAndPackFee / 100 : null,
                referralFeePct: p.referralFeePercent || null,
                weight: p.packageWeight || null
            };
        });
        return results;
    } catch (e) {
        console.log('[CRON] Batch lookup erreur: ' + e.message);
        return {};
    }
}

// === PROFIT CALCULATION ===
function calculateProfit(dealPrice, keepaData) {
    if (!keepaData || !keepaData.price || keepaData.price <= 0) return null;

    var sellPrice = keepaData.price;
    var commPct = (keepaData.referralFeePct || FEES.commissionPct) / 100;
    var commission = sellPrice * commPct;
    var fbaFee = keepaData.fbaPickAndPack || FEES.fbaFee;
    var inbound = FEES.inboundShipping;
    if (keepaData.weight) inbound = Math.max(0.50, (keepaData.weight / 1000) * 1.20);
    var prep = FEES.prepCost;
    var urssaf = sellPrice * (FEES.urssafPct / 100);
    var totalFees = commission + fbaFee + inbound + prep + urssaf;
    var profit = sellPrice - dealPrice - totalFees;
    var roi = dealPrice > 0 ? (profit / dealPrice) * 100 : 0;

    return { profit: Math.round(profit * 100) / 100, roi: Math.round(roi * 10) / 10, sellPrice: sellPrice };
}

// === TELEGRAM ===
async function sendTelegram(botToken, chatId, message) {
    try {
        var resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            })
        });
        var data = await resp.json();
        if (!data.ok) console.log('[CRON] Telegram erreur: ' + data.description);
        return data.ok;
    } catch (e) {
        console.log('[CRON] Telegram erreur: ' + e.message);
        return false;
    }
}

// === MAIN HANDLER ===
const handler = async (event) => {
    console.log('[CRON] Deal Scanner demarre');

    var apiKey = process.env.KEEPA_API_KEY;
    var botToken = process.env.TELEGRAM_BOT_TOKEN;
    var chatId = process.env.TELEGRAM_CHAT_ID;

    if (!apiKey || !botToken || !chatId) {
        console.log('[CRON] Variables env manquantes');
        return { statusCode: 200, body: 'Missing env vars' };
    }

    // Ouvrir les stores Blobs
    var dealStore, asinCache;
    try {
        dealStore = getStore('deal-results');
        asinCache = getStore('asin-cache');
    } catch (e) {
        console.log('[CRON] Blobs erreur: ' + e.message);
        return { statusCode: 200, body: 'Blobs error' };
    }

    // Charger le cache ASIN (titre → ASIN)
    var titleToAsin = {};
    try {
        var cacheRaw = await asinCache.get('title-map', { type: 'json' });
        if (cacheRaw) titleToAsin = cacheRaw;
        console.log('[CRON] Cache ASIN charge: ' + Object.keys(titleToAsin).length + ' titres');
    } catch (e) { /* premier lancement */ }

    // 1. Fetch tous les RSS (hot+new) en parallele
    var fetchPromises = [];
    RSS_SOURCES.forEach(function(source) {
        fetchPromises.push(fetchRSS(source, 'hot'));
        fetchPromises.push(fetchRSS(source, 'new'));
    });
    var allResults = await Promise.all(fetchPromises);

    // Fusionner + dedupliquer
    var seenLinks = {};
    var deals = [];
    allResults.forEach(function(items) {
        items.forEach(function(deal) {
            if (!seenLinks[deal.link]) {
                seenLinks[deal.link] = true;
                deals.push(deal);
            }
        });
    });
    console.log('[CRON] ' + deals.length + ' deals bruts');

    // 2. Pre-filtrer
    deals = filterDeals(deals);
    console.log('[CRON] ' + deals.length + ' deals apres filtres');

    // 3. Appliquer le cache ASIN aux deals sans ASIN
    var needSearch = [];
    deals.forEach(function(d) {
        if (!d.asin) {
            var cacheKey = d.title.substring(0, 50).toLowerCase().trim();
            if (titleToAsin[cacheKey]) {
                d.asin = titleToAsin[cacheKey];
                console.log('[CRON] Cache hit: "' + d.title.substring(0, 30) + '" → ' + d.asin);
            } else if (d.price > 0) {
                needSearch.push(d);
            }
        }
    });

    // 4. Keepa search pour deals sans ASIN — par lots de BATCH_SIZE
    needSearch.sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); });
    var searchCount = Math.min(needSearch.length, BATCH_SIZE);
    var searchedCount = 0;

    for (var i = 0; i < searchCount; i++) {
        var result = await keepaSearch(apiKey, needSearch[i].title);
        if (result) {
            needSearch[i].asin = result.asin;
            var cacheKey = needSearch[i].title.substring(0, 50).toLowerCase().trim();
            titleToAsin[cacheKey] = result.asin;
            searchedCount++;
            // Arreter si tokens bas
            if (result.tokensLeft !== undefined && result.tokensLeft <= 5) {
                console.log('[CRON] Tokens bas apres recherche, arret (' + (i + 1) + '/' + searchCount + ')');
                break;
            }
        }
    }
    console.log('[CRON] Recherches: ' + searchedCount + '/' + searchCount + ' trouves');

    // Sauvegarder le cache ASIN
    try {
        await asinCache.setJSON('title-map', titleToAsin);
    } catch (e) { console.log('[CRON] Erreur sauvegarde cache ASIN: ' + e.message); }

    // 5. Batch Keepa lookup
    var allAsins = deals.filter(function(d) { return d.asin; }).map(function(d) { return d.asin; });
    allAsins = allAsins.filter(function(a, i) { return allAsins.indexOf(a) === i; });
    console.log('[CRON] Batch lookup: ' + allAsins.length + ' ASINs');

    var keepaData = {};
    if (allAsins.length > 0) {
        keepaData = await keepaBatchLookup(apiKey, allAsins);
    }

    // 6. Calculer profit pour tous les deals avec ASIN
    deals.forEach(function(deal) {
        if (!deal.asin) return;
        var kd = keepaData[deal.asin];
        if (!kd) return;
        var result = calculateProfit(deal.price, kd);
        if (!result) return;
        deal.profit = result.profit;
        deal.roi = result.roi;
        deal.amazonPrice = result.sellPrice;
        deal.bsr = kd.bsr;
        deal.fbaSellers = kd.fbaSellers;
    });

    // 7. Stocker TOUS les deals dans Blobs (pour le navigateur)
    var dealsForBrowser = deals.map(function(d) {
        return {
            title: d.title, link: d.link, price: d.price,
            merchant: d.merchant, isAmazon: d.isAmazon,
            asin: d.asin || null, amazonPrice: d.amazonPrice || null,
            profit: d.profit || null, roi: d.roi || null,
            bsr: d.bsr || null, fbaSellers: d.fbaSellers || null,
            temperature: d.temperature, source: d.source,
            feedType: d.feedType, date: d.date
        };
    });

    try {
        await dealStore.setJSON('latest', {
            deals: dealsForBrowser,
            updatedAt: new Date().toISOString(),
            stats: {
                total: deals.length,
                withAsin: deals.filter(function(d) { return d.asin; }).length,
                profitable: deals.filter(function(d) { return d.profit > 0; }).length
            }
        });
        console.log('[CRON] ' + dealsForBrowser.length + ' deals stockes dans Blobs');
    } catch (e) {
        console.log('[CRON] Erreur stockage deals: ' + e.message);
    }

    // 8. Telegram pour deals rentables (profit > 0) pas encore notifies
    var profitableDeals = deals.filter(function(d) { return d.profit > 0; });
    var notifiedStore;
    try { notifiedStore = getStore('deal-notified'); } catch (e) { notifiedStore = null; }

    var newNotifs = 0;
    for (var j = 0; j < profitableDeals.length; j++) {
        var deal = profitableDeals[j];
        var notifKey = 'notif_' + deal.asin;
        var alreadySent = false;

        if (notifiedStore) {
            try {
                var existing = await notifiedStore.get(notifKey);
                if (existing) alreadySent = true;
            } catch (e) { /* nouveau */ }
        }

        if (!alreadySent) {
            var msg = '🔔 *Deal rentable !*\n\n' +
                '📦 ' + deal.title.substring(0, 80) + '\n' +
                '💰 ' + deal.price.toFixed(2) + '€ → Amazon: ' + deal.amazonPrice.toFixed(2) + '€\n' +
                '✅ Profit: +' + deal.profit.toFixed(2) + '€ | ROI: ' + deal.roi.toFixed(0) + '%\n' +
                (deal.bsr ? '📊 BSR: ' + deal.bsr.toLocaleString() + '\n' : '') +
                '🏪 ' + deal.source + (deal.temperature > 0 ? ' ' + deal.temperature + '°' : '') + '\n' +
                '🔗 [Deal](' + deal.link + ')' +
                (deal.asin ? ' | [Amazon](https://www.amazon.fr/dp/' + deal.asin + ')' : '');

            var sent = await sendTelegram(botToken, chatId, msg);
            if (sent && notifiedStore) {
                try {
                    await notifiedStore.set(notifKey, JSON.stringify({ asin: deal.asin, date: new Date().toISOString() }));
                } catch (e) { /* ignore */ }
            }
            newNotifs++;
            console.log('[CRON] Telegram: ' + deal.title.substring(0, 40) + ' (+' + deal.profit.toFixed(2) + '€)');
        }
    }

    console.log('[CRON] Termine: ' + deals.length + ' deals, ' + profitableDeals.length + ' rentables, ' + newNotifs + ' notifies');
    return {
        statusCode: 200,
        body: JSON.stringify({ deals: deals.length, profitable: profitableDeals.length, notified: newNotifs })
    };
};

// Executer toutes les 30 minutes
exports.handler = schedule('*/30 * * * *', handler);
