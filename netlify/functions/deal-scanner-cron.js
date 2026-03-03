const fetch = require('node-fetch');
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

// === CONFIG ===
const RSS_SOURCES = [
    { name: 'Dealabs', url: 'https://www.dealabs.com/rss/hot', domain: 4 },
    { name: 'MyDealz', url: 'https://www.mydealz.de/rss/hot', domain: 3 },
    { name: 'Chollometro', url: 'https://www.chollometro.com/rss/hot', domain: 9 },
    { name: 'Pepper.it', url: 'https://www.pepper.it/rss/hot', domain: 8 }
];
const SOURCE_DOMAINS = { 'Dealabs': 4, 'MyDealz': 3, 'Chollometro': 9, 'Pepper.it': 8 };
const DOMAIN_NAMES = { 3: 'amazon.de', 4: 'amazon.fr', 8: 'amazon.it', 9: 'amazon.es' };

const BLACKLIST = 'iphone,ipad,macbook,airpods,apple watch,samsung,galaxy,sony,playstation,ps5,ps4,xbox,surface,nintendo,switch,huawei,xiaomi,oppo,oneplus,dyson,nike,adidas,lego,bose,rolex,canon,nikon,gopro,televiseur,television,ordinateur portable,laptop,pc portable,smartphone,lave-linge,lave-vaisselle,refrigerateur,congelateur,micro-ondes,climatiseur,canape,matelas,pneu'.split(',');

const FEES = { commissionPct: 15, fbaFee: 3.50, inboundShipping: 2.00, prepCost: 0.25, urssafPct: 12.3 };
const FILTERS = { minPrice: 5, maxPrice: 200 };
const SEARCH_BATCH = 2;
const PRICE_REFRESH = 10;
const DEAL_EXPIRY_H = 24;
const MAX_TELEGRAM = 3;

// === HELPERS ===
function elapsed(start) { return ((Date.now() - start) / 1000).toFixed(1) + 's'; }

function openStore(name) {
    try { return getStore(name); } catch (e) {
        if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN)
            return getStore({ name: name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
        throw e;
    }
}

// === RSS ===
async function fetchRSS(source) {
    try {
        var resp = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(source.url), { timeout: 4000 });
        var data = await resp.json();
        if (data.status === 'ok' && data.items) return data.items.map(function(item) { return parseItem(item, source.name); });
    } catch (e) {}
    return [];
}

function parseItem(item, sourceName) {
    var title = (item.title || '').replace(/\s*\d+°\s*$/, '').trim();
    var desc = item.description || item.content || '';
    var tempMatch = (item.title || '').match(/(\d+)°\s*$/);
    var temperature = tempMatch ? parseInt(tempMatch[1]) : 0;
    var price = 0;
    var pm = desc.match(/<strong>\s*(\d+[\.,]?\d*)\s*€/i);
    if (pm) price = parseFloat(pm[1].replace(',', '.'));
    if (!price) { var gp = (title + ' ' + desc).match(/(\d+[\.,]\d{2})\s*€/); if (gp) price = parseFloat(gp[1].replace(',', '.')); }
    var merchant = '';
    var mm = desc.match(/<strong>[^<]*€\s*-\s*([^<]+)<\/strong>/i);
    if (mm) merchant = mm[1].trim();
    var link = item.link || '';
    var isAmazon = /amazon\.(fr|de|it|es|co\.uk|com)/i.test(link) || /amazon/i.test(merchant) || /amazon\.(fr|de|it|es)/i.test(desc);
    var asin = null;
    if (isAmazon) {
        var am = (link + ' ' + desc).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        if (am) asin = am[1].toUpperCase();
        if (!asin) { var bm = (link + ' ' + desc).match(/\b(B0[A-Z0-9]{8})\b/); if (bm) asin = bm[1]; }
    }
    return { title: title, link: link, price: price, merchant: merchant, isAmazon: isAmazon, asin: asin, temperature: temperature, source: sourceName, date: item.pubDate || new Date().toISOString(), firstSeen: new Date().toISOString() };
}

function filterDeals(deals) {
    return deals.filter(function(d) {
        if (!d.title || d.price <= 0 || d.price < FILTERS.minPrice || d.price > FILTERS.maxPrice) return false;
        var t = d.title.toLowerCase();
        for (var i = 0; i < BLACKLIST.length; i++) { if (t.includes(BLACKLIST[i].trim())) return false; }
        return true;
    });
}

// === KEEPA ===
function buildSearchTerm(title) {
    if (!title) return null;
    var base = title.replace(/\s*\d+°\s*/, '').replace(/\([^)]*\)/g, ' ').replace(/\s+[-–—]\s+/g, ' ').replace(/[|€$£%]/g, '').replace(/\d+[,.]?\d*\s*€/g, '').replace(/\s+/g, ' ').trim();
    var noise = /\b(promo|offre|bon plan|deal|livraison gratuite|en stock|disponible|gratuit|soldes?|destockage|vente flash|code promo|reduction|remise|pas cher|meilleur prix|noir|noire|blanc|blanche|rouge|bleu|bleue|vert|verte|gris|grise|avec|pour|sans|fil|edition|version|pack|lot|kit|set|paire|neuf|occasion|compatible)\b/gi;
    var words = base.replace(noise, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(function(w) { return w.length > 1; });
    if (words.length > 6) words = words.slice(0, 6);
    return words.length >= 2 ? words.join(' ') : null;
}

async function keepaSearch(apiKey, title, domain) {
    var term = buildSearchTerm(title);
    if (!term) return null;
    try {
        var resp = await fetch('https://api.keepa.com/search?key=' + apiKey + '&domain=' + domain + '&type=product&term=' + encodeURIComponent(term) + '&asins-only=1&page=0');
        var data = await resp.json();
        if (data.asinList && data.asinList.length > 0) {
            console.log('[CRON] FOUND: "' + term.substring(0, 25) + '" -> ' + data.asinList[0] + ' (tokens=' + data.tokensLeft + ')');
            return { asin: data.asinList[0], tokensLeft: data.tokensLeft };
        }
    } catch (e) {}
    return null;
}

async function keepaBatchLookup(apiKey, asins, domain) {
    if (asins.length === 0) return {};
    var results = {};
    try {
        var resp = await fetch('https://api.keepa.com/product?key=' + apiKey + '&domain=' + domain + '&asin=' + asins.join(',') + '&stats=180&fbafees=1');
        if (resp.status === 429) { console.log('[CRON] Batch 429'); return results; }
        var data = await resp.json();
        if (data.products) {
            data.products.forEach(function(p) {
                if (!p || !p.asin) return;
                var amazonPrice = null;
                if (p.csv && p.csv[0]) { var ph = p.csv[0]; if (ph.length >= 2 && ph[ph.length - 1] > 0) amazonPrice = ph[ph.length - 1] / 100; }
                if (!amazonPrice && p.stats && p.stats.current && p.stats.current[0] > 0) amazonPrice = p.stats.current[0] / 100;
                results[p.asin] = {
                    price: amazonPrice,
                    bsr: (p.stats && p.stats.current) ? p.stats.current[3] : null,
                    fbaSellers: (p.stats && p.stats.current) ? p.stats.current[10] : null,
                    fbaPickAndPack: p.fbaFees && p.fbaFees.pickAndPackFee ? p.fbaFees.pickAndPackFee / 100 : null,
                    referralFeePct: p.referralFeePercent || null,
                    weight: p.packageWeight || null
                };
            });
        }
        console.log('[CRON] Batch: ' + asins.length + ' ASINs, ' + Object.keys(results).length + ' prix (tokens=' + (data.tokensLeft || '?') + ')');
    } catch (e) { console.log('[CRON] Batch erreur: ' + e.message); }
    return results;
}

function calculateProfit(dealPrice, kd) {
    if (!kd || !kd.price || kd.price <= 0) return null;
    var sell = kd.price;
    var comm = sell * ((kd.referralFeePct || FEES.commissionPct) / 100);
    var fba = kd.fbaPickAndPack || FEES.fbaFee;
    var inbound = kd.weight ? Math.max(0.50, (kd.weight / 1000) * 1.20) : FEES.inboundShipping;
    var total = comm + fba + inbound + FEES.prepCost + (sell * FEES.urssafPct / 100);
    var profit = sell - dealPrice - total;
    var roi = dealPrice > 0 ? (profit / dealPrice) * 100 : 0;
    return { profit: Math.round(profit * 100) / 100, roi: Math.round(roi * 10) / 10 };
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
const handler = async (event) => {
    var T = Date.now();
    var scanHour = new Date().toISOString().substring(0, 13) + ':00'; // ex: "2026-03-03T15:00"
    console.log('[CRON] === Start ' + scanHour + ' ===');

    var apiKey = process.env.KEEPA_API_KEY;
    var botToken = process.env.TELEGRAM_BOT_TOKEN;
    var chatId = process.env.TELEGRAM_CHAT_ID;
    if (!apiKey || !botToken || !chatId) { console.log('[CRON] Env manquantes'); return { statusCode: 200, body: 'no env' }; }

    var dealStore, asinCache, notifiedStore;
    try {
        dealStore = openStore('deal-results');
        asinCache = openStore('asin-cache');
        notifiedStore = openStore('deal-notified');
    } catch (e) { console.log('[CRON] Blobs: ' + e.message); return { statusCode: 200, body: 'blobs error' }; }

    // === 1. Charger blobs + RSS en parallele ===
    var accRaw, cacheRaw;
    var rssResults;
    try {
        var p = await Promise.all([
            dealStore.get('accumulated', { type: 'json' }).catch(function() { return null; }),
            asinCache.get('title-map', { type: 'json' }).catch(function() { return null; }),
            Promise.all(RSS_SOURCES.map(fetchRSS))
        ]);
        accRaw = p[0]; cacheRaw = p[1]; rssResults = p[2];
    } catch (e) {
        console.log('[CRON] Load erreur: ' + e.message);
        return { statusCode: 200, body: 'load error' };
    }
    console.log('[CRON] Load: ' + elapsed(T));

    // Accumulated deals
    var accumulated = accRaw || {};
    var now = Date.now();
    var expiredCount = 0;
    Object.keys(accumulated).forEach(function(key) {
        if (now - new Date(accumulated[key].firstSeen).getTime() > DEAL_EXPIRY_H * 3600000) { delete accumulated[key]; expiredCount++; }
    });

    // ASIN cache
    var titleToAsin = {};
    if (cacheRaw) {
        var cutoff = now - 14 * 86400000;
        Object.keys(cacheRaw).forEach(function(key) {
            var e = cacheRaw[key];
            if (typeof e === 'string') titleToAsin[key] = { asin: e, date: new Date().toISOString() };
            else if (e.date && new Date(e.date).getTime() > cutoff) titleToAsin[key] = e;
        });
    }

    // RSS merge
    var seenLinks = {};
    var freshDeals = [];
    rssResults.forEach(function(items) { items.forEach(function(d) { if (!seenLinks[d.link]) { seenLinks[d.link] = true; freshDeals.push(d); } }); });
    freshDeals = filterDeals(freshDeals);

    var newCount = 0;
    freshDeals.forEach(function(deal) {
        var key = deal.link;
        if (!accumulated[key]) {
            deal.scanHour = scanHour;
            accumulated[key] = deal;
            newCount++;
        } else {
            accumulated[key].temperature = Math.max(accumulated[key].temperature || 0, deal.temperature || 0);
        }
    });
    console.log('[CRON] RSS: ' + freshDeals.length + ' filtres, ' + newCount + ' nouveaux | Total: ' + Object.keys(accumulated).length + ' | ' + elapsed(T));

    // === 2. ASIN search (max 2, 1 tentative chacun) ===
    var needSearch = [];
    Object.values(accumulated).forEach(function(d) {
        if (!d.asin) {
            var ck = d.title.substring(0, 50).toLowerCase().trim();
            if (titleToAsin[ck]) { d.asin = titleToAsin[ck].asin || titleToAsin[ck]; }
            else if (d.price > 0) needSearch.push(d);
        }
    });
    needSearch.sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); });

    var searched = 0;
    var lastTokens = 999;
    for (var i = 0; i < Math.min(needSearch.length, SEARCH_BATCH); i++) {
        if (lastTokens <= 5) { console.log('[CRON] Tokens bas (' + lastTokens + '), skip search'); break; }
        var dom = SOURCE_DOMAINS[needSearch[i].source] || 4;
        var res = await keepaSearch(apiKey, needSearch[i].title, dom);
        if (res) {
            needSearch[i].asin = res.asin;
            titleToAsin[needSearch[i].title.substring(0, 50).toLowerCase().trim()] = { asin: res.asin, date: new Date().toISOString() };
            searched++;
            if (res.tokensLeft !== undefined) lastTokens = res.tokensLeft;
            if (lastTokens <= 5) break;
        }
    }
    console.log('[CRON] Search: ' + searched + '/' + Math.min(needSearch.length, SEARCH_BATCH) + ' (tokens~' + lastTokens + ') | ' + elapsed(T));

    // === 3. Price lookup (max 10 ASINs, skip si tokens bas) ===
    var allDeals = Object.values(accumulated);
    var toCheck = allDeals.filter(function(d) { return d.asin && !d.priceCheckedAt; })
        .sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); })
        .slice(0, PRICE_REFRESH);

    var keepaData = {};
    if (toCheck.length > 0 && lastTokens > 10) {
        var domCount = {};
        toCheck.forEach(function(d) { var dm = SOURCE_DOMAINS[d.source] || 4; domCount[dm] = (domCount[dm] || 0) + 1; });
        var mainDom = Object.keys(domCount).sort(function(a, b) { return domCount[b] - domCount[a]; })[0];
        var asinsForBatch = toCheck.filter(function(d) { return (SOURCE_DOMAINS[d.source] || 4) == mainDom; }).map(function(d) { return d.asin; });
        if (asinsForBatch.length > 10) asinsForBatch = asinsForBatch.slice(0, 10);
        keepaData = await keepaBatchLookup(apiKey, asinsForBatch, mainDom);
    } else if (lastTokens <= 10) {
        console.log('[CRON] Skip batch: tokens trop bas (' + lastTokens + ')');
    }
    console.log('[CRON] Prices: ' + Object.keys(keepaData).length + '/' + toCheck.length + ' | ' + elapsed(T));

    // === 4. Calculate profit ===
    var profitableCount = 0;
    allDeals.forEach(function(deal) {
        if (!deal.asin) return;
        var kd = keepaData[deal.asin];
        if (kd) {
            deal.amazonPrice = kd.price;
            deal.bsr = kd.bsr;
            deal.fbaSellers = kd.fbaSellers;
            deal.keepaData = kd;
            deal.priceCheckedAt = new Date().toISOString();
        }
        if (deal.amazonPrice && deal.price > 0) {
            var r = calculateProfit(deal.price, deal.keepaData || { price: deal.amazonPrice });
            if (r) { deal.profit = r.profit; deal.roi = r.roi; if (r.profit > 0) profitableCount++; }
        }
    });

    // === 5. Save (parallel) ===
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
            bsr: d.bsr || null, fbaSellers: d.fbaSellers || null,
            temperature: d.temperature, source: d.source, date: d.date,
            firstSeen: d.firstSeen, scanHour: d.scanHour || null,
            priceCheckedAt: d.priceCheckedAt || null
        };
    });

    try {
        await Promise.all([
            dealStore.setJSON('accumulated', accumulated),
            dealStore.setJSON('latest', {
                deals: dealsForBrowser,
                updatedAt: new Date().toISOString(),
                scanHour: scanHour,
                stats: { total: allDeals.length, withAsin: allDeals.filter(function(d) { return d.asin; }).length, profitable: profitableCount }
            }),
            asinCache.setJSON('title-map', titleToAsin)
        ]);
    } catch (e) { console.log('[CRON] Save erreur: ' + e.message); }
    console.log('[CRON] Saved | ' + elapsed(T));

    // === 6. Telegram (max 3) ===
    var newNotifs = 0;
    var profitable = allDeals.filter(function(d) { return d.profit > 0 && d.amazonPrice > 0; });
    for (var k = 0; k < profitable.length && newNotifs < MAX_TELEGRAM; k++) {
        var deal = profitable[k];
        var nk = 'notif_' + deal.asin;
        var skip = false;
        try {
            var ex = await notifiedStore.get(nk);
            if (ex) { var nd = JSON.parse(ex); if (nd.date && (now - new Date(nd.date).getTime() < 7 * 86400000)) skip = true; }
        } catch (e) {}

        if (!skip) {
            var dn = DOMAIN_NAMES[SOURCE_DOMAINS[deal.source] || 4] || 'amazon.fr';
            var msg = '\u{1F514} *Deal rentable !*\n\n\u{1F4E6} ' + deal.title.substring(0, 80) +
                '\n\u{1F4B0} ' + Number(deal.price).toFixed(2) + '\u20AC \u2192 Amazon: ' + Number(deal.amazonPrice).toFixed(2) + '\u20AC' +
                '\n\u2705 Profit: +' + Number(deal.profit).toFixed(2) + '\u20AC | ROI: ' + Number(deal.roi).toFixed(0) + '%' +
                (deal.bsr ? '\n\u{1F4CA} BSR: ' + Number(deal.bsr).toLocaleString() : '') +
                '\n\u{1F3EA} ' + deal.source + (deal.temperature > 0 ? ' ' + deal.temperature + '\u00B0' : '') +
                '\n\u{1F517} [Deal](' + deal.link + ')' + (deal.asin ? ' | [Amazon](https://www.' + dn + '/dp/' + deal.asin + ')' : '');
            var sent = await sendTelegram(botToken, chatId, msg);
            if (sent) {
                try { await notifiedStore.set(nk, JSON.stringify({ asin: deal.asin, date: new Date().toISOString() })); } catch (e) {}
                newNotifs++;
            }
        }
    }

    console.log('[CRON] === Done: ' + allDeals.length + ' deals, ' + profitableCount + ' rentables, ' + newNotifs + ' notifs | TOTAL ' + elapsed(T) + ' ===');
    return { statusCode: 200, body: JSON.stringify({ total: allDeals.length, profitable: profitableCount, notified: newNotifs }) };
};

exports.handler = schedule('0 * * * *', handler);
