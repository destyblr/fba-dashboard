const fetch = require('node-fetch');
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

// === CONFIG ===
const RSS_SOURCES = [
    { name: 'Dealabs', url: 'https://www.dealabs.com/rss/hot', domain: 4 },
    { name: 'Dealabs', url: 'https://www.dealabs.com/rss/new', domain: 4 },
    { name: 'MyDealz', url: 'https://www.mydealz.de/rss/hot', domain: 3 },
    { name: 'MyDealz', url: 'https://www.mydealz.de/rss/new', domain: 3 },
    { name: 'Chollometro', url: 'https://www.chollometro.com/rss/hot', domain: 9 },
    { name: 'Chollometro', url: 'https://www.chollometro.com/rss/new', domain: 9 },
    { name: 'Pepper.it', url: 'https://www.pepper.it/rss/hot', domain: 8 },
    { name: 'Pepper.it', url: 'https://www.pepper.it/rss/new', domain: 8 }
];
const SOURCE_DOMAINS = { 'Dealabs': 4, 'MyDealz': 3, 'Chollometro': 9, 'Pepper.it': 8 };
const DOMAIN_NAMES = { 3: 'amazon.de', 4: 'amazon.fr', 8: 'amazon.it', 9: 'amazon.es' };

const BLACKLIST = 'iphone,ipad,macbook,airpods,apple watch,samsung,galaxy,sony,playstation,ps5,ps4,xbox,surface,nintendo,switch,huawei,xiaomi,oppo,oneplus,dyson,nike,adidas,lego,bose,rolex,canon,nikon,gopro,televiseur,television,ordinateur portable,laptop,pc portable,smartphone,lave-linge,lave-vaisselle,refrigerateur,congelateur,micro-ondes,climatiseur,canape,matelas,pneu'.split(',');

const FEES = { commissionPct: 15, fbaFee: 3.50, inboundShipping: 2.00, prepCost: 0.25, urssafPct: 12.3 };
const FILTERS = { minPrice: 5, maxPrice: 200 };
const SEARCH_BATCH = 2;
const MAX_LOOKUPS = 50;
const DEAL_EXPIRY_H = 24;
const MAX_TELEGRAM = 3;
const MIN_TOKENS = 5;

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
        return { asin: null, tokensLeft: data.tokensLeft || 0 };
    } catch (e) {}
    return null;
}

// Lookup individuel (1 ASIN = 1 token) → retourne { data, tokensLeft }
async function keepaLookupOne(apiKey, asin, domain) {
    try {
        var resp = await fetch('https://api.keepa.com/product?key=' + apiKey + '&domain=' + domain + '&asin=' + asin + '&stats=180&fbafees=1');
        if (resp.status === 429) { console.log('[CRON] Lookup 429: ' + asin); return { data: null, tokensLeft: 0 }; }
        var json = await resp.json();
        var tokensLeft = json.tokensLeft !== undefined ? json.tokensLeft : -1;
        if (json.products && json.products[0]) {
            var p = json.products[0];
            var amazonPrice = null;
            if (p.csv && p.csv[0]) { var ph = p.csv[0]; if (ph.length >= 2 && ph[ph.length - 1] > 0) amazonPrice = ph[ph.length - 1] / 100; }
            if (!amazonPrice && p.stats && p.stats.current && p.stats.current[0] > 0) amazonPrice = p.stats.current[0] / 100;
            return {
                data: {
                    price: amazonPrice,
                    bsr: (p.stats && p.stats.current) ? p.stats.current[3] : null,
                    fbaSellers: (p.stats && p.stats.current) ? p.stats.current[10] : null,
                    fbaPickAndPack: p.fbaFees && p.fbaFees.pickAndPackFee ? p.fbaFees.pickAndPackFee / 100 : null,
                    referralFeePct: p.referralFeePercent || null,
                    weight: p.packageWeight || null
                },
                tokensLeft: tokensLeft
            };
        }
        return { data: null, tokensLeft: tokensLeft };
    } catch (e) { console.log('[CRON] Lookup erreur ' + asin + ': ' + e.message); return { data: null, tokensLeft: -1 }; }
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
    var scanHour = new Date().toISOString().substring(0, 13) + ':00';
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
    var accRaw, cacheRaw, rssResults;
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

    // Backfill pour les anciens deals
    Object.values(accumulated).forEach(function(d) {
        // scanHour depuis firstSeen si manquant
        if (!d.scanHour && d.firstSeen) {
            d.scanHour = new Date(d.firstSeen).toISOString().substring(0, 13) + ':00';
        }
        // Marquer comme deja traite si prix/profit existent deja (evite re-traitement)
        if (!d.priceCheckedAt && d.amazonPrice && d.profit !== null && d.profit !== undefined) {
            d.priceCheckedAt = d.firstSeen || new Date().toISOString();
        }
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

    // Resoudre ASINs depuis le cache
    Object.values(accumulated).forEach(function(d) {
        if (!d.asin) {
            var ck = d.title.substring(0, 50).toLowerCase().trim();
            if (titleToAsin[ck]) { d.asin = titleToAsin[ck].asin || titleToAsin[ck]; }
        }
    });

    // === 2. TRAITEMENT COMPLET PAR PRODUIT ===
    var lastTokens = 999;
    var processedCount = 0;
    var profitableCount = 0;
    var newNotifs = 0;
    var tokensRanOut = false;

    // --- Phase 1 : Deals AVEC ASIN (1 token chacun — pas cher) ---
    var dealsWithAsin = Object.values(accumulated)
        .filter(function(d) { return d.asin && !d.priceCheckedAt; })
        .sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); });

    console.log('[CRON] Phase 1: ' + dealsWithAsin.length + ' deals avec ASIN a traiter');

    for (var i = 0; i < Math.min(dealsWithAsin.length, MAX_LOOKUPS); i++) {
        if (lastTokens <= MIN_TOKENS) { tokensRanOut = true; console.log('[CRON] Phase 1 STOP: tokens=' + lastTokens); break; }

        var deal = dealsWithAsin[i];
        var dom = SOURCE_DOMAINS[deal.source] || 4;
        var result = await keepaLookupOne(apiKey, deal.asin, dom);

        if (result.tokensLeft !== undefined && result.tokensLeft >= 0) lastTokens = result.tokensLeft;

        if (result.data) {
            deal.amazonPrice = result.data.price;
            deal.bsr = result.data.bsr;
            deal.fbaSellers = result.data.fbaSellers;
            deal.keepaData = result.data;
            deal.priceCheckedAt = new Date().toISOString();

            if (deal.amazonPrice && deal.price > 0) {
                var r = calculateProfit(deal.price, result.data);
                if (r) {
                    deal.profit = r.profit;
                    deal.roi = r.roi;
                    if (r.profit > 0) profitableCount++;
                }
            }
            processedCount++;
            console.log('[CRON]   ' + deal.asin + ': ' + (deal.amazonPrice ? deal.amazonPrice.toFixed(2) + '€' : 'N/A') + (deal.profit ? ' profit=' + deal.profit.toFixed(2) + '€' : '') + ' (tokens=' + lastTokens + ')');

            // Telegram si rentable
            if (deal.profit > 0 && deal.amazonPrice > 0 && newNotifs < MAX_TELEGRAM) {
                var nk = 'notif_' + deal.asin;
                var skip = false;
                try {
                    var ex = await notifiedStore.get(nk);
                    if (ex) { var nd = JSON.parse(ex); if (nd.date && (now - new Date(nd.date).getTime() < 7 * 86400000)) skip = true; }
                } catch (e) {}
                if (!skip) {
                    var dn = DOMAIN_NAMES[dom] || 'amazon.fr';
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
        }
    }
    console.log('[CRON] Phase 1 done: ' + processedCount + '/' + dealsWithAsin.length + ' traites | ' + elapsed(T));

    // --- Phase 2 : Deals SANS ASIN (search ~10 tokens + lookup 1 token = ~11 par deal) ---
    var needSearch = Object.values(accumulated)
        .filter(function(d) { return !d.asin && d.price > 0; })
        .sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); });

    var searched = 0;
    console.log('[CRON] Phase 2: ' + needSearch.length + ' deals sans ASIN, max ' + SEARCH_BATCH);

    for (var j = 0; j < Math.min(needSearch.length, SEARCH_BATCH); j++) {
        if (lastTokens <= 15) { tokensRanOut = true; console.log('[CRON] Phase 2 STOP: tokens=' + lastTokens); break; }

        var sd = needSearch[j];
        var sDom = SOURCE_DOMAINS[sd.source] || 4;
        var sr = await keepaSearch(apiKey, sd.title, sDom);
        if (!sr) continue;
        if (sr.tokensLeft !== undefined) lastTokens = sr.tokensLeft;

        if (sr.asin) {
            sd.asin = sr.asin;
            titleToAsin[sd.title.substring(0, 50).toLowerCase().trim()] = { asin: sr.asin, date: new Date().toISOString() };
            searched++;

            // Lookup immediat si assez de tokens
            if (lastTokens > MIN_TOKENS) {
                var lr = await keepaLookupOne(apiKey, sd.asin, sDom);
                if (lr.tokensLeft !== undefined && lr.tokensLeft >= 0) lastTokens = lr.tokensLeft;
                if (lr.data) {
                    sd.amazonPrice = lr.data.price;
                    sd.bsr = lr.data.bsr;
                    sd.fbaSellers = lr.data.fbaSellers;
                    sd.keepaData = lr.data;
                    sd.priceCheckedAt = new Date().toISOString();
                    if (sd.amazonPrice && sd.price > 0) {
                        var rr = calculateProfit(sd.price, lr.data);
                        if (rr) {
                            sd.profit = rr.profit;
                            sd.roi = rr.roi;
                            if (rr.profit > 0) profitableCount++;
                        }
                    }
                    processedCount++;
                    console.log('[CRON]   SEARCH+LOOKUP ' + sd.asin + ': ' + (sd.amazonPrice ? sd.amazonPrice.toFixed(2) + '€' : 'N/A') + (sd.profit ? ' profit=' + sd.profit.toFixed(2) + '€' : '') + ' (tokens=' + lastTokens + ')');

                    // Telegram si rentable
                    if (sd.profit > 0 && sd.amazonPrice > 0 && newNotifs < MAX_TELEGRAM) {
                        var nk2 = 'notif_' + sd.asin;
                        var skip2 = false;
                        try {
                            var ex2 = await notifiedStore.get(nk2);
                            if (ex2) { var nd2 = JSON.parse(ex2); if (nd2.date && (now - new Date(nd2.date).getTime() < 7 * 86400000)) skip2 = true; }
                        } catch (e) {}
                        if (!skip2) {
                            var dn2 = DOMAIN_NAMES[sDom] || 'amazon.fr';
                            var msg2 = '\u{1F514} *Deal rentable !*\n\n\u{1F4E6} ' + sd.title.substring(0, 80) +
                                '\n\u{1F4B0} ' + Number(sd.price).toFixed(2) + '\u20AC \u2192 Amazon: ' + Number(sd.amazonPrice).toFixed(2) + '\u20AC' +
                                '\n\u2705 Profit: +' + Number(sd.profit).toFixed(2) + '\u20AC | ROI: ' + Number(sd.roi).toFixed(0) + '%' +
                                (sd.bsr ? '\n\u{1F4CA} BSR: ' + Number(sd.bsr).toLocaleString() : '') +
                                '\n\u{1F3EA} ' + sd.source + (sd.temperature > 0 ? ' ' + sd.temperature + '\u00B0' : '') +
                                '\n\u{1F517} [Deal](' + sd.link + ')' + (sd.asin ? ' | [Amazon](https://www.' + dn2 + '/dp/' + sd.asin + ')' : '');
                            var sent2 = await sendTelegram(botToken, chatId, msg2);
                            if (sent2) {
                                try { await notifiedStore.set(nk2, JSON.stringify({ asin: sd.asin, date: new Date().toISOString() })); } catch (e) {}
                                newNotifs++;
                            }
                        }
                    }
                }
            } else {
                tokensRanOut = true;
            }
        }
    }
    console.log('[CRON] Phase 2 done: ' + searched + ' ASIN trouves | ' + elapsed(T));

    // Recalculer les profits pour les deals deja traites (anciens cycles)
    var allDeals = Object.values(accumulated);
    allDeals.forEach(function(deal) {
        if (deal.keepaData && deal.amazonPrice && deal.price > 0 && deal.profit === null) {
            var rCalc = calculateProfit(deal.price, deal.keepaData);
            if (rCalc) { deal.profit = rCalc.profit; deal.roi = rCalc.roi; if (rCalc.profit > 0) profitableCount++; }
        }
    });

    // === 3. SAVE ===
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

    // === 4. ALERTE TELEGRAM si traitement incomplet ===
    var totalWithAsin = allDeals.filter(function(d) { return d.asin; }).length;
    var totalChecked = allDeals.filter(function(d) { return d.priceCheckedAt; }).length;
    var totalUnchecked = totalWithAsin - totalChecked;
    var totalNoAsin = allDeals.filter(function(d) { return !d.asin && d.price > 0; }).length;

    if (tokensRanOut && (totalUnchecked > 0 || totalNoAsin > 0)) {
        var alertMsg = '\u26A0\uFE0F *Scan incomplet* (tokens: ' + lastTokens + ')\n\n' +
            '\u2705 ' + processedCount + ' deals traites completement\n' +
            (totalUnchecked > 0 ? '\u23F3 ' + totalUnchecked + ' avec ASIN en attente de prix\n' : '') +
            (totalNoAsin > 0 ? '\u{1F50D} ' + totalNoAsin + ' sans ASIN (recherche necessaire)\n' : '') +
            '\n\u{1F504} Prochain scan dans 1h';
        await sendTelegram(botToken, chatId, alertMsg);
    }

    console.log('[CRON] === Done: ' + allDeals.length + ' deals, ' + processedCount + ' traites, ' + profitableCount + ' rentables, ' + newNotifs + ' notifs' + (tokensRanOut ? ' | TOKENS EPUISES' : '') + ' | TOTAL ' + elapsed(T) + ' ===');
    return { statusCode: 200, body: JSON.stringify({ total: allDeals.length, processed: processedCount, profitable: profitableCount, notified: newNotifs, tokensRanOut: tokensRanOut }) };
};

exports.handler = schedule('0 * * * *', handler);
