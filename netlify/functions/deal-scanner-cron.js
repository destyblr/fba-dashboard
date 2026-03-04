const fetch = require('node-fetch');
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

// === CONFIG ===
const RSS_SOURCES = [
    { name: 'Dealabs', url: 'https://www.dealabs.com/rss/hot', domain: 4 },
    { name: 'Dealabs', url: 'https://www.dealabs.com/rss/new', domain: 4 }
];
const SOURCE_DOMAINS = { 'Dealabs': 4 };
const DOMAIN_NAMES = { 4: 'amazon.fr' };

const BLACKLIST = [
    // Marques gatees / restreintes
    'iphone','ipad','macbook','airpods','apple watch','samsung','galaxy','sony','playstation','ps5','ps4',
    'xbox','surface','nintendo','switch','huawei','xiaomi','oppo','oneplus','dyson','nike','adidas',
    'lego','bose','rolex','canon','nikon','gopro','dji','garmin','philips','braun','karcher',
    // Electronique / informatique surdimensionne
    'televiseur','television','ordinateur portable','laptop','pc portable','smartphone','ecran pc',
    'pc gamer','pc fixe','pc de bureau','tour pc','unite centrale','moniteur','imprimante',
    // Electromenager (trop gros/lourd)
    'lave-linge','lave-vaisselle','refrigerateur','congelateur','micro-ondes','climatiseur',
    'radiateur','seche-linge','four encastrable','hotte aspirante','aspirateur robot',
    // Mobilier (trop gros)
    'canape','matelas','armoire','sommier','meuble','lit coffre','table','bureau','etagere',
    'commode','bibliotheque','chaise de bureau','fauteuil','tabouret','banquette',
    // Exterieur / jardin surdimensionne
    'trottinette','trotinette','trampoline','piscine','barbecue','tondeuse','jacuzzi','parasol',
    'pergola','balancoire','portique','abri de jardin','groupe electrogene','nettoyeur haute pression',
    'motoculteur','debroussailleuse','tronconneuse','salon de jardin',
    // Mobilite / sport surdimensionne
    'velo electrique','velo enfant','vtt','draisienne','kayak','paddle','rameur',
    'tapis de course','velo elliptique','banc de musculation','home trainer',
    // Auto / moto
    'pneu','demarreur','pare-brise','siege auto','poussette',
    // Dematerialise (pas FBA)
    'carte cadeau','gift card','e-carte','bon d\'achat','code de telechargement',
    'abonnement','cle cd','steam key','licence numerique','jeu demat','xbox game pass',
    'ps plus','playstation plus','nintendo eshop','xbox live','spotify','netflix','disney+',
    // Hazmat / restreint
    'e-liquide','cigarette electronique','parfum','eau de toilette','eau de parfum',
    // Alimentaire / perissable
    'chocolat','bonbon','cafe capsule','the','complement alimentaire','proteine whey'
];

const FEES = { commissionPct: 15, fbaFee: 3.50, inboundShipping: 2.00, prepCost: 0.25, urssafPct: 12.3 };
const EFN_SURCHARGE = 3.50; // Surcout EFN cross-border (stock FR, vente DE/IT/ES)
const FILTERS = { minPrice: 5, maxPrice: 200 };
const MAX_LOOKUPS = 50;
const DEAL_EXPIRY_H = 24;
const MAX_TELEGRAM = 3;
const MIN_TOKENS = 5;

// Categories gated/interdites Amazon (patterns multi-langue FR/DE/EN)
const GATED_CATEGORIES = [
    // Alimentaire / Epicerie
    'epicerie','grocery','gourmet','lebensmittel','alimentari','alimentacion',
    // Beaute / Parfum
    'beaute','beauty','parfum','kosmetik','bellezza',
    // Hygiene / Sante
    'hygiene','sante','health','gesundheit','salute','salud',
    // Vetements / Chaussures / Bijoux
    'vetement','clothing','shoes','chaussure','bijou','jewelry','schmuck','bekleidung','mode',
    'accessoires mode',
    // Auto / Moto
    'auto','automotive','moto','fahrzeug','kfz',
    // Montres
    'montre','watches','uhren','orologi',
    // Alcool / Vin
    'vin','wine','wein','biere','alcool','spiritueux',
    // Art / Collectibles
    'fine art','collectible','sammler'
];

function getSellStatus(keepaData) {
    if (!keepaData) return null;
    var cat = (keepaData.categoryName || '').toLowerCase();

    // Verifier si categorie gated
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

// === RESOLVE PEPPER (0 tokens — suit les redirections pour trouver ASIN Amazon) ===
async function resolvePepperAsin(dealUrl) {
    var pepperBases = { 'dealabs.com': 'https://www.dealabs.com', 'mydealz.de': 'https://www.mydealz.de', 'chollometro.com': 'https://www.chollometro.com', 'pepper.it': 'https://www.pepper.it' };
    var baseUrl = null;
    var keys = Object.keys(pepperBases);
    for (var i = 0; i < keys.length; i++) { if (dealUrl.includes(keys[i])) { baseUrl = pepperBases[keys[i]]; break; } }
    if (!baseUrl) return null;

    var threadIdMatch = dealUrl.match(/(\d{5,})(?:\?|$|#)/);
    var threadIdFallback = dealUrl.match(/(\d{5,})/g);
    var threadId = threadIdMatch ? threadIdMatch[1] : (threadIdFallback ? threadIdFallback[threadIdFallback.length - 1] : null);
    if (!threadId) return null;

    function extractAsin(url) {
        if (!url) return null;
        var m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        if (m) return m[1].toUpperCase();
        var b = url.match(/\b(B0[A-Z0-9]{8})\b/);
        if (b) return b[1];
        return null;
    }

    try {
        // Methode 1 : Suivre visit/threadmain → redirections
        var visitUrl = baseUrl + '/visit/threadmain/' + threadId;
        var resp = await fetch(visitUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': dealUrl },
            redirect: 'manual', timeout: 8000
        });
        var location = resp.headers.get('location');
        var hops = 0;
        while (location && hops < 5) {
            var found = extractAsin(location);
            if (found) return found;
            if (/amazon\.(fr|de|com|co\.uk|it|es)/i.test(location)) {
                try {
                    var nr = await fetch(location, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual', timeout: 5000 });
                    var nl = nr.headers.get('location');
                    if (nl) { var fa = extractAsin(nl); if (fa) return fa; location = nl; }
                    else { var body = await nr.text(); var ba = extractAsin(body); if (ba) return ba; break; }
                } catch (e) { break; }
            } else {
                try { var nr2 = await fetch(location, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual', timeout: 5000 }); location = nr2.headers.get('location'); }
                catch (e) { break; }
            }
            hops++;
        }
    } catch (e) {}

    // Methode 2 fallback : Fetcher la page deal, chercher ASIN dans le HTML
    try {
        var pr = await fetch(dealUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' }, redirect: 'follow', timeout: 8000 });
        var html = await pr.text();
        var ha = html.match(/\/dp\/([A-Z0-9]{10})/i);
        if (ha) return ha[1].toUpperCase();
        var hb = html.match(/\b(B0[A-Z0-9]{8})\b/);
        if (hb) return hb[0];
    } catch (e) {}

    return null;
}

// === KEEPA ===
function buildSearchTerms(title) {
    if (!title) return [];
    var base = title.replace(/\s*\d+°\s*/, '').replace(/\([^)]*\)/g, ' ').replace(/\s+[-–—]\s+/g, ' ').replace(/[|€$£%]/g, '').replace(/\d+[,.]?\d*\s*€/g, '').replace(/\s+/g, ' ').trim();
    var noise = /\b(promo|offre|bon plan|deal|livraison gratuite|en stock|disponible|gratuit|soldes?|destockage|vente flash|code promo|reduction|remise|pas cher|meilleur prix|noir|noire|blanc|blanche|rouge|bleu|bleue|vert|verte|gris|grise|avec|pour|sans|fil|edition|version|pack|lot|kit|set|paire|neuf|occasion|compatible)\b/gi;
    var words = base.replace(noise, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(function(w) { return w.length > 1; });
    var terms = [];
    // Essai 1 : titre complet (max 6 mots)
    var full = words.slice(0, 6);
    if (full.length >= 2) terms.push(full.join(' '));
    // Essai 2 : raccourci (3 premiers mots = marque + modele)
    var short = words.slice(0, 3);
    if (short.length >= 2 && short.join(' ') !== full.join(' ')) terms.push(short.join(' '));
    return terms;
}

async function keepaSearch(apiKey, title, domain) {
    var terms = buildSearchTerms(title);
    if (terms.length === 0) return null;
    var lastTokens = 0;

    for (var ti = 0; ti < terms.length; ti++) {
        var term = terms[ti];
        try {
            var resp = await fetch('https://api.keepa.com/search?key=' + apiKey + '&domain=' + domain + '&type=product&term=' + encodeURIComponent(term) + '&asins-only=1&page=0');
            var data = await resp.json();
            lastTokens = data.tokensLeft || 0;
            if (data.asinList && data.asinList.length > 0) {
                console.log('[CRON] FOUND (essai ' + (ti + 1) + '): "' + term.substring(0, 30) + '" -> ' + data.asinList[0] + ' (tokens=' + lastTokens + ')');
                return { asin: data.asinList[0], tokensLeft: lastTokens };
            }
            console.log('[CRON] NOT FOUND (essai ' + (ti + 1) + '): "' + term.substring(0, 30) + '" (tokens=' + lastTokens + ')');
            // Si plus assez de tokens pour un 2e essai, arreter
            if (lastTokens <= 15) break;
        } catch (e) {
            console.log('[CRON] Search erreur: ' + e.message);
        }
    }
    return { asin: null, tokensLeft: lastTokens };
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
            var priceIsAvg = false;
            var amazonSells = false;
            // csv[0] = prix Amazon vendeur direct
            if (p.csv && p.csv[0]) { var ph = p.csv[0]; if (ph.length >= 2 && ph[ph.length - 1] > 0) { amazonPrice = ph[ph.length - 1] / 100; amazonSells = true; } }
            if (!amazonPrice && p.stats && p.stats.current && p.stats.current[0] > 0) { amazonPrice = p.stats.current[0] / 100; amazonSells = true; }
            // Fallback : prix moyen 90j si pas de prix courant
            if (!amazonPrice && p.stats && p.stats.avg && p.stats.avg[0] > 0) {
                amazonPrice = p.stats.avg[0] / 100;
                priceIsAvg = true;
            }
            // Fallback 2 : prix moyen 180j
            if (!amazonPrice && p.stats && p.stats.avg180 && p.stats.avg180[0] > 0) {
                amazonPrice = p.stats.avg180[0] / 100;
                priceIsAvg = true;
            }
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
                    price: amazonPrice,
                    priceIsAvg: priceIsAvg,
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
    } catch (e) { console.log('[CRON] Lookup erreur ' + asin + ': ' + e.message); return { data: null, tokensLeft: -1 }; }
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

    // === 1. Charger blobs + RSS + tokens en parallele ===
    var accRaw, cacheRaw, rssResults, startTokens;
    try {
        var p = await Promise.all([
            dealStore.get('accumulated', { type: 'json' }).catch(function() { return null; }),
            asinCache.get('title-map', { type: 'json' }).catch(function() { return null; }),
            Promise.all(RSS_SOURCES.map(fetchRSS)),
            fetch('https://api.keepa.com/token?key=' + apiKey).then(function(r) { return r.json(); }).then(function(j) { return j.tokensLeft; }).catch(function() { return null; })
        ]);
        accRaw = p[0]; cacheRaw = p[1]; rssResults = p[2]; startTokens = p[3];
    console.log('[CRON] Tokens au depart: ' + startTokens);
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

    // RSS merge + pipeline counters
    var rssRawCount = 0;
    rssResults.forEach(function(items) { rssRawCount += items.length; });

    var seenLinks = {};
    var freshDeals = [];
    rssResults.forEach(function(items) { items.forEach(function(d) { if (!seenLinks[d.link]) { seenLinks[d.link] = true; freshDeals.push(d); } }); });
    var afterDedupCount = freshDeals.length;
    freshDeals = filterDeals(freshDeals);
    var afterFilterCount = freshDeals.length;

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
    console.log('[CRON] RSS: ' + rssRawCount + ' brut → ' + afterDedupCount + ' uniques → ' + afterFilterCount + ' filtres, ' + newCount + ' nouveaux | Total: ' + Object.keys(accumulated).length + ' | ' + elapsed(T));

    // Resoudre ASINs depuis le cache
    Object.values(accumulated).forEach(function(d) {
        if (!d.asin) {
            var ck = d.title.substring(0, 50).toLowerCase().trim();
            if (titleToAsin[ck]) { d.asin = titleToAsin[ck].asin || titleToAsin[ck]; }
        }
    });

    // === 1b. RESOLVE PEPPER — suivre les redirections pour trouver ASIN (0 tokens) ===
    // Seulement les deals de CE cycle (pas les anciens)
    var needResolve = Object.values(accumulated).filter(function(d) {
        return !d.asin && d.link && !d.resolveAttempted && d.scanHour === scanHour;
    }).sort(function(a, b) {
        var aFR = a.source === 'Dealabs' ? 1 : 0;
        var bFR = b.source === 'Dealabs' ? 1 : 0;
        if (aFR !== bFR) return bFR - aFR;
        return (b.temperature || 0) - (a.temperature || 0);
    });
    console.log('[CRON] Resolve-pepper: ' + needResolve.length + ' deals a resoudre');

    var resolvedCount = 0;
    var maxResolve = Math.min(needResolve.length, 20); // max 20 par cycle (timeout)
    for (var ri = 0; ri < maxResolve; ri += 5) {
        var batch = needResolve.slice(ri, Math.min(ri + 5, maxResolve));
        await Promise.all(batch.map(function(d) {
            return resolvePepperAsin(d.link).then(function(asin) {
                d.resolveAttempted = true;
                if (asin) {
                    d.asin = asin;
                    d.isAmazon = true;
                    d.searchStatus = 'resolve_ok';
                    resolvedCount++;
                    console.log('[CRON]   Pepper→ASIN: ' + asin + ' ← ' + d.title.substring(0, 40));
                } else {
                    d.searchStatus = 'resolve_no_amazon';
                }
            }).catch(function() { d.resolveAttempted = true; d.searchStatus = 'resolve_error'; });
        }));
    }
    console.log('[CRON] Resolve-pepper done: ' + resolvedCount + '/' + maxResolve + ' ASINs trouves | ' + elapsed(T));

    // === 2. TRAITEMENT COMPLET PAR PRODUIT ===
    var lastTokens = (startTokens !== null) ? startTokens : 999;
    var processedCount = 0;
    var profitableCount = 0;
    var newNotifs = 0;
    var tokensRanOut = false;
    var pendingNotifs = []; // Deals rentables a notifier (Telegram differe apres Phase 4)

    // --- Phase 1 : Deals AVEC ASIN (1 token chacun — pas cher) ---
    // Nouveaux du cycle courant EN PRIORITE, puis anciens non-traites
    var dealsWithAsin = Object.values(accumulated)
        .filter(function(d) { return d.asin && !d.priceCheckedAt; })
        .sort(function(a, b) {
            // Cycle courant en priorite
            var aCurrent = a.scanHour === scanHour ? 1 : 0;
            var bCurrent = b.scanHour === scanHour ? 1 : 0;
            if (aCurrent !== bCurrent) return bCurrent - aCurrent;
            // FR (Dealabs) en priorite
            var aFR = a.source === 'Dealabs' ? 1 : 0;
            var bFR = b.source === 'Dealabs' ? 1 : 0;
            if (aFR !== bFR) return bFR - aFR;
            return (b.temperature || 0) - (a.temperature || 0);
        });

    var newWithAsin = dealsWithAsin.filter(function(d) { return d.scanHour === scanHour; }).length;
    var oldWithAsin = dealsWithAsin.length - newWithAsin;
    console.log('[CRON] Phase 1: ' + newWithAsin + ' nouveaux avec ASIN' + (oldWithAsin > 0 ? ' + ' + oldWithAsin + ' anciens a rattraper' : ''));

    for (var i = 0; i < Math.min(dealsWithAsin.length, MAX_LOOKUPS); i++) {
        if (lastTokens <= MIN_TOKENS) { tokensRanOut = true; console.log('[CRON] Phase 1 STOP: tokens=' + lastTokens); break; }

        var deal = dealsWithAsin[i];
        var dom = SOURCE_DOMAINS[deal.source] || 4;
        var result = await keepaLookupOne(apiKey, deal.asin, dom);

        if (result.tokensLeft !== undefined && result.tokensLeft >= 0) {
            lastTokens = result.tokensLeft;
        }

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

            // Verifier vendabilite FBA
            var ss = getSellStatus(result.data);
            deal.sellStatus = ss ? ss.status : null;
            deal.sellReason = ss ? ss.reason : null;

            if (deal.sellStatus === 'gated' || deal.sellStatus === 'amazon_sells' || deal.sellStatus === 'no_fba' || deal.sellStatus === 'too_competitive') {
                console.log('[CRON]   ' + deal.asin + ': ' + deal.sellStatus.toUpperCase() + ' (' + (deal.sellReason || '') + ') — skip | tokens=' + lastTokens);
                processedCount++;
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
            processedCount++;
            console.log('[CRON]   ' + deal.asin + ': ' + (deal.amazonPrice ? deal.amazonPrice.toFixed(2) + '€' : 'N/A') + (deal.profit ? ' profit=' + deal.profit.toFixed(2) + '€' : '') + ' [' + (deal.sellStatus || '?') + '] (tokens=' + lastTokens + ')');

            // Collecter pour Telegram (envoye apres Phase 4 avec Best MKT)
            if (deal.profit > 0 && deal.amazonPrice > 0) {
                pendingNotifs.push(deal);
            }
        }
    }
    console.log('[CRON] Phase 1 done: ' + processedCount + '/' + dealsWithAsin.length + ' traites | ' + elapsed(T));

    // --- Phase 3 : Recherche mot-cle pour deals sans ASIN ---
    // Cycle courant EN PRIORITE, puis anciens tokens_exhausted a rattraper
    var needSearch = Object.values(accumulated)
        .filter(function(d) { return !d.asin && d.price > 0 && (d.scanHour === scanHour || d.searchStatus === 'tokens_exhausted'); })
        .sort(function(a, b) {
            // Cycle courant en priorite
            var aCurrent = a.scanHour === scanHour ? 1 : 0;
            var bCurrent = b.scanHour === scanHour ? 1 : 0;
            if (aCurrent !== bCurrent) return bCurrent - aCurrent;
            return (b.temperature || 0) - (a.temperature || 0);
        });

    var newSearch = needSearch.filter(function(d) { return d.scanHour === scanHour; }).length;
    var oldSearch = needSearch.length - newSearch;

    // Reserver tokens pour Phase 4 (multi-MKT) : 3 tokens par deal rentable sans multiMarket
    var pendingMultiMkt = Object.values(accumulated).filter(function(d) {
        return d.asin && d.profit > 0 && !d.multiMarket;
    }).length;
    var phase4Reserve = Math.min(pendingMultiMkt * 3, 30) + MIN_TOKENS;
    var phase3StopAt = Math.max(15, phase4Reserve);
    console.log('[CRON] Phase 4 reserve: ' + phase4Reserve + ' tokens (' + pendingMultiMkt + ' deals en attente multi-MKT) | Phase 3 stop a ' + phase3StopAt);

    var searched = 0;
    var searchSkipped = []; // deals non traites par manque de tokens
    console.log('[CRON] Phase 3: ' + newSearch + ' nouveaux sans ASIN' + (oldSearch > 0 ? ' + ' + oldSearch + ' anciens a rattraper' : ''));

    for (var j = 0; j < needSearch.length; j++) {
        if (lastTokens <= phase3StopAt) {
            // Plus assez de tokens — noter les deals restants
            for (var sk = j; sk < needSearch.length; sk++) {
                needSearch[sk].searchStatus = 'tokens_exhausted';
                searchSkipped.push(needSearch[sk].title.substring(0, 50));
            }
            tokensRanOut = true;
            console.log('[CRON] Phase 3 STOP: tokens=' + lastTokens + ', ' + searchSkipped.length + ' deals en attente');
            break;
        }

        var sd = needSearch[j];
        var sDom = SOURCE_DOMAINS[sd.source] || 4;
        var sr = await keepaSearch(apiKey, sd.title, sDom);
        if (!sr) continue;
        if (sr.tokensLeft !== undefined) lastTokens = sr.tokensLeft;

        if (!sr.asin) {
            sd.searchStatus = 'search_not_found';
            searchSkipped.push(sd.title.substring(0, 50) + ' (ASIN introuvable)');
            continue;
        }

        if (sr.asin) {
            sd.asin = sr.asin;
            sd.searchStatus = 'search_found';
            titleToAsin[sd.title.substring(0, 50).toLowerCase().trim()] = { asin: sr.asin, date: new Date().toISOString() };
            searched++;

            // Lookup immediat si assez de tokens
            if (lastTokens > MIN_TOKENS) {
                var lr = await keepaLookupOne(apiKey, sd.asin, sDom);
                if (lr.tokensLeft !== undefined && lr.tokensLeft >= 0) lastTokens = lr.tokensLeft;
                if (lr.data) {
                    sd.amazonPrice = lr.data.buyBoxPrice || lr.data.price;
                    sd.priceIsAvg = lr.data.priceIsAvg || false;
                    sd.buyBoxPrice = lr.data.buyBoxPrice || null;
                    sd.newOfferCount = lr.data.newOfferCount || null;
                    sd.monthlySold = lr.data.monthlySold || null;
                    sd.bsr = lr.data.bsr;
                    sd.fbaSellers = lr.data.fbaSellers;
                    sd.keepaData = lr.data;
                    sd.categoryName = lr.data.categoryName || null;
                    sd.priceCheckedAt = new Date().toISOString();

                    // Verifier vendabilite FBA
                    var ss3 = getSellStatus(lr.data);
                    sd.sellStatus = ss3 ? ss3.status : null;
                    sd.sellReason = ss3 ? ss3.reason : null;

                    if (sd.sellStatus === 'gated' || sd.sellStatus === 'amazon_sells' || sd.sellStatus === 'no_fba' || sd.sellStatus === 'too_competitive') {
                        console.log('[CRON]   SEARCH+LOOKUP ' + sd.asin + ': ' + sd.sellStatus.toUpperCase() + ' (' + (sd.sellReason || '') + ') — skip | tokens=' + lastTokens);
                        processedCount++;
                    } else {
                        if (sd.amazonPrice && sd.price > 0) {
                            var rr = calculateProfit(sd.price, lr.data);
                            if (rr) {
                                sd.profit = rr.profit;
                                sd.roi = rr.roi;
                                if (rr.profit > 0) profitableCount++;
                            }
                        }
                        processedCount++;
                        console.log('[CRON]   SEARCH+LOOKUP ' + sd.asin + ': ' + (sd.amazonPrice ? sd.amazonPrice.toFixed(2) + '€' : 'N/A') + (sd.profit ? ' profit=' + sd.profit.toFixed(2) + '€' : '') + ' [' + (sd.sellStatus || '?') + '] (tokens=' + lastTokens + ')');

                        // Collecter pour Telegram (envoye apres Phase 4 avec Best MKT)
                        if (sd.profit > 0 && sd.amazonPrice > 0) {
                            pendingNotifs.push(sd);
                        }
                    }
                }
            } else {
                sd.searchStatus = 'search_ok_no_tokens';
                searchSkipped.push(sd.title.substring(0, 50) + ' (ASIN trouve, pas de tokens pour lookup)');
                tokensRanOut = true;
            }
        }
    }
    console.log('[CRON] Phase 3 done: ' + searched + ' ASIN trouves | ' + elapsed(T));

    // Recalculer les profits pour les deals deja traites (anciens cycles)
    var allDeals = Object.values(accumulated);
    allDeals.forEach(function(deal) {
        if (deal.keepaData && deal.amazonPrice && deal.price > 0 && deal.profit === null) {
            var rCalc = calculateProfit(deal.price, deal.keepaData);
            if (rCalc) { deal.profit = rCalc.profit; deal.roi = rCalc.roi; if (rCalc.profit > 0) profitableCount++; }
        }
    });

    // --- Phase 4 : Multi-marketplace pour TOUS les deals rentables sans multiMarket ---
    var profitableDeals = allDeals.filter(function(d) {
        return d.asin && d.profit > 0 && !d.multiMarket;
    });
    console.log('[CRON] Phase 4 (multi-MKT): ' + profitableDeals.length + ' deals rentables a checker');

    for (var mi = 0; mi < profitableDeals.length; mi++) {
        if (lastTokens <= MIN_TOKENS + 3) { console.log('[CRON] Phase 4 STOP: tokens=' + lastTokens); break; }
        var md = profitableDeals[mi];
        var markets = {};
        var bestMarket = null;
        var bestProfit = -Infinity;

        // On a deja le prix FR (domain 4), ajouter les autres
        var frData = md.keepaData;
        if (frData && frData.price > 0) {
            var frCalc = calculateProfit(md.price, frData);
            markets['fr'] = { price: frData.price, profit: frCalc ? frCalc.profit : 0, roi: frCalc ? frCalc.roi : 0 };
            if (frCalc && frCalc.profit > bestProfit) { bestProfit = frCalc.profit; bestMarket = 'fr'; }
        }

        // Lookup DE, IT, ES (3 tokens)
        var otherDomains = [3, 8, 9]; // DE, IT, ES
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
        var bestLabel = bestMarket ? bestMarket.toUpperCase() : '?';
        console.log('[CRON]   Multi ' + md.asin + ': best=' + bestLabel + ' (' + bestProfit.toFixed(2) + '€) | tokens=' + lastTokens);
    }
    console.log('[CRON] Phase 4 done | ' + elapsed(T));

    // --- Telegram differe : envoyer les notifs avec Best MKT ---
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
    console.log('[CRON] Telegram: ' + newNotifs + ' notifs envoyees | ' + elapsed(T));

    // === 3. SAVE ===
    allDeals.sort(function(a, b) {
        var ra = (a.roi !== null && a.roi !== undefined) ? a.roi : -999;
        var rb = (b.roi !== null && b.roi !== undefined) ? b.roi : -999;
        return rb - ra;
    });

    // Tous les deals sont visibles (le nettoyage par expiration gere les vieux)
    var visibleDeals = allDeals;
    console.log('[CRON] Visible: ' + visibleDeals.length + ' deals');

    var dealsForBrowser = visibleDeals.map(function(d) {
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

    // Pipeline stats pour ce cycle
    var pendingMultiMktAfter = allDeals.filter(function(d) { return d.asin && d.profit > 0 && !d.multiMarket; }).length;
    var pipelineStats = {
        rssRaw: rssRawCount,
        afterDedup: afterDedupCount,
        afterFilter: afterFilterCount,
        newDeals: newCount,
        resolvedAsin: resolvedCount,
        searchedAsin: searched,
        priceChecked: processedCount,
        profitable: profitableCount,
        pendingMultiMkt: pendingMultiMktAfter,
        tokensUsed: (startTokens !== null && lastTokens !== 999) ? startTokens - lastTokens : 0,
        tokensLeft: (lastTokens !== 999) ? lastTokens : startTokens,
        startTokens: startTokens
    };

    // Charger l'historique pipeline et ajouter ce cycle
    var pipelineHistory = {};
    try {
        var ph = await dealStore.get('pipeline-history', { type: 'json' });
        if (ph) pipelineHistory = ph;
    } catch (e) {}
    pipelineHistory[scanHour] = pipelineStats;
    // Nettoyer les entrees > 72h
    var pipelineCutoff = now - 72 * 3600000;
    Object.keys(pipelineHistory).forEach(function(k) {
        try { if (new Date(k.length <= 16 ? k + ':00Z' : k).getTime() < pipelineCutoff) delete pipelineHistory[k]; } catch (e) { delete pipelineHistory[k]; }
    });

    try {
        await Promise.all([
            dealStore.setJSON('accumulated', accumulated),
            dealStore.setJSON('latest', {
                deals: dealsForBrowser,
                updatedAt: new Date().toISOString(),
                scanHour: scanHour,
                stats: { total: allDeals.length, withAsin: allDeals.filter(function(d) { return d.asin; }).length, profitable: profitableCount },
                pipelineStats: pipelineStats
            }),
            dealStore.setJSON('pipeline-history', pipelineHistory),
            asinCache.setJSON('title-map', titleToAsin)
        ]);
    } catch (e) { console.log('[CRON] Save erreur: ' + e.message); }
    console.log('[CRON] Saved | ' + elapsed(T));

    // === 4. TELEGRAM COMPTE-RENDU (seulement si aucune alerte deal envoyee) ===
    if (newNotifs === 0) {
        var newDealsThisCycle = Object.values(accumulated).filter(function(d) { return d.scanHour === scanHour; }).length;
        var realTokensLeft = (lastTokens !== 999) ? lastTokens : startTokens;
        var tokensUsed = (startTokens !== null && realTokensLeft !== null) ? startTokens - realTokensLeft : 0;

        var crHour = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
        var crMsg = '\u{1F4CA} *Compte-rendu ' + crHour + '*\n\n';
        crMsg += '\u{1F4E1} ' + newDealsThisCycle + ' nouveaux deals (Dealabs)\n';
        crMsg += '\u{1F50D} ' + resolvedCount + ' ASINs resolve-pepper | ' + searched + ' ASINs recherche\n';
        crMsg += '\u2705 ' + processedCount + ' deals traites | ' + profitableCount + ' rentables\n';
        if (startTokens !== null) {
            crMsg += '\u{1F4B0} Tokens: ' + tokensUsed + ' utilises | ' + (realTokensLeft !== null ? realTokensLeft : '?') + ' restants (depart: ' + startTokens + ')';
        } else {
            crMsg += '\u{1F4B0} Tokens: info indisponible';
        }

        if (searchSkipped.length > 0) {
            crMsg += '\n\n\u26A0\uFE0F *' + searchSkipped.length + ' deals non traites (tokens epuises) :*\n';
            for (var si = 0; si < Math.min(searchSkipped.length, 10); si++) {
                crMsg += '\u2022 ' + searchSkipped[si] + '\n';
            }
            if (searchSkipped.length > 10) crMsg += '\u2022 ... et ' + (searchSkipped.length - 10) + ' autres';
        }

        crMsg += '\n\n\u{1F504} Prochain scan dans 1h';
        await sendTelegram(botToken, chatId, crMsg);
    }

    console.log('[CRON] === Done: ' + allDeals.length + ' deals, ' + processedCount + ' traites, ' + profitableCount + ' rentables, ' + newNotifs + ' notifs' + (tokensRanOut ? ' | TOKENS EPUISES' : '') + ' | TOTAL ' + elapsed(T) + ' ===');
    return { statusCode: 200, body: JSON.stringify({ total: allDeals.length, processed: processedCount, profitable: profitableCount, notified: newNotifs, tokensRanOut: tokensRanOut }) };
};

exports.handler = schedule('0 * * * *', handler);
