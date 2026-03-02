const fetch = require('node-fetch');
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

// === CONFIG ===
const RSS_SOURCES = [
    { name: 'Dealabs', baseUrl: 'https://www.dealabs.com/rss/', domain: 4 },
    { name: 'MyDealz', baseUrl: 'https://www.mydealz.de/rss/', domain: 3 },
    { name: 'Chollometro', baseUrl: 'https://www.chollometro.com/rss/', domain: 9 },
    { name: 'Pepper.it', baseUrl: 'https://www.pepper.it/rss/', domain: 8 }
];
const SOURCE_DOMAINS = { 'Dealabs': 4, 'MyDealz': 3, 'Chollometro': 9, 'Pepper.it': 8 };
const DOMAIN_NAMES = { 3: 'amazon.de', 4: 'amazon.fr', 8: 'amazon.it', 9: 'amazon.es' };

const BLACKLIST = 'iphone,ipad,macbook,airpods,apple watch,samsung,galaxy,sony,playstation,ps5,ps4,xbox,surface,nintendo,switch,huawei,xiaomi,oppo,oneplus,dyson,nike,adidas,lego,bose,rolex,canon,nikon,gopro,televiseur,television,ordinateur portable,laptop,pc portable,smartphone,lave-linge,lave-vaisselle,refrigerateur,congelateur,micro-ondes,climatiseur,canape,matelas,pneu'.split(',');

const FEES = {
    commissionPct: 15,
    fbaFee: 3.50,
    inboundShipping: 2.00,
    prepCost: 0.25,
    urssafPct: 12.3
};

const FILTERS = { minPrice: 5, maxPrice: 200 };
const SEARCH_BATCH = 3;       // Nouvelles recherches ASIN par cycle (3 x 10 = 30 tokens)
const PRICE_REFRESH_NEW = 5;  // Max ASINs sans prix a checker (5 tokens)
const PRICE_REFRESH_STALE = 15; // Max ASINs avec prix perime a rafraichir (15 tokens)
const DEAL_EXPIRY_H = 24;     // Expiration des deals en heures
const PRICE_STALE_H = 2;      // Prix considere perime apres X heures
const ASIN_CACHE_EXPIRY_DAYS = 14; // Expiration cache titre→ASIN

// === RSS FETCHING ===
async function fetchRSS(source, mode) {
    try {
        var resp = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(source.baseUrl + mode));
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
        id: link, // identifiant unique
        title: title, link: link, price: price, merchant: merchant,
        isAmazon: isAmazon, asin: asin, temperature: temperature,
        source: sourceName, feedType: feedType,
        firstSeen: new Date().toISOString(),
        date: item.pubDate || new Date().toISOString()
    };
}

// === FILTERS ===
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

async function keepaSearch(apiKey, title, sourceDomain) {
    var terms = buildSearchTerms(title);
    if (terms.length === 0) return null;
    var domain = sourceDomain || 4; // domaine Amazon selon la source du deal

    // Max 2 tentatives : titre nettoye, puis titre large (meme domaine)
    var attempts = [];
    if (terms[0]) attempts.push(terms[0]);
    if (terms[1]) attempts.push(terms[1]);

    for (var i = 0; i < attempts.length; i++) {
        try {
            var resp = await fetch('https://api.keepa.com/search?key=' + apiKey + '&domain=' + domain + '&type=product&term=' + encodeURIComponent(attempts[i]) + '&asins-only=1&page=0');
            var data = await resp.json();
            if (data.asinList && data.asinList.length > 0) {
                console.log('[CRON] FOUND: "' + attempts[i].substring(0, 25) + '" → ' + data.asinList[0] + ' (dom=' + domain + ', tokens=' + data.tokensLeft + ')');
                return { asin: data.asinList[0], tokensLeft: data.tokensLeft };
            }
            if (data.tokensLeft !== undefined && data.tokensLeft <= 2) {
                console.log('[CRON] Tokens bas (' + data.tokensLeft + '), arret');
                return null;
            }
        } catch (e) { /* skip */ }
    }
    return null;
}

function parseKeepaProduct(p) {
    if (!p || !p.asin) return null;
    var amazonPrice = null;
    if (p.csv && p.csv[0]) {
        var ph = p.csv[0];
        if (ph.length >= 2 && ph[ph.length - 1] > 0) amazonPrice = ph[ph.length - 1] / 100;
    }
    if (!amazonPrice && p.stats && p.stats.current) {
        var c = p.stats.current[0];
        if (c > 0) amazonPrice = c / 100;
    }
    return {
        price: amazonPrice,
        bsr: (p.stats && p.stats.current) ? p.stats.current[3] : null,
        fbaSellers: (p.stats && p.stats.current) ? p.stats.current[10] : null,
        fbaPickAndPack: p.fbaFees && p.fbaFees.pickAndPackFee ? p.fbaFees.pickAndPackFee / 100 : null,
        referralFeePct: p.referralFeePercent || null,
        weight: p.packageWeight || null,
        checkedAt: new Date().toISOString()
    };
}

async function keepaBatchLookup(apiKey, asinsByDomain) {
    // asinsByDomain = { 4: ['B0...', 'B0...'], 3: ['B0...'] }
    var allResults = {};
    var domains = Object.keys(asinsByDomain);
    for (var d = 0; d < domains.length; d++) {
        var domain = domains[d];
        var asins = asinsByDomain[domain];
        if (asins.length === 0) continue;

        // Decouper en paquets de 10
        for (var start = 0; start < asins.length; start += 10) {
            var chunk = asins.slice(start, start + 10);
            try {
                var resp = await fetch('https://api.keepa.com/product?key=' + apiKey + '&domain=' + domain + '&asin=' + chunk.join(',') + '&stats=180&fbafees=1');
                if (resp.status === 429) {
                    console.log('[CRON] Batch 429 dom=' + domain + ' - arret');
                    return allResults; // retourne ce qu'on a deja
                }
                var data = await resp.json();
                if (data.products) {
                    data.products.forEach(function(p) {
                        var parsed = parseKeepaProduct(p);
                        if (parsed) allResults[p.asin] = parsed;
                    });
                }
                console.log('[CRON] Batch dom=' + domain + ': ' + chunk.length + ' ASINs (tokens=' + (data.tokensLeft || '?') + ')');
            } catch (e) {
                console.log('[CRON] Batch erreur dom=' + domain + ': ' + e.message);
            }
        }
    }
    return allResults;
}

// === PROFIT ===
function calculateProfit(dealPrice, keepaData) {
    if (!keepaData || !keepaData.price || keepaData.price <= 0) return null;
    var sellPrice = keepaData.price;
    var commPct = (keepaData.referralFeePct || FEES.commissionPct) / 100;
    var fbaFee = keepaData.fbaPickAndPack || FEES.fbaFee;
    var inbound = FEES.inboundShipping;
    if (keepaData.weight) inbound = Math.max(0.50, (keepaData.weight / 1000) * 1.20);
    var totalFees = (sellPrice * commPct) + fbaFee + inbound + FEES.prepCost + (sellPrice * FEES.urssafPct / 100);
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
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown', disable_web_page_preview: true })
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
    console.log('[CRON] === Deal Scanner demarre ===');
    var apiKey = process.env.KEEPA_API_KEY;
    var botToken = process.env.TELEGRAM_BOT_TOKEN;
    var chatId = process.env.TELEGRAM_CHAT_ID;

    if (!apiKey || !botToken || !chatId) {
        console.log('[CRON] Variables env manquantes');
        return { statusCode: 200, body: 'Missing env vars' };
    }

    var dealStore, asinCache, notifiedStore;
    try {
        dealStore = getStore('deal-results');
        asinCache = getStore('asin-cache');
        notifiedStore = getStore('deal-notified');
    } catch (e) {
        console.log('[CRON] Blobs erreur: ' + e.message);
        return { statusCode: 200, body: 'Blobs error' };
    }

    var now = Date.now();

    // === 1. Charger les deals accumules ===
    var accumulated = {};
    try {
        var raw = await dealStore.get('accumulated', { type: 'json' });
        if (raw) accumulated = raw;
        console.log('[CRON] Deals accumules: ' + Object.keys(accumulated).length);
    } catch (e) { /* premier lancement */ }

    // Expirer les deals > 24h
    var expiredCount = 0;
    Object.keys(accumulated).forEach(function(key) {
        var deal = accumulated[key];
        if (now - new Date(deal.firstSeen).getTime() > DEAL_EXPIRY_H * 3600000) {
            delete accumulated[key];
            expiredCount++;
        }
    });
    if (expiredCount > 0) console.log('[CRON] ' + expiredCount + ' deals expires');

    // === 2. Charger le cache ASIN (titre → {asin, date}) et expirer ===
    var titleToAsin = {};
    try {
        var cacheRaw = await asinCache.get('title-map', { type: 'json' });
        if (cacheRaw) {
            var expiryCutoff = now - ASIN_CACHE_EXPIRY_DAYS * 86400000;
            var expiredCache = 0;
            Object.keys(cacheRaw).forEach(function(key) {
                var entry = cacheRaw[key];
                // Migration : ancien format string → nouveau format {asin, date}
                if (typeof entry === 'string') {
                    titleToAsin[key] = { asin: entry, date: new Date().toISOString() };
                } else if (entry.date && new Date(entry.date).getTime() > expiryCutoff) {
                    titleToAsin[key] = entry;
                } else {
                    expiredCache++;
                }
            });
            if (expiredCache > 0) console.log('[CRON] Cache ASIN: ' + expiredCache + ' entrees expirees');
        }
        console.log('[CRON] Cache ASIN: ' + Object.keys(titleToAsin).length + ' titres');
    } catch (e) { /* premier lancement */ }

    // === 3. Fetch RSS (hot+new, 4 sources) ===
    var fetchPromises = [];
    RSS_SOURCES.forEach(function(source) {
        fetchPromises.push(fetchRSS(source, 'hot'));
        fetchPromises.push(fetchRSS(source, 'new'));
    });
    var allResults = await Promise.all(fetchPromises);

    var seenLinks = {};
    var freshDeals = [];
    allResults.forEach(function(items) {
        items.forEach(function(deal) {
            if (!seenLinks[deal.link]) {
                seenLinks[deal.link] = true;
                freshDeals.push(deal);
            }
        });
    });
    console.log('[CRON] RSS: ' + freshDeals.length + ' deals bruts');

    freshDeals = filterDeals(freshDeals);
    console.log('[CRON] RSS: ' + freshDeals.length + ' apres filtres');

    // === 4. Fusionner avec accumules (ajouter les nouveaux, garder les anciens) ===
    var newCount = 0;
    freshDeals.forEach(function(deal) {
        var key = deal.link;
        if (!accumulated[key]) {
            // Nouveau deal
            accumulated[key] = deal;
            newCount++;
        } else {
            // Mettre a jour temperature + feedType (le deal existe deja)
            accumulated[key].temperature = Math.max(accumulated[key].temperature || 0, deal.temperature || 0);
            if (deal.feedType === 'hot' && accumulated[key].feedType !== 'hot') {
                accumulated[key].feedType = 'hot';
            }
        }
    });
    console.log('[CRON] Nouveaux: ' + newCount + ' | Total accumule: ' + Object.keys(accumulated).length);

    // === 5. Appliquer cache ASIN + chercher nouveaux ASINs ===
    var needSearch = [];
    Object.values(accumulated).forEach(function(d) {
        if (!d.asin) {
            var cacheKey = d.title.substring(0, 50).toLowerCase().trim();
            if (titleToAsin[cacheKey]) {
                d.asin = titleToAsin[cacheKey].asin || titleToAsin[cacheKey];
            } else if (d.price > 0) {
                needSearch.push(d);
            }
        }
    });

    // Trier par temperature (les plus populaires en premier pour les recherches)
    needSearch.sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); });
    var searchCount = Math.min(needSearch.length, SEARCH_BATCH);
    var searched = 0;

    for (var i = 0; i < searchCount; i++) {
        var dealDomain = SOURCE_DOMAINS[needSearch[i].source] || 4;
        var result = await keepaSearch(apiKey, needSearch[i].title, dealDomain);
        if (result) {
            needSearch[i].asin = result.asin;
            titleToAsin[needSearch[i].title.substring(0, 50).toLowerCase().trim()] = { asin: result.asin, date: new Date().toISOString() };
            searched++;
            if (result.tokensLeft !== undefined && result.tokensLeft <= 5) {
                console.log('[CRON] Tokens bas, arret recherche (' + (i + 1) + '/' + searchCount + ')');
                break;
            }
        }
    }
    console.log('[CRON] Recherches ASIN: ' + searched + '/' + searchCount);

    // Sauvegarder cache ASIN
    try { await asinCache.setJSON('title-map', titleToAsin); } catch (e) {}

    // === 6. Rafraichir les prix Amazon (2 groupes separes) ===
    var allDeals = Object.values(accumulated);
    var dealsWithAsin = allDeals.filter(function(d) { return d.asin; });

    // Groupe A : deals SANS prix (jamais checkes) — max PRICE_REFRESH_NEW
    var noPriceDeals = dealsWithAsin.filter(function(d) { return !d.amazonPrice && !d.priceCheckedAt; });
    noPriceDeals.sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); });

    // Groupe B : deals avec prix PERIME (> 2h) — max PRICE_REFRESH_STALE, rentables d'abord
    var staleDeals = dealsWithAsin.filter(function(d) {
        return d.priceCheckedAt && (now - new Date(d.priceCheckedAt).getTime() > PRICE_STALE_H * 3600000);
    });
    staleDeals.sort(function(a, b) {
        // Rentables d'abord (on veut garder leurs prix frais)
        var aProfit = (a.profit && a.profit > 0) ? 1 : 0;
        var bProfit = (b.profit && b.profit > 0) ? 1 : 0;
        if (aProfit !== bProfit) return bProfit - aProfit;
        return (b.temperature || 0) - (a.temperature || 0);
    });

    // Fusionner les 2 groupes avec limites separees, groupes par domaine
    var asinsByDomain = {};
    var seenAsins = {};
    var noPriceCount = 0;
    function addAsinForDeal(deal) {
        var dom = SOURCE_DOMAINS[deal.source] || 4;
        if (!asinsByDomain[dom]) asinsByDomain[dom] = [];
        if (!seenAsins[deal.asin]) {
            seenAsins[deal.asin] = true;
            asinsByDomain[dom].push(deal.asin);
            return true;
        }
        return false;
    }
    for (var j = 0; j < noPriceDeals.length && noPriceCount < PRICE_REFRESH_NEW; j++) {
        if (addAsinForDeal(noPriceDeals[j])) noPriceCount++;
    }
    var staleCount = 0;
    for (var j2 = 0; j2 < staleDeals.length && staleCount < PRICE_REFRESH_STALE; j2++) {
        if (addAsinForDeal(staleDeals[j2])) staleCount++;
    }
    var totalRefresh = noPriceCount + staleCount;
    console.log('[CRON] Prix a rafraichir: ' + noPriceCount + ' nouveaux + ' + staleCount + ' perimes = ' + totalRefresh + ' ASINs');

    var keepaData = {};
    if (totalRefresh > 0) {
        keepaData = await keepaBatchLookup(apiKey, asinsByDomain);
    }

    // === 7. Calculer profit pour tous les deals ===
    var profitableCount = 0;
    allDeals.forEach(function(deal) {
        if (!deal.asin) return;
        var kd = keepaData[deal.asin];
        if (kd) {
            // Prix frais
            deal.amazonPrice = kd.price;
            deal.bsr = kd.bsr;
            deal.fbaSellers = kd.fbaSellers;
            deal.keepaData = kd;
            deal.priceCheckedAt = kd.checkedAt;
        }
        // Recalculer profit (meme avec ancien prix)
        if (deal.amazonPrice && deal.price > 0) {
            var fakeKd = deal.keepaData || { price: deal.amazonPrice };
            var result = calculateProfit(deal.price, fakeKd);
            if (result) {
                deal.profit = result.profit;
                deal.roi = result.roi;
                if (result.profit > 0) profitableCount++;
            }
        }
    });

    // === 8. Stocker dans Blobs — trie par ROI ===
    allDeals.sort(function(a, b) {
        var roiA = (a.roi !== null && a.roi !== undefined) ? a.roi : -999;
        var roiB = (b.roi !== null && b.roi !== undefined) ? b.roi : -999;
        return roiB - roiA;
    });

    var dealsForBrowser = allDeals.map(function(d) {
        return {
            title: d.title, link: d.link, price: d.price,
            merchant: d.merchant, isAmazon: d.isAmazon,
            asin: d.asin || null,
            amazonPrice: (d.amazonPrice !== undefined && d.amazonPrice !== null) ? d.amazonPrice : null,
            profit: (d.profit !== undefined && d.profit !== null) ? d.profit : null,
            roi: (d.roi !== undefined && d.roi !== null) ? d.roi : null,
            bsr: d.bsr || null, fbaSellers: d.fbaSellers || null,
            temperature: d.temperature, source: d.source,
            feedType: d.feedType, date: d.date,
            firstSeen: d.firstSeen, priceCheckedAt: d.priceCheckedAt || null
        };
    });

    try {
        // Sauvegarder les deals accumules (pour le prochain cycle)
        await dealStore.setJSON('accumulated', accumulated);
        // Sauvegarder la version pour le navigateur (triee par ROI)
        await dealStore.setJSON('latest', {
            deals: dealsForBrowser,
            updatedAt: new Date().toISOString(),
            stats: {
                total: allDeals.length,
                withAsin: allDeals.filter(function(d) { return d.asin; }).length,
                profitable: profitableCount,
                pendingSearch: needSearch.length - searched,
                expired: expiredCount
            }
        });
        console.log('[CRON] Stocke: ' + allDeals.length + ' deals (' + profitableCount + ' rentables)');
    } catch (e) {
        console.log('[CRON] Erreur stockage: ' + e.message);
    }

    // === 9. Telegram pour NOUVEAUX deals rentables ===
    var newNotifs = 0;
    var profitable = allDeals.filter(function(d) { return d.profit > 0; });

    for (var k = 0; k < profitable.length; k++) {
        var deal = profitable[k];
        var notifKey = 'notif_' + deal.asin;
        var alreadySent = false;

        try {
            var existing = await notifiedStore.get(notifKey);
            if (existing) {
                // TTL 7 jours : re-notifier si > 7j (deal revenu en promo)
                var notifData = JSON.parse(existing);
                if (notifData.date && (now - new Date(notifData.date).getTime() < 7 * 86400000)) {
                    alreadySent = true;
                }
            }
        } catch (e) { /* nouveau */ }

        if (!alreadySent && deal.price && deal.amazonPrice && deal.profit !== null && deal.roi !== null) {
            var dealDomainName = DOMAIN_NAMES[SOURCE_DOMAINS[deal.source] || 4] || 'amazon.fr';
            var msg = '🔔 *Deal rentable !*\n\n' +
                '📦 ' + deal.title.substring(0, 80) + '\n' +
                '💰 ' + Number(deal.price).toFixed(2) + '€ → Amazon: ' + Number(deal.amazonPrice).toFixed(2) + '€\n' +
                '✅ Profit: +' + Number(deal.profit).toFixed(2) + '€ | ROI: ' + Number(deal.roi).toFixed(0) + '%\n' +
                (deal.bsr ? '📊 BSR: ' + Number(deal.bsr).toLocaleString() + '\n' : '') +
                '🏪 ' + deal.source + (deal.temperature > 0 ? ' ' + deal.temperature + '°' : '') + '\n' +
                '🔗 [Deal](' + deal.link + ')' +
                (deal.asin ? ' | [Amazon](https://www.' + dealDomainName + '/dp/' + deal.asin + ')' : '');

            var sent = await sendTelegram(botToken, chatId, msg);
            if (sent) {
                try { await notifiedStore.set(notifKey, JSON.stringify({ asin: deal.asin, date: new Date().toISOString() })); } catch (e) {}
                newNotifs++;
                console.log('[CRON] Telegram: ' + deal.title.substring(0, 40) + ' (+' + Number(deal.profit).toFixed(2) + '€, ROI ' + Number(deal.roi).toFixed(0) + '%)');
            }
        }
    }

    console.log('[CRON] === Termine: ' + allDeals.length + ' deals, ' + profitableCount + ' rentables, ' + newNotifs + ' notifies ===');
    return {
        statusCode: 200,
        body: JSON.stringify({ total: allDeals.length, profitable: profitableCount, notified: newNotifs })
    };
};

exports.handler = schedule('*/30 * * * *', handler);
