const fetch = require('node-fetch');
const { getStore } = require('@netlify/blobs');

// ─── Presets de filtres ────────────────────────────────────────────────────
const PRESETS = {
    1: { name: 'Jouets premium',             category: 12950651,  bsrMin: 1000,  bsrMax: 30000,  priceMin: 2000,  priceMax: 6000  },
    2: { name: 'Électronique accessible',    category: 599364031, bsrMin: 5000,  bsrMax: 80000,  priceMin: 3000,  priceMax: 10000 },
    3: { name: 'Sports & Loisirs',           category: 16435051,  bsrMin: 1000,  bsrMax: 50000,  priceMin: 1500,  priceMax: 8000  },
    4: { name: 'Beauté & Santé',             category: 64252031,  bsrMin: 1000,  bsrMax: 30000,  priceMin: 1000,  priceMax: 5000  },
    5: { name: 'Bébé & Enfant',              category: 1084822,   bsrMin: 500,   bsrMax: 20000,  priceMin: 1500,  priceMax: 6000  },
    6: { name: 'Cuisine & Maison',           category: 3167641,   bsrMin: 2000,  bsrMax: 60000,  priceMin: 2000,  priceMax: 10000 },
    7: { name: 'Informatique accessoires',   category: 340843031, bsrMin: 3000,  bsrMax: 70000,  priceMin: 2500,  priceMax: 12000 },
    8: { name: 'Animalerie',                 category: 3036301,   bsrMin: 1000,  bsrMax: 40000,  priceMin: 1000,  priceMax: 5000  },
    9: { name: 'Bricolage & Outils',         category: 3006192,   bsrMin: 2000,  bsrMax: 60000,  priceMin: 3000,  priceMax: 15000 },
    10:{ name: 'Opportunité FR→DE',          category: null,      bsrMin: 500,   bsrMax: 50000,  priceMin: 2000,  priceMax: 8000  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────
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

async function readBlob(store, key, fallback) {
    try {
        const val = await store.get(key, { type: 'json' });
        return val ?? fallback;
    } catch { return fallback; }
}

async function writeBlob(store, key, data) {
    await store.setJSON(key, data);
}

// ─── SP-API : vérifier éligibilité d'un ASIN ──────────────────────────────
async function checkEligibility(asin, accessToken) {
    if (!accessToken) return 'pending'; // SP-API pas dispo
    try {
        const url = `https://sellingpartnerapi-eu.amazon.com/listings/2021-08-01/restrictions` +
            `?asin=${asin}&sellerId=${process.env.SP_API_SELLER_ID}&marketplaceIds=A1PA6795UKMFR9`;
        const resp = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'x-amz-access-token': accessToken,
                'Content-Type': 'application/json'
            }
        });
        if (!resp.ok) return 'pending';
        const data = await resp.json();
        const restrictions = data.restrictions || [];
        const isEligible = restrictions.length === 0 ||
            restrictions.every(r => r.reasons?.every(reason => reason.reasonCode !== 'NOT_ELIGIBLE'));
        return isEligible ? 'eligible' : 'gated';
    } catch { return 'pending'; }
}

// ─── SP-API : obtenir un access token via LWA ──────────────────────────────
async function getSPAPIToken() {
    const clientId     = process.env.SP_API_CLIENT_ID;
    const clientSecret = process.env.SP_API_CLIENT_SECRET;
    const refreshToken = process.env.SP_API_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;
    try {
        const resp = await fetch('https://api.amazon.com/auth/o2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret
            })
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.access_token || null;
    } catch { return null; }
}

// ─── Handler principal ─────────────────────────────────────────────────────
exports.handler = async () => {
    const KEEPA_KEY = process.env.KEEPA_API_KEY;
    if (!KEEPA_KEY) {
        console.error('[Prospection] KEEPA_API_KEY manquant');
        return { statusCode: 500 };
    }

    const store = getStore('oa-portfolio');

    // ── 1. Lire l'état courant ──────────────────────────────────────────────
    const settings   = await readBlob(store, 'settings',  { activePreset: 1, page: 0 });
    const portfolio  = await readBlob(store, 'portfolio', []);
    const queue      = await readBlob(store, 'queue',     []);
    const blacklist  = await readBlob(store, 'blacklist', []);
    const seenAsins  = new Set([
        ...portfolio.map(p => p.asin),
        ...queue.map(p => p.asin),
        ...blacklist.map(p => p.asin)
    ]);

    const preset    = PRESETS[settings.activePreset] || PRESETS[1];
    const page      = settings.page || 0;

    console.log(`[Prospection] Preset #${settings.activePreset} "${preset.name}", page ${page}`);

    // ── 2. SP-API token (optionnel) ────────────────────────────────────────
    const spToken = await getSPAPIToken();
    console.log(`[Prospection] SP-API: ${spToken ? 'disponible' : 'non disponible (file d\'attente)'}`);

    // ── 3. Keepa Finder ────────────────────────────────────────────────────
    let finderUrl = `https://api.keepa.com/query?key=${KEEPA_KEY}&domain=3` +
        `&current_SALES_gte=${preset.bsrMin}&current_SALES_lte=${preset.bsrMax}` +
        `&current_NEW_gte=${preset.priceMin}&current_NEW_lte=${preset.priceMax}` +
        `&perPage=50&page=${page}`;
    if (preset.category) finderUrl += `&categories_include=${preset.category}`;

    const finderResp = await fetch(finderUrl);
    const finderData = await finderResp.json();
    const allAsins   = finderData.asinList || [];
    const newAsins   = allAsins.filter(a => !seenAsins.has(a));

    console.log(`[Prospection] Keepa: ${allAsins.length} ASINs trouvés, ${newAsins.length} nouveaux`);

    // ── 4. Détails produits (max 20 nouveaux) ─────────────────────────────
    const toProcess = newAsins.slice(0, 20);
    let products = [];

    if (toProcess.length > 0) {
        const productUrl = `https://api.keepa.com/product?key=${KEEPA_KEY}&domain=3` +
            `&asin=${toProcess.join(',')}&stats=1&history=0`;
        const productResp = await fetch(productUrl);
        const productData = await productResp.json();

        products = (productData.products || []).map(p => {
            const current    = (p.stats || {}).current || [];
            const amazonPrice = current[0] ?? -1;
            const newPrice    = current[1] ?? -1;
            const bsr         = current[3] ?? -1;
            return {
                asin:    p.asin,
                title:   p.title || '',
                brand:   p.brand || '',
                category: p.categoryTree?.slice(-1)[0]?.name || '',
                image:   p.imagesCSV ? p.imagesCSV.split(',')[0] : '',
                price:   newPrice > 0 ? +(newPrice / 100).toFixed(2) : null,
                bsr:     bsr > 0 ? bsr : null,
                amazonSelling: amazonPrice > 0,
                link:    `https://www.amazon.de/dp/${p.asin}`,
                addedAt: Date.now(),
                preset:  settings.activePreset
            };
        }).filter(p => !p.amazonSelling && p.bsr && p.price);
    }

    // ── 5. SP-API check + classement ──────────────────────────────────────
    let countEligible = 0, countGated = 0, countPending = 0;
    const newPortfolio = [...portfolio];
    const newQueue     = [...queue];
    const newBlacklist = [...blacklist];

    for (const p of products) {
        const status = await checkEligibility(p.asin, spToken);
        p.status = status;
        if (status === 'eligible') {
            newPortfolio.push(p);
            countEligible++;
        } else if (status === 'gated') {
            newBlacklist.push({ asin: p.asin, brand: p.brand, title: p.title, addedAt: Date.now() });
            countGated++;
        } else {
            newQueue.push(p); // pending SP-API
            countPending++;
        }
    }

    // ── 6. Avancer la pagination pour le prochain run ─────────────────────
    const totalPages    = Math.ceil((finderData.totalResults || 50) / 50);
    const nextPage      = (page + 1) >= totalPages ? 0 : page + 1;
    // Si on a fait toutes les pages de ce preset → passer au preset suivant
    const nextPreset    = nextPage === 0
        ? (settings.activePreset >= 10 ? 1 : settings.activePreset + 1)
        : settings.activePreset;

    // ── 7. Sauvegarder dans Blobs ─────────────────────────────────────────
    await writeBlob(store, 'portfolio',  newPortfolio);
    await writeBlob(store, 'queue',      newQueue);
    await writeBlob(store, 'blacklist',  newBlacklist);
    await writeBlob(store, 'settings',  { activePreset: nextPreset, page: nextPage });

    // ── 8. Journal d'activité ─────────────────────────────────────────────
    const activityStore = getStore('oa-activity');
    const activity      = await readBlob(activityStore, 'log', []);
    activity.unshift({
        ts:     Date.now(),
        agent:  'prospection',
        preset: `#${settings.activePreset} ${preset.name}`,
        summary:`${products.length} produits analysés → ${countEligible} éligibles, ${countPending} en attente SP-API, ${countGated} gated`,
        stats:  { found: products.length, eligible: countEligible, pending: countPending, gated: countGated },
        tokensLeft: finderData.tokensLeft || 0
    });
    await writeBlob(activityStore, 'log', activity.slice(0, 100)); // garder les 100 derniers événements

    // ── 9. Telegram ───────────────────────────────────────────────────────
    const spStatus = spToken ? '✅ SP-API actif' : '⏳ SP-API en attente Production';
    const msg = `🔍 <b>Agent Prospection</b>\n` +
        `📂 Preset #${settings.activePreset} — ${preset.name}\n` +
        `📦 ${products.length} produits analysés\n` +
        `✅ ${countEligible} éligibles → portefeuille\n` +
        `⏳ ${countPending} en attente SP-API\n` +
        `❌ ${countGated} gated → blacklist\n` +
        `📊 Portefeuille total : ${newPortfolio.length} marques\n` +
        `🔑 ${spStatus}`;

    await sendTelegram(msg);

    console.log(`[Prospection] Terminé — eligible:${countEligible} pending:${countPending} gated:${countGated}`);
    return { statusCode: 200 };
};
