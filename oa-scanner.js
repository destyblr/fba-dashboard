// ===========================
// OA CROSS-BORDER SCANNER
// Nexyla — Amazon FBA Europe
// ===========================

// ===========================
// VARIABLES GLOBALES OA
// ===========================

let oaDataDE = [];          // Donnees CSV marche de VENTE (destination)
let oaDataFR = [];          // Donnees CSV marche d'ACHAT (source)
let oaScanResults = [];     // Resultats du scan filtre
let oaCurrentCheck = null;  // Produit en cours de verification
let oaCurrentCheckIndex = -1; // Index dans oaScanResults
let oaInventory = [];       // Inventaire OA
let oaFilterMode = 'strict'; // Mode de filtrage actif (strict ou souple)

// --- DEAL SCANNER ---
let dealScannerResults = [];    // Tous les deals fetches
let dealFilterMode = 'all';     // 'all', 'amazon', 'profitable', 'no_asin', 'unprocessed'
let dealPipelineHistory = {};   // scanHour → pipelineStats (from server)
let dealSellMarket = 'de';      // Marketplace de vente cible
let keepaCache = {};             // Cache ASIN → {price, bsr, timestamp}
let keepaQueue = [];             // ASINs en attente de lookup Keepa
let keepaProcessing = false;     // Flag pour eviter double processing queue
let dealHistory = {};            // Historique des deals vus : { link → { firstSeen, lastSeen, status } }
let selectedDealDay = 0;         // 0 = aujourd'hui, 1 = hier, 2 = avant-hier
let collapsedHourGroups = {};    // scanHour → true si groupe replie

const DEAL_SOURCES = {
    // Pepper RSS FR uniquement — baseUrl + mode hot/new
    dealabs:        { name: 'Dealabs', country: 'FR', type: 'rss', baseUrl: 'https://www.dealabs.com/rss/' },
};

// Mode RSS : 'new' (defaut, moins de concurrence) ou 'hot' (populaires)

// Blacklist mots-cles par defaut (marques gatees + produits ingerables)
const DEAL_BLACKLIST_DEFAULT = 'iPhone,iPad,MacBook,AirPods,Apple Watch,Samsung,Galaxy,Sony,PlayStation,PS5,PS4,Xbox,Surface,Nintendo,Switch,Huawei,Xiaomi,Oppo,OnePlus,Dyson,Nike,Adidas,LEGO,Bose,Rolex,Canon,Nikon,GoPro,televiseur,television,ordinateur portable,laptop,PC portable,smartphone,lave-linge,lave-vaisselle,refrigerateur,congelateur,micro-ondes,climatiseur,canape,matelas,pneu';

const KEEPA_DOMAINS = { de: 3, fr: 4, it: 8, es: 9 };
const KEEPA_CACHE_TTL = 4 * 60 * 60 * 1000; // 4h en ms (prix changent souvent)
const KEEPA_RATE_LIMIT_MS = 65000; // 65 secondes entre chaque appel

// Marketplaces Amazon Europe
const OA_MARKETPLACES = {
    'fr': { code: 'FR', name: 'France', domain: 'amazon.fr', flag: '\ud83c\uddeb\ud83c\uddf7', keepaSearch: 'Recherche de Produit', keepaViewer: 'Visualiseur de Produit' },
    'de': { code: 'DE', name: 'Allemagne', domain: 'amazon.de', flag: '\ud83c\udde9\ud83c\uddea', keepaSearch: 'Produktsuche', keepaViewer: 'Produktbetrachter' },
    'it': { code: 'IT', name: 'Italie', domain: 'amazon.it', flag: '\ud83c\uddee\ud83c\uddf9', keepaSearch: 'Ricerca Prodotti', keepaViewer: 'Visualizzatore Prodotti' },
    'es': { code: 'ES', name: 'Espagne', domain: 'amazon.es', flag: '\ud83c\uddea\ud83c\uddf8', keepaSearch: 'Buscador de Productos', keepaViewer: 'Visor de Productos' }
};

function getSource() { var s = loadOASettings(); return OA_MARKETPLACES[s.sourceMarket] || OA_MARKETPLACES['de']; }
function getDest() { var s = loadOASettings(); return OA_MARKETPLACES[s.destMarket] || OA_MARKETPLACES['fr']; }

const OA_DEFAULTS = {
    // Frais Amazon (FBA fee est par produit depuis Keepa, ce default est le fallback)
    commissionPct: 15,
    fbaFee: 3.50,
    storageFee: 26.00,

    // Couts utilisateur
    inboundShipping: 2.00,     // Fallback si pas de poids Keepa
    prepCost: 0.25,            // Machine 22€ + etiquettes 20€ = 42€/an / ~170 prod
    urssafPct: 12.3,

    // Charges fixes mensuelles (affichees dans le dashboard, PAS dans le calcul par produit)
    keepaCost: 29,             // Keepa 29€/mois
    sellerAmpCost: 19,         // SellerAmp 19€/mois

    // Criteres de selection — Strict (par defaut)
    minProfit: 5.00,
    minROI: 35,
    maxBSR: 30000,
    maxFBASellers: 5,
    amazonSells: false,
    minPriceDE: 15,
    maxPriceDE: 80,

    // Criteres de selection — Souple
    soupleMinProfit: 2.00,
    soupleMinROI: 15,
    soupleMaxBSR: 100000,
    soupleMaxFBASellers: 8,
    soupleMinPriceDE: 12,
    soupleMaxPriceDE: 100,

    // Direction (marche source = achat, marche dest = vente)
    sourceMarket: 'de',
    destMarket: 'fr',

    // API Keepa (pour Deal Scanner)
    keepaApiKey: '',

    // Capital
    capitalTotal: 755,
    maxPerProduct: 40,
    maxUnitsFirstBuy: 2,

    // Deal Scanner — Pre-filtres (avant Keepa)
    dealMinPrice: 8,
    dealMaxPrice: 100,
    dealMinDiscount: 30,
    dealBlacklist: DEAL_BLACKLIST_DEFAULT,

    // Deal Scanner — Post-filtres (apres Keepa)
    dealMinProfit: 3,
    dealMinROI: 30,
    dealMaxBSR: 100000,
    dealMaxFBASellers: 10,

    // Deal Scanner — Notifications
    telegramBotToken: '',
    telegramChatId: '',
    emailjsServiceId: '',
    emailjsTemplateId: '',
    emailjsPublicKey: '',
    dealNotifyMinProfit: 5        // Profit min pour declencher une notification
};

// Paliers inbound par poids (Envoi a AMZ)
// Basé sur envoi petit lot UPS/DHL FR→DE
function getInboundCost(weightGrams, settings) {
    if (!weightGrams || weightGrams <= 0) return settings.inboundShipping; // fallback
    if (weightGrams < 500) return 1.50;
    if (weightGrams < 2000) return 2.00;
    if (weightGrams < 5000) return 3.00;
    return 4.50;
}

// Estimation frais de stockage FBA
// volume en cm3, estSales = ventes mensuelles estimees, fbaSellers = nb vendeurs FBA
function getStorageCost(volumeCm3, estSales, fbaSellers, settings) {
    if (!volumeCm3 || volumeCm3 <= 0) return 0; // pas de volume = on ne peut pas estimer
    const volumeM3 = volumeCm3 / 1000000;
    const storageFeePerM3 = settings.storageFee || 26;

    // Estimer combien de temps ton unite reste en stock
    // Ta part des ventes = ventes totales / (nb vendeurs + 1 pour toi)
    const yourSalesPerMonth = estSales > 0 ? estSales / ((fbaSellers || 1) + 1) : 1;
    // Duree en stock pour vendre 1 unite (en mois), cap a 3 mois max
    const monthsInStock = Math.min(3, 1 / Math.max(0.1, yourSalesPerMonth));

    return Math.round(volumeM3 * storageFeePerM3 * monthsInStock * 100) / 100;
}

// Retourne les criteres de filtrage selon le mode actif (strict ou souple)
function getActiveFilters(settings) {
    if (oaFilterMode === 'souple') {
        return {
            minProfit: settings.soupleMinProfit || 2,
            minROI: settings.soupleMinROI || 15,
            maxBSR: settings.soupleMaxBSR || 100000,
            maxFBASellers: settings.soupleMaxFBASellers || 8,
            amazonSells: settings.amazonSells,
            minPriceDE: settings.soupleMinPriceDE || 12,
            maxPriceDE: settings.soupleMaxPriceDE || 100
        };
    }
    return {
        minProfit: settings.minProfit,
        minROI: settings.minROI,
        maxBSR: settings.maxBSR,
        maxFBASellers: settings.maxFBASellers,
        amazonSells: settings.amazonSells,
        minPriceDE: settings.minPriceDE,
        maxPriceDE: settings.maxPriceDE
    };
}

// Compter les resultats pour un mode donne
function countFilteredProducts(products, settings, mode) {
    var f = mode === 'souple' ? {
        minProfit: settings.soupleMinProfit || 2,
        minROI: settings.soupleMinROI || 15,
        maxBSR: settings.soupleMaxBSR || 100000,
        maxFBASellers: settings.soupleMaxFBASellers || 8,
        amazonSells: settings.amazonSells,
        minPriceDE: settings.soupleMinPriceDE || 12,
        maxPriceDE: settings.soupleMaxPriceDE || 100
    } : {
        minProfit: settings.minProfit,
        minROI: settings.minROI,
        maxBSR: settings.maxBSR,
        maxFBASellers: settings.maxFBASellers,
        amazonSells: settings.amazonSells,
        minPriceDE: settings.minPriceDE,
        maxPriceDE: settings.maxPriceDE
    };
    return products.filter(function(p) {
        if (p.pricDE <= p.pricFR) return false;
        if (p.profit <= 0) return false;
        if (p.profit < f.minProfit) return false;
        if (p.roi < f.minROI) return false;
        if (f.maxBSR > 0 && p.bsr > f.maxBSR && p.bsr > 0) return false;
        if (p.fbaSellers > f.maxFBASellers) return false;
        if (!f.amazonSells && p.amazonSells) return false;
        if (f.minPriceDE > 0 && p.pricDE < f.minPriceDE) return false;
        if (f.maxPriceDE > 0 && p.pricDE > f.maxPriceDE) return false;
        return true;
    }).length;
}

// Toggle entre strict et souple (sans relancer le scan)
function toggleFilterMode(mode) {
    oaFilterMode = mode;
    if (oaScanResults.length === 0) return;

    var settings = loadOASettings();
    var strictCount = countFilteredProducts(oaScanResults, settings, 'strict');
    var soupleCount = countFilteredProducts(oaScanResults, settings, 'souple');
    var activeCount = mode === 'souple' ? soupleCount : strictCount;

    renderScanResults(oaScanResults, activeCount, null, strictCount, soupleCount);
    console.log('[OA] Mode filtre: ' + mode + ' (' + activeCount + ' resultats)');
}

function getInboundLabel(weightGrams) {
    if (!weightGrams || weightGrams <= 0) return 'defaut (pas de poids)';
    if (weightGrams < 500) return '< 500g';
    if (weightGrams < 2000) return '500g-2kg';
    if (weightGrams < 5000) return '2-5kg';
    return '> 5kg';
}

// ===========================
// 1. OA SETTINGS
// ===========================

function loadOASettings() {
    try {
        const saved = localStorage.getItem('oaSettings');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Fusionner avec les defauts pour garantir toutes les cles
            return Object.assign({}, OA_DEFAULTS, parsed);
        }
    } catch (e) {
        console.log('[OA] Erreur chargement parametres:', e);
    }
    return Object.assign({}, OA_DEFAULTS);
}

function saveOASettings() {
    const settings = {};
    const fields = [
        { id: 'oa-commissionPct', key: 'commissionPct', type: 'float' },
        { id: 'oa-fbaFee', key: 'fbaFee', type: 'float' },
        { id: 'oa-storageFee', key: 'storageFee', type: 'float' },
        { id: 'oa-inboundShipping', key: 'inboundShipping', type: 'float' },
        { id: 'oa-prepCost', key: 'prepCost', type: 'float' },
        { id: 'oa-urssafPct', key: 'urssafPct', type: 'float' },
        { id: 'oa-keepaCost', key: 'keepaCost', type: 'float' },
        { id: 'oa-sellerAmpCost', key: 'sellerAmpCost', type: 'float' },
        { id: 'oa-minProfit', key: 'minProfit', type: 'float' },
        { id: 'oa-minROI', key: 'minROI', type: 'float' },
        { id: 'oa-maxBSR', key: 'maxBSR', type: 'int' },
        { id: 'oa-maxFBASellers', key: 'maxFBASellers', type: 'int' },
        { id: 'oa-amazonSells', key: 'amazonSells', type: 'bool' },
        { id: 'oa-minPriceDE', key: 'minPriceDE', type: 'float' },
        { id: 'oa-maxPriceDE', key: 'maxPriceDE', type: 'float' },
        { id: 'oa-souple-minProfit', key: 'soupleMinProfit', type: 'float' },
        { id: 'oa-souple-minROI', key: 'soupleMinROI', type: 'float' },
        { id: 'oa-souple-maxBSR', key: 'soupleMaxBSR', type: 'int' },
        { id: 'oa-souple-maxFBASellers', key: 'soupleMaxFBASellers', type: 'int' },
        { id: 'oa-souple-minPriceDE', key: 'soupleMinPriceDE', type: 'float' },
        { id: 'oa-souple-maxPriceDE', key: 'soupleMaxPriceDE', type: 'float' },
        { id: 'oa-capitalTotal', key: 'capitalTotal', type: 'float' },
        { id: 'oa-maxPerProduct', key: 'maxPerProduct', type: 'float' },
        { id: 'oa-maxUnitsFirstBuy', key: 'maxUnitsFirstBuy', type: 'int' },
        { id: 'oa-sourceMarket', key: 'sourceMarket', type: 'string' },
        { id: 'oa-destMarket', key: 'destMarket', type: 'string' },
        { id: 'oa-keepaApiKey', key: 'keepaApiKey', type: 'string' },
        // Deal Scanner filtres
        { id: 'oa-dealMinPrice', key: 'dealMinPrice', type: 'float' },
        { id: 'oa-dealMaxPrice', key: 'dealMaxPrice', type: 'float' },
        { id: 'oa-dealMinDiscount', key: 'dealMinDiscount', type: 'int' },
        { id: 'oa-dealBlacklist', key: 'dealBlacklist', type: 'string' },
        { id: 'oa-dealMinProfit', key: 'dealMinProfit', type: 'float' },
        { id: 'oa-dealMinROI', key: 'dealMinROI', type: 'int' },
        { id: 'oa-dealMaxBSR', key: 'dealMaxBSR', type: 'int' },
        { id: 'oa-dealMaxFBASellers', key: 'dealMaxFBASellers', type: 'int' },
        // Notifications
        { id: 'oa-telegramBotToken', key: 'telegramBotToken', type: 'string' },
        { id: 'oa-telegramChatId', key: 'telegramChatId', type: 'string' },
        { id: 'oa-emailjsServiceId', key: 'emailjsServiceId', type: 'string' },
        { id: 'oa-emailjsTemplateId', key: 'emailjsTemplateId', type: 'string' },
        { id: 'oa-emailjsPublicKey', key: 'emailjsPublicKey', type: 'string' },
        { id: 'oa-dealNotifyMinProfit', key: 'dealNotifyMinProfit', type: 'float' }
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        if (f.type === 'bool') {
            settings[f.key] = el.checked || false;
        } else if (f.type === 'int') {
            settings[f.key] = parseInt(el.value) || 0;
        } else if (f.type === 'string') {
            settings[f.key] = el.value || '';
        } else {
            settings[f.key] = parseFloat(el.value) || 0;
        }
    });

    // Validation : source != destination
    if (settings.sourceMarket && settings.destMarket && settings.sourceMarket === settings.destMarket) {
        showOANotification('Le marche source et destination doivent etre differents !', 'error');
        return;
    }

    try {
        localStorage.setItem('oaSettings', JSON.stringify(settings));
        console.log('[OA] Parametres sauvegardes:', settings);
        showOANotification('Parametres sauvegardes !', 'success');

        // Auto-refresh : recalculer les resultats si on a des donnees
        if (oaScanResults.length > 0) {
            console.log('[OA] Recalcul avec les nouveaux parametres...');
            oaScanResults.forEach(p => calculateProfit(p, settings));
            oaScanResults = sortProducts(oaScanResults);
            var strictC = countFilteredProducts(oaScanResults, settings, 'strict');
            var soupleC = countFilteredProducts(oaScanResults, settings, 'souple');
            var activeC = oaFilterMode === 'souple' ? soupleC : strictC;
            renderScanResults(oaScanResults, activeC, null, strictC, soupleC);
            showOANotification('Resultats recalcules (' + activeC + ' rentables en mode ' + oaFilterMode + ')', 'success');
        }
        updateFixedChargesDashboard();
        updateMarketplaceLabels();
    } catch (e) {
        console.log('[OA] Erreur sauvegarde parametres:', e);
        showOANotification('Erreur sauvegarde parametres', 'error');
    }
}

function initOASettings() {
    const settings = loadOASettings();
    const fields = [
        { id: 'oa-commissionPct', key: 'commissionPct' },
        { id: 'oa-fbaFee', key: 'fbaFee' },
        { id: 'oa-storageFee', key: 'storageFee' },
        { id: 'oa-inboundShipping', key: 'inboundShipping' },
        { id: 'oa-prepCost', key: 'prepCost' },
        { id: 'oa-urssafPct', key: 'urssafPct' },
        { id: 'oa-keepaCost', key: 'keepaCost' },
        { id: 'oa-sellerAmpCost', key: 'sellerAmpCost' },
        { id: 'oa-minProfit', key: 'minProfit' },
        { id: 'oa-minROI', key: 'minROI' },
        { id: 'oa-maxBSR', key: 'maxBSR' },
        { id: 'oa-maxFBASellers', key: 'maxFBASellers' },
        { id: 'oa-amazonSells', key: 'amazonSells' },
        { id: 'oa-minPriceDE', key: 'minPriceDE' },
        { id: 'oa-maxPriceDE', key: 'maxPriceDE' },
        { id: 'oa-souple-minProfit', key: 'soupleMinProfit' },
        { id: 'oa-souple-minROI', key: 'soupleMinROI' },
        { id: 'oa-souple-maxBSR', key: 'soupleMaxBSR' },
        { id: 'oa-souple-maxFBASellers', key: 'soupleMaxFBASellers' },
        { id: 'oa-souple-minPriceDE', key: 'soupleMinPriceDE' },
        { id: 'oa-souple-maxPriceDE', key: 'soupleMaxPriceDE' },
        { id: 'oa-capitalTotal', key: 'capitalTotal' },
        { id: 'oa-maxPerProduct', key: 'maxPerProduct' },
        { id: 'oa-maxUnitsFirstBuy', key: 'maxUnitsFirstBuy' },
        { id: 'oa-sourceMarket', key: 'sourceMarket' },
        { id: 'oa-destMarket', key: 'destMarket' },
        { id: 'oa-keepaApiKey', key: 'keepaApiKey' },
        // Deal Scanner filtres
        { id: 'oa-dealMinPrice', key: 'dealMinPrice' },
        { id: 'oa-dealMaxPrice', key: 'dealMaxPrice' },
        { id: 'oa-dealMinDiscount', key: 'dealMinDiscount' },
        { id: 'oa-dealBlacklist', key: 'dealBlacklist' },
        { id: 'oa-dealMinProfit', key: 'dealMinProfit' },
        { id: 'oa-dealMinROI', key: 'dealMinROI' },
        { id: 'oa-dealMaxBSR', key: 'dealMaxBSR' },
        { id: 'oa-dealMaxFBASellers', key: 'dealMaxFBASellers' },
        // Notifications
        { id: 'oa-telegramBotToken', key: 'telegramBotToken' },
        { id: 'oa-telegramChatId', key: 'telegramChatId' },
        { id: 'oa-emailjsServiceId', key: 'emailjsServiceId' },
        { id: 'oa-emailjsTemplateId', key: 'emailjsTemplateId' },
        { id: 'oa-emailjsPublicKey', key: 'emailjsPublicKey' },
        { id: 'oa-dealNotifyMinProfit', key: 'dealNotifyMinProfit' }
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        if (f.key === 'amazonSells') {
            el.checked = settings[f.key] || false;
        } else {
            el.value = settings[f.key];
        }
    });

    // Afficher le status API Keepa
    var keepaStatus = document.getElementById('keepa-api-status');
    if (keepaStatus && settings.keepaApiKey) {
        keepaStatus.classList.remove('hidden');
    }

    console.log('[OA] Parametres initialises');
}

function resetOASettings() {
    if (!confirm('Reinitialiser tous les parametres OA aux valeurs par defaut ?')) return;
    localStorage.removeItem('oaSettings');
    initOASettings();
    showOANotification('Parametres reinitialises aux valeurs par defaut', 'success');
    console.log('[OA] Parametres reinitialises');
}

// Met a jour tous les labels dynamiques selon la direction source/dest choisie
function updateMarketplaceLabels() {
    var src = getSource();
    var dst = getDest();

    // Labels CSV zones
    var csvLabelDe = document.getElementById('csv-label-dest');
    var csvSubDe = document.getElementById('csv-sub-dest');
    var csvLabelFr = document.getElementById('csv-label-source');
    var csvSubFr = document.getElementById('csv-sub-source');
    if (csvLabelDe) csvLabelDe.innerHTML = 'CSV Amazon.<strong>' + dst.code + '</strong> ' + dst.flag;
    if (csvSubDe) csvSubDe.innerHTML = 'Keepa <strong>' + dst.keepaSearch + '</strong>';
    if (csvLabelFr) csvLabelFr.innerHTML = 'CSV Amazon.<strong>' + src.code + '</strong> ' + src.flag;
    if (csvSubFr) csvSubFr.innerHTML = 'Keepa <strong>' + src.keepaViewer + '</strong>';

    // Labels checklist
    var checkPriceDe = document.getElementById('check-label-price-dest');
    var checkPriceFr = document.getElementById('check-label-price-source');
    if (checkPriceDe) checkPriceDe.textContent = 'Prix ' + dst.code + ' (vente)';
    if (checkPriceFr) checkPriceFr.textContent = 'Prix ' + src.code + ' (achat)';

    // Labels parametres prix
    var labelMinPrice = document.getElementById('label-minPriceDE');
    var labelMaxPrice = document.getElementById('label-maxPriceDE');
    if (labelMinPrice) labelMinPrice.textContent = 'Prix vente min (' + dst.code + ')';
    if (labelMaxPrice) labelMaxPrice.textContent = 'Prix vente max (' + dst.code + ')';

    // Guide ASIN extract
    var guideText = document.getElementById('asin-guide-text');
    if (guideText) guideText.innerHTML = 'Le CSV ' + dst.code + ' est charge. Maintenant il faut recuperer les prix ' + src.code + ' <b>des memes produits</b>. Copie les ASINs ci-dessous, va dans Keepa ' + src.keepaViewer + ' (Amazon.' + src.code.toLowerCase() + '), colle-les, charge, puis exporte en CSV.';
    var guideSteps = document.getElementById('asin-guide-steps');
    if (guideSteps) guideSteps.textContent = 'Sur Keepa ' + src.keepaViewer + ' : 1) Selectionne Amazon.' + src.code.toLowerCase() + ' 2) Colle les ASINs 3) Charge 4) Exporte CSV 5) Importe ici dans la zone CSV ' + src.code;

    // Direction indicator
    var dirLabel = document.getElementById('oa-direction-label');
    if (dirLabel) dirLabel.innerHTML = src.flag + ' ' + src.code + ' <i class="fas fa-arrow-right mx-2"></i> ' + dst.flag + ' ' + dst.code;

    // Checklist : step 2 = prix de VENTE (destination), step 4 = prix d'ACHAT (source)
    var step2Title = document.getElementById('check-step2-title');
    var step2Sub = document.getElementById('check-step2-sub');
    var step4Title = document.getElementById('check-step4-title');
    var step4Sub = document.getElementById('check-step4-sub');
    if (step2Title) step2Title.textContent = 'Prix ' + dst.domain + ' actuel (vente)';
    if (step2Sub) step2Sub.textContent = 'Ouvre ' + dst.domain + ' et verifie le prix de vente actuel';
    if (step4Title) step4Title.textContent = 'Prix ' + src.domain + ' (achat) + Disponibilite';
    if (step4Sub) step4Sub.textContent = 'Le produit est disponible sur ' + src.domain + ' au bon prix ?';

    console.log('[OA] Labels mis a jour: ' + src.code + ' -> ' + dst.code);
}

// Dashboard charges fixes (bandeau persistant en haut de toutes les sections OA)
let oaCurrentPeriod = 'month';

function setOAPeriod(period) {
    oaCurrentPeriod = period;
    // Mettre a jour les boutons actifs
    document.querySelectorAll('.oa-period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === period);
    });
    updateFixedChargesDashboard();
}

function getDateFilter(period) {
    const now = new Date();
    if (period === 'month') {
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    } else if (period === 'lastmonth') {
        const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0');
    } else if (period === 'year') {
        return String(now.getFullYear());
    }
    return ''; // 'all' — pas de filtre
}

function getPeriodLabel(period) {
    if (period === 'month') return 'ce mois';
    if (period === 'lastmonth') return 'mois dernier';
    if (period === 'year') return 'cette annee';
    return 'depuis le debut';
}

// Retourne le nombre de mois TERMINES (charges prelevees fin de mois)
function getCompletedMonths(period) {
    const now = new Date();
    if (period === 'month') return 0;       // mois en cours = pas encore preleve
    if (period === 'lastmonth') return 1;    // mois dernier = deja preleve
    if (period === 'year') return now.getMonth(); // mois termines cette annee (jan=0 si on est en jan, etc.)
    return 0; // 'all' — on calcule ci-dessous
}

function updateFixedChargesDashboard() {
    const settings = loadOASettings();
    const fixedMonthly = (settings.keepaCost || 29) + (settings.sellerAmpCost || 19);
    const period = oaCurrentPeriod;
    const dateFilter = getDateFilter(period);
    const periodLabel = getPeriodLabel(period);

    // Filtrer l'inventaire par periode
    const inventory = loadOAInventory();

    const filterByDate = function(item, dateField) {
        if (!dateFilter) return true; // 'all'
        const d = item[dateField];
        return d && d.startsWith(dateFilter);
    };

    // Produits achetes dans la periode
    const boughtInPeriod = inventory.filter(function(p) { return filterByDate(p, 'dateAdded'); });
    const boughtCount = boughtInPeriod.length;

    // Produits vendus dans la periode
    const soldInPeriod = inventory.filter(function(p) {
        return p.status === 'vendu' && filterByDate(p, 'dateSold');
    });
    const salesCount = soldInPeriod.length;
    const totalProfit = soldInPeriod.reduce(function(s, p) { return s + (p.realProfit || 0); }, 0);

    // Charges fixes : seulement les mois TERMINES (prelevees en fin de mois)
    var completedMonths = getCompletedMonths(period);
    var isCurrentMonth = (period === 'month');
    if (period === 'all' && inventory.length > 0) {
        // Nombre de mois termines depuis le premier achat
        const dates = inventory.map(function(p) { return new Date(p.dateAdded); }).filter(function(d) { return !isNaN(d); });
        if (dates.length > 0) {
            const oldest = new Date(Math.min.apply(null, dates));
            const now = new Date();
            // Mois termines = total - 1 (le mois en cours n'est pas termine)
            completedMonths = Math.max(0, Math.ceil((now - oldest) / (30.44 * 24 * 60 * 60 * 1000)) - 1);
        }
    }
    const totalFixedCharges = fixedMonthly * completedMonths;

    // Cout par vente (sur les charges deja prelevees)
    const costPerSale = salesCount > 0 && totalFixedCharges > 0 ? totalFixedCharges / salesCount : 0;
    const netResult = totalProfit - totalFixedCharges;

    // Mettre a jour le DOM
    var el;
    el = document.getElementById('oa-fixed-total');
    if (el) {
        if (isCurrentMonth) {
            el.textContent = fixedMonthly.toFixed(0) + ' \u20ac';
        } else {
            el.textContent = totalFixedCharges.toFixed(0) + ' \u20ac';
        }
    }

    el = document.getElementById('oa-fixed-period-label');
    if (el) {
        if (isCurrentMonth) {
            el.textContent = 'a deduire fin de mois';
        } else if (completedMonths > 1) {
            el.textContent = periodLabel + ' (' + completedMonths + ' mois)';
        } else {
            el.textContent = periodLabel;
        }
    }

    el = document.getElementById('oa-fixed-bought');
    if (el) el.textContent = boughtCount;

    el = document.getElementById('oa-fixed-sales');
    if (el) el.textContent = salesCount;

    el = document.getElementById('oa-fixed-per-sale');
    if (el) {
        if (isCurrentMonth) {
            // Mois en cours : on montre combien il faudrait vendre pour couvrir les charges
            el.textContent = salesCount > 0 ? (fixedMonthly / salesCount).toFixed(2) + ' \u20ac' : '- \u20ac';
        } else {
            el.textContent = salesCount > 0 && totalFixedCharges > 0 ? costPerSale.toFixed(2) + ' \u20ac' : '- \u20ac';
        }
    }

    el = document.getElementById('oa-fixed-profit');
    if (el) {
        el.textContent = totalProfit.toFixed(2) + ' \u20ac';
        el.className = 'text-lg font-bold ' + (totalProfit >= 0 ? 'text-green-300' : 'text-red-300');
    }

    el = document.getElementById('oa-fixed-net');
    if (el) {
        if (isCurrentMonth) {
            // Mois en cours : montrer le profit brut (charges pas encore prelevees)
            // mais indiquer ce que ca donnera apres charges
            var projected = totalProfit - fixedMonthly;
            el.textContent = totalProfit.toFixed(2) + ' \u20ac';
            el.className = 'text-lg font-bold text-cyan-300';
            el.title = 'Apres charges fin de mois : ' + (projected >= 0 ? '+' : '') + projected.toFixed(2) + '\u20ac';
        } else {
            el.textContent = (netResult >= 0 ? '+' : '') + netResult.toFixed(2) + ' \u20ac';
            el.className = 'text-lg font-bold ' + (netResult >= 0 ? 'text-green-300' : 'text-red-300');
            el.title = '';
        }
    }

    // Label sous resultat net
    var netLabel = document.getElementById('oa-fixed-net-label');
    if (netLabel) {
        if (isCurrentMonth) {
            netLabel.textContent = 'avant charges (-' + fixedMonthly + '\u20ac)';
        } else {
            netLabel.textContent = 'profit - charges';
        }
    }

    var card = document.getElementById('oa-fixed-net-card');
    if (card) {
        if (isCurrentMonth) {
            card.className = 'bg-gray-700/50 rounded-xl p-3 text-center border-2 border-cyan-500/50';
        } else {
            card.className = 'bg-gray-700/50 rounded-xl p-3 text-center border-2 ' +
                (netResult >= 0 ? 'border-green-500/50' : 'border-red-500/50');
        }
    }
}

// loadOAInventory() est definie plus bas dans la section inventaire

// ===========================
// 2. CSV PARSER & SCANNER
// ===========================

// Gestionnaires d'evenements pour les zones d'import CSV dans le HTML
function handleCSVSelect(event, marketplace) {
    const file = event.target.files[0];
    if (file) handleCSVImport(file, marketplace);
}

function handleCSVDrop(event, marketplace) {
    event.preventDefault();
    event.target.closest('[id^="csv-zone"]').classList.remove('border-indigo-500', 'bg-indigo-50');
    const file = event.dataTransfer.files[0];
    if (file) handleCSVImport(file, marketplace);
}

function handleCSVImport(file, marketplace) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const csvText = e.target.result;
        const data = parseKeepaCSV(csvText);

        if (marketplace === 'de') {
            oaDataDE = data;
            updateCSVStatus('de', file.name, data.length);
            console.log('[OA] CSV vente charge:', data.length, 'produits');
            // Afficher le guide d'extraction ASINs si source pas encore charge
            if (data.length > 0 && oaDataFR.length === 0) {
                showASINExtractGuide(data.length);
            }
        } else if (marketplace === 'fr') {
            oaDataFR = data;
            updateCSVStatus('fr', file.name, data.length);
            console.log('[OA] CSV achat charge:', data.length, 'produits');
            // Cacher le guide si visible
            const guide = document.getElementById('asin-extract-zone');
            if (guide) guide.classList.add('hidden');
        }

        // Lancer le scan automatiquement si les 2 CSV sont charges
        if (oaDataDE.length > 0 && oaDataFR.length > 0) {
            console.log('[OA] Les 2 CSV sont charges, lancement du scan...');
            runScan();
        }
    };

    reader.onerror = function() {
        console.log('[OA] Erreur lecture fichier:', file.name);
        showOANotification('Erreur lecture du fichier ' + file.name, 'error');
    };

    reader.readAsText(file, 'UTF-8');
}

function parseKeepaCSV(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    // Detecter le separateur (virgule, point-virgule, tab)
    const headerLine = lines[0];
    let separator = ',';
    if (headerLine.indexOf('\t') !== -1) {
        separator = '\t';
    } else if (headerLine.split(';').length > headerLine.split(',').length) {
        separator = ';';
    }

    const headers = parseCSVLine(headerLine, separator);
    const headerMap = {};
    headers.forEach((h, i) => {
        headerMap[h.trim().toLowerCase()] = i;
    });

    // Mapper les colonnes Keepa (recherche flexible — EN + FR)
    const colASIN = findColumn(headerMap, ['asin']);
    const colTitle = findColumn(headerMap, ['title', 'titre', 'product name', 'nom']);
    const colBSR = findColumn(headerMap, [
        'sales rank: current', 'classement des ventes: courant',
        'sales rank current', 'salesrank', 'sales rank', 'bsr'
    ]);
    const colBSR90 = findColumn(headerMap, [
        'sales rank: 90 days avg', 'classement des ventes: moyenne sur 90 jours',
        'sales rank 90 days avg'
    ]);
    const colBuyBox = findColumn(headerMap, [
        'buy box: current', 'buy box: courant',
        'buy box current', 'buybox'
    ]);
    const colNewOffers = findColumn(headerMap, [
        "new offer count: current", "nombre d'offre neuf fba: courant",
        "count of retrieved live offers: new, fba",
        "new offer count current", "new offer count", "new offers"
    ]);
    const colAmazonPrice = findColumn(headerMap, [
        'amazon: current', 'amazon: courant', 'amazon current'
    ]);
    const colCategory = findColumn(headerMap, [
        'categories: root', "cat\u00e9gories: principale",
        'categories root', 'category', 'categories'
    ]);
    const colNewPrice = findColumn(headerMap, [
        'new: current', 'nouveau: courant',
        'nouveau, tierce partie fba: courant',
        'new current', 'new price'
    ]);
    const colEstSales = findColumn(headerMap, [
        'bought in past month', "achet\u00e9s au cours du mois dernier",
        'estimated sales', 'est. sales', 'sales estimate', 'estimated monthly sales'
    ]);

    // Colonnes de stabilite prix (Keepa 90 jours — EN + FR)
    const colBuyBox90 = findColumn(headerMap, [
        'buy box: 90 days avg', 'buy box: moyenne sur 90 jours',
        'buy box 90 days avg'
    ]);
    const colBuyBox90Drop = findColumn(headerMap, [
        'buy box: 90 days drop %', 'buy box: baisse sur 90 jours %',
        'buy box 90 days drop'
    ]);
    const colNew90 = findColumn(headerMap, [
        'new: 90 days avg', 'nouveau: moyenne sur 90 jours',
        'nouveau, tierce partie fba: moyenne sur 90 jours',
        'new 90 days avg'
    ]);
    const colBuyBoxMin90 = findColumn(headerMap, [
        'buy box: 90 days min', 'buy box: lowest 90'
    ]);
    const colBuyBoxMax90 = findColumn(headerMap, [
        'buy box: 90 days max', 'buy box: highest 90'
    ]);

    // Colonnes de frais reels Keepa (par produit)
    const colFBAFee = findColumn(headerMap, [
        "fba pick & pack fee", "fba fees", "frais d'enl\u00e8vement et d'emballage fba",
        "frais d'enlèvement et d'emballage fba"
    ]);
    const colReferralPct = findColumn(headerMap, [
        '% referral fee', 'referral fee %', '% de frais de parrainage'
    ]);
    const colReferralAmt = findColumn(headerMap, [
        'referral fee based on current buy box price',
        "frais de parrainage bas\u00e9s sur le prix actuel de la buy box",
        "frais de parrainage basés sur le prix actuel de la buy box"
    ]);

    // Colonnes poids/dimensions (pour calcul inbound intelligent)
    const colPackageWeight = findColumn(headerMap, [
        'package: weight (g)', 'emballage: poids (g)', 'package weight',
        'verpackung: gewicht (g)', 'paquete: peso (g)', 'confezione: peso (g)',
        'weight (g)', 'gewicht (g)', 'peso (g)', 'poids (g)'
    ]);
    const colItemWeight = findColumn(headerMap, [
        'item: weight (g)', 'article: poids (g)', 'item weight',
        'artikel: gewicht (g)', 'articulo: peso (g)', 'articolo: peso (g)'
    ]);
    const colPackageDim = findColumn(headerMap, [
        'package: dimension (cm cubed)', 'emballage: dimension (cm cubed)',
        'verpackung: abmessung (cm cubed)', 'paquete: dimension (cm cubed)',
        'confezione: dimensione (cm cubed)', 'dimension (cm cubed)',
        'package: dimension (cm³)', 'package dimension'
    ]);

    // Debug: afficher les colonnes detectees
    console.log('[OA] Colonnes detectees:', {
        ASIN: colASIN, Titre: colTitle, BSR: colBSR, BuyBox: colBuyBox,
        FBASellers: colNewOffers, Amazon: colAmazonPrice, NewPrice: colNewPrice,
        EstSales: colEstSales, BuyBox90: colBuyBox90, BuyBox90Drop: colBuyBox90Drop,
        FBAFee: colFBAFee, ReferralPct: colReferralPct, ReferralAmt: colReferralAmt,
        PackageWeight: colPackageWeight, PackageDim: colPackageDim
    });
    console.log('[OA] Nb headers:', headers.length, '| Premieres colonnes:', headers.slice(0, 5));
    // Debug poids/volume : lister les headers qui contiennent weight/poids/dimension/volume/gewicht
    var weightHeaders = headers.filter(h => /weight|poids|gewicht|peso|dimension|volume|abmessung|packag|emballag|verpackung/i.test(h));
    console.log('[OA] Headers poids/volume trouves:', weightHeaders);
    if (colPackageWeight === -1 && colItemWeight === -1) console.warn('[OA] ATTENTION: aucune colonne poids detectee !');
    if (colPackageDim === -1) console.warn('[OA] ATTENTION: aucune colonne volume/dimension detectee !');

    const products = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], separator);
        if (values.length < 2) continue;

        const asin = getVal(values, colASIN, '').trim();
        if (!asin || asin.length < 5) continue;

        const price = parsePrice(getVal(values, colBuyBox, '')) || parsePrice(getVal(values, colNewPrice, ''));
        const bsr = parseInt(getVal(values, colBSR, '0').replace(/[^0-9]/g, '')) || 0;
        const bsr90 = parseInt(getVal(values, colBSR90, '0').replace(/[^0-9]/g, '')) || 0;
        const amazonPrice = parsePrice(getVal(values, colAmazonPrice, ''));
        const fbaSellers = parseInt(getVal(values, colNewOffers, '0').replace(/[^0-9]/g, '')) || 0;
        const estSales = parseInt(getVal(values, colEstSales, '0').replace(/[^0-9]/g, '')) || 0;

        // Donnees stabilite prix
        const price90avg = parsePrice(getVal(values, colBuyBox90, '')) || parsePrice(getVal(values, colNew90, ''));
        const price90drop = parseInt(getVal(values, colBuyBox90Drop, '0').replace(/[^0-9\-]/g, '')) || 0;
        const price90min = parsePrice(getVal(values, colBuyBoxMin90, ''));
        const price90max = parsePrice(getVal(values, colBuyBoxMax90, ''));

        // Frais reels Keepa (par produit)
        const fbaFeeReal = parsePrice(getVal(values, colFBAFee, ''));
        const referralPctRaw = getVal(values, colReferralPct, '');
        const referralPct = parseFloat(referralPctRaw.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        const referralAmt = parsePrice(getVal(values, colReferralAmt, ''));

        // Poids (grammes) — prend le poids emballage en priorite, sinon article
        const packageWeight = parseInt(getVal(values, colPackageWeight, '0').replace(/[^0-9]/g, '')) || 0;
        const itemWeight = parseInt(getVal(values, colItemWeight, '0').replace(/[^0-9]/g, '')) || 0;
        const weight = packageWeight || itemWeight;

        // Volume colis (cm3) — pour estimation frais de stockage
        var volumeRaw = getVal(values, colPackageDim, '0').replace(/,/g, '.').replace(/[^0-9.]/g, '');
        var volumeCm3 = Math.round(parseFloat(volumeRaw) || 0);
        // Fallback : estimer le volume depuis le poids si Keepa ne fournit pas le volume
        if (volumeCm3 <= 0 && weight > 0) {
            // Estimation grossiere : 1g ~ 2.5 cm3 (densite moyenne produits consumer)
            volumeCm3 = Math.round(weight * 2.5);
        }

        products.push({
            asin: asin,
            title: getVal(values, colTitle, 'Sans titre').trim(),
            price: price,
            bsr: bsr,
            bsr90: bsr90,
            amazonPrice: amazonPrice,
            amazonSells: amazonPrice > 0,
            fbaSellers: fbaSellers,
            fbaFeeReal: fbaFeeReal,
            referralPct: referralPct,
            referralAmt: referralAmt,
            category: getVal(values, colCategory, '').trim(),
            estSales: estSales,
            price90avg: price90avg,
            price90drop: price90drop,
            price90min: price90min,
            price90max: price90max,
            weight: weight,
            volumeCm3: volumeCm3
        });
    }

    return products;
}

function parseCSVLine(line, separator) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === separator && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

function findColumn(headerMap, candidates) {
    for (let c of candidates) {
        if (headerMap[c] !== undefined) return headerMap[c];
    }
    // Recherche partielle
    for (let key in headerMap) {
        for (let c of candidates) {
            if (key.indexOf(c) !== -1) return headerMap[key];
        }
    }
    return -1;
}

function getVal(values, index, defaultVal) {
    if (index < 0 || index >= values.length) return defaultVal;
    const v = values[index];
    return (v !== undefined && v !== null && v !== '') ? v : defaultVal;
}

function parsePrice(str) {
    if (!str || typeof str !== 'string') {
        if (typeof str === 'number') return str;
        return 0;
    }
    // Nettoyer : enlever symboles monetaires, espaces
    let cleaned = str.replace(/[€$£\s]/g, '').trim();
    // Gerer le format europeen (virgule = decimal)
    if (cleaned.indexOf(',') !== -1 && cleaned.indexOf('.') !== -1) {
        // Format 1.234,56
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (cleaned.indexOf(',') !== -1) {
        cleaned = cleaned.replace(',', '.');
    }
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
}

function updateCSVStatus(marketplace, filename, count) {
    const statusEl = document.getElementById('csv-status-' + marketplace);
    const infoEl = document.getElementById('csv-info-' + marketplace);
    if (statusEl) statusEl.classList.remove('hidden');
    if (infoEl) infoEl.textContent = filename + ' (' + count + ' produits)';

    // Mettre a jour le style de la zone de drop
    const zone = document.getElementById('csv-zone-' + marketplace);
    if (zone) {
        zone.classList.remove('border-gray-300');
        zone.classList.add('border-green-400', 'bg-green-50');
    }
}

function mergeData(dataDE, dataFR) {
    const frMap = {};
    dataFR.forEach(p => {
        frMap[p.asin] = p;
    });

    const merged = [];
    dataDE.forEach(pDE => {
        const pFR = frMap[pDE.asin];
        if (pFR && pFR.price > 0 && pDE.price > 0) {
            // Calculer la stabilite prix (DE = prix de vente)
            const stability = calculateStability(pDE);

            merged.push({
                asin: pDE.asin,
                title: pDE.title || pFR.title,
                titleFR: pFR.title || '',
                titleDE: pDE.title || '',
                pricDE: pDE.price,
                pricFR: pFR.price,
                bsr: pDE.bsr || pFR.bsr,
                bsr90: pDE.bsr90 || pFR.bsr90,
                amazonSells: pDE.amazonSells,
                amazonPriceDE: pDE.amazonPrice,
                fbaSellers: pDE.fbaSellers,
                fbaFeeReal: pDE.fbaFeeReal || 0,
                referralPct: pDE.referralPct || 0,
                referralAmt: pDE.referralAmt || 0,
                category: pDE.category || pFR.category,
                estSales: pDE.estSales || pFR.estSales,
                weight: pDE.weight || pFR.weight || 0,
                volumeCm3: pDE.volumeCm3 || pFR.volumeCm3 || 0,
                stability: stability,
                profit: 0,
                roi: 0
            });
        }
    });

    console.log('[OA] Fusion: ' + merged.length + ' produits en commun sur ' + dataDE.length + ' DE / ' + dataFR.length + ' FR');
    return merged;
}

// Calcule un score de stabilite prix sur 90 jours
// Retourne { score: 0-100, label: 'Stable'/'Modere'/'Volatile'/'Inconnu', color: 'green'/'yellow'/'red'/'gray' }
function calculateStability(product) {
    const current = product.price;
    const avg90 = product.price90avg;
    const min90 = product.price90min;
    const max90 = product.price90max;
    const drops = product.price90drop;

    // Si pas de donnees 90j, on ne peut pas calculer
    if (!avg90 || avg90 <= 0 || !current || current <= 0) {
        return { score: 0, label: 'Inconnu', color: 'gray', detail: 'Pas de donnees 90j' };
    }

    let score = 100;

    // 1. Ecart prix actuel vs moyenne 90j (max -40 points)
    const pctFromAvg = Math.abs(current - avg90) / avg90 * 100;
    if (pctFromAvg > 20) score -= 40;
    else if (pctFromAvg > 10) score -= 25;
    else if (pctFromAvg > 5) score -= 10;

    // 2. Amplitude min-max sur 90j (max -30 points)
    if (min90 > 0 && max90 > 0) {
        const range = (max90 - min90) / avg90 * 100;
        if (range > 40) score -= 30;
        else if (range > 25) score -= 20;
        else if (range > 15) score -= 10;
    }

    // 3. Nombre de drops sur 90j (max -30 points)
    if (drops > 10) score -= 30;
    else if (drops > 5) score -= 20;
    else if (drops > 2) score -= 10;

    score = Math.max(0, Math.min(100, score));

    let label, color;
    if (score >= 70) { label = 'Stable'; color = 'green'; }
    else if (score >= 40) { label = 'Modere'; color = 'yellow'; }
    else { label = 'Volatile'; color = 'red'; }

    // Detail lisible
    let detail = 'Prix actuel: ' + current.toFixed(2) + '\u20ac';
    if (avg90 > 0) detail += ' | Moy 90j: ' + avg90.toFixed(2) + '\u20ac';
    if (min90 > 0 && max90 > 0) detail += ' | Range: ' + min90.toFixed(0) + '-' + max90.toFixed(0) + '\u20ac';

    return { score: score, label: label, color: color, detail: detail };
}

function calculateProfit(product, settings) {
    // Utiliser les frais reels Keepa si disponibles, sinon les parametres
    const commPct = (product.referralPct > 0) ? product.referralPct : settings.commissionPct;
    const commission = product.pricDE * (commPct / 100);
    const fbaFee = (product.fbaFeeReal > 0) ? product.fbaFeeReal : settings.fbaFee;

    // Inbound intelligent base sur le poids du produit
    const inbound = getInboundCost(product.weight, settings);

    // Estimation frais de stockage FBA
    const storageCost = getStorageCost(product.volumeCm3, product.estSales, product.fbaSellers, settings);

    const totalFees = commission + fbaFee + inbound + settings.prepCost + storageCost;
    const urssaf = product.pricDE * (settings.urssafPct / 100);
    const profit = product.pricDE - totalFees - urssaf - product.pricFR;
    const roi = product.pricFR > 0 ? (profit / product.pricFR) * 100 : 0;

    product.profit = Math.round(profit * 100) / 100;
    product.roi = Math.round(roi * 100) / 100;
    product.commission = Math.round(commission * 100) / 100;
    product.fbaFeeUsed = Math.round(fbaFee * 100) / 100;
    product.inboundUsed = Math.round(inbound * 100) / 100;
    product.storageCost = Math.round(storageCost * 100) / 100;
    product.totalFees = Math.round(totalFees * 100) / 100;
    product.urssaf = Math.round(urssaf * 100) / 100;

    return product;
}

function filterProducts(products, settings) {
    return products.filter(p => {
        if (p.profit < settings.minProfit) return false;
        if (p.roi < settings.minROI) return false;
        if (settings.maxBSR > 0 && p.bsr > settings.maxBSR && p.bsr > 0) return false;
        if (p.fbaSellers > settings.maxFBASellers) return false;
        if (!settings.amazonSells && p.amazonSells) return false;
        if (settings.minPriceDE > 0 && p.pricDE < settings.minPriceDE) return false;
        if (settings.maxPriceDE > 0 && p.pricDE > settings.maxPriceDE) return false;
        return true;
    });
}

function sortProducts(products) {
    return products.sort((a, b) => b.profit - a.profit);
}

// Afficher le guide d'extraction ASINs quand le CSV DE est charge
function showASINExtractGuide(count) {
    const zone = document.getElementById('asin-extract-zone');
    if (zone) {
        zone.classList.remove('hidden');
        const countEl = document.getElementById('asin-count');
        if (countEl) countEl.textContent = count;
    }
    var dst = getDest();
    var src = getSource();
    showOANotification('CSV ' + dst.code + ' charge ! Copie les ASINs pour les chercher sur ' + src.domain + ' via Keepa ' + src.keepaViewer + '.', 'info');
}

// Copier tous les ASINs du CSV DE dans le presse-papier (pour Keepa Product Viewer)
function copyASINsToClipboard() {
    if (oaDataDE.length === 0) {
        showOANotification('Aucun CSV vente charge', 'error');
        return;
    }

    const asins = oaDataDE.map(p => p.asin).filter(a => a && a.length >= 10);
    const uniqueAsins = [...new Set(asins)];
    const text = uniqueAsins.join('\n');

    navigator.clipboard.writeText(text).then(() => {
        const status = document.getElementById('asin-copy-status');
        if (status) {
            status.classList.remove('hidden');
            setTimeout(() => status.classList.add('hidden'), 3000);
        }
        showOANotification(uniqueAsins.length + ' ASINs copies dans le presse-papier !', 'success');
    }).catch(err => {
        // Fallback : creer un textarea temporaire
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showOANotification(uniqueAsins.length + ' ASINs copies !', 'success');
    });
}

function runScan() {
    console.log('[OA] Lancement du scan...');
    const settings = loadOASettings();

    var src = getSource();
    var dst = getDest();

    if (oaDataDE.length === 0 || oaDataFR.length === 0) {
        showOANotification('Veuillez importer les 2 CSV (' + dst.code + ' et ' + src.code + ') avant de lancer le scan', 'error');
        return;
    }

    // Construire l'entonnoir de filtrage
    const funnel = [];

    funnel.push({ step: 'CSV ' + dst.code + ' (vente)', count: oaDataDE.length, icon: 'file-csv', color: 'gray' });
    funnel.push({ step: 'CSV ' + src.code + ' (achat)', count: oaDataFR.length, icon: 'file-csv', color: 'gray' });

    // Fusionner
    let products = mergeData(oaDataDE, oaDataFR);
    funnel.push({ step: 'ASINs en commun (' + dst.code + '+' + src.code + ')', count: products.length, icon: 'link', color: 'blue' });

    if (products.length === 0) {
        showOANotification('0 ASINs en commun. Utilise le bouton "Copier les ASINs" pour chercher les memes produits sur ' + src.domain + ' via Keepa ' + src.keepaViewer + '.', 'error');
        showASINExtractGuide(oaDataDE.length);
        renderScanResults([], 0, funnel);
        return;
    }

    // Calculer profits
    products = products.map(p => calculateProfit(p, settings));

    // Entonnoir detaille — appliquer chaque filtre un par un
    let remaining = products.slice();

    // Filtre prix DE
    if (settings.minPriceDE > 0 || settings.maxPriceDE > 0) {
        remaining = remaining.filter(p =>
            (settings.minPriceDE <= 0 || p.pricDE >= settings.minPriceDE) &&
            (settings.maxPriceDE <= 0 || p.pricDE <= settings.maxPriceDE)
        );
        funnel.push({ step: 'Prix vente ' + dst.code + ' ' + settings.minPriceDE + '-' + settings.maxPriceDE + ' \u20ac', count: remaining.length, icon: 'euro-sign', color: 'purple' });
    }

    // Filtre BSR
    if (settings.maxBSR > 0) {
        remaining = remaining.filter(p => p.bsr <= settings.maxBSR || p.bsr === 0);
        funnel.push({ step: 'BSR \u2264 ' + formatNumber(settings.maxBSR), count: remaining.length, icon: 'chart-line', color: 'blue' });
    }

    // Filtre FBA sellers
    remaining = remaining.filter(p => p.fbaSellers <= settings.maxFBASellers);
    funnel.push({ step: 'Vendeurs FBA \u2264 ' + settings.maxFBASellers, count: remaining.length, icon: 'store', color: 'indigo' });

    // Filtre Amazon vend
    if (!settings.amazonSells) {
        remaining = remaining.filter(p => !p.amazonSells);
        funnel.push({ step: 'Amazon ne vend pas', count: remaining.length, icon: 'ban', color: 'orange' });
    }

    // Filtre ecart positif (FR < DE) — cascade
    remaining = remaining.filter(p => p.pricDE > p.pricFR);
    funnel.push({ step: 'Prix vente > Prix achat (ecart positif)', count: remaining.length, icon: 'arrow-up', color: 'green' });

    // Filtre profit positif — cascade
    remaining = remaining.filter(p => p.profit > 0);
    funnel.push({ step: 'Profit > 0 \u20ac (apres frais)', count: remaining.length, icon: 'coins', color: 'emerald' });

    // Filtre profit minimum — cascade
    remaining = remaining.filter(p => p.profit >= settings.minProfit);
    funnel.push({ step: 'Profit \u2265 ' + settings.minProfit + ' \u20ac', count: remaining.length, icon: 'check-circle', color: 'green' });

    // Filtre ROI minimum — cascade
    let finalFiltered = remaining.filter(p => p.roi >= settings.minROI);
    funnel.push({ step: 'ROI \u2265 ' + settings.minROI + '%', count: finalFiltered.length, icon: 'percentage', color: 'green' });

    // Trier par profit decroissant (tous les produits)
    products = sortProducts(products);

    // Stocker TOUS les produits
    oaScanResults = products;
    saveScanResults();

    // Compter pour les 2 modes
    var strictCount = countFilteredProducts(products, settings, 'strict');
    var soupleCount = countFilteredProducts(products, settings, 'souple');
    var activeCount = oaFilterMode === 'souple' ? soupleCount : strictCount;

    console.log('[OA] Scan termine: strict=' + strictCount + ', souple=' + soupleCount + ' sur ' + products.length + ' en commun');
    renderScanResults(products, activeCount, funnel, strictCount, soupleCount);
    showOANotification(activeCount + ' produits rentables sur ' + products.length + ' en commun', activeCount > 0 ? 'success' : 'info');
}

function saveScanResults() {
    try {
        const data = {
            results: oaScanResults,
            date: new Date().toISOString(),
            countDE: oaDataDE.length,
            countFR: oaDataFR.length
        };
        localStorage.setItem('oaScanResults', JSON.stringify(data));
        console.log('[OA] Resultats sauvegardes:', oaScanResults.length, 'produits');
    } catch (e) {
        console.log('[OA] Erreur sauvegarde resultats (localStorage plein ?):', e);
    }
}

function loadScanResults() {
    try {
        const saved = localStorage.getItem('oaScanResults');
        if (saved) {
            const data = JSON.parse(saved);
            oaScanResults = data.results || [];
            const scanDate = new Date(data.date);
            const ago = Math.round((Date.now() - scanDate.getTime()) / 60000);
            const timeLabel = ago < 60 ? ago + ' min' : Math.round(ago / 60) + 'h';

            console.log('[OA] Resultats restaures:', oaScanResults.length, 'produits (scan il y a ' + timeLabel + ')');

            if (oaScanResults.length > 0) {
                renderScanResults(oaScanResults);
                const summary = document.getElementById('scan-summary');
                if (summary) summary.textContent = 'Dernier scan : ' + oaScanResults.length + ' produits (il y a ' + timeLabel + ')';
            }
            return true;
        }
    } catch (e) {
        console.log('[OA] Erreur chargement resultats:', e);
    }
    return false;
}

function renderScanResults(products, profitableCount, funnel, strictCount, soupleCount) {
    const container = document.getElementById('oa-scan-results');
    if (!container) return;

    if (products.length === 0 && (!funnel || funnel.length === 0)) {
        container.innerHTML = '<div class="text-center py-8 text-gray-400">' +
            '<i class="fas fa-search fa-3x mb-4"></i>' +
            '<p>Aucun produit ne correspond aux criteres.</p>' +
            '<p class="text-sm mt-2">Essayez d\'ajuster vos parametres de filtrage.</p></div>';
        return;
    }

    const settings = loadOASettings();
    if (profitableCount === undefined) {
        strictCount = countFilteredProducts(products, settings, 'strict');
        soupleCount = countFilteredProducts(products, settings, 'souple');
        profitableCount = oaFilterMode === 'souple' ? soupleCount : strictCount;
    }

    // === ENTONNOIR DE FILTRAGE ===
    let funnelHtml = '';
    if (funnel && funnel.length > 0) {
        funnelHtml += '<div class="bg-gray-700 rounded-xl p-5 mb-6">';
        funnelHtml += '<h4 class="font-bold text-gray-300 mb-3"><i class="fas fa-filter mr-2"></i>Entonnoir de filtrage</h4>';
        funnelHtml += '<div class="flex flex-wrap items-center gap-2">';

        funnel.forEach((f, i) => {
            // Couleur du badge selon le nombre
            const bgColor = f.count === 0 ? 'bg-red-900/50 text-red-400 border-red-700' :
                           f.count <= 10 ? 'bg-orange-900/50 text-orange-400 border-orange-700' :
                           f.count <= 100 ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700' :
                           'bg-gray-700 text-gray-200 border-gray-600';

            funnelHtml += '<div class="flex items-center gap-2">';
            funnelHtml += '<div class="border rounded-lg px-3 py-2 text-sm ' + bgColor + '">';
            funnelHtml += '<i class="fas fa-' + f.icon + ' mr-1 opacity-60"></i>';
            funnelHtml += '<span class="font-bold">' + formatNumber(f.count) + '</span>';
            funnelHtml += '<span class="text-xs ml-1 opacity-70">' + f.step + '</span>';
            funnelHtml += '</div>';

            // Fleche entre les etapes
            if (i < funnel.length - 1) {
                funnelHtml += '<i class="fas fa-chevron-right text-gray-600 text-xs"></i>';
            }
            funnelHtml += '</div>';
        });

        funnelHtml += '</div></div>';
    }

    if (products.length === 0) {
        container.innerHTML = funnelHtml + '<div class="text-center py-8 text-gray-400">' +
            '<i class="fas fa-search fa-3x mb-4"></i>' +
            '<p>Aucun produit dans la liste.</p></div>';
        return;
    }

    // Stats
    const positiveProfit = products.filter(p => p.profit > 0);
    const bestProfit = products[0] ? products[0].profit : 0;
    const avgDiff = products.reduce((s, p) => s + (p.pricDE - p.pricFR), 0) / products.length;

    // Resume chiffres cles
    let summary = '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">';
    summary += '<div class="bg-gray-700 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-white">' + products.length + '</div>';
    summary += '<div class="text-xs text-gray-300">Produits en commun</div></div>';
    summary += '<div class="bg-gray-700 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold ' + (positiveProfit.length > 0 ? 'text-emerald-400' : 'text-red-400') + '">' + positiveProfit.length + '</div>';
    summary += '<div class="text-xs text-gray-300">Profit positif</div></div>';
    summary += '<div class="bg-gray-700 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-purple-300">' + bestProfit.toFixed(2) + ' &euro;</div>';
    summary += '<div class="text-xs text-gray-300">Meilleur profit</div></div>';
    summary += '<div class="bg-gray-700 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold ' + (avgDiff > 0 ? 'text-green-400' : 'text-red-400') + '">' + avgDiff.toFixed(2) + ' &euro;</div>';
    summary += '<div class="text-xs text-gray-300">Ecart moyen DE-FR</div></div>';
    summary += '</div>';

    // Calculer les counts si pas fournis
    if (strictCount === undefined) strictCount = countFilteredProducts(products, settings, 'strict');
    if (soupleCount === undefined) soupleCount = countFilteredProducts(products, settings, 'souple');

    // Toggle Strict / Souple / Non eligible
    var soupleOnlyCount = soupleCount - strictCount; // extras souple (pas dans strict)
    var nonEligibleCount = products.length - soupleCount;
    summary += '<div class="flex items-center gap-3 mb-6">';
    summary += '<span class="text-sm text-gray-400">Filtrage :</span>';
    summary += '<button onclick="toggleFilterMode(\'strict\')" class="px-4 py-2 rounded-lg text-sm font-bold transition ' +
        (oaFilterMode === 'strict' ? 'bg-indigo-600 text-white' : 'bg-gray-600 text-gray-200 hover:bg-gray-500') + '">';
    summary += 'Strict (' + strictCount + ')</button>';
    summary += '<button onclick="toggleFilterMode(\'souple\')" class="px-4 py-2 rounded-lg text-sm font-bold transition ' +
        (oaFilterMode === 'souple' ? 'bg-amber-600 text-white' : 'bg-gray-600 text-gray-200 hover:bg-gray-500') + '">';
    summary += 'Souple (' + soupleOnlyCount + ')</button>';
    summary += '<button onclick="toggleFilterMode(\'noneligible\')" class="px-4 py-2 rounded-lg text-sm font-bold transition ' +
        (oaFilterMode === 'noneligible' ? 'bg-red-600 text-white' : 'bg-gray-600 text-gray-200 hover:bg-gray-500') + '">';
    summary += 'Non eligible (' + nonEligibleCount + ')</button>';
    var modeLabel = oaFilterMode === 'strict' ? 'Criteres stricts' : oaFilterMode === 'souple' ? 'Produits entre strict et souple' : 'Produits qui ne passent aucun filtre';
    summary += '<span class="text-xs text-gray-400 ml-2">' + modeLabel + '</span>';
    summary += '</div>';

    // Filtrer selon le mode actif puis limiter a 200
    const maxDisplay = 200;
    var filteredProducts;

    // Fonction helper pour tester si un produit passe un jeu de criteres
    function passesFilters(p, f) {
        if (p.pricDE <= p.pricFR) return false;
        if (p.profit <= 0) return false;
        if (p.profit < f.minProfit) return false;
        if (p.roi < f.minROI) return false;
        if (f.maxBSR > 0 && p.bsr > f.maxBSR && p.bsr > 0) return false;
        if (p.fbaSellers > f.maxFBASellers) return false;
        if (!f.amazonSells && p.amazonSells) return false;
        if (f.minPriceDE > 0 && p.pricDE < f.minPriceDE) return false;
        if (f.maxPriceDE > 0 && p.pricDE > f.maxPriceDE) return false;
        return true;
    }

    var strictFilters = {
        minProfit: settings.minProfit, minROI: settings.minROI,
        maxBSR: settings.maxBSR, maxFBASellers: settings.maxFBASellers,
        amazonSells: settings.amazonSells, minPriceDE: settings.minPriceDE, maxPriceDE: settings.maxPriceDE
    };
    var soupleFilters = {
        minProfit: settings.soupleMinProfit || 2, minROI: settings.soupleMinROI || 15,
        maxBSR: settings.soupleMaxBSR || 100000, maxFBASellers: settings.soupleMaxFBASellers || 8,
        amazonSells: settings.amazonSells, minPriceDE: settings.soupleMinPriceDE || 12, maxPriceDE: settings.soupleMaxPriceDE || 100
    };

    if (oaFilterMode === 'strict') {
        filteredProducts = products.filter(function(p) { return passesFilters(p, strictFilters); });
    } else if (oaFilterMode === 'souple') {
        // Souple = passe souple MAIS PAS strict (les extras uniquement)
        filteredProducts = products.filter(function(p) { return passesFilters(p, soupleFilters) && !passesFilters(p, strictFilters); });
    } else {
        // Non eligible = ne passe PAS les criteres souple
        filteredProducts = products.filter(function(p) { return !passesFilters(p, soupleFilters); });
    }
    const displayProducts = filteredProducts.slice(0, maxDisplay);

    summary += '<div class="text-sm text-gray-400 mb-6 mt-2">';
    summary += 'Affichage de <b>' + Math.min(filteredProducts.length, maxDisplay) + '</b> produits sur ' + filteredProducts.length + ' (tries par profit decroissant)';
    summary += '</div>';

    let html = '<div class="overflow-x-auto">';
    html += '<table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-300 border-b border-gray-600">';
    html += '<th class="pb-3 px-4">#</th>';
    html += '<th class="pb-3 pr-4">Produit</th>';
    var src = getSource();
    var dst = getDest();
    html += '<th class="pb-3 pr-4 text-right">Prix ' + src.code + '</th>';
    html += '<th class="pb-3 pr-4 text-right">Prix ' + dst.code + '</th>';
    html += '<th class="pb-3 pr-4 text-right">Ecart</th>';
    html += '<th class="pb-3 pr-4 text-right cursor-help" title="Deja precis ! Le scanner utilise le vrai montant Keepa par produit (FBA pick&pack). L\'envoi a AMZ est calcule automatiquement selon le poids. Survolez chaque ligne pour voir le detail.">Frais <i class="fas fa-info-circle text-xs opacity-50"></i></th>';
    html += '<th class="pb-3 pr-4 text-right">Profit</th>';
    html += '<th class="pb-3 pr-4 text-right">ROI</th>';
    html += '<th class="pb-3 pr-4 text-right cursor-help" title="Best Sellers Rank : classement des ventes sur ' + dst.domain + '. Plus le chiffre est bas, plus le produit se vend. 1-100 = top ventes, 100-1000 = tres populaire, 1000-10000 = bon vendeur, 10000-30000 = ventes regulieres, 30000+ = ventes lentes">BSR <i class="fas fa-info-circle text-xs opacity-50"></i></th>';
    html += '<th class="pb-3 pr-4 text-right cursor-help" title="Nombre de vendeurs FBA (Fulfilled by Amazon) sur cette fiche produit. Moins il y en a, moins il y a de concurrence.">Sellers <i class="fas fa-info-circle text-xs opacity-50"></i></th>';
    html += '<th class="pb-3 pr-4 text-center">Liens</th>';
    html += '<th class="pb-3 pr-4 text-center">Action</th>';
    html += '</tr></thead><tbody>';

    displayProducts.forEach((p, i) => {
        // Couleur de la ligne
        const isNonEligible = oaFilterMode === 'noneligible';
        const rowBg = isNonEligible ? 'bg-gray-800/40' : '';
        const profitClass = p.profit >= 5 ? 'text-green-400 font-bold' :
                           p.profit >= 0 ? 'text-yellow-300' : 'text-red-400 font-bold';
        const roiClass = p.roi >= 35 ? 'text-green-400' :
                        p.roi >= 0 ? 'text-yellow-300' : 'text-red-400';
        const ecart = p.pricDE - p.pricFR;
        const ecartClass = ecart > 0 ? 'text-green-400' : 'text-red-400';
        const totalFeesDisplay = p.totalFees + p.urssaf;

        // Nom FR (pour chercher deals) + nom DE
        const titleFR = p.titleFR || '';
        const titleDE = p.titleDE || p.title || '';
        const titleMain = titleFR || titleDE;
        const titleMainShort = titleMain.length > 50 ? titleMain.substring(0, 50) + '...' : titleMain;

        // Tooltip frais detailles
        const weightLabel = p.weight > 0 ? p.weight + 'g' : 'inconnu';
        const inboundTier = getInboundLabel(p.weight);
        const storageLabel = p.storageCost > 0
            ? p.storageCost.toFixed(2) + '\u20ac (vol: ' + (p.volumeCm3 || 0) + 'cm3)'
            : '0.00\u20ac (pas de volume)';
        const feesTooltip = 'Commission: ' + (p.commission || 0).toFixed(2) + '\u20ac (' + (p.referralPct || settings.commissionPct) + '%)'
            + '\nFBA pick&pack: ' + (p.fbaFeeUsed || settings.fbaFee).toFixed(2) + '\u20ac (Keepa)'
            + '\nEnvoi a AMZ: ' + (p.inboundUsed || settings.inboundShipping).toFixed(2) + '\u20ac (auto: ' + inboundTier + ', ' + weightLabel + ')'
            + '\nStockage FBA: ' + storageLabel
            + '\nEtiquetage: ' + settings.prepCost.toFixed(2) + '\u20ac (FNSKU)'
            + '\nURSSAF: ' + (p.urssaf || 0).toFixed(2) + '\u20ac (' + settings.urssafPct + '%)'
            + '\n---------'
            + '\nTotal: ' + totalFeesDisplay.toFixed(2) + '\u20ac';

        html += '<tr class="border-b border-gray-800 hover:bg-gray-800/50 ' + rowBg + '">';
        html += '<td class="py-2 px-4 text-gray-400 text-xs">' + (i + 1) + '</td>';
        html += '<td class="py-2 pr-3 max-w-xs">';
        if (titleFR) {
            html += '<div class="font-medium text-gray-100 text-xs" title="' + escapeHTML(titleFR) + '"><span class="text-blue-300 font-bold mr-1">' + src.code + '</span>' + escapeHTML(titleMainShort) + '</div>';
        }
        if (titleDE && titleDE !== titleFR) {
            const titleDEShort = titleDE.length > 50 ? titleDE.substring(0, 50) + '...' : titleDE;
            html += '<div class="text-xs text-gray-300 truncate" title="' + escapeHTML(titleDE) + '"><span class="text-purple-300 font-bold mr-1">' + dst.code + '</span>' + escapeHTML(titleDEShort) + '</div>';
        }
        if (!titleFR && titleDE) {
            html += '<div class="font-medium text-gray-100 text-xs" title="' + escapeHTML(titleDE) + '"><span class="text-purple-300 font-bold mr-1">' + dst.code + '</span>' + escapeHTML(titleMainShort) + '</div>';
        }
        html += '<div class="text-xs font-mono"><a href="https://www.' + src.domain + '/dp/' + p.asin + '" target="_blank" class="text-gray-400 hover:text-blue-300">' + p.asin + '</a></div></td>';
        html += '<td class="py-2 pr-3 text-right text-blue-300 font-medium">' + p.pricFR.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right text-purple-300 font-medium">' + p.pricDE.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right font-bold ' + ecartClass + '">' + (ecart > 0 ? '+' : '') + ecart.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right text-gray-200 text-xs cursor-help" title="' + escapeHTML(feesTooltip) + '">' + totalFeesDisplay.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right font-bold ' + profitClass + '">' + p.profit.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right font-medium ' + roiClass + '">' + p.roi.toFixed(0) + '%</td>';
        html += '<td class="py-2 pr-3 text-right text-gray-100 text-xs">' + formatNumber(p.bsr) + '</td>';
        html += '<td class="py-2 pr-3 text-right text-gray-100 text-xs">' + p.fbaSellers + '</td>';

        // Liens Amazon FR + DE
        html += '<td class="py-2 pr-3 text-center whitespace-nowrap">';
        html += '<a href="https://www.' + src.domain + '/dp/' + p.asin + '" target="_blank" class="text-blue-300 hover:text-blue-200 text-xs mr-2 font-medium" title="Voir sur ' + src.domain + '">' + src.code + '</a>';
        html += '<a href="https://www.' + dst.domain + '/dp/' + p.asin + '" target="_blank" class="text-purple-300 hover:text-purple-200 text-xs font-medium" title="Voir sur ' + dst.domain + '">' + dst.code + '</a>';
        html += '</td>';

        html += '<td class="py-2 pr-3 text-center whitespace-nowrap">';
        if (p.profit > 0) {
            html += '<button onclick="startChecklist(' + i + ')" class="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs">';
            html += '<i class="fas fa-clipboard-check mr-1"></i>Verifier</button>';
        } else if (p.profit > -3) {
            // Presque rentable — Quick Check pour voir si un deal existe
            const searchQuery = encodeURIComponent((titleFR || titleDE).substring(0, 60));
            html += '<a href="https://www.' + src.domain + '/s?k=' + searchQuery + '" target="_blank" class="bg-yellow-700 hover:bg-yellow-600 text-white px-3 py-1 rounded text-xs inline-block" title="Chercher un deal sur ' + src.domain + '">';
            html += '<i class="fas fa-search mr-1"></i>Deal?</a>';
        } else {
            html += '<span class="text-gray-600 text-xs" title="Profit trop negatif (' + p.profit.toFixed(2) + '\u20ac)">-</span>';
        }
        html += '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';

    container.innerHTML = '<div class="p-6">' + funnelHtml + summary + html + '</div>';
}

// ===========================
// 3. CHECKLIST
// ===========================

function startChecklist(productIndex) {
    if (productIndex < 0 || productIndex >= oaScanResults.length) return;

    oaCurrentCheck = Object.assign({}, oaScanResults[productIndex]);
    oaCurrentCheckIndex = productIndex;
    var dstDomain = getDest().domain;
    var srcDomain = getSource().domain;
    oaCurrentCheck.steps = [
        { id: 1, label: 'Verifier eligibilite sur Seller Central', status: null, timestamp: null },
        { id: 2, label: 'Verifier le prix de vente reel sur ' + dstDomain, status: null, timestamp: null, realPrice: null },
        { id: 3, label: 'Verifier les restrictions / avertissements', status: null, timestamp: null },
        { id: 4, label: 'Verifier le prix d\'achat reel sur ' + srcDomain, status: null, timestamp: null, realPrice: null },
        { id: 5, label: 'Verifier la concurrence et le BSR actuel', status: null, timestamp: null }
    ];
    oaCurrentCheck.verdict = null; // 'go' ou 'nogo'

    console.log('[OA] Checklist demarree pour:', oaCurrentCheck.asin);

    // Afficher la section checklist
    showSection('oa-checklist');

    // Cacher l'etat vide, montrer le contenu
    const emptyState = document.getElementById('checklist-empty');
    const content = document.getElementById('checklist-content');
    if (emptyState) emptyState.classList.add('hidden');
    if (content) content.classList.remove('hidden');

    // Remplir les infos du produit dans le HTML statique
    const nameEl = document.getElementById('check-product-name');
    const asinEl = document.getElementById('check-product-asin');
    const profitEl = document.getElementById('check-product-profit');
    const roiEl = document.getElementById('check-product-roi');
    const priceDeEl = document.getElementById('check-product-price-de');
    const priceFrEl = document.getElementById('check-product-price-fr');

    if (nameEl) nameEl.textContent = oaCurrentCheck.title || oaCurrentCheck.asin;
    if (asinEl) asinEl.textContent = oaCurrentCheck.asin;
    if (profitEl) profitEl.textContent = (oaCurrentCheck.profit || 0).toFixed(2) + ' \u20ac';
    if (roiEl) roiEl.textContent = (oaCurrentCheck.roi || 0).toFixed(0) + ' %';
    if (priceDeEl) priceDeEl.textContent = (oaCurrentCheck.pricDE || 0).toFixed(2) + ' \u20ac';
    if (priceFrEl) priceFrEl.textContent = (oaCurrentCheck.pricFR || 0).toFixed(2) + ' \u20ac';

    // Reset toutes les etapes
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById('check-step-' + i);
        const icon = document.getElementById('check-step-' + i + '-icon');
        const time = document.getElementById('check-step-' + i + '-time');
        if (step) {
            step.classList.toggle('opacity-50', i > 1);
            // Desactiver tout sauf reset
            step.querySelectorAll('button:not(.reset-btn), input').forEach(el => el.disabled = i > 1);
            // Les boutons reset sont toujours actifs
            step.querySelectorAll('.reset-btn').forEach(el => el.disabled = false);
        }
        if (icon) icon.textContent = '';
        if (time) time.textContent = '';
    }

    // Activer seulement l'etape 1
    enableCheckStep(1);

    // Reset verdict
    const verdict = document.getElementById('check-verdict');
    const verdictGo = document.getElementById('verdict-go');
    const verdictNogo = document.getElementById('verdict-nogo');
    if (verdict) verdict.classList.add('hidden');
    if (verdictGo) verdictGo.classList.add('hidden');
    if (verdictNogo) verdictNogo.classList.add('hidden');
}

function enableCheckStep(step) {
    const stepEl = document.getElementById('check-step-' + step);
    if (!stepEl) return;
    stepEl.classList.remove('opacity-50');
    // Activer les boutons/inputs de cette etape (sauf le bouton reset)
    stepEl.querySelectorAll('button:not(.reset-btn), input').forEach(el => el.disabled = false);
}

function resetCheckStep(step) {
    if (!oaCurrentCheck) return;

    // Reset cette etape et toutes les suivantes
    for (var i = step; i <= 5; i++) {
        oaCurrentCheck.steps[i - 1].status = null;
        oaCurrentCheck.steps[i - 1].timestamp = null;
        oaCurrentCheck.steps[i - 1].realPrice = null;
        if (i === 2) oaCurrentCheck.realPricDE = null;
        if (i === 4) oaCurrentCheck.realPricFR = null;

        var stepEl = document.getElementById('check-step-' + i);
        var icon = document.getElementById('check-step-' + i + '-icon');
        var time = document.getElementById('check-step-' + i + '-time');
        if (icon) icon.innerHTML = '';
        if (time) time.textContent = '';
        if (stepEl) {
            stepEl.classList.toggle('opacity-50', i > step);
            // Reactiver les boutons seulement pour l'etape courante
            stepEl.querySelectorAll('button:not(.reset-btn), input').forEach(function(el) {
                el.disabled = i !== step;
            });
        }
    }

    // Cacher le verdict si affiché
    oaCurrentCheck.verdict = null;
    var verdict = document.getElementById('check-verdict');
    var verdictGo = document.getElementById('verdict-go');
    var verdictNogo = document.getElementById('verdict-nogo');
    if (verdict) verdict.classList.add('hidden');
    if (verdictGo) verdictGo.classList.add('hidden');
    if (verdictNogo) verdictNogo.classList.add('hidden');

    console.log('[OA] Reset etape ' + step + ' et suivantes');
}

function validateCheckStep(step, value) {
    if (!oaCurrentCheck) return;
    const now = new Date();
    const timestamp = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Pour les etapes avec prix (2 et 4), enregistrer le prix reel
    if ((step === 2 || step === 4) && value !== false) {
        const price = parseFloat(value);
        if (isNaN(price) || price <= 0) {
            showOANotification('Veuillez entrer un prix valide', 'error');
            return;
        }
        oaCurrentCheck.steps[step - 1].realPrice = price;
        if (step === 2) oaCurrentCheck.realPricDE = price;
        if (step === 4) oaCurrentCheck.realPricFR = price;
        value = true;
    }

    oaCurrentCheck.steps[step - 1].status = value;
    oaCurrentCheck.steps[step - 1].timestamp = timestamp;

    console.log('[OA] Etape ' + step + ':', value ? 'PASS' : 'FAIL', 'a', timestamp);

    // Mettre a jour l'icone et le timestamp dans le HTML
    const icon = document.getElementById('check-step-' + step + '-icon');
    const time = document.getElementById('check-step-' + step + '-time');
    if (icon) icon.innerHTML = value ? '<span class="text-green-500"><i class="fas fa-check-circle"></i></span>' : '<span class="text-red-500"><i class="fas fa-times-circle"></i></span>';
    if (time) time.textContent = timestamp;

    // Desactiver les boutons de cette etape (sauf le reset)
    const stepEl = document.getElementById('check-step-' + step);
    if (stepEl) stepEl.querySelectorAll('button:not(.reset-btn), input').forEach(el => el.disabled = true);

    // Verifier si NO GO
    if (value === false) {
        oaCurrentCheck.verdict = 'nogo';
        console.log('[OA] Verdict: NO GO (etape ' + step + ')');

        // Afficher le verdict NO GO
        const verdict = document.getElementById('check-verdict');
        const verdictNogo = document.getElementById('verdict-nogo');
        const reason = document.getElementById('verdict-nogo-reason');
        if (verdict) verdict.classList.remove('hidden');
        if (verdictNogo) verdictNogo.classList.remove('hidden');
        if (reason) reason.textContent = 'Echec a l\'etape ' + step + ' : ' + oaCurrentCheck.steps[step - 1].label;
        return;
    }

    // Activer l'etape suivante
    if (step < 5) {
        enableCheckStep(step + 1);
    }

    // Verifier si toutes les etapes sont passees
    const allDone = oaCurrentCheck.steps.every(s => s.status !== null);
    const allPass = oaCurrentCheck.steps.every(s => s.status === true);
    if (allDone && allPass) {
        // Recalculer avec les prix reels
        const result = recalculateWithRealPrices();

        const verdict = document.getElementById('check-verdict');
        const verdictGo = document.getElementById('verdict-go');
        const verdictNogo2 = document.getElementById('verdict-nogo');
        const verdictProfit = document.getElementById('verdict-profit');
        const verdictRoi = document.getElementById('verdict-roi');
        const verdictReco = document.getElementById('verdict-recommendation');
        const reason = document.getElementById('verdict-nogo-reason');

        if (verdict) verdict.classList.remove('hidden');

        // Bloquer si le profit recalcule est negatif
        if (result.profit <= 0) {
            oaCurrentCheck.verdict = 'nogo';
            console.log('[OA] Verdict: NO GO (profit recalcule negatif: ' + result.profit.toFixed(2) + ')');
            if (verdictNogo2) verdictNogo2.classList.remove('hidden');
            if (verdictGo) verdictGo.classList.add('hidden');
            if (reason) reason.textContent = 'Profit negatif avec les prix reels (' + result.profit.toFixed(2) + '\u20ac). Le deal n\'est plus rentable.';
            return;
        }

        oaCurrentCheck.verdict = 'go';
        console.log('[OA] Verdict: GO ! Profit: ' + result.profit.toFixed(2));

        const recommendation = getQuantityRecommendation(oaCurrentCheck, loadOASettings());

        if (verdictGo) verdictGo.classList.remove('hidden');
        if (verdictProfit) verdictProfit.textContent = result.profit.toFixed(2) + ' \u20ac';
        if (verdictRoi) verdictRoi.textContent = result.roi.toFixed(0) + ' %';
        if (verdictReco) verdictReco.innerHTML = recommendation.html;

        // Mettre la quantite recommandee dans l'input et lancer le simulateur
        const qtyInput = document.getElementById('verdict-quantity');
        if (qtyInput) qtyInput.value = recommendation.qty;
        updateGainSimulator();
    }
}

function recalculateWithRealPrices() {
    if (!oaCurrentCheck) return { profit: 0, roi: 0 };

    const settings = loadOASettings();
    const pricDE = oaCurrentCheck.realPricDE || oaCurrentCheck.pricDE;
    const pricFR = oaCurrentCheck.realPricFR || oaCurrentCheck.pricFR;

    const commPct = (oaCurrentCheck.referralPct > 0) ? oaCurrentCheck.referralPct : settings.commissionPct;
    const commission = pricDE * (commPct / 100);
    const fbaFee = (oaCurrentCheck.fbaFeeReal > 0) ? oaCurrentCheck.fbaFeeReal : settings.fbaFee;
    const inbound = getInboundCost(oaCurrentCheck.weight, settings);
    const storageCost = getStorageCost(oaCurrentCheck.volumeCm3, oaCurrentCheck.estSales, oaCurrentCheck.fbaSellers, settings);
    const totalFees = commission + fbaFee + inbound + settings.prepCost + storageCost;
    const urssaf = pricDE * (settings.urssafPct / 100);
    const profit = pricDE - totalFees - urssaf - pricFR;
    const roi = pricFR > 0 ? (profit / pricFR) * 100 : 0;

    return {
        profit: Math.round(profit * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        pricDE: pricDE,
        pricFR: pricFR
    };
}

function updateGainSimulator() {
    if (!oaCurrentCheck) return;
    var result = recalculateWithRealPrices();
    var qty = parseInt(document.getElementById('verdict-quantity').value) || 1;
    var buyPrice = oaCurrentCheck.realPricFR || oaCurrentCheck.pricFR;
    var sellPrice = oaCurrentCheck.realPricDE || oaCurrentCheck.pricDE;

    var investment = qty * buyPrice;
    var totalProfit = qty * result.profit;
    var revenue = qty * sellPrice;
    var totalFees = revenue - totalProfit - investment;
    var margin = revenue > 0 ? (totalProfit / revenue * 100) : 0;

    var investEl = document.getElementById('sim-investment');
    var profitEl = document.getElementById('sim-total-profit');
    var feesEl = document.getElementById('sim-revenue');
    var marginEl = document.getElementById('sim-margin');

    if (investEl) investEl.textContent = investment.toFixed(2) + ' \u20ac';
    if (profitEl) profitEl.textContent = (totalProfit > 0 ? '+' : '') + totalProfit.toFixed(2) + ' \u20ac';
    if (feesEl) feesEl.textContent = totalFees.toFixed(2) + ' \u20ac';
    if (marginEl) marginEl.textContent = margin.toFixed(1) + ' %';

    // Couleur du profit total
    if (profitEl) profitEl.className = 'text-2xl font-black ' + (totalProfit > 0 ? 'text-green-600' : 'text-red-600');
}

function getQuantityRecommendation(product, settings) {
    const estSales = product.estSales || 0;
    const costPerUnit = product.realPricFR || product.pricFR;

    // Helper pour generer un retour consistant
    function makeResult(qty, message) {
        const html = '<p>' + message + '</p>' +
            (qty > 0 ? '<p>Cout : ' + qty + ' x ' + costPerUnit.toFixed(2) + '\u20ac = ' + (qty * costPerUnit).toFixed(2) + '\u20ac</p>' : '');
        return { qty: qty, html: html, quantity: qty, text: message, scale: '' };
    }

    if (estSales <= 0) {
        const qty = Math.min(1, settings.maxUnitsFirstBuy);
        return makeResult(qty, 'Ventes estimees inconnues, limiter a ' + qty + ' unite(s)');
    }

    const estimatedSalesForYou = estSales / ((product.fbaSellers || 1) + 1);

    if (estimatedSalesForYou < 10) {
        return makeResult(1, 'Vitesse de vente lente (~' + estimatedSalesForYou.toFixed(0) + ' ventes/mois pour toi). Limiter a 1 unite test.');
    }

    const timeToSell1Unit = 30 / estimatedSalesForYou;

    // Premier achat
    const firstBuyQty = Math.min(2, settings.maxUnitsFirstBuy);
    const totalCost = firstBuyQty * costPerUnit;

    // Verifier les limites de capital
    if (totalCost > settings.maxPerProduct) {
        const maxQty = Math.floor(settings.maxPerProduct / costPerUnit);
        if (maxQty < 1) {
            return makeResult(0, 'Trop cher pour le budget par produit (' + settings.maxPerProduct + '\u20ac max)');
        }
        return makeResult(maxQty, maxQty + ' unite(s) (limite budget ' + settings.maxPerProduct + '\u20ac)');
    }

    const capitalAvailable = calculateCapital().available;
    if (totalCost > capitalAvailable * 0.15) {
        const maxQty = Math.floor((capitalAvailable * 0.15) / costPerUnit);
        if (maxQty < 1) {
            return makeResult(0, 'Capital insuffisant (15% max = ' + (capitalAvailable * 0.15).toFixed(2) + '\u20ac)');
        }
        const qty = Math.min(maxQty, firstBuyQty);
        return makeResult(qty, qty + ' unite(s) (limite capital 15%)');
    }

    // Recommandation de scale
    let scaleText = '';
    if (timeToSell1Unit < 7) {
        scaleText = 'Rapide ! Passer a 5 unites au restock';
    } else if (timeToSell1Unit < 14) {
        scaleText = 'Correct. Passer a 3 unites au restock';
    } else {
        scaleText = 'Lent. Rester a 1-2 unites';
    }

    const html = '<p><strong>1er achat (test) :</strong> ' + firstBuyQty + ' unite(s)</p>' +
        '<p>Cout : ' + firstBuyQty + ' x ' + costPerUnit.toFixed(2) + '\u20ac = ' + totalCost.toFixed(2) + '\u20ac</p>' +
        '<p>Temps de vente estime : ~' + timeToSell1Unit.toFixed(0) + ' jours par unite</p>' +
        '<p class="mt-2 font-semibold">' + scaleText + '</p>';

    return {
        qty: firstBuyQty,
        html: html,
        quantity: firstBuyQty,
        text: firstBuyQty + ' unite(s) pour le premier achat',
        scale: scaleText
    };
}

function confirmPurchaseFromChecklist() {
    if (!oaCurrentCheck) return;
    const qtyInput = document.getElementById('verdict-quantity');
    const qty = qtyInput ? parseInt(qtyInput.value) : 1;
    const costPerUnit = oaCurrentCheck.realPricFR || oaCurrentCheck.pricFR;

    if (qty < 1) {
        showOANotification('Quantite invalide', 'error');
        return;
    }

    confirmPurchase(oaCurrentCheck, qty, costPerUnit);
}

function confirmPurchase(product, quantity, costPerUnit) {
    const totalCost = quantity * costPerUnit;
    const cap = calculateCapital();

    if (totalCost > cap.available) {
        showOANotification('Capital insuffisant ! Disponible: ' + cap.available.toFixed(2) + ' EUR', 'error');
        return;
    }

    // Calculer le profit attendu directement (pas via la globale oaCurrentCheck)
    const settings = loadOASettings();
    const sellPrice = product.realPricDE || product.pricDE;
    const commPct = (product.referralPct > 0) ? product.referralPct : settings.commissionPct;
    const commission = sellPrice * (commPct / 100);
    const fbaFee = (product.fbaFeeReal > 0) ? product.fbaFeeReal : settings.fbaFee;
    const inbound = getInboundCost(product.weight, settings);
    const storageCost = getStorageCost(product.volumeCm3, product.estSales, product.fbaSellers, settings);
    const totalFees = commission + fbaFee + inbound + settings.prepCost + storageCost;
    const urssaf = sellPrice * (settings.urssafPct / 100);
    const unitProfit = sellPrice - totalFees - urssaf - costPerUnit;

    const inventoryItem = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        asin: product.asin,
        title: product.title,
        pricFR: costPerUnit,
        pricDE: sellPrice,
        quantity: quantity,
        costPerUnit: costPerUnit,
        totalCost: totalCost,
        expectedProfit: Math.round(unitProfit * quantity * 100) / 100,
        weight: product.weight || 0,
        volumeCm3: product.volumeCm3 || 0,
        estSales: product.estSales || 0,
        fbaSellers: product.fbaSellers || 0,
        fbaFeeReal: product.fbaFeeReal || 0,
        referralPct: product.referralPct || 0,
        status: 'achete',
        dateAdded: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
        actualSalePrice: null,
        realProfit: null
    };

    addToInventory(inventoryItem);
    updateFixedChargesDashboard();
    showOANotification('Produit ajoute a l\'inventaire ! (' + quantity + 'x ' + costPerUnit.toFixed(2) + ' EUR = ' + totalCost.toFixed(2) + ' EUR)', 'success');
    console.log('[OA] Achat confirme:', inventoryItem);
}

function goToNextProduct() {
    if (oaCurrentCheckIndex < oaScanResults.length - 1) {
        startChecklist(oaCurrentCheckIndex + 1);
    } else {
        showOANotification('Dernier produit atteint !', 'info');
        showSection('oa-scanner');
    }
}

// ===========================
// 3b. QUICK CHECK ASIN (pour les deals)
// ===========================

// Extraire un ASIN depuis un lien Amazon (amazon.fr, amazon.de, amazon.com, etc.)
function extractASINFromURL(input) {
    if (!input) return null;
    // Match /dp/ASIN, /gp/product/ASIN, /gp/aw/d/ASIN
    const urlPatterns = [
        /\/dp\/([A-Z0-9]{10})/i,
        /\/gp\/product\/([A-Z0-9]{10})/i,
        /\/gp\/aw\/d\/([A-Z0-9]{10})/i,
        /[?&]asin=([A-Z0-9]{10})/i
    ];
    for (const pattern of urlPatterns) {
        const match = input.match(pattern);
        if (match) return match[1].toUpperCase();
    }
    return null;
}

// Chercher un produit par nom dans les donnees CSV
function searchProductByName(query) {
    const q = query.toLowerCase().trim();
    if (q.length < 3) return [];
    const results = [];

    // Chercher dans les donnees DE
    for (const p of oaDataDE) {
        if (p.title && p.title.toLowerCase().includes(q)) {
            results.push({ source: 'csv-de', asin: p.asin, title: p.title, price: p.price });
        }
        if (results.length >= 10) break;
    }

    // Chercher dans les resultats du scan
    if (results.length < 10) {
        for (const p of oaScanResults) {
            if (p.title && p.title.toLowerCase().includes(q) && !results.find(r => r.asin === p.asin)) {
                results.push({ source: 'scan', asin: p.asin, title: p.title, price: p.pricDE });
            }
            if (results.length >= 10) break;
        }
    }

    return results;
}

// Detecte le type d'entree : ASIN, URL Amazon, ou nom de produit
function detectInputType(input) {
    const trimmed = input.trim();
    if (!trimmed) return { type: 'empty' };

    // 1. URL Amazon ?
    if (trimmed.includes('amazon.') || trimmed.includes('amzn.')) {
        const asin = extractASINFromURL(trimmed);
        if (asin) return { type: 'url', asin: asin };
        return { type: 'url-invalid' };
    }

    // 2. ASIN direct ? (10 caracteres alphanumeriques commencant par B0)
    if (/^[A-Z0-9]{10}$/i.test(trimmed)) {
        return { type: 'asin', asin: trimmed.toUpperCase() };
    }

    // 3. Sinon c'est un nom de produit
    return { type: 'name', query: trimmed };
}

function quickCheckASIN() {
    const asinInput = document.getElementById('quick-asin');
    const priceFRInput = document.getElementById('quick-price-fr');
    if (!asinInput) return;

    const rawInput = asinInput.value.trim();
    if (!rawInput || rawInput.length < 3) {
        showOANotification('Entre un ASIN, un lien Amazon ou un nom de produit', 'error');
        return;
    }

    const detected = detectInputType(rawInput);

    // Determiner l'ASIN selon le type d'entree
    let asin = null;
    if (detected.type === 'asin' || detected.type === 'url') {
        asin = detected.asin;
    } else if (detected.type === 'name') {
        // Recherche par nom — trouver le meilleur match
        const matches = searchProductByName(detected.query);
        if (matches.length === 0) {
            showOANotification('Aucun produit trouve pour "' + escapeHTML(detected.query) + '". Importe d\'abord un CSV Keepa ou entre un ASIN.', 'error');
            return;
        }
        if (matches.length === 1) {
            asin = matches[0].asin;
            showOANotification('Produit trouve : ' + escapeHTML(matches[0].title.substring(0, 60)), 'success');
        } else {
            // Plusieurs resultats — afficher la liste
            showSearchResults(matches);
            return;
        }
    } else if (detected.type === 'url-invalid') {
        showOANotification('Lien Amazon non reconnu. Verifie que l\'URL contient /dp/ASIN ou /gp/product/ASIN', 'error');
        return;
    } else {
        showOANotification('Entre un ASIN, un lien Amazon ou un nom de produit', 'error');
        return;
    }

    const priceFR = parseFloat(priceFRInput ? priceFRInput.value : 0);
    if (!priceFR || priceFR <= 0) {
        showOANotification('Entre le prix d\'achat FR', 'error');
        return;
    }

    const settings = loadOASettings();

    // Chercher dans les donnees CSV DE deja importees
    let productDE = null;
    if (oaDataDE.length > 0) {
        productDE = oaDataDE.find(p => p.asin === asin);
    }
    // Chercher aussi dans les resultats du dernier scan
    if (!productDE && oaScanResults.length > 0) {
        const fromScan = oaScanResults.find(p => p.asin === asin);
        if (fromScan) {
            productDE = { price: fromScan.pricDE, asin: asin, title: fromScan.title, bsr: fromScan.bsr, bsr90: fromScan.bsr90 || 0, fbaSellers: fromScan.fbaSellers, estSales: fromScan.estSales, amazonSells: fromScan.amazonSells, fbaFeeReal: fromScan.fbaFeeReal || 0, referralPct: fromScan.referralPct || 0, weight: fromScan.weight || 0, volumeCm3: fromScan.volumeCm3 || 0, stability: fromScan.stability, price90avg: 0, price90drop: 0, price90min: 0, price90max: 0 };
        }
    }

    // Si on a le prix DE depuis le CSV
    if (productDE && productDE.price > 0) {
        const product = {
            asin: asin,
            title: productDE.title || 'Produit ' + asin,
            pricDE: productDE.price,
            pricFR: priceFR,
            bsr: productDE.bsr || 0,
            bsr90: productDE.bsr90 || 0,
            amazonSells: productDE.amazonSells || false,
            fbaSellers: productDE.fbaSellers || 0,
            estSales: productDE.estSales || 0,
            fbaFeeReal: productDE.fbaFeeReal || 0,
            referralPct: productDE.referralPct || 0,
            weight: productDE.weight || 0,
            volumeCm3: productDE.volumeCm3 || 0,
            stability: productDE.stability || calculateStability(productDE),
            profit: 0,
            roi: 0
        };

        calculateProfit(product, settings);
        showQuickCheckResult(product, true);
    } else {
        // Pas dans le CSV — demander le prix DE manuellement
        const priceDEInput = document.getElementById('quick-price-de');
        if (!priceDEInput || !priceDEInput.value) {
            // Afficher le champ prix DE
            const deField = document.getElementById('quick-de-field');
            if (deField) deField.classList.remove('hidden');
            showOANotification('ASIN pas dans le CSV Keepa. Entre le prix DE manuellement.', 'info');
            return;
        }

        const priceDE = parseFloat(priceDEInput.value);
        if (!priceDE || priceDE <= 0) {
            showOANotification('Entre un prix DE valide', 'error');
            return;
        }

        const product = {
            asin: asin,
            title: 'Produit ' + asin,
            pricDE: priceDE,
            pricFR: priceFR,
            bsr: 0,
            bsr90: 0,
            amazonSells: false,
            fbaSellers: 0,
            estSales: 0,
            weight: 0,
            volumeCm3: 0,
            fbaFeeReal: 0,
            referralPct: 0,
            stability: { score: 0, label: 'Inconnu', color: 'gray', detail: 'Donnees manuelles' },
            profit: 0,
            roi: 0
        };

        calculateProfit(product, settings);
        showQuickCheckResult(product, false);
    }
}

// Afficher les resultats de recherche par nom
function showSearchResults(matches) {
    const container = document.getElementById('quick-search-results');
    if (!container) {
        // Fallback: utiliser le premier resultat
        const input = document.getElementById('quick-asin');
        if (input) input.value = matches[0].asin;
        showOANotification('Plusieurs resultats — premier selectionne: ' + matches[0].asin, 'info');
        return;
    }

    let html = '';
    for (const m of matches) {
        html += '<div class="px-3 py-2 hover:bg-indigo-50 cursor-pointer border-b border-gray-100 last:border-0" onclick="selectSearchResult(\'' + m.asin + '\')">';
        html += '<div class="text-sm text-gray-800 truncate">' + escapeHTML(m.title ? m.title.substring(0, 60) : m.asin) + '</div>';
        html += '<div class="text-xs text-gray-400"><span class="font-mono">' + m.asin + '</span> — ' + (m.price ? m.price.toFixed(2) + ' €' : '?') + '</div>';
        html += '</div>';
    }

    container.innerHTML = html;
    container.classList.remove('hidden');
}

function selectSearchResult(asin) {
    const input = document.getElementById('quick-asin');
    if (input) input.value = asin;

    // Cacher la liste
    const container = document.getElementById('quick-search-results');
    if (container) container.classList.add('hidden');

    showOANotification('ASIN selectionne : ' + asin, 'success');
}

function showQuickCheckResult(product, fromCSV) {
    const container = document.getElementById('quick-check-result');
    if (!container) return;

    const profitClass = product.profit >= 5 ? 'text-green-600' : (product.profit >= 3 ? 'text-yellow-600' : 'text-red-600');
    const roiClass = product.roi >= 35 ? 'text-green-600' : (product.roi >= 20 ? 'text-yellow-600' : 'text-red-600');
    const isGood = product.profit >= loadOASettings().minProfit && product.roi >= loadOASettings().minROI;

    let html = '<div class="bg-white rounded-xl shadow-sm p-6 mt-4">';
    html += '<div class="flex items-center justify-between mb-4">';
    html += '<h4 class="font-bold text-gray-800">' + escapeHTML(product.title) + '</h4>';
    html += '<span class="text-xs text-gray-400 font-mono">' + product.asin + '</span>';
    html += '</div>';

    var srcQC = getSource();
    var dstQC = getDest();
    html += '<div class="grid grid-cols-4 gap-4 mb-4">';
    html += '<div class="text-center"><div class="text-xs text-gray-400">Prix ' + srcQC.code + ' (achat)</div><div class="text-xl font-bold text-blue-600">' + product.pricFR.toFixed(2) + ' &euro;</div></div>';
    html += '<div class="text-center"><div class="text-xs text-gray-400">Prix ' + dstQC.code + ' (vente)</div><div class="text-xl font-bold text-purple-600">' + product.pricDE.toFixed(2) + ' &euro;</div></div>';
    html += '<div class="text-center"><div class="text-xs text-gray-400">Profit</div><div class="text-xl font-bold ' + profitClass + '">' + product.profit.toFixed(2) + ' &euro;</div></div>';
    html += '<div class="text-center"><div class="text-xs text-gray-400">ROI</div><div class="text-xl font-bold ' + roiClass + '">' + product.roi.toFixed(0) + '%</div></div>';
    html += '</div>';

    if (fromCSV) {
        html += '<div class="text-xs text-gray-400 mb-3">';
        html += 'BSR: ' + formatNumber(product.bsr) + ' | FBA sellers: ' + product.fbaSellers;
        html += ' | Stabilite: <span class="font-bold">' + product.stability.label + '</span>';
        if (product.amazonSells) html += ' | <span class="text-red-500 font-bold">Amazon vend !</span>';
        html += '</div>';
    } else {
        html += '<div class="text-xs text-yellow-600 mb-3"><i class="fas fa-exclamation-triangle mr-1"></i>Donnees manuelles — verifie BSR, concurrence et stabilite dans la checklist</div>';
    }

    if (isGood) {
        html += '<div class="flex items-center gap-3">';
        html += '<span class="text-green-600 font-bold"><i class="fas fa-check-circle mr-1"></i>Rentable</span>';
        html += '<button onclick="quickCheckToChecklist()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-clipboard-check mr-2"></i>Lancer la checklist</button>';
        html += '</div>';
    } else {
        html += '<div class="text-red-600 font-bold"><i class="fas fa-times-circle mr-1"></i>Pas rentable avec les criteres actuels</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Stocker le produit pour la checklist
    window._quickCheckProduct = product;
}

function quickCheckToChecklist() {
    if (!window._quickCheckProduct) return;

    // Ajouter le produit aux resultats du scan (temporairement)
    oaScanResults.push(window._quickCheckProduct);
    startChecklist(oaScanResults.length - 1);
}

// ===========================
// 4. INVENTAIRE & CAPITAL TRACKER
// ===========================

const OA_STATUS_LABELS = {
    'achete': 'Achete',
    'recu': 'Recu',
    'fnsku': 'FNSKU colle',
    'expedie': 'Envoye FBA',
    'en_vente': 'En vente',
    'vendu': 'Vendu',
    'retire': 'Retire'
};

const OA_STATUS_COLORS = {
    'achete': 'bg-yellow-600',
    'recu': 'bg-blue-600',
    'fnsku': 'bg-indigo-600',
    'expedie': 'bg-purple-600',
    'en_vente': 'bg-green-600',
    'vendu': 'bg-green-800',
    'retire': 'bg-gray-600'
};

const OA_STATUS_PIPELINE = ['achete', 'recu', 'fnsku', 'expedie', 'en_vente', 'vendu', 'retire'];

function loadOAInventory() {
    try {
        const saved = localStorage.getItem('oaInventory');
        if (saved) {
            oaInventory = JSON.parse(saved);
        }
    } catch (e) {
        console.log('[OA] Erreur chargement inventaire:', e);
        oaInventory = [];
    }
    return oaInventory;
}

function saveOAInventory() {
    try {
        localStorage.setItem('oaInventory', JSON.stringify(oaInventory));
        console.log('[OA] Inventaire sauvegarde:', oaInventory.length, 'produits');
    } catch (e) {
        console.log('[OA] Erreur sauvegarde inventaire:', e);
    }
}

function addToInventory(product) {
    loadOAInventory();
    oaInventory.push(product);
    saveOAInventory();
    renderInventory();
}

function deleteInventoryItem(productId) {
    loadOAInventory();
    const product = oaInventory.find(p => p.id === productId);
    if (!product) return;

    const name = product.title || product.asin || productId;
    if (!confirm('Supprimer "' + name + '" de l\'inventaire ?')) return;

    oaInventory = oaInventory.filter(p => p.id !== productId);
    saveOAInventory();
    renderInventory();
    updateFixedChargesDashboard();
    showOANotification('Produit supprime de l\'inventaire', 'info');
    console.log('[OA] Produit supprime:', productId);
}

function updateProductStatus(productId, newStatus) {
    loadOAInventory();
    const product = oaInventory.find(p => p.id === productId);
    if (!product) return;

    if (newStatus === 'vendu') {
        const priceStr = prompt('Prix de vente reel PAR UNITE (en EUR) :');
        if (priceStr === null) return;
        const actualPrice = parseFloat(priceStr);
        if (isNaN(actualPrice) || actualPrice <= 0) {
            showOANotification('Prix invalide', 'error');
            return;
        }
        markAsSold(productId, actualPrice);
        return;
    }

    product.status = newStatus;
    product.dateUpdated = new Date().toISOString();
    saveOAInventory();
    renderInventory();
    console.log('[OA] Statut mis a jour:', productId, '->', newStatus);
}

function advanceProductStatus(productId) {
    loadOAInventory();
    const product = oaInventory.find(p => p.id === productId);
    if (!product) return;

    const currentIndex = OA_STATUS_PIPELINE.indexOf(product.status);
    if (currentIndex < 0 || currentIndex >= OA_STATUS_PIPELINE.length - 1) return;

    const nextStatus = OA_STATUS_PIPELINE[currentIndex + 1];
    updateProductStatus(productId, nextStatus);
}

function markAsSold(productId, actualSalePrice) {
    loadOAInventory();
    const product = oaInventory.find(p => p.id === productId);
    if (!product) return;

    const settings = loadOASettings();
    const commPct = (product.referralPct > 0) ? product.referralPct : settings.commissionPct;
    const commission = actualSalePrice * (commPct / 100);
    const fbaFee = (product.fbaFeeReal > 0) ? product.fbaFeeReal : settings.fbaFee;
    const inbound = getInboundCost(product.weight, settings);
    const storageCost = getStorageCost(product.volumeCm3, product.estSales, product.fbaSellers, settings);
    const totalFees = commission + fbaFee + inbound + settings.prepCost + storageCost;
    const urssaf = actualSalePrice * (settings.urssafPct / 100);
    const realProfit = (actualSalePrice - totalFees - urssaf - product.costPerUnit) * product.quantity;

    product.status = 'vendu';
    product.actualSalePrice = actualSalePrice;
    product.realProfit = Math.round(realProfit * 100) / 100;
    product.dateUpdated = new Date().toISOString();
    product.dateSold = new Date().toISOString();

    saveOAInventory();
    renderInventory();
    updateFixedChargesDashboard();
    console.log('[OA] Produit vendu:', productId, 'profit reel:', product.realProfit);
    showOANotification('Vente enregistree ! Profit reel: ' + product.realProfit.toFixed(2) + ' EUR', 'success');
}

function recheckPrice(productId) {
    loadOAInventory();
    const product = oaInventory.find(p => p.id === productId);
    if (!product) return;

    const newPriceStr = prompt('Prix actuel sur Amazon.de pour ' + (product.title || product.asin) + ' (en EUR) :');
    if (newPriceStr === null) return;
    const newPriceDE = parseFloat(newPriceStr);
    if (isNaN(newPriceDE) || newPriceDE <= 0) {
        showOANotification('Prix invalide', 'error');
        return;
    }

    const settings = loadOASettings();
    const commPct = (product.referralPct > 0) ? product.referralPct : settings.commissionPct;
    const commission = newPriceDE * (commPct / 100);
    const fbaFee = (product.fbaFeeReal > 0) ? product.fbaFeeReal : settings.fbaFee;
    const inbound = getInboundCost(product.weight, settings);
    const storageCost = getStorageCost(product.volumeCm3, product.estSales, product.fbaSellers, settings);
    const totalFees = commission + fbaFee + inbound + settings.prepCost + storageCost;
    const urssaf = newPriceDE * (settings.urssafPct / 100);
    const newProfit = (newPriceDE - totalFees - urssaf - product.costPerUnit) * product.quantity;

    const oldPricDE = product.pricDE;
    product.pricDE = newPriceDE;
    product.expectedProfit = Math.round(newProfit * 100) / 100;
    product.dateUpdated = new Date().toISOString();
    product.lastPriceCheck = new Date().toISOString();

    saveOAInventory();
    renderInventory();

    const diff = newPriceDE - oldPricDE;
    const diffText = diff >= 0 ? '+' + diff.toFixed(2) : diff.toFixed(2);
    const profitPerUnit = Math.round((newProfit / product.quantity) * 100) / 100;

    if (profitPerUnit > 0) {
        showOANotification('Prix DE: ' + newPriceDE.toFixed(2) + '\u20ac (' + diffText + '\u20ac) — Profit: ' + profitPerUnit.toFixed(2) + '\u20ac/unite', 'success');
    } else {
        showOANotification('ATTENTION: Prix DE: ' + newPriceDE.toFixed(2) + '\u20ac — Profit NEGATIF: ' + profitPerUnit.toFixed(2) + '\u20ac/unite !', 'error');
    }
}

function calculateCapital() {
    loadOAInventory();
    const settings = loadOASettings();
    const total = settings.capitalTotal;

    let spent = 0;
    let recovered = 0;

    oaInventory.forEach(p => {
        if (p.status !== 'vendu' && p.status !== 'retire') {
            spent += p.totalCost || 0;
        }
        if (p.status === 'vendu') {
            // Capital recupere = cout d'achat + profit reel
            recovered += (p.totalCost || 0) + (p.realProfit || 0);
        }
    });

    const available = total - spent + recovered;

    return {
        total: Math.round(total * 100) / 100,
        spent: Math.round(spent * 100) / 100,
        recovered: Math.round(recovered * 100) / 100,
        available: Math.round(available * 100) / 100
    };
}

function renderInventory() {
    const container = document.getElementById('inv-product-list');
    if (!container) return;

    loadOAInventory();
    const cap = calculateCapital();

    // Mettre a jour les cartes de capital statiques du HTML
    const elTotal = document.getElementById('inv-capital-total');
    const elSpent = document.getElementById('inv-capital-spent');
    const elRecovered = document.getElementById('inv-capital-recovered');
    const elAvailable = document.getElementById('inv-capital-available');
    const elBar = document.getElementById('inv-capital-bar');
    const elBarLabel = document.getElementById('inv-capital-bar-label');

    if (elTotal) elTotal.textContent = cap.total.toFixed(0) + ' \u20ac';
    if (elSpent) elSpent.textContent = cap.spent.toFixed(0) + ' \u20ac';
    if (elRecovered) elRecovered.textContent = cap.recovered.toFixed(0) + ' \u20ac';
    if (elAvailable) elAvailable.textContent = cap.available.toFixed(0) + ' \u20ac';
    if (elBar) elBar.style.width = (cap.total > 0 ? (cap.available / cap.total * 100) : 100) + '%';
    if (elBarLabel) elBarLabel.textContent = cap.available.toFixed(0) + ' \u20ac disponible';

    // Mettre a jour les stats bilan
    const bought = oaInventory.length;
    const sold = oaInventory.filter(p => p.status === 'vendu').length;
    const pipeline = oaInventory.filter(p => p.status !== 'vendu' && p.status !== 'retire').length;
    const profitRealized = oaInventory.filter(p => p.status === 'vendu').reduce((s, p) => s + (p.realProfit || 0), 0);

    const elBought = document.getElementById('inv-total-bought');
    const elPipeline = document.getElementById('inv-total-pipeline');
    const elSold = document.getElementById('inv-total-sold');
    const elProfit = document.getElementById('inv-total-profit');

    if (elBought) elBought.textContent = bought;
    if (elPipeline) elPipeline.textContent = pipeline;
    if (elSold) elSold.textContent = sold;
    if (elProfit) elProfit.textContent = profitRealized.toFixed(0) + ' \u20ac';

    // Mettre a jour le sidebar OA
    updateSidebarOA();

    let html = '';

    // Capital tracker est affiche dans les cartes HTML statiques (mis a jour ci-dessus)

    // Liste des produits
    if (oaInventory.length === 0) {
        html += '<div class="text-center py-8 text-gray-400">';
        html += '<i class="fas fa-box-open fa-3x mb-4"></i>';
        html += '<p>Aucun produit dans l\'inventaire.</p>';
        html += '<p class="text-sm mt-2">Lancez un scan et achetez des produits pour commencer.</p></div>';
    } else {
        html += '<div class="space-y-3">';
        oaInventory.forEach(p => {
            const statusLabel = OA_STATUS_LABELS[p.status] || p.status;
            const statusColor = OA_STATUS_COLORS[p.status] || 'bg-gray-600';
            const dateStr = new Date(p.dateUpdated || p.dateAdded).toLocaleDateString('fr-FR');
            const titleShort = (p.title || '').length > 45 ? p.title.substring(0, 45) + '...' : (p.title || 'Sans titre');
            const canAdvance = OA_STATUS_PIPELINE.indexOf(p.status) < OA_STATUS_PIPELINE.length - 1;

            html += '<div class="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-4">';

            // Info produit
            html += '<div class="flex-1 min-w-0">';
            html += '<div class="font-medium text-white text-sm truncate">' + escapeHTML(titleShort) + '</div>';
            html += '<div class="text-xs text-gray-500 flex items-center gap-3 mt-1">';
            html += '<span class="font-mono">' + (p.asin || '') + '</span>';
            html += '<span>' + p.quantity + 'x ' + (p.costPerUnit || 0).toFixed(2) + ' &euro;</span>';
            html += '<span>' + dateStr + '</span>';
            html += '</div></div>';

            // Cout et profit
            html += '<div class="text-right text-sm">';
            html += '<div class="text-yellow-400 font-bold">' + (p.totalCost || 0).toFixed(2) + ' &euro;</div>';
            if (p.status === 'vendu' && p.realProfit !== null) {
                const profitColor = p.realProfit >= 0 ? 'text-green-400' : 'text-red-400';
                html += '<div class="text-xs ' + profitColor + '">Profit: ' + p.realProfit.toFixed(2) + ' &euro;</div>';
            } else {
                html += '<div class="text-xs text-gray-500">Estime: +' + (p.expectedProfit || 0).toFixed(2) + ' &euro;</div>';
            }
            html += '</div>';

            // Bouton re-verifier prix (seulement pour produits en pipeline, pas vendus/retires)
            const inPipelineStatus = ['achete', 'recu', 'fnsku', 'expedie', 'en_vente'];
            if (inPipelineStatus.indexOf(p.status) !== -1) {
                html += '<div>';
                html += '<button onclick="recheckPrice(\'' + p.id + '\')" class="text-gray-400 hover:text-blue-400 text-xs" title="Re-verifier le prix DE actuel">';
                html += '<i class="fas fa-sync-alt"></i></button>';
                if (p.lastPriceCheck) {
                    const checkDate = new Date(p.lastPriceCheck);
                    const ago = Math.round((Date.now() - checkDate.getTime()) / 3600000);
                    html += '<div class="text-xs text-gray-600">' + (ago < 24 ? ago + 'h' : Math.round(ago / 24) + 'j') + '</div>';
                }
                html += '</div>';
            }

            // Badge statut (cliquable) + supprimer
            html += '<div class="flex items-center gap-2">';
            if (canAdvance) {
                html += '<button onclick="advanceProductStatus(\'' + p.id + '\')" class="' + statusColor + ' text-white px-3 py-1 rounded text-xs font-bold hover:opacity-80 cursor-pointer">';
                html += statusLabel + ' <i class="fas fa-arrow-right ml-1"></i></button>';
            } else {
                html += '<span class="' + statusColor + ' text-white px-3 py-1 rounded text-xs font-bold">' + statusLabel + '</span>';
            }
            html += '<button onclick="deleteInventoryItem(\'' + p.id + '\')" class="text-gray-600 hover:text-red-400 text-xs ml-1" title="Supprimer ce produit">';
            html += '<i class="fas fa-trash-alt"></i></button>';
            html += '</div>';

            html += '</div>';
        });
        html += '</div>';

        // Stats resume
        const totalBought = oaInventory.length;
        const inPipeline = oaInventory.filter(p => p.status !== 'vendu' && p.status !== 'retire').length;
        const soldCount = oaInventory.filter(p => p.status === 'vendu').length;
        const profitRealized = oaInventory.filter(p => p.status === 'vendu').reduce((s, p) => s + (p.realProfit || 0), 0);
        const profitExpected = oaInventory.filter(p => p.status !== 'vendu' && p.status !== 'retire').reduce((s, p) => s + (p.expectedProfit || 0), 0);

        html += '<div class="grid grid-cols-5 gap-3 mt-6">';
        html += '<div class="bg-gray-800 rounded-lg p-3 text-center">';
        html += '<div class="text-lg font-bold text-white">' + totalBought + '</div>';
        html += '<div class="text-xs text-gray-400">Total achetes</div></div>';
        html += '<div class="bg-gray-800 rounded-lg p-3 text-center">';
        html += '<div class="text-lg font-bold text-blue-400">' + inPipeline + '</div>';
        html += '<div class="text-xs text-gray-400">En pipeline</div></div>';
        html += '<div class="bg-gray-800 rounded-lg p-3 text-center">';
        html += '<div class="text-lg font-bold text-green-400">' + soldCount + '</div>';
        html += '<div class="text-xs text-gray-400">Vendus</div></div>';
        html += '<div class="bg-gray-800 rounded-lg p-3 text-center">';
        html += '<div class="text-lg font-bold ' + (profitRealized >= 0 ? 'text-green-400' : 'text-red-400') + '">' + profitRealized.toFixed(2) + ' &euro;</div>';
        html += '<div class="text-xs text-gray-400">Profit realise</div></div>';
        html += '<div class="bg-gray-800 rounded-lg p-3 text-center">';
        html += '<div class="text-lg font-bold text-yellow-400">' + profitExpected.toFixed(2) + ' &euro;</div>';
        html += '<div class="text-xs text-gray-400">Profit attendu</div></div>';
        html += '</div>';
    }

    container.innerHTML = html;
}

// ===========================
// 5. SIDEBAR OA UPDATE (switchMode et initMode sont dans app.js)
// ===========================

function updateSidebarOA() {
    const capEl = document.getElementById('sidebar-oa-capital');
    const profitEl = document.getElementById('sidebar-oa-profit');
    if (!capEl || !profitEl) return;

    const cap = calculateCapital();
    const inv = loadOAInventory();
    const profitRealized = inv.filter(p => p.status === 'vendu').reduce((s, p) => s + (p.realProfit || 0), 0);

    capEl.textContent = cap.available.toFixed(0) + ' \u20ac';
    profitEl.textContent = profitRealized.toFixed(0) + ' \u20ac';
}

// ===========================
// FONCTIONS UTILITAIRES
// ===========================

var oaActiveToasts = [];
function showOANotification(message, type) {
    // Creer un toast notification
    const toast = document.createElement('div');
    // Calculer le decalage vertical selon les toasts actifs
    const offset = oaActiveToasts.length * 56; // ~56px par toast (padding + margin)
    toast.className = 'fixed right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all duration-300 transform translate-x-full';
    toast.style.top = (16 + offset) + 'px';

    if (type === 'success') {
        toast.classList.add('bg-green-600');
    } else if (type === 'error') {
        toast.classList.add('bg-red-600');
    } else {
        toast.classList.add('bg-blue-600');
    }

    toast.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : (type === 'error' ? 'exclamation-circle' : 'info-circle')) + ' mr-2"></i>' + escapeHTML(message);

    document.body.appendChild(toast);
    oaActiveToasts.push(toast);

    // Animation entree
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full');
        toast.classList.add('translate-x-0');
    });

    // Disparition automatique
    setTimeout(() => {
        toast.classList.add('translate-x-full');
        toast.classList.remove('translate-x-0');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            oaActiveToasts = oaActiveToasts.filter(function(t) { return t !== toast; });
        }, 300);
    }, 3000);
}

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ===========================
// INITIALISATION OA
// ===========================

// ===========================
// DEAL SCANNER
// ===========================

// --- Keepa Search Cache (titre → ASIN) ---
var keepaSearchTitleCache = {};

function loadSearchCache() {
    try {
        var raw = localStorage.getItem('keepaSearchCache');
        if (raw) {
            keepaSearchTitleCache = JSON.parse(raw);
            // Nettoyer > 7 jours
            var now = Date.now();
            Object.keys(keepaSearchTitleCache).forEach(function(key) {
                if (now - keepaSearchTitleCache[key].ts > 7 * 24 * 60 * 60 * 1000) {
                    delete keepaSearchTitleCache[key];
                }
            });
            console.log('[DealScanner] Cache recherche charge: ' + Object.keys(keepaSearchTitleCache).length + ' titres');
        }
    } catch (e) { keepaSearchTitleCache = {}; }
}

function saveSearchCache() {
    try { localStorage.setItem('keepaSearchCache', JSON.stringify(keepaSearchTitleCache)); } catch (e) {}
}

// --- Keepa Cache ---
function loadKeepaCache() {
    try {
        var raw = localStorage.getItem('keepaCache');
        if (raw) {
            keepaCache = JSON.parse(raw);
            // Nettoyer les entrees expirees (> 24h)
            var now = Date.now();
            var cleaned = 0;
            Object.keys(keepaCache).forEach(function(key) {
                // Expirer aussi les entrees sans frais FBA (ancien cache avant fbafees=1)
                if (now - keepaCache[key].timestamp > KEEPA_CACHE_TTL || !keepaCache[key].fbaPickAndPack) {
                    delete keepaCache[key];
                    cleaned++;
                }
            });
            if (cleaned > 0) {
                localStorage.setItem('keepaCache', JSON.stringify(keepaCache));
                console.log('[DealScanner] Cache Keepa: ' + cleaned + ' entrees expirees nettoyees');
            }
            console.log('[DealScanner] Cache Keepa charge: ' + Object.keys(keepaCache).length + ' entrees');
        }
    } catch (e) {
        keepaCache = {};
        console.warn('[DealScanner] Erreur chargement cache Keepa:', e);
    }
}

function saveKeepaCache() {
    try {
        localStorage.setItem('keepaCache', JSON.stringify(keepaCache));
    } catch (e) {
        console.warn('[DealScanner] Erreur sauvegarde cache Keepa:', e);
    }
}

// --- Keepa API Lookup (single ASIN/EAN) ---
async function keepaLookup(identifier, type) {
    var settings = loadOASettings();
    var apiKey = settings.keepaApiKey;
    if (!apiKey) {
        console.warn('[DealScanner] Pas de cle API Keepa configuree');
        return null;
    }

    var domain = KEEPA_DOMAINS[dealSellMarket] || 3;
    var url;
    if (type === 'ean') {
        url = 'https://api.keepa.com/product?key=' + apiKey + '&domain=' + domain + '&ean=' + identifier + '&stats=180&fbafees=1';
    } else {
        url = 'https://api.keepa.com/product?key=' + apiKey + '&domain=' + domain + '&asin=' + identifier + '&stats=180&fbafees=1';
    }

    try {
        console.log('[DealScanner] Keepa lookup: ' + type + '=' + identifier + ' domain=' + domain);
        var resp = await fetch(url);
        console.log('[DealScanner] Keepa lookup HTTP ' + resp.status);

        if (!resp.ok) {
            var errText = await resp.text();
            console.error('[DealScanner] Keepa lookup HTTP erreur:', resp.status, errText);
            return null;
        }

        var data = await resp.json();

        if (data.error) {
            console.warn('[DealScanner] Keepa API erreur:', JSON.stringify(data.error));
            return null;
        }

        console.log('[DealScanner] Keepa tokensLeft=' + data.tokensLeft + ' products=' + (data.products ? data.products.length : 0));

        if (data.products && data.products.length > 0) {
            var result = parseKeepaProduct(data.products[0]);
            if (result) {
                keepaCache[result.asin] = result;
                saveKeepaCache();
                console.log('[DealScanner] Keepa lookup OK: ' + result.asin + ' prix=' + result.price + '€ bsr=' + result.bsr);
            }
            return result;
        }

        console.warn('[DealScanner] Keepa lookup: aucun produit retourne pour ' + identifier);
        return null;
    } catch (e) {
        console.error('[DealScanner] Keepa lookup ERREUR:', e.message, e);
        return null;
    }
}

// --- Keepa Batch Lookup (plusieurs ASINs en 1 appel) ---
async function keepaBatchLookup(asins) {
    var settings = loadOASettings();
    var apiKey = settings.keepaApiKey;
    if (!apiKey || asins.length === 0) return {};

    var domain = KEEPA_DOMAINS[dealSellMarket] || 3;
    var url = 'https://api.keepa.com/product?key=' + apiKey + '&domain=' + domain + '&asin=' + asins.join(',') + '&stats=180&fbafees=1';

    var keepaStatsEl = document.getElementById('deal-stats-keepa');

    try {
        console.log('[DealScanner] Keepa batch URL: domain=' + domain + ' asins=' + asins.join(','));
        var resp = await fetch(url);
        console.log('[DealScanner] Keepa batch HTTP ' + resp.status);

        if (!resp.ok) {
            var errText = await resp.text();
            console.error('[DealScanner] Keepa batch HTTP erreur:', resp.status, errText);
            if (keepaStatsEl) keepaStatsEl.innerHTML = '<span class="text-red-500">Keepa erreur HTTP ' + resp.status + '</span>';
            return {};
        }

        var data = await resp.json();

        if (data.error) {
            console.warn('[DealScanner] Keepa batch erreur:', JSON.stringify(data.error));
            if (keepaStatsEl) keepaStatsEl.innerHTML = '<span class="text-red-500">Keepa: ' + (data.error.message || JSON.stringify(data.error)) + '</span>';
            return {};
        }

        if (data.tokensLeft !== undefined) keepaTokensLeft = data.tokensLeft;
        console.log('[DealScanner] Keepa tokensLeft=' + data.tokensLeft + ' refillIn=' + data.refillIn + ' refillRate=' + data.refillRate);
        console.log('[DealScanner] Keepa products retournes: ' + (data.products ? data.products.length : 0));

        var results = {};
        if (data.products && data.products.length > 0) {
            data.products.forEach(function(p) {
                var result = parseKeepaProduct(p);
                if (result) {
                    results[p.asin] = result;
                    keepaCache[p.asin] = result;
                    console.log('[DealScanner] Keepa ASIN ' + p.asin + ': prix=' + result.price + ' bsr=' + result.bsr);
                }
            });
            saveKeepaCache();
            console.log('[DealScanner] Keepa batch OK: ' + Object.keys(results).length + '/' + asins.length + ' produits trouves');
        } else {
            console.warn('[DealScanner] Keepa batch: aucun produit retourne (products=' + JSON.stringify(data.products) + ')');
        }

        return results;
    } catch (e) {
        console.error('[DealScanner] Keepa batch ERREUR:', e.message, e);
        if (keepaStatsEl) keepaStatsEl.innerHTML = '<span class="text-red-500">Keepa: ' + e.message + '</span>';
        return {};
    }
}

// --- Parser un produit Keepa (utilise par lookup et batch) ---
function parseKeepaProduct(p) {
    var stats = p.stats || {};

    var amazonPrice = -1;
    var newPrice = -1;
    if (p.csv && p.csv[0]) {
        var csvAmazon = p.csv[0];
        if (csvAmazon.length >= 2) {
            amazonPrice = csvAmazon[csvAmazon.length - 1];
            if (amazonPrice > 0) amazonPrice = amazonPrice / 100;
        }
    }
    if (p.csv && p.csv[1]) {
        var csvNew = p.csv[1];
        if (csvNew.length >= 2) {
            newPrice = csvNew[csvNew.length - 1];
            if (newPrice > 0) newPrice = newPrice / 100;
        }
    }

    var bestPrice = -1;
    if (amazonPrice > 0) bestPrice = amazonPrice;
    else if (newPrice > 0) bestPrice = newPrice;

    // Extraire les vrais frais FBA depuis Keepa (fbafees=1)
    var fbaPickAndPack = null; // Frais AMZ reels (fulfillment)
    var referralFeePct = null; // Commission reelle (%)

    if (p.fbaFees) {
        if (p.fbaFees.pickAndPackFee && p.fbaFees.pickAndPackFee > 0) {
            fbaPickAndPack = p.fbaFees.pickAndPackFee / 100;
        }
    }
    if (p.referralFeePercentage && p.referralFeePercentage > 0) {
        referralFeePct = p.referralFeePercentage;
    }

    // Poids du produit (Keepa: packageWeight/itemWeight en grammes, -1 = inconnu)
    var weight = 0;
    if (p.packageWeight && p.packageWeight > 0) weight = p.packageWeight;
    else if (p.itemWeight && p.itemWeight > 0) weight = p.itemWeight;

    return {
        asin: p.asin,
        title: p.title,
        price: bestPrice,
        amazonPrice: amazonPrice > 0 ? amazonPrice : null,
        marketplacePrice: newPrice > 0 ? newPrice : null,
        bsr: (stats.current && stats.current[3] >= 0) ? stats.current[3] : (p.salesRankReference || 0),
        fbaSellers: (p.fbaOfferCount && p.fbaOfferCount.length > 0) ? p.fbaOfferCount[p.fbaOfferCount.length - 1] : 0,
        category: p.categoryTree ? p.categoryTree.map(function(c) { return c.name; }).join(' > ') : '',
        imageUrl: p.imagesCSV ? ('https://images-na.ssl-images-amazon.com/images/I/' + p.imagesCSV.split(',')[0]) : '',
        fbaPickAndPack: fbaPickAndPack,
        referralFeePct: referralFeePct,
        weight: weight,
        timestamp: Date.now()
    };
}

// --- Extraire marque + modele d'un titre (pour recherche Keepa) ---
// Genere plusieurs variantes de recherche a partir d'un titre de deal
function buildSearchTerms(title) {
    if (!title) return [];
    var terms = [];

    // Nettoyage de base (commun a toutes les variantes)
    var base = title
        .replace(/\s*\d+°\s*/, '')           // enlever temperature Pepper
        .replace(/\([^)]*\)/g, ' ')           // enlever parentheses
        .replace(/\[[^\]]*\]/g, ' ')          // enlever crochets
        // Remplacer les tirets SAUF dans les refs produit (ex: A168WA-1YES, LE520-RGB)
        .replace(/\s+[-–—]\s+/g, ' ')         // tirets entourés d'espaces = separateurs
        .replace(/[|]/g, ' ')                 // pipe = separateur
        .replace(/[€$£%]/g, '')               // enlever symboles monnaie
        .replace(/\d+[,.]?\d*\s*€/g, '')      // enlever prix
        .replace(/\s+/g, ' ')
        .trim();

    // Mots de bruit promo
    var promoNoise = /\b(promo|offre|bon plan|deal|livraison gratuite|en stock|disponible|gratuit|soldes?|destockage|vente flash|code promo|reduction|remise|pas cher|meilleur prix)\b/gi;
    // Mots couleurs
    var colorWords = /\b(noir|noire|blanc|blanche|rouge|bleu|bleue|vert|verte|gris|grise|argent|or|rose|beige|violet|orange|jaune|marine|anthracite)\b/gi;
    // Mots connectique/adjectifs generiques
    var genericAdj = /\b(avec|pour|sans|fil|filaire|edition|version|pack|lot|kit|set|paire|neuf|occasion|reconditionne|compatible|inclus|fourni|effet|coton|100)\b/gi;
    // Mots type-produit (enleves seulement en V3)
    var productType = /\b(casque|ecouteur|ecouteurs|enceinte|montre|aspirateur|robot|tablette|smartphone|telephone|portable|souris|clavier|imprimante|batterie|chargeur|cable|adaptateur|housse|coque|etui|protection|support|connecte|intelligente?|numerique|lecteur|camera|webcam|micro|haut parleur|pantalon|chino|puzzle|watercooling|ventilateur|ventilateurs|ampoule|ampoules|vol|billet)\b/gi;

    // Variante 1 : titre presque complet (enlever juste le bruit promo)
    var v1 = base
        .replace(promoNoise, ' ')
        .replace(/\s+/g, ' ').trim();
    var v1words = v1.split(' ').filter(function(w) { return w.length > 1; });
    if (v1words.length > 10) v1words = v1words.slice(0, 10);
    if (v1words.length >= 2) terms.push(v1words.join(' '));

    // Variante 2 : enlever couleurs + adjectifs generiques (garder type produit + marque + modele)
    var v2 = base
        .replace(promoNoise, ' ')
        .replace(colorWords, ' ')
        .replace(genericAdj, ' ')
        .replace(/\s+/g, ' ').trim();
    var v2words = v2.split(' ').filter(function(w) { return w.length > 1; });
    if (v2words.length > 8) v2words = v2words.slice(0, 8);
    if (v2words.length >= 2) terms.push(v2words.join(' '));

    // Variante 3 : marque + modele seulement (enlever aussi le type produit)
    var v3 = v2
        .replace(productType, ' ')
        .replace(/\s+/g, ' ').trim();
    var v3words = v3.split(' ').filter(function(w) { return w.length > 1; });
    if (v3words.length > 5) v3words = v3words.slice(0, 5);
    if (v3words.length >= 2 && v3words.join(' ') !== (terms[terms.length - 1] || '')) {
        terms.push(v3words.join(' '));
    }

    // Dedupliquer
    var seen = {};
    return terms.filter(function(t) {
        var key = t.toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
    });
}

// Tokens Keepa restants (mis a jour apres chaque appel)
var keepaTokensLeft = 60;

// --- Appel unitaire Keepa search (1 token) ---
async function keepaSearchOne(apiKey, domain, term) {
    var url = 'https://api.keepa.com/search?key=' + apiKey + '&domain=' + domain + '&type=product&term=' + encodeURIComponent(term) + '&asins-only=1&page=0';
    var resp = await fetch(url);
    var data = await resp.json();
    if (data.tokensLeft !== undefined) keepaTokensLeft = data.tokensLeft;
    if (data.asinList && data.asinList.length > 0) {
        return data.asinList[0];
    }
    return null;
}

// --- Recherche Keepa par titre — strategie economique en tokens ---
// Cout : 1 token par tentative. Strategie escalade :
//   Etape 1 : V2 (mots-cles) sur FR → 1 token
//   Etape 2 : V2 sur DE → 1 token
//   Etape 3 : V3 (marque+modele) sur FR → 1 token
//   Etape 4 : V1 (titre complet) sur FR → 1 token
// Total max : 4 tokens par deal (arret des le premier resultat)
async function keepaSearchByTitle(title) {
    var settings = loadOASettings();
    var apiKey = settings.keepaApiKey;
    if (!apiKey || !title) return null;

    // Verifier qu'on a des tokens
    if (keepaTokensLeft <= 0) {
        console.log('[DealScanner] Plus de tokens Keepa (' + keepaTokensLeft + '), skip "' + title.substring(0, 30) + '"');
        return null;
    }

    // Verifier le cache titre→ASIN
    var cacheKey = title.substring(0, 50).toLowerCase().trim();
    if (keepaSearchTitleCache[cacheKey]) {
        console.log('[DealScanner] Cache titre→ASIN: "' + title.substring(0, 30) + '" → ' + keepaSearchTitleCache[cacheKey].asin);
        return keepaSearchTitleCache[cacheKey].asin;
    }

    var searchTerms = buildSearchTerms(title);
    if (searchTerms.length === 0) return null;

    var FR = 4, DE = 3;

    // Ordre de tentatives optimise : V2/FR → V2/DE → V3/FR → V1/FR
    var attempts = [];
    if (searchTerms[1]) attempts.push({ term: searchTerms[1], domain: FR, label: 'V2/FR' });
    if (searchTerms[1]) attempts.push({ term: searchTerms[1], domain: DE, label: 'V2/DE' });
    if (searchTerms[2]) attempts.push({ term: searchTerms[2], domain: FR, label: 'V3/FR' });
    if (searchTerms[0]) attempts.push({ term: searchTerms[0], domain: FR, label: 'V1/FR' });
    // Si seulement V1 existe (titre court)
    if (attempts.length === 0 && searchTerms[0]) {
        attempts.push({ term: searchTerms[0], domain: FR, label: 'V1/FR' });
        attempts.push({ term: searchTerms[0], domain: DE, label: 'V1/DE' });
    }

    console.log('[DealScanner] Recherche "' + title.substring(0, 40) + '" → ' + attempts.length + ' tentatives max');

    for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        if (keepaTokensLeft <= 0) {
            console.log('[DealScanner] Plus de tokens, arret recherche');
            return null;
        }
        try {
            var asin = await keepaSearchOne(apiKey, a.domain, a.term);
            if (asin) {
                console.log('[DealScanner] TROUVE ' + a.label + ': "' + a.term.substring(0, 25) + '" → ' + asin + ' (tokens=' + keepaTokensLeft + ')');
                keepaSearchTitleCache[cacheKey] = { asin: asin, ts: Date.now() };
                saveSearchCache();
                return asin;
            }
            console.log('[DealScanner] ' + a.label + ' "' + a.term.substring(0, 25) + '" → 0 (tokens=' + keepaTokensLeft + ')');
        } catch (e) {
            console.warn('[DealScanner] ' + a.label + ' erreur: ' + e.message);
        }
    }

    console.log('[DealScanner] Aucun ASIN pour "' + title.substring(0, 30) + '"');
    return null;
}

// --- Queue Keepa ---
async function processKeepaQueue() {
    if (keepaProcessing || keepaQueue.length === 0) return;
    keepaProcessing = true;
    console.log('[DealScanner] Demarrage queue Keepa: ' + keepaQueue.length + ' ASINs en attente');

    while (keepaQueue.length > 0) {
        var item = keepaQueue.shift();
        // item = { identifier, type, dealIndex }
        var result = await keepaLookup(item.identifier, item.type);

        if (result && item.dealIndex >= 0 && item.dealIndex < dealScannerResults.length) {
            var deal = dealScannerResults[item.dealIndex];
            if (!deal.asin && result.asin) deal.asin = result.asin;
            deal.amazonPrice = result.price;
            deal.keepaData = result;

            // Recalculer le profit
            if (deal.price > 0 && result.price > 0) {
                var profitResult = calculateDealProfit(deal, result);
                deal.profit = profitResult.profit;
                deal.roi = profitResult.roi;
                deal.fees = profitResult.fees;
            }

            // Mettre a jour la ligne dans le tableau
            updateDealRow(item.dealIndex, deal);
        }

        // Mettre a jour le compteur queue
        var keepaStatsEl = document.getElementById('deal-stats-keepa');
        if (keepaStatsEl) {
            if (keepaQueue.length > 0) {
                keepaStatsEl.textContent = '⏳ ' + keepaQueue.length + ' en attente Keepa';
            } else {
                keepaStatsEl.textContent = '';
            }
        }

        // Respecter le rate limit (65s entre chaque appel)
        if (keepaQueue.length > 0) {
            await new Promise(function(resolve) { setTimeout(resolve, KEEPA_RATE_LIMIT_MS); });
        }
    }

    keepaProcessing = false;
    console.log('[DealScanner] Queue Keepa terminee');
    // Re-render les stats finales
    updateDealStats();
}

// --- Chercher dans les donnees CSV deja chargees ---
function findProductInCSV(asin) {
    if (!asin) return null;
    // Chercher dans oaDataDE (marche de vente)
    if (oaDataDE.length > 0) {
        var found = oaDataDE.find(function(p) { return p.asin === asin; });
        if (found && found.price > 0) return found;
    }
    // Chercher dans oaScanResults
    if (oaScanResults.length > 0) {
        var fromScan = oaScanResults.find(function(p) { return p.asin === asin; });
        if (fromScan) return { price: fromScan.pricDE, asin: asin, bsr: fromScan.bsr, fbaSellers: fromScan.fbaSellers };
    }
    return null;
}

// --- Calcul du profit pour un deal ---
function calculateDealProfit(deal, amazonData) {
    var settings = loadOASettings();
    var buyPrice = deal.price;
    var sellPrice = amazonData.price;

    if (!buyPrice || buyPrice <= 0 || !sellPrice || sellPrice <= 0) {
        return { profit: 0, roi: 0, fees: 0 };
    }

    // Commission : utiliser le vrai % Keepa si dispo, sinon le defaut parametres
    var realCommission = false;
    var commPct = settings.commissionPct;
    if (amazonData.referralFeePct && amazonData.referralFeePct > 0) {
        commPct = amazonData.referralFeePct;
        realCommission = true;
    }
    var commission = sellPrice * (commPct / 100);

    // Frais AMZ (FBA fulfillment) : utiliser le vrai montant Keepa si dispo
    var realFbaFee = false;
    var fbaFee = settings.fbaFee;
    if (amazonData.fbaPickAndPack && amazonData.fbaPickAndPack > 0) {
        fbaFee = amazonData.fbaPickAndPack;
        realFbaFee = true;
    }

    // Inbound intelligent : utiliser le poids Keepa si disponible
    var inbound = getInboundCost(amazonData.weight, settings);
    var realInbound = (amazonData.weight && amazonData.weight > 0);
    var prep = settings.prepCost;
    var urssaf = sellPrice * (settings.urssafPct / 100);

    var totalFees = commission + fbaFee + inbound + prep;
    var profit = sellPrice - buyPrice - totalFees - urssaf;
    var roi = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;

    return {
        profit: Math.round(profit * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        fees: {
            total: Math.round(totalFees * 100) / 100,
            commission: Math.round(commission * 100) / 100,
            commPct: commPct,
            realCommission: realCommission,
            fbaFee: Math.round(fbaFee * 100) / 100,
            realFbaFee: realFbaFee,
            inbound: Math.round(inbound * 100) / 100,
            realInbound: realInbound,
            weightGrams: amazonData.weight || 0,
            prep: Math.round(prep * 100) / 100,
            urssaf: Math.round(urssaf * 100) / 100,
            urssafPct: settings.urssafPct
        }
    };
}

// --- Helpers d'extraction ---
// extractASINFromURL est deja defini plus haut (ligne ~1925) avec plus de patterns

function extractASINFromText(text) {
    if (!text) return null;
    var match = text.match(/\b(B[A-Z0-9]{9})\b/);
    return match ? match[1] : null;
}

function isAmazonDeal(deal) {
    var text = ((deal.merchant || '') + ' ' + (deal.link || '') + ' ' + (deal.title || '')).toLowerCase();
    return text.includes('amazon');
}

function extractPriceFromText(text) {
    if (!text) return 0;
    // Patterns: "499€", "499,99€", "499.99 €", "EUR 499", "499 euros"
    var patterns = [
        /(\d+[\.,]?\d*)\s*€/,
        /EUR\s*(\d+[\.,]?\d*)/i,
        /(\d+[\.,]?\d*)\s*euros?/i
    ];
    for (var i = 0; i < patterns.length; i++) {
        var match = text.match(patterns[i]);
        if (match) return parseFloat(match[1].replace(',', '.'));
    }
    return 0;
}

function extractOriginalPrice(text) {
    if (!text) return 0;
    // Chercher le prix barre (souvent dans des balises <del> ou apres "au lieu de")
    var patterns = [
        /au\s+lieu\s+de\s+(\d+[\.,]?\d*)\s*€/i,
        /(?:PVR|PPC|prix\s+conseill[eé])\s*:?\s*(\d+[\.,]?\d*)\s*€/i,
        /<del[^>]*>.*?(\d+[\.,]?\d*)\s*€/i,
        /<s>.*?(\d+[\.,]?\d*)\s*€/i,
        /(\d+[\.,]?\d*)\s*€\s*(?:au\s+lieu)/i
    ];
    for (var i = 0; i < patterns.length; i++) {
        var match = text.match(patterns[i]);
        if (match) return parseFloat(match[1].replace(',', '.'));
    }
    return 0;
}

function extractTemperature(title) {
    if (!title) return 0;
    var match = title.match(/(\d+)°/);
    return match ? parseInt(match[1]) : 0;
}

function extractImageFromDesc(description) {
    if (!description) return '';
    var match = description.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : '';
}

// --- Parse un item RSS Pepper ---
function parsePepperRSSItem(item, sourceKey) {
    var title = (item.title || '').replace(/\s*\d+°\s*$/, '').trim(); // Enlever la temperature du titre
    var temperature = extractTemperature(item.title || '');
    var description = item.description || item.content || '';

    // Extraire le prix depuis le format Pepper : <strong>17,90€ - Marchand</strong>
    var price = 0;
    var pepperPriceMatch = description.match(/<strong>\s*(\d+[\.,]?\d*)\s*€/i);
    if (pepperPriceMatch) {
        price = parseFloat(pepperPriceMatch[1].replace(',', '.'));
    }
    // Fallback : regex generique
    if (!price || price <= 0) {
        price = extractPriceFromText(title + ' ' + description);
    }
    var origPrice = extractOriginalPrice(description);
    var discount = 0;
    if (origPrice > 0 && price > 0 && origPrice > price) {
        discount = Math.round((1 - price / origPrice) * 100);
    }

    // Detecter le marchand depuis le format Pepper : <strong>17,90€ - Marchand</strong>
    var merchant = '';
    var pepperMerchantMatch = description.match(/<strong>[^<]*€\s*-\s*([^<]+)<\/strong>/i);
    if (pepperMerchantMatch) {
        merchant = pepperMerchantMatch[1].trim();
    }
    // Fallback : categories RSS ou pattern "chez X"
    if (!merchant && item.categories && item.categories.length > 0) {
        merchant = item.categories[0];
    }
    var merchantMatchChez = description.match(/chez\s+([A-Za-z0-9\s\.\-]+?)(?:\s|<|$)/i);
    if (!merchant && merchantMatchChez) merchant = merchantMatchChez[1].trim();

    var link = item.link || '';
    var isAmz = isAmazonDeal({ merchant: merchant, link: link, title: title + ' ' + description });
    var asin = null;

    if (isAmz) {
        asin = extractASINFromURL(link) || extractASINFromURL(description) || extractASINFromText(description);
    }

    var image = item.thumbnail || (item.enclosure ? item.enclosure.link : null) || extractImageFromDesc(description);

    return {
        title: title,
        link: link,
        image: image,
        price: price,
        originalPrice: origPrice,
        discount: discount,
        merchant: merchant,
        isAmazon: isAmz,
        asin: asin,
        ean: null,
        amazonPrice: null,
        keepaData: null,
        profit: null,
        roi: null,
        fees: null,
        category: (item.categories || []).join(', '),
        temperature: temperature,
        date: item.pubDate ? new Date(item.pubDate) : new Date(),
        source: sourceKey,
        sourceName: DEAL_SOURCES[sourceKey] ? DEAL_SOURCES[sourceKey].name : sourceKey,
        manual: false
    };
}

// --- Parse un item de scraper Netlify ---
function parseScraperItem(item, sourceKey) {
    var discount = 0;
    if (item.originalPrice > 0 && item.price > 0 && item.originalPrice > item.price) {
        discount = Math.round((1 - item.price / item.originalPrice) * 100);
    }

    var isAmz = isAmazonDeal({ merchant: item.merchant || '', link: item.link || '', title: item.title || '' });
    var asin = null;
    if (isAmz) {
        asin = extractASINFromURL(item.link) || extractASINFromText(item.title);
    }

    return {
        title: item.title || '',
        link: item.link || '',
        image: item.image || '',
        price: parseFloat(item.price) || 0,
        originalPrice: parseFloat(item.originalPrice) || 0,
        discount: discount,
        merchant: item.merchant || DEAL_SOURCES[sourceKey].name,
        isAmazon: isAmz,
        asin: asin,
        ean: item.ean || null,
        amazonPrice: null,
        keepaData: null,
        profit: null,
        roi: null,
        fees: null,
        category: item.category || '',
        temperature: 0,
        date: item.date ? new Date(item.date) : new Date(),
        source: sourceKey,
        sourceName: DEAL_SOURCES[sourceKey] ? DEAL_SOURCES[sourceKey].name : sourceKey,
        manual: false
    };
}

// --- Fetch deals depuis une source ---
async function fetchDealsFromSource(sourceKey) {
    var source = DEAL_SOURCES[sourceKey];
    if (!source) {
        console.warn('[DealScanner] Source inconnue: ' + sourceKey);
        return [];
    }

    if (source.type === 'rss') {
        // Fetch hot + new en parallele, fusionner et dedupliquer
        var modes = ['hot', 'new'];
        var allDeals = [];
        var seenLinks = {};

        var modePromises = modes.map(function(mode) {
            var rssUrl = source.baseUrl + mode;
            var proxyUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);
            return fetch(proxyUrl).then(function(resp) { return resp.json(); }).then(function(data) {
                if (data.status === 'ok' && data.items) {
                    console.log('[DealScanner] RSS ' + source.name + '/' + mode + ': ' + data.items.length + ' items');
                    return { mode: mode, items: data.items.map(function(item) { return parsePepperRSSItem(item, sourceKey); }) };
                }
                console.warn('[DealScanner] RSS ' + source.name + '/' + mode + ' echec');
                return { mode: mode, items: [] };
            }).catch(function(e) {
                console.warn('[DealScanner] RSS ' + source.name + '/' + mode + ' erreur: ' + e.message);
                return { mode: mode, items: [] };
            });
        });

        try {
            var results = await Promise.all(modePromises);
            // Fusionner hot + new, dedupliquer par lien, tagger feedType
            for (var ri = 0; ri < results.length; ri++) {
                var feedMode = results[ri].mode;
                for (var di = 0; di < results[ri].items.length; di++) {
                    var deal = results[ri].items[di];
                    if (seenLinks[deal.link]) {
                        // Deja vu dans l'autre feed → marquer comme les deux
                        var existing = allDeals.find(function(d) { return d.link === deal.link; });
                        if (existing) existing.feedType = 'both';
                    } else {
                        seenLinks[deal.link] = true;
                        deal.feedType = feedMode; // 'hot' ou 'new'
                        allDeals.push(deal);
                    }
                }
            }
            console.log('[DealScanner] RSS ' + source.name + ' total: ' + allDeals.length + ' deals uniques (hot+new)');
            return allDeals;
        } catch (e) {
            console.error('[DealScanner] Erreur fetch RSS ' + source.name + ':', e);
            return [];
        }
    } else if (source.type === 'scraper') {
        // Fetch via Netlify Function
        try {
            var resp = await fetch(source.endpoint);
            if (!resp.ok) {
                console.warn('[DealScanner] Scraper ' + source.name + ' erreur HTTP ' + resp.status);
                return [];
            }
            var items = await resp.json();
            console.log('[DealScanner] Scraper ' + source.name + ': ' + items.length + ' items');
            return items.map(function(item) { return parseScraperItem(item, sourceKey); });
        } catch (e) {
            console.error('[DealScanner] Erreur fetch scraper ' + source.name + ':', e);
            return [];
        }
    }

    return [];
}

// --- Compte a rebours cron ---
var cronCountdownTimer = null;
var lastCronUpdate = null;
var CRON_INTERVAL = 60; // minutes
var autoRefreshTimer = null;
var lastServerUpdatedAt = null; // pour detecter les nouvelles donnees
var cronFetchScheduled = false;  // eviter double fetch quand countdown atteint 0

function startCronCountdown(updatedAt) {
    lastCronUpdate = new Date(updatedAt);
    lastServerUpdatedAt = updatedAt;
    cronFetchScheduled = false;
    if (cronCountdownTimer) clearInterval(cronCountdownTimer);
    updateCronStatus();
    cronCountdownTimer = setInterval(updateCronStatus, 1000);
}

async function autoRefreshCheck() {
    try {
        var resp = await fetch('/.netlify/functions/get-deals');
        if (!resp.ok) return;
        var data = await resp.json();
        if (!data || !data.deals) return;
        // Comparer avec la derniere MAJ connue
        if (data.updatedAt && data.updatedAt !== lastServerUpdatedAt) {
            console.log('[AutoRefresh] Nouvelles donnees detectees: ' + data.updatedAt);
            var oldCount = dealScannerResults.length;
            markDealsWithHistory(data.deals);
            dealScannerResults = data.deals;
            lastServerUpdatedAt = data.updatedAt;
            startCronCountdown(data.updatedAt);
            renderDealResults();
            // Notif visuelle
            var newCount = data.deals.length - oldCount;
            var statsEl = document.getElementById('deal-stats-funnel');
            if (statsEl) {
                var msg = data.deals.length + ' deals (MAJ auto ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ')';
                if (newCount > 0) msg += ' · +' + newCount + ' nouveaux';
                statsEl.textContent = msg;
            }
        }
    } catch (e) {
        console.log('[AutoRefresh] Erreur: ' + e.message);
    }
}

function updateCronStatus() {
    var el = document.getElementById('deal-cron-status');
    if (!el || !lastCronUpdate) return;

    var now = new Date();
    var nextCron = new Date(lastCronUpdate.getTime() + CRON_INTERVAL * 60 * 1000);
    var diffSec = Math.max(0, Math.floor((nextCron - now) / 1000));

    if (diffSec <= 0) {
        el.innerHTML = '<i class="fas fa-sync-alt fa-spin text-green-400 mr-1"></i><span class="text-green-400">Scan en cours...</span>';
        // Auto-fetch 90s apres l'heure du cron (lui laisser le temps de finir)
        if (!cronFetchScheduled) {
            cronFetchScheduled = true;
            console.log('[AutoRefresh] Cron termine, fetch dans 90s...');
            setTimeout(function() {
                console.log('[AutoRefresh] Fetch auto post-cron');
                autoRefreshCheck();
            }, 90000);
        }
        return;
    }

    var min = Math.floor(diffSec / 60);
    var sec = diffSec % 60;
    var lastH = String(lastCronUpdate.getHours()).padStart(2, '0');
    var lastM = String(lastCronUpdate.getMinutes()).padStart(2, '0');
    el.innerHTML = '<i class="fas fa-server text-blue-400 mr-1"></i>MAJ ' + lastH + ':' + lastM + ' · <i class="fas fa-clock text-gray-500 mr-1"></i>Prochain dans ' + min + ':' + String(sec).padStart(2, '0');
}

function stopCronCountdown() {
    if (cronCountdownTimer) { clearInterval(cronCountdownTimer); cronCountdownTimer = null; }
}

// --- Countdown en mode "attente de scan" (pas de donnees serveur) ---
function startWaitingCountdown() {
    if (cronCountdownTimer) clearInterval(cronCountdownTimer);
    updateWaitingStatus();
    cronCountdownTimer = setInterval(updateWaitingStatus, 1000);
}

function updateWaitingStatus() {
    var el = document.getElementById('deal-cron-status');
    if (!el) return;
    var now = new Date();
    var nextCron = new Date(now);
    nextCron.setMinutes(0, 0, 0);
    nextCron.setHours(nextCron.getHours() + 1);
    var diffSec = Math.max(0, Math.floor((nextCron - now) / 1000));
    if (diffSec <= 0) {
        el.innerHTML = '<i class="fas fa-sync-alt fa-spin text-green-400 mr-1"></i><span class="text-green-400">Scan en cours...</span>';
        return;
    }
    var min = Math.floor(diffSec / 60);
    var sec = diffSec % 60;
    var nextLabel = String(nextCron.getHours()).padStart(2, '0') + ':00';
    el.innerHTML = '<i class="fas fa-satellite-dish text-blue-400 mr-1"></i>En attente · <i class="fas fa-clock text-gray-500 mr-1"></i>Prochain scan ' + nextLabel + ' dans ' + min + ':' + String(sec).padStart(2, '0');
}

// --- Charger les deals depuis le serveur Netlify (0 token) ---
async function fetchDealsFromServer() {
    try {
        var baseUrl = window.location.hostname === 'localhost' ? '' : '';
        var resp = await fetch('/.netlify/functions/get-deals');
        if (!resp.ok) return null;
        var data = await resp.json();
        if (data && data.deals && data.deals.length > 0) {
            console.log('[DealScanner] Serveur: ' + data.deals.length + ' deals (MAJ: ' + data.updatedAt + ')');
            return data;
        }
    } catch (e) {
        console.log('[DealScanner] Serveur non disponible, fallback local');
    }
    return null;
}

// --- Fetch principal ---
async function fetchDeals() {
    var fetchBtn = document.getElementById('deal-fetch-btn');

    // Afficher loading
    if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Chargement...';
    }
    var container = document.getElementById('deal-scanner-results');
    if (container) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400"><i class="fas fa-spinner fa-spin text-4xl mb-4"></i><p class="text-lg">Chargement des deals...</p></div>';
    }

    // D'abord essayer le serveur (0 token — le cron fait le travail)
    var serverData = await fetchDealsFromServer();
    if (serverData && serverData.deals) {
        var filtered = serverData.deals;
        // Marquer avec l'historique
        markDealsWithHistory(filtered);
        dealScannerResults = filtered;

        // Stocker pipeline history
        if (serverData.pipelineHistory) dealPipelineHistory = serverData.pipelineHistory;

        // Stats
        var statsEl = document.getElementById('deal-stats');
        if (statsEl) { statsEl.classList.remove('hidden'); statsEl.style.display = ''; }
        var funnelEl = document.getElementById('deal-stats-funnel');
        if (funnelEl) funnelEl.textContent = filtered.length + ' deals (serveur)';
        var keepaStatsEl = document.getElementById('deal-stats-keepa');
        if (keepaStatsEl) keepaStatsEl.textContent = 'MAJ: ' + new Date(serverData.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        renderDealResults();

        // Demarrer le compte a rebours cron
        startCronCountdown(serverData.updatedAt);

        // Telegram gere par le cron (pas de doublon navigateur)

        // Restaurer le bouton
        if (fetchBtn) {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Charger';
        }
        return;
    }

    // Pas de donnees serveur — afficher "En attente de scan" avec countdown
    console.log('[DealScanner] Serveur vide — affichage en attente de scan');
    dealScannerResults = [];

    // Afficher le creneau courant en attente
    var container2 = document.getElementById('deal-scanner-results');
    if (container2) {
        var now = new Date();
        var nextH = new Date(now);
        nextH.setMinutes(0, 0, 0);
        nextH.setHours(nextH.getHours() + 1);
        var curLabel = String(now.getHours()).padStart(2, '0') + ':00';
        var nextLabel = String(nextH.getHours()).padStart(2, '0') + ':00';
        container2.innerHTML = '<div class="p-8 text-center text-gray-400">' +
            '<i class="fas fa-satellite-dish text-5xl mb-4 text-blue-400"></i>' +
            '<p class="text-lg text-white mb-2">En attente du scan de ' + nextLabel + '</p>' +
            '<p class="text-sm text-gray-500">Le cron tourne toutes les heures. Prochain scan dans quelques minutes.</p>' +
            '</div>';
    }
    var statsEl = document.getElementById('deal-stats');
    if (statsEl) { statsEl.classList.remove('hidden'); statsEl.style.display = ''; }
    var funnelEl = document.getElementById('deal-stats-funnel');
    if (funnelEl) funnelEl.textContent = 'En attente du prochain scan...';

    // Demarrer le countdown vers la prochaine heure pile
    startWaitingCountdown();

    // Restaurer le bouton
    if (fetchBtn) {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Charger';
    }

    // Retry : re-verifier le serveur dans 2 min
    startServerRetry();
}

var serverRetryTimer = null;
function startServerRetry() {
    if (serverRetryTimer) clearInterval(serverRetryTimer);
    serverRetryTimer = setInterval(async function() {
        console.log('[ServerRetry] Verification serveur...');
        var data = await fetchDealsFromServer();
        if (data && data.deals && data.deals.length > 0) {
            console.log('[ServerRetry] Donnees serveur trouvees! ' + data.deals.length + ' deals');
            clearInterval(serverRetryTimer);
            serverRetryTimer = null;
            // Basculer en mode serveur
            markDealsWithHistory(data.deals);
            dealScannerResults = data.deals;
            startCronCountdown(data.updatedAt);
            renderDealResults();
            var fEl = document.getElementById('deal-stats-funnel');
            if (fEl) fEl.textContent = data.deals.length + ' deals (serveur)';
            var kEl = document.getElementById('deal-stats-keepa');
            if (kEl) kEl.textContent = 'MAJ: ' + new Date(data.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            var btn = document.getElementById('deal-fetch-btn');
            if (btn) btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Charger';
        }
    }, 120000); // toutes les 2 minutes
}

// --- Pre-filtrage des deals (avant Keepa) ---
function preFilterDeals(deals) {
    var settings = loadOASettings();
    var minPrice = settings.dealMinPrice || 0;
    var maxPrice = settings.dealMaxPrice || 9999;
    var minDiscount = settings.dealMinDiscount || 0;

    // Parser la blacklist en mots-cles (insensible a la casse)
    var blacklistStr = (settings.dealBlacklist || '').toLowerCase();
    var blacklistWords = blacklistStr.split(',').map(function(w) { return w.trim(); }).filter(function(w) { return w.length > 0; });

    var excluded = { price: 0, discount: 0, blacklist: 0 };

    var result = deals.filter(function(deal) {
        // Filtre prix (seulement si le prix est connu)
        if (deal.price > 0 && deal.price < minPrice) { excluded.price++; return false; }
        if (deal.price > 0 && deal.price > maxPrice) { excluded.price++; return false; }

        // Filtre reduction minimum — seulement si on a l'info (discount > 0 = info dispo)
        if (minDiscount > 0 && deal.discount > 0 && deal.discount < minDiscount) { excluded.discount++; return false; }

        // Filtre blacklist mots-cles (match mot entier pour eviter faux positifs)
        if (blacklistWords.length > 0) {
            var text = (' ' + deal.title + ' ' + deal.merchant + ' ' + deal.category + ' ').toLowerCase();
            for (var i = 0; i < blacklistWords.length; i++) {
                // Chercher le mot avec des separateurs autour (espace, virgule, point, debut/fin)
                if (text.includes(' ' + blacklistWords[i] + ' ') ||
                    text.includes(' ' + blacklistWords[i] + ',') ||
                    text.includes(' ' + blacklistWords[i] + '.') ||
                    text.includes(' ' + blacklistWords[i] + ')') ||
                    text.includes('(' + blacklistWords[i] + ' ')) {
                    excluded.blacklist++;
                    return false;
                }
            }
        }

        return true;
    });

    console.log('[DealScanner] Pre-filtres exclusions: prix=' + excluded.price + ' reduction=' + excluded.discount + ' blacklist=' + excluded.blacklist);
    return result;
}

// --- Analyser les deals ---
async function analyzeDeals(deals) {
    var settings = loadOASettings();
    keepaQueue = [];

    // Phase 1 : Detection Amazon + extraction ASIN directe
    var needResolve = []; // deals Amazon sans ASIN (besoin de resolve-pepper)

    deals.forEach(function(deal, index) {
        // 1. Detecter deals Amazon
        if (!deal.isAmazon) {
            deal.isAmazon = isAmazonDeal(deal);
        }

        // 2. Extraire ASIN si Amazon (depuis URL et texte)
        if (deal.isAmazon && !deal.asin) {
            deal.asin = extractASINFromURL(deal.link) || extractASINFromText(deal.title) || extractASINFromText(deal.link);
        }

        // 3. Si Amazon detecte mais toujours pas d'ASIN → resolve via Netlify Function
        if (deal.isAmazon && !deal.asin && deal.link) {
            needResolve.push({ deal: deal, index: index });
        }
    });

    // Phase 2 : Resoudre les ASINs manquants via resolve-pepper (en parallele)
    if (needResolve.length > 0) {
        console.log('[DealScanner] ' + needResolve.length + ' deals Amazon sans ASIN → resolution...');
        var resolvePromises = needResolve.map(function(item) {
            return resolveASINFromPepper(item.deal.link).then(function(result) {
                if (result && result.asin) {
                    item.deal.asin = result.asin;
                    console.log('[DealScanner] ASIN resolu: ' + result.asin + ' pour ' + item.deal.title.substring(0, 40));
                }
            }).catch(function(e) {
                console.warn('[DealScanner] Erreur resolution ASIN:', e.message);
            });
        });
        await Promise.all(resolvePromises);
    }

    // Phase 2b : Deals Amazon toujours sans ASIN → Keepa search par titre EN PARALLELE
    var stillNoAsin = deals.filter(function(d) { return d.isAmazon && !d.asin && d.title; });
    if (stillNoAsin.length > 0 && settings.keepaApiKey) {
        console.log('[DealScanner] ' + stillNoAsin.length + ' deals Amazon sans ASIN → recherche Keepa par titre (parallele)...');
        var searchPromises = stillNoAsin.map(function(deal) {
            return keepaSearchByTitle(deal.title).then(function(foundAsin) {
                if (foundAsin) {
                    deal.asin = foundAsin;
                    console.log('[DealScanner] ASIN trouve par titre: ' + foundAsin);
                }
            }).catch(function() {});
        });
        await Promise.all(searchPromises);
    }

    // Phase 3 : Chercher le prix Amazon — d'abord cache/CSV, puis batch Keepa
    var needKeepaASINs = []; // ASINs a chercher via Keepa batch
    var needKeepaEANs = [];  // EANs a chercher via Keepa (un par un)

    var dealsWithAsin = deals.filter(function(d) { return d.asin; });
    console.log('[DealScanner] Phase 3: ' + deals.length + ' deals, ' + dealsWithAsin.length + ' avec ASIN');

    deals.forEach(function(deal, index) {
        if (deal.asin) {
            // D'abord dans le cache Keepa
            if (keepaCache[deal.asin] && (Date.now() - keepaCache[deal.asin].timestamp) < KEEPA_CACHE_TTL) {
                var cached = keepaCache[deal.asin];
                deal.amazonPrice = cached.price;
                deal.keepaData = cached;
                if (deal.price > 0 && cached.price > 0) {
                    var profitResult = calculateDealProfit(deal, cached);
                    deal.profit = profitResult.profit;
                    deal.roi = profitResult.roi;
                    deal.fees = profitResult.fees;
                }
                return;
            }

            // Ensuite dans les CSV charges
            var csvData = findProductInCSV(deal.asin);
            if (csvData) {
                deal.amazonPrice = csvData.price;
                if (deal.price > 0 && csvData.price > 0) {
                    var profitResult = calculateDealProfit(deal, csvData);
                    deal.profit = profitResult.profit;
                    deal.roi = profitResult.roi;
                    deal.fees = profitResult.fees;
                }
                return;
            }

            // Sinon → ajouter au batch Keepa
            if (settings.keepaApiKey) {
                needKeepaASINs.push({ asin: deal.asin, dealIndex: index });
            }
        } else if (deal.ean && settings.keepaApiKey) {
            needKeepaEANs.push({ ean: deal.ean, dealIndex: index });
        }
    });

    // Phase 4 : Batch Keepa API (tous les ASINs en 1 seul appel)
    var keepaStatsEl = document.getElementById('deal-stats-keepa');
    if (needKeepaASINs.length > 0) {
        if (!settings.keepaApiKey) {
            console.warn('[DealScanner] Pas de cle API Keepa → impossible de chercher les prix Amazon');
            if (keepaStatsEl) keepaStatsEl.innerHTML = '<span class="text-red-500"><i class="fas fa-key mr-1"></i>Cle API Keepa manquante (Parametres OA)</span>';
            // Marquer les deals comme "checked but no data"
            needKeepaASINs.forEach(function(item) {
                if (item.dealIndex < deals.length) {
                    deals[item.dealIndex].keepaChecked = true;
                }
            });
        } else {
            var asinsToLookup = needKeepaASINs.map(function(item) { return item.asin; });
            console.log('[DealScanner] Batch Keepa: ' + asinsToLookup.length + ' ASINs en 1 appel');

            if (keepaStatsEl) keepaStatsEl.textContent = 'Keepa: lookup ' + asinsToLookup.length + ' ASINs...';

            var batchResults = await keepaBatchLookup(asinsToLookup);
            var foundCount = Object.keys(batchResults).length;
            console.log('[DealScanner] Batch Keepa resultat: ' + foundCount + '/' + asinsToLookup.length);

            // Appliquer les resultats aux deals
            needKeepaASINs.forEach(function(item) {
                if (item.dealIndex >= deals.length) return;
                var deal = deals[item.dealIndex];
                var result = batchResults[item.asin];
                if (result) {
                    deal.amazonPrice = result.price;
                    deal.keepaData = result;
                    deal.keepaChecked = true;
                    if (deal.price > 0 && result.price > 0) {
                        var profitResult = calculateDealProfit(deal, result);
                        deal.profit = profitResult.profit;
                        deal.roi = profitResult.roi;
                        deal.fees = profitResult.fees;
                    }
                } else {
                    deal.keepaChecked = true; // lookup done, no result
                }
            });

            if (keepaStatsEl) {
                if (foundCount > 0) {
                    keepaStatsEl.textContent = 'Keepa: ' + foundCount + '/' + asinsToLookup.length + ' trouves';
                } else {
                    keepaStatsEl.textContent = 'Keepa: 0 resultat';
                }
            }
        }
    }

    // Phase 5 : EANs individuels (ne supportent pas le batch)
    if (needKeepaEANs.length > 0 && settings.keepaApiKey) {
        keepaQueue = needKeepaEANs.map(function(item) {
            return { identifier: item.ean, type: 'ean', dealIndex: item.dealIndex };
        });
        processKeepaQueue();
    }

    // Appliquer les filtres post-Keepa
    applyPostKeepaFilters(deals);
}

// --- Filtres post-Keepa (exclure deals non rentables) ---
function applyPostKeepaFilters(deals) {
    var settings = loadOASettings();
    var minProfit = settings.dealMinProfit || 0;
    var minROI = settings.dealMinROI || 0;
    var maxBSR = settings.dealMaxBSR || 0;
    var maxFBASellers = settings.dealMaxFBASellers || 0;

    deals.forEach(function(deal) {
        // Initialiser pour tous les deals
        deal.excludedPostKeepa = false;

        if (!deal.keepaData) return; // pas encore de donnees Keepa

        if (minProfit > 0 && deal.profit !== null && deal.profit < minProfit) {
            deal.excludedPostKeepa = true;
        }
        if (minROI > 0 && deal.roi !== null && deal.roi < minROI) {
            deal.excludedPostKeepa = true;
        }
        if (maxBSR > 0 && deal.keepaData.bsr > 0 && deal.keepaData.bsr > maxBSR) {
            deal.excludedPostKeepa = true;
        }
        if (maxFBASellers > 0 && deal.keepaData.fbaSellers > maxFBASellers) {
            deal.excludedPostKeepa = true;
        }
    });
}

// --- Resoudre un ASIN depuis une page Pepper (Dealabs/MyDealz) ---
async function resolveASINFromPepper(dealUrl) {
    if (!dealUrl) return null;

    // Verifier que c'est un site Pepper
    var pepperDomains = ['dealabs.com', 'mydealz.de', 'chollometro.com', 'pepper.it'];
    var isPepper = pepperDomains.some(function(d) { return dealUrl.includes(d); });
    if (!isPepper) return null;

    try {
        var resp = await fetch('/.netlify/functions/resolve-pepper?url=' + encodeURIComponent(dealUrl));
        if (!resp.ok) {
            console.warn('[DealScanner] resolve-pepper HTTP ' + resp.status);
            return null;
        }
        var data = await resp.json();
        return data; // { asin, merchantUrl }
    } catch (e) {
        console.warn('[DealScanner] resolve-pepper erreur:', e.message);
        return null;
    }
}


// --- Filtres ---
function setDealFilter(mode) {
    dealFilterMode = mode;

    // Couleurs par filtre
    var filterColors = {
        all: { active: 'bg-gray-700 text-white', inactive: 'bg-gray-200 text-gray-700' },
        profitable: { active: 'bg-green-600 text-white', inactive: 'bg-green-100 text-green-700' },
        amazon: { active: 'bg-blue-600 text-white', inactive: 'bg-blue-100 text-blue-700' },
        no_asin: { active: 'bg-orange-600 text-white', inactive: 'bg-orange-100 text-orange-700' },
        unprocessed: { active: 'bg-red-600 text-white', inactive: 'bg-red-100 text-red-700' }
    };

    ['all', 'profitable', 'amazon', 'no_asin', 'unprocessed'].forEach(function(m) {
        var btn = document.getElementById('deal-filter-' + m);
        if (btn) {
            var colors = filterColors[m] || filterColors.all;
            var cls = (m === mode) ? colors.active : colors.inactive;
            btn.className = 'px-4 py-2 ' + cls + ' rounded-lg text-sm font-semibold transition';
        }
    });

    renderDealResults();
}

// --- Helper : deals du jour selectionne (avant filtres) ---
function getDealsForSelectedDay() {
    var deals = dealScannerResults;
    if (deals.length === 0) return [];

    var today = new Date();
    var dayStrings = [];
    for (var di = 0; di <= 2; di++) {
        var d = new Date(today);
        d.setDate(d.getDate() - di);
        dayStrings.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    }
    var selectedDayStr = dayStrings[selectedDealDay] || dayStrings[0];

    return deals.filter(function(dd) {
        if (dd.historyStatus === 'ignored') return false;
        var dealDay = getDayFromScanHour(dd.scanHour);
        if (!dealDay) return selectedDealDay === 0;
        return dealDay === selectedDayStr;
    });
}

// --- Mettre a jour les stats (dynamiques par jour) ---
function updateDealStats() {
    var dayDeals = getDealsForSelectedDay();

    var allCount = dayDeals.length;
    var amazonCount = dayDeals.filter(function(d) { return d.asin; }).length;
    var profitableCount = dayDeals.filter(function(d) { return !d.excludedPostKeepa && d.profit !== null && d.profit > 0; }).length;
    var noAsinCount = dayDeals.filter(function(d) {
        return !d.asin && (d.searchStatus === 'resolve_no_amazon' || d.searchStatus === 'search_not_found');
    }).length;
    var unprocessedCount = dayDeals.filter(function(d) {
        // Tokens epuises (pas d'ASIN), OU ASIN trouve mais pas de prix
        return d.searchStatus === 'tokens_exhausted' ||
               d.searchStatus === 'search_ok_no_tokens' ||
               (d.asin && !d.priceCheckedAt);
    }).length;

    var statsEl = document.getElementById('deal-stats');
    if (statsEl) { statsEl.classList.remove('hidden'); statsEl.style.display = ''; }

    // Mettre a jour chaque filtre avec compteur du jour
    var filters = {
        all: { label: 'Tous', count: allCount },
        profitable: { label: 'Rentables', count: profitableCount },
        amazon: { label: 'Amazon', count: amazonCount },
        no_asin: { label: 'Sans ASIN', count: noAsinCount },
        unprocessed: { label: 'Non traites', count: unprocessedCount }
    };

    Object.keys(filters).forEach(function(key) {
        var btn = document.getElementById('deal-filter-' + key);
        if (btn) {
            var f = filters[key];
            btn.textContent = f.label + ' (' + f.count + ')';
            // Masquer si 0 (sauf Tous et le filtre actif)
            if (key !== 'all' && key !== dealFilterMode && f.count === 0) {
                btn.style.opacity = '0.5';
            } else {
                btn.style.opacity = '1';
            }
        }
    });

    // Pipeline
    renderPipeline();
}

// --- Pipeline entonnoir visuel ---
function renderPipeline() {
    var container = document.getElementById('deal-pipeline');
    if (!container) return;

    // Determiner le jour selectionne
    var today = new Date();
    var dayStrings = [];
    for (var di = 0; di <= 2; di++) {
        var d = new Date(today);
        d.setDate(d.getDate() - di);
        dayStrings.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    }
    var selectedDayStr = dayStrings[selectedDealDay] || dayStrings[0];

    // Agreger les pipelineStats de toutes les heures du jour selectionne
    var agg = { rssRaw: 0, afterDedup: 0, afterFilter: 0, newDeals: 0, resolvedAsin: 0, searchedAsin: 0, priceChecked: 0, profitable: 0, tokensUsed: 0, tokensLeft: null };
    var hasData = false;
    var hourCount = 0;
    var hourEntries = []; // pour le detail par scan

    Object.keys(dealPipelineHistory).forEach(function(scanHour) {
        var hourDay = getDayFromScanHour(scanHour);
        if (hourDay === selectedDayStr) {
            var s = dealPipelineHistory[scanHour];
            agg.rssRaw += s.rssRaw || 0;
            agg.afterDedup += s.afterDedup || 0;
            agg.afterFilter += s.afterFilter || 0;
            agg.newDeals += s.newDeals || 0;
            agg.resolvedAsin += s.resolvedAsin || 0;
            agg.searchedAsin += s.searchedAsin || 0;
            agg.priceChecked += s.priceChecked || 0;
            agg.profitable += s.profitable || 0;
            agg.tokensUsed += s.tokensUsed || 0;
            if (s.tokensLeft !== null && s.tokensLeft !== undefined) agg.tokensLeft = s.tokensLeft;
            hourEntries.push({ scanHour: scanHour, label: getHourLabel(scanHour), stats: s });
            hasData = true;
            hourCount++;
        }
    });
    // Trier par heure desc (plus recent en haut)
    hourEntries.sort(function(a, b) { return b.scanHour.localeCompare(a.scanHour); });

    // Si pas de pipeline data, reconstruire depuis les deals
    if (!hasData) {
        var dayDeals = getDealsForSelectedDay();
        if (dayDeals.length === 0) {
            container.classList.add('hidden');
            return;
        }
        agg.newDeals = dayDeals.length;
        agg.resolvedAsin = dayDeals.filter(function(d) { return d.asin && d.searchStatus === 'resolve_ok'; }).length;
        agg.searchedAsin = dayDeals.filter(function(d) { return d.asin && d.searchStatus === 'search_found'; }).length;
        agg.priceChecked = dayDeals.filter(function(d) { return d.priceCheckedAt; }).length;
        agg.profitable = dayDeals.filter(function(d) { return d.profit !== null && d.profit > 0; }).length;
        // On n'a pas rssRaw/afterDedup/afterFilter sans pipeline data
    }

    container.classList.remove('hidden');

    // Construire les 6 etapes de l'entonnoir
    var totalAsin = agg.resolvedAsin + agg.searchedAsin;
    var steps = [];

    if (agg.rssRaw > 0) {
        steps.push({ icon: 'fa-satellite-dish', label: 'RSS', value: agg.rssRaw, color: '#6b7280', bg: '#374151', loss: null });
        var dedupLoss = agg.rssRaw - agg.afterDedup;
        steps.push({ icon: 'fa-layer-group', label: 'Uniques', value: agg.afterDedup, color: '#9ca3af', bg: '#374151', loss: dedupLoss > 0 ? '-' + dedupLoss + ' doublons' : null });
        var filterLoss = agg.afterDedup - agg.afterFilter;
        steps.push({ icon: 'fa-filter', label: 'Filtres', value: agg.afterFilter, color: '#f59e0b', bg: '#78350f', loss: filterLoss > 0 ? '-' + filterLoss + ' prix/blacklist' : null });
    }

    var knownLoss = agg.afterFilter > 0 ? agg.afterFilter - agg.newDeals : null;
    steps.push({ icon: 'fa-plus-circle', label: 'Nouveaux', value: agg.newDeals, color: '#3b82f6', bg: '#1e3a5f', loss: knownLoss > 0 ? '-' + knownLoss + ' deja vus' : null });

    var asinDetail = '';
    if (agg.resolvedAsin > 0 || agg.searchedAsin > 0) {
        var parts = [];
        if (agg.resolvedAsin > 0) parts.push(agg.resolvedAsin + ' redirect');
        if (agg.searchedAsin > 0) parts.push(agg.searchedAsin + ' recherche');
        asinDetail = parts.join(' + ');
    }
    steps.push({ icon: 'fa-barcode', label: 'ASIN', value: totalAsin, color: '#8b5cf6', bg: '#4c1d95', loss: null, detail: asinDetail });

    steps.push({ icon: 'fa-check-circle', label: 'Rentables', value: agg.profitable, color: '#10b981', bg: '#064e3b', loss: null });

    // Tokens info
    var tokensHtml = '';
    if (agg.tokensUsed > 0 || agg.tokensLeft !== null) {
        tokensHtml = '<div class="flex items-center gap-2 mt-2 text-xs text-gray-400">';
        tokensHtml += '<i class="fas fa-coins text-amber-400"></i>';
        if (agg.tokensUsed > 0) tokensHtml += '<span>' + agg.tokensUsed + ' tokens utilises</span>';
        if (agg.tokensLeft !== null) tokensHtml += '<span class="text-gray-500">|</span><span>' + agg.tokensLeft + ' restants</span>';
        if (hourCount > 0) tokensHtml += '<span class="text-gray-500">|</span><span>' + hourCount + ' scan' + (hourCount > 1 ? 's' : '') + '</span>';
        tokensHtml += '</div>';
    }

    // Render HTML
    var html = '<div class="rounded-xl p-4" style="background: linear-gradient(135deg, #1a1a2e, #16213e)">';
    html += '<div class="flex items-center gap-1 overflow-x-auto">';

    for (var si = 0; si < steps.length; si++) {
        var st = steps[si];
        // Bloc
        html += '<div class="flex flex-col items-center min-w-[80px]">';
        html += '<div class="rounded-lg px-3 py-2 text-center" style="background: ' + st.bg + '; border: 1px solid ' + st.color + '40">';
        html += '<div class="text-lg font-bold" style="color: ' + st.color + '">' + st.value + '</div>';
        html += '<div class="text-xs text-gray-400"><i class="fas ' + st.icon + ' mr-1" style="color: ' + st.color + '"></i>' + st.label + '</div>';
        if (st.detail) html += '<div class="text-xs text-gray-500 mt-0.5">' + st.detail + '</div>';
        html += '</div>';
        // Perte en dessous
        if (st.loss) {
            html += '<div class="text-xs text-red-400/70 mt-1">' + st.loss + '</div>';
        }
        html += '</div>';

        // Fleche entre blocs (sauf dernier)
        if (si < steps.length - 1) {
            html += '<div class="text-gray-500 text-sm mx-1"><i class="fas fa-chevron-right"></i></div>';
        }
    }

    html += '</div>';
    html += tokensHtml;

    // Detail par scan (depliable)
    if (hourEntries.length > 0) {
        html += '<div class="mt-2">';
        html += '<button onclick="document.getElementById(\'pipeline-detail\').classList.toggle(\'hidden\')" class="text-xs text-gray-400 hover:text-gray-200 transition">';
        html += '<i class="fas fa-list mr-1"></i>Detail par scan (' + hourEntries.length + ')';
        html += '</button>';
        html += '<div id="pipeline-detail" class="hidden mt-2">';
        html += '<table class="w-full text-xs">';
        html += '<thead><tr class="text-gray-500 border-b border-gray-600/50">';
        html += '<th class="text-left py-1 px-2">Heure</th>';
        html += '<th class="text-right py-1 px-2">RSS</th>';
        html += '<th class="text-right py-1 px-2">Filtres</th>';
        html += '<th class="text-right py-1 px-2">Nouveaux</th>';
        html += '<th class="text-right py-1 px-2">ASIN</th>';
        html += '<th class="text-right py-1 px-2">Rentables</th>';
        html += '<th class="text-right py-1 px-2">Tokens</th>';
        html += '</tr></thead><tbody>';

        for (var hi = 0; hi < hourEntries.length; hi++) {
            var he = hourEntries[hi];
            var hs = he.stats;
            var hAsin = (hs.resolvedAsin || 0) + (hs.searchedAsin || 0);
            var hTokens = hs.tokensUsed || 0;
            var rowClass = hs.profitable > 0 ? 'text-green-300' : 'text-gray-300';
            html += '<tr class="' + rowClass + ' border-b border-gray-700/30 hover:bg-white/5">';
            html += '<td class="py-1 px-2 font-medium">' + he.label + '</td>';
            html += '<td class="py-1 px-2 text-right text-gray-400">' + (hs.rssRaw || 0) + '</td>';
            html += '<td class="py-1 px-2 text-right text-amber-400">' + (hs.afterFilter || 0) + '</td>';
            html += '<td class="py-1 px-2 text-right text-blue-400">' + (hs.newDeals || 0) + '</td>';
            html += '<td class="py-1 px-2 text-right text-purple-400">' + hAsin + '</td>';
            html += '<td class="py-1 px-2 text-right ' + (hs.profitable > 0 ? 'text-green-400 font-bold' : 'text-gray-500') + '">' + (hs.profitable || 0) + '</td>';
            html += '<td class="py-1 px-2 text-right text-amber-300">' + (hTokens > 0 ? '-' + hTokens : '0') + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += '</div></div>';
    }

    html += '</div>';

    container.innerHTML = html;
}

// --- Mettre a jour une ligne du tableau ---
function updateDealRow(index, deal) {
    var row = document.getElementById('deal-row-' + index);
    if (!row) {
        // Row not found, re-render the whole table
        renderDealResults();
        return;
    }

    // Mettre a jour la cellule ASIN
    var asinCell = row.querySelector('.deal-asin');
    if (asinCell && deal.asin) {
        var mktDomain = OA_MARKETPLACES[dealSellMarket] ? OA_MARKETPLACES[dealSellMarket].domain : 'amazon.de';
        asinCell.innerHTML = '<a href="https://www.' + mktDomain + '/dp/' + deal.asin + '" target="_blank" class="text-blue-300 hover:text-blue-200 text-xs">' + deal.asin.substring(0, 5) + '...</a>';
    }

    // Mettre a jour la cellule prix Amazon
    var amazonPriceCell = row.querySelector('.deal-amazon-price');
    if (amazonPriceCell) {
        if (deal.amazonPrice && deal.amazonPrice > 0) {
            amazonPriceCell.innerHTML = '<span class="text-purple-300">' + deal.amazonPrice.toFixed(2) + '€</span>';
        } else if (deal.keepaData) {
            amazonPriceCell.innerHTML = '<span class="text-gray-500" title="Pas de prix Amazon disponible">N/A</span>';
        }
    }

    // Mettre a jour la cellule Ecart
    var spreadCell = row.querySelector('.deal-spread');
    if (spreadCell) {
        if (deal.price > 0 && deal.amazonPrice && deal.amazonPrice > 0) {
            var spread = deal.amazonPrice - deal.price;
            var spreadClass = spread > 0 ? 'text-cyan-400' : 'text-red-400';
            spreadCell.innerHTML = '<span class="' + spreadClass + '">' + (spread > 0 ? '+' : '') + spread.toFixed(2) + '€</span>';
        }
    }

    // Mettre a jour les cellules profit/ROI
    var profitCell = row.querySelector('.deal-profit');
    var roiCell = row.querySelector('.deal-roi');
    var actionsCell = row.querySelector('.deal-actions');

    if (profitCell) {
        if (deal.profit !== null && deal.profit !== undefined) {
            var profitClass = deal.profit > 0 ? 'text-green-400 font-bold' : 'text-red-400';
            profitCell.innerHTML = '<span class="' + profitClass + '">' + (deal.profit > 0 ? '+' : '') + deal.profit.toFixed(2) + '€</span>';
        } else if (deal.keepaData) {
            profitCell.innerHTML = '<span class="text-gray-500" title="Prix Amazon indisponible pour calcul">—</span>';
        }
    }
    if (roiCell) {
        if (deal.roi !== null && deal.roi !== undefined) {
            var roiClass = deal.roi > 0 ? 'text-green-400' : 'text-red-400';
            roiCell.innerHTML = '<span class="' + roiClass + '">' + deal.roi.toFixed(0) + '%</span>';
        } else if (deal.keepaData) {
            roiCell.innerHTML = '<span class="text-gray-500">—</span>';
        }
    }
    if (actionsCell) {
        var actionsHtml = '<a href="' + escapeHTML(deal.link) + '" target="_blank" class="text-blue-300 hover:text-blue-200 text-xs mr-2" title="Voir le deal"><i class="fas fa-external-link-alt"></i></a>';
        if (deal.asin && deal.profit !== null && deal.profit > 0) {
            actionsHtml += '<button onclick="sendDealToChecklist(' + index + ')" class="text-green-400 hover:text-green-300 text-xs" title="Verifier dans Checklist"><i class="fas fa-clipboard-check"></i></button>';
        }
        actionsCell.innerHTML = actionsHtml;
    }

    // Couleur de fond selon rentabilite
    row.className = row.className.replace(/bg-green-900\/20|bg-red-900\/10/g, '');
    if (deal.profit !== null && deal.profit > 0) row.className += ' bg-green-900/20';
    else if (deal.profit !== null && deal.profit < 0) row.className += ' bg-red-900/10';

    // Mettre a jour les stats globales
    updateDealStats();
}

// --- Helper : generer le HTML d'une ligne de deal ---
function buildDealRowHtml(d, displayNum, origIndex) {
    // Couleur de fond selon rentabilite
    var rowBg = '';
    if (d.profit !== null && d.profit > 0) rowBg = 'bg-green-900/20';
    else if (d.profit !== null && d.profit < 0) rowBg = 'bg-red-900/10';

    // Ecart de prix
    var spreadHtml = '';
    if (d.price > 0 && d.amazonPrice && d.amazonPrice > 0) {
        var spread = d.amazonPrice - d.price;
        var spreadClass = spread > 0 ? 'text-cyan-400' : 'text-red-400';
        spreadHtml = '<span class="' + spreadClass + '">' + (spread > 0 ? '+' : '') + spread.toFixed(2) + '€</span>';
    } else {
        spreadHtml = '<span class="text-gray-500">—</span>';
    }

    // Profit + tooltip detaille
    var profitHtml = '';
    var roiHtml = '';
    if (d.profit !== null && d.profit !== undefined) {
        var profitClass = d.profit > 0 ? 'text-green-400 font-bold' : 'text-red-400';
        var tooltipLines = [];
        tooltipLines.push('ACHAT: ' + d.price.toFixed(2) + '€');
        if (d.amazonPrice && d.amazonPrice > 0) tooltipLines.push('VENTE: ' + d.amazonPrice.toFixed(2) + '€');
        if (d.price > 0 && d.amazonPrice > 0) tooltipLines.push('Ecart brut: ' + (d.amazonPrice > d.price ? '+' : '') + (d.amazonPrice - d.price).toFixed(2) + '€');
        tooltipLines.push('---');
        if (d.fees && typeof d.fees === 'object') {
            tooltipLines.push('Commission (' + (d.fees.commPct || 15) + '%): -' + (d.fees.commission || 0).toFixed(2) + '€' + (d.fees.realCommission ? ' *' : ''));
            tooltipLines.push('Frais AMZ: -' + (d.fees.fbaFee || 0).toFixed(2) + '€' + (d.fees.realFbaFee ? ' *' : ''));
            var inboundLabel = 'Envoi a AMZ: -' + (d.fees.inbound || 0).toFixed(2) + '€';
            if (d.fees.realInbound) inboundLabel += ' * (' + d.fees.weightGrams + 'g)';
            tooltipLines.push(inboundLabel);
            tooltipLines.push('Prep: -' + (d.fees.prep || 0).toFixed(2) + '€');
            tooltipLines.push('URSSAF (' + (d.fees.urssafPct || 12.3) + '%): -' + (d.fees.urssaf || 0).toFixed(2) + '€');
            tooltipLines.push('Total frais: -' + ((d.fees.total || 0) + (d.fees.urssaf || 0)).toFixed(2) + '€');
            if (d.fees.realCommission || d.fees.realFbaFee || d.fees.realInbound) tooltipLines.push('* = donnees reelles Keepa');
        }
        tooltipLines.push('---');
        tooltipLines.push('PROFIT NET: ' + (d.profit > 0 ? '+' : '') + Number(d.profit).toFixed(2) + '€');
        if (d.roi !== null && d.roi !== undefined) tooltipLines.push('ROI: ' + Number(d.roi).toFixed(0) + '%');
        var tooltip = tooltipLines.join('\n');
        profitHtml = '<span class="' + profitClass + ' cursor-help deal-profit-cell" data-deal-index="' + origIndex + '" title="' + escapeHTML(tooltip) + '">' + (d.profit > 0 ? '+' : '') + Number(d.profit).toFixed(2) + '€</span>';
        if (d.roi !== null && d.roi !== undefined) {
            var roiClass = d.roi > 0 ? 'text-green-400' : 'text-red-400';
            roiHtml = '<span class="' + roiClass + '">' + Number(d.roi).toFixed(0) + '%</span>';
        } else {
            roiHtml = '<span class="text-gray-500">—</span>';
        }
    } else if (d.asin && !d.priceCheckedAt) {
        profitHtml = '<span class="text-amber-400 text-xs" title="En attente Keepa">⏳</span>';
        roiHtml = '<span class="text-amber-400 text-xs">⏳</span>';
    } else {
        profitHtml = '<span class="text-gray-500">—</span>';
        roiHtml = '<span class="text-gray-500">—</span>';
    }

    // ASIN
    var asinHtml = '';
    if (d.asin) {
        var mktDomain = OA_MARKETPLACES[dealSellMarket] ? OA_MARKETPLACES[dealSellMarket].domain : 'amazon.de';
        asinHtml = '<a href="https://www.' + mktDomain + '/dp/' + d.asin + '" target="_blank" class="text-blue-300 hover:text-blue-200 text-xs">' + d.asin.substring(0, 5) + '...</a>';
    } else {
        // Tooltip selon le searchStatus
        var statusLabels = {
            'resolve_no_amazon': 'Redirect Pepper → site non-Amazon (pas de lien Amazon)',
            'resolve_error': 'Erreur lors du suivi de la redirection Pepper',
            'search_not_found': 'Recherche Keepa echouee (2 essais, produit introuvable)',
            'tokens_exhausted': 'Pas assez de tokens Keepa pour chercher',
            'search_ok_no_tokens': 'ASIN trouve mais plus de tokens pour le prix'
        };
        var statusTip = statusLabels[d.searchStatus] || (d.isAmazon ? 'Amazon detecte, ASIN non trouve' : 'Lier a un ASIN Amazon');
        var iconClass = d.searchStatus ? 'text-amber-400' : 'text-gray-400';
        var icon = d.searchStatus ? '<i class="fas fa-exclamation-triangle mr-1"></i>' : '<i class="fas fa-link mr-1"></i>';
        asinHtml = '<span class="' + iconClass + ' text-xs cursor-help" title="' + statusTip + '">' + icon + '</span><button onclick="promptLinkASIN(' + origIndex + ')" class="' + iconClass + ' hover:text-gray-200 text-xs">lier</button>';
    }

    // Amazon price
    var amazonPriceHtml = '';
    if (d.amazonPrice && d.amazonPrice > 0) {
        if (d.priceIsAvg) {
            amazonPriceHtml = '<span class="text-orange-300 cursor-help" title="Prix moyen 90j (produit actuellement hors stock ou indisponible)">~' + Number(d.amazonPrice).toFixed(2) + '€</span>';
        } else {
            amazonPriceHtml = '<span class="text-purple-300">' + Number(d.amazonPrice).toFixed(2) + '€</span>';
        }
    } else if (d.priceCheckedAt) {
        amazonPriceHtml = '<span class="text-gray-500 text-xs" title="Aucun prix Amazon disponible (meme en moyenne)">N/A</span>';
    } else if (d.asin) {
        amazonPriceHtml = '<span class="text-amber-400 text-xs" title="En attente du lookup Keepa">⏳</span>';
    } else {
        amazonPriceHtml = '<span class="text-gray-500">—</span>';
    }

    // Actions
    var actionsHtml = '<a href="' + escapeHTML(d.link) + '" target="_blank" class="text-blue-300 hover:text-blue-200 text-xs mr-2" title="Voir le deal"><i class="fas fa-external-link-alt"></i></a>';
    if (d.asin && d.profit !== null && d.profit > 0) {
        actionsHtml += '<button onclick="sendDealToChecklist(' + origIndex + ')" class="text-green-400 hover:text-green-300 text-xs" title="Verifier dans Checklist"><i class="fas fa-clipboard-check"></i></button>';
    }
    actionsHtml += ' <button onclick="markDealIgnored(' + origIndex + ')" class="text-gray-500 hover:text-red-400 text-xs ml-1" title="Ignorer ce deal"><i class="fas fa-times"></i></button>';

    // Badges
    var tempLabel = '';
    if (d.temperature >= 500) tempLabel = 'Exceptionnel';
    else if (d.temperature >= 200) tempLabel = 'Tres bon deal';
    else if (d.temperature >= 100) tempLabel = 'Bon deal, populaire';
    else if (d.temperature >= 50) tempLabel = 'Correct';
    else if (d.temperature > 0) tempLabel = 'Tiede';
    else tempLabel = 'Mal vote';
    var tempBadge = d.temperature > 0 ? ' <span class="text-orange-400 text-xs cursor-help" title="Temperature Pepper: ' + d.temperature + '\u00B0 — ' + tempLabel + '">' + d.temperature + '\u00B0</span>' : '';
    var amazonBadge = d.isAmazon ? ' <span class="bg-orange-500/30 text-orange-300 text-xs px-1 rounded">AMZ</span>' : '';
    var historyBadge = '';
    if (d.isNew) historyBadge = ' <span class="bg-green-500/30 text-green-300 text-xs px-1 rounded">NEW</span>';
    else if (d.historyStatus === 'checklist') historyBadge = ' <span class="bg-indigo-500/30 text-indigo-300 text-xs px-1 rounded">CL</span>';
    var feedBadge = '';
    if (d.feedType === 'hot') feedBadge = ' <span class="bg-red-500/30 text-red-300 text-xs px-1 rounded" title="Feed Hot (populaire)">HOT</span>';
    else if (d.feedType === 'new') feedBadge = ' <span class="bg-cyan-500/30 text-cyan-300 text-xs px-1 rounded" title="Feed New (recent)">NEW</span>';
    else if (d.feedType === 'both') feedBadge = ' <span class="bg-yellow-500/30 text-yellow-300 text-xs px-1 rounded" title="Dans Hot et New">HOT</span>';
    var matchBadge = d.matchedBySearch ? ' <span class="bg-purple-500/30 text-purple-300 text-xs px-1 rounded" title="ASIN trouve par recherche Keepa">MATCH</span>' : '';

    // Multi-marketplace
    var multiMktHtml = '';
    if (d.multiMarket && d.multiMarket.best) {
        var bestMkt = d.multiMarket.best.toUpperCase();
        var bestData = d.multiMarket.markets[d.multiMarket.best];
        var mktFlag = { de: '\ud83c\udde9\ud83c\uddea', fr: '\ud83c\uddeb\ud83c\uddf7', it: '\ud83c\uddee\ud83c\uddf9', es: '\ud83c\uddea\ud83c\uddf8' };
        var flag = mktFlag[d.multiMarket.best] || '';
        var mktTooltip = 'Comparaison 4 marketplaces:\n';
        Object.keys(d.multiMarket.markets).forEach(function(mk) {
            var m = d.multiMarket.markets[mk];
            var isB = mk === d.multiMarket.best ? ' \u2190 BEST' : '';
            mktTooltip += mk.toUpperCase() + ': ' + m.price.toFixed(2) + '€ \u2192 ' + (m.profit > 0 ? '+' : '') + m.profit.toFixed(2) + '€ (' + m.roi.toFixed(0) + '%)' + isB + '\n';
        });
        var bestProfitClass = bestData && bestData.profit > 0 ? 'text-green-400' : 'text-red-400';
        multiMktHtml = '<span class="' + bestProfitClass + ' cursor-help text-xs" title="' + escapeHTML(mktTooltip) + '">' + flag + ' ' + bestMkt + '</span>';
    } else {
        multiMktHtml = '<span class="text-gray-500 text-xs">—</span>';
    }

    var row = '<tr id="deal-row-' + origIndex + '" class="border-b border-gray-700/50 hover:bg-gray-700/30 ' + rowBg + '">';
    row += '<td class="p-2 text-gray-400">' + displayNum + '</td>';
    row += '<td class="p-2"><div class="text-gray-100 text-xs leading-tight max-w-xs truncate" title="' + escapeHTML(d.title) + '">' + escapeHTML(d.title.substring(0, 80)) + '</div><div class="text-gray-400 text-xs mt-1">' + historyBadge + amazonBadge + feedBadge + matchBadge + tempBadge + '</div></td>';
    row += '<td class="p-2 text-right text-blue-300 font-medium">' + (d.price > 0 ? d.price.toFixed(2) + '€' : '—') + '</td>';
    row += '<td class="p-2 text-gray-300 text-xs">' + escapeHTML(d.sourceName || d.source || '') + '</td>';
    row += '<td class="p-2 text-center deal-asin">' + asinHtml + '</td>';
    row += '<td class="p-2 text-right deal-amazon-price">' + amazonPriceHtml + '</td>';
    row += '<td class="p-2 text-right deal-spread">' + spreadHtml + '</td>';
    row += '<td class="p-2 text-right deal-profit">' + profitHtml + '</td>';
    row += '<td class="p-2 text-right deal-roi">' + roiHtml + '</td>';
    row += '<td class="p-2 text-center">' + multiMktHtml + '</td>';
    row += '<td class="p-2 text-center deal-actions">' + actionsHtml + '</td>';
    row += '</tr>';
    return row;
}

// --- Helper : en-tete de tableau ---
function buildDealTableHeader() {
    var h = '<thead><tr class="text-gray-300 border-b border-gray-600">';
    h += '<th class="text-left p-2 w-8">#</th>';
    h += '<th class="text-left p-2">Deal</th>';
    h += '<th class="text-right p-2">Prix</th>';
    h += '<th class="text-left p-2">Source</th>';
    h += '<th class="text-center p-2">ASIN</th>';
    h += '<th class="text-right p-2">Amazon</th>';
    h += '<th class="text-right p-2">Ecart</th>';
    h += '<th class="text-right p-2">Profit</th>';
    h += '<th class="text-right p-2">ROI</th>';
    h += '<th class="text-center p-2">Best MKT</th>';
    h += '<th class="text-center p-2">Actions</th>';
    h += '</tr></thead>';
    return h;
}

// --- Helper : date string depuis scanHour ---
function getDayFromScanHour(scanHour) {
    if (!scanHour) return null;
    // Convertir UTC → date locale
    var d = new Date(scanHour.length <= 16 ? scanHour + ':00Z' : scanHour);
    if (isNaN(d.getTime())) return scanHour.substring(0, 10);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// --- Helper : heure lisible depuis scanHour (UTC → locale) ---
function getHourLabel(scanHour) {
    if (!scanHour) return 'Inconnu';
    // scanHour est en UTC (ex: "2026-03-03T18:00"), convertir en heure locale
    var d = new Date(scanHour.length <= 16 ? scanHour + ':00Z' : scanHour);
    if (isNaN(d.getTime())) return scanHour.substring(11, 16);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// --- Navigation jour ---
function setDealDay(day) {
    selectedDealDay = day;
    collapsedHourGroups = {}; // reset quand on change de jour
    // Mettre a jour les boutons
    for (var i = 0; i <= 2; i++) {
        var btn = document.getElementById('deal-day-' + i);
        if (btn) {
            if (i === day) {
                btn.className = 'px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-semibold';
            } else {
                btn.className = 'px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold';
            }
        }
    }
    renderDealResults();
}

// --- Toggle groupe horaire ---
function toggleHourGroup(scanHour) {
    collapsedHourGroups[scanHour] = !collapsedHourGroups[scanHour];
    renderDealResults();
}

// --- Rendu du tableau (2 sections : nouveaux + precedents par heure) ---
function renderDealResults() {
    var container = document.getElementById('deal-scanner-results');
    if (!container) return;

    var deals = dealScannerResults;
    if (deals.length === 0) {
        var nw0 = new Date();
        var nxH0 = new Date(nw0);
        nxH0.setMinutes(0, 0, 0);
        nxH0.setHours(nxH0.getHours() + 1);
        var nxLabel0 = String(nxH0.getHours()).padStart(2, '0') + ':00';
        container.innerHTML = '<div class="p-8 text-center text-gray-400">' +
            '<i class="fas fa-satellite-dish text-5xl mb-4 text-blue-400"></i>' +
            '<p class="text-lg text-white mb-2">En attente du scan de ' + nxLabel0 + '</p>' +
            '<p class="text-sm text-gray-500">Le cron scanne automatiquement toutes les heures.</p></div>';
        return;
    }

    // Appliquer les filtres
    var filtered = deals.filter(function(d) { return d.historyStatus !== 'ignored'; });
    if (dealFilterMode === 'amazon') {
        filtered = filtered.filter(function(d) { return d.asin; });
    } else if (dealFilterMode === 'profitable') {
        filtered = filtered.filter(function(d) { return !d.excludedPostKeepa && d.profit !== null && d.profit > 0; });
    } else if (dealFilterMode === 'no_asin') {
        filtered = filtered.filter(function(d) { return !d.asin && (d.searchStatus === 'resolve_no_amazon' || d.searchStatus === 'search_not_found'); });
    } else if (dealFilterMode === 'unprocessed') {
        filtered = filtered.filter(function(d) {
            return d.searchStatus === 'tokens_exhausted' ||
                   d.searchStatus === 'search_ok_no_tokens' ||
                   (d.asin && !d.priceCheckedAt);
        });
    }

    // Tri par ROI desc puis temperature desc
    filtered.sort(function(a, b) {
        var roiA = (a.roi !== null && a.roi !== undefined) ? a.roi : -9999;
        var roiB = (b.roi !== null && b.roi !== undefined) ? b.roi : -9999;
        if (roiA !== -9999 && roiB !== -9999) return roiB - roiA;
        if (roiA !== -9999) return -1;
        if (roiB !== -9999) return 1;
        return (b.temperature || 0) - (a.temperature || 0);
    });

    updateDealStats();

    // === Determiner les jours disponibles (heure locale) ===
    var today = new Date();
    var dayStrings = [];
    for (var di = 0; di <= 2; di++) {
        var d = new Date(today);
        d.setDate(d.getDate() - di);
        dayStrings.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    }

    // Mettre a jour les boutons jour avec compteurs (total non filtre)
    var allNonIgnored = deals.filter(function(d) { return d.historyStatus !== 'ignored'; });
    for (var bi = 0; bi <= 2; bi++) {
        var dayBtn = document.getElementById('deal-day-' + bi);
        if (dayBtn) {
            var dayLabel = bi === 0 ? "Aujourd'hui" : bi === 1 ? 'Hier' : 'Avant-hier';
            var dayCount = allNonIgnored.filter(function(dd) { return getDayFromScanHour(dd.scanHour) === dayStrings[bi]; }).length;
            dayBtn.textContent = dayLabel + ' (' + dayCount + ')';
        }
    }

    // === Filtrer par jour selectionne ===
    var selectedDayStr = dayStrings[selectedDealDay] || dayStrings[0];
    var dayDeals = filtered.filter(function(dd) {
        var dealDay = getDayFromScanHour(dd.scanHour);
        if (!dealDay) return selectedDealDay === 0; // deals sans scanHour → aujourd'hui
        return dealDay === selectedDayStr;
    });

    if (dayDeals.length === 0) {
        if (selectedDealDay === 0) {
            // Aujourd'hui sans deals → afficher "En attente du prochain scan"
            var nw = new Date();
            var nxH = new Date(nw);
            nxH.setMinutes(0, 0, 0);
            nxH.setHours(nxH.getHours() + 1);
            var nxLabel = String(nxH.getHours()).padStart(2, '0') + ':00';
            container.innerHTML = '<div class="mb-6">' +
                '<div class="flex items-center justify-between px-4 py-3 rounded-xl" style="background: linear-gradient(135deg, #1e3a5f, #2d3748); border: 1px dashed #4a5568">' +
                '<div class="flex items-center">' +
                '<i class="fas fa-satellite-dish text-blue-400 mr-2 text-lg"></i>' +
                '<span class="text-gray-300 font-bold text-lg">' + nxLabel + '</span>' +
                '<span class="ml-3 bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded-full"><i class="fas fa-hourglass-half mr-1"></i>En attente de scan</span>' +
                '</div></div></div>';
        } else {
            container.innerHTML = '<div class="p-8 text-center text-gray-400"><i class="fas fa-calendar-times text-5xl mb-4"></i><p class="text-lg">Aucun deal pour cette journee</p><p class="text-sm mt-2">Selectionnez un autre jour</p></div>';
        }
        return;
    }

    // === Grouper par scanHour ===
    var hourGroups = {};
    dayDeals.forEach(function(dd) {
        var key = dd.scanHour || 'unknown';
        if (!hourGroups[key]) hourGroups[key] = [];
        hourGroups[key].push(dd);
    });

    // === Generer TOUS les creneaux horaires (y compris 0 deals) ===
    var nowForSlot = new Date();
    var currentHourKey = nowForSlot.toISOString().substring(0, 13) + ':00';
    var allHourKeys = Object.keys(hourGroups).filter(function(k) { return k !== 'unknown'; });

    if (selectedDealDay === 0 && allHourKeys.length > 0) {
        // Aujourd'hui : generer de la 1ere heure connue jusqu'a l'heure courante
        allHourKeys.sort();
        var firstHour = allHourKeys[0];
        var startD = new Date(firstHour.length <= 16 ? firstHour + ':00Z' : firstHour);
        var endD = new Date(currentHourKey + ':00Z');
        var cursor = new Date(startD);
        while (cursor <= endD) {
            var key = cursor.toISOString().substring(0, 13) + ':00';
            if (!hourGroups[key]) hourGroups[key] = [];
            cursor.setHours(cursor.getHours() + 1);
        }
    }

    var hourOrder = Object.keys(hourGroups).filter(function(k) { return k !== 'unknown'; });
    hourOrder.sort(function(a, b) { return b.localeCompare(a); });

    var hasCurrentHour = hourOrder.indexOf(currentHourKey) !== -1;

    var latestHour = hourOrder[0];
    var olderHours = hourOrder.slice(1);

    // === Construire le HTML ===
    var html = '';
    var globalNum = 1;

    // --- Bandeau "En attente de scan" pour l'heure courante (si pas encore de deals) ---
    if (selectedDealDay === 0 && !hasCurrentHour) {
        var nextHour = new Date(nowForSlot);
        nextHour.setMinutes(0, 0, 0);
        nextHour.setHours(nextHour.getHours() + 1);
        var nextHLabel = String(nextHour.getHours()).padStart(2, '0') + ':00';
        html += '<div class="mb-6">';
        html += '<div class="flex items-center justify-between px-4 py-3 rounded-xl" style="background: linear-gradient(135deg, #1e3a5f, #2d3748); border: 1px dashed #4a5568">';
        html += '<div class="flex items-center">';
        html += '<i class="fas fa-satellite-dish text-blue-400 mr-2 text-lg"></i>';
        html += '<span class="text-gray-300 font-bold text-lg">' + nextHLabel + '</span>';
        html += '<span class="ml-3 bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded-full"><i class="fas fa-hourglass-half mr-1"></i>En attente de scan</span>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
    }

    // --- Section "Nouveaux deals" (derniere heure) ---
    var latestDeals = hourGroups[latestHour] || [];
    var latestLabel = getHourLabel(latestHour);
    var latestProfitable = latestDeals.filter(function(dd) { return dd.profit !== null && dd.profit > 0; }).length;

    html += '<div class="mb-6">';
    html += '<div class="flex items-center justify-between px-4 py-3 rounded-t-xl" style="background: linear-gradient(135deg, #1a365d, #2d3748)">';
    html += '<div class="flex items-center">';
    html += '<i class="fas fa-bolt text-yellow-400 mr-2 text-lg"></i>';
    html += '<span class="text-white font-bold text-lg">Nouveaux deals</span>';
    html += '<span class="ml-3 bg-white/20 text-white text-xs px-2 py-1 rounded-full">' + latestLabel + '</span>';
    html += '<span class="ml-2 bg-white/10 text-gray-300 text-xs px-2 py-1 rounded-full">' + latestDeals.length + ' deals</span>';
    if (latestProfitable > 0) html += '<span class="ml-2 bg-green-500/30 text-green-300 text-xs px-2 py-1 rounded-full">' + latestProfitable + ' rentables</span>';
    html += '</div>';
    html += '</div>';

    html += '<div class="overflow-x-auto rounded-b-xl" style="background-color: #2d3748">';
    html += '<table class="w-full text-sm">';
    html += buildDealTableHeader();
    html += '<tbody>';
    for (var li = 0; li < latestDeals.length; li++) {
        var ld = latestDeals[li];
        var origIdx = dealScannerResults.indexOf(ld);
        html += buildDealRowHtml(ld, globalNum++, origIdx);
    }
    html += '</tbody></table></div>';
    html += '</div>';

    // --- Sections "Deals precedents" (heures plus anciennes, repliables) ---
    if (olderHours.length > 0) {
        html += '<div class="mt-4">';
        html += '<div class="flex items-center mb-3 px-1">';
        html += '<i class="fas fa-history text-gray-400 mr-2"></i>';
        html += '<span class="text-gray-300 font-semibold">Deals precedents</span>';
        var olderTotal = 0;
        olderHours.forEach(function(h) { olderTotal += hourGroups[h].length; });
        html += '<span class="ml-2 text-gray-500 text-sm">(' + olderTotal + ' deals)</span>';
        html += '</div>';

        for (var oi = 0; oi < olderHours.length; oi++) {
            var hourKey = olderHours[oi];
            var hourDeals = hourGroups[hourKey];
            var hourLabel = getHourLabel(hourKey);
            var hourProfitable = hourDeals.filter(function(dd) { return dd.profit !== null && dd.profit > 0; }).length;
            var isCollapsed = collapsedHourGroups[hourKey] !== false; // collapsed par defaut

            html += '<div class="mb-3">';
            // En-tete cliquable
            html += '<div onclick="toggleHourGroup(\'' + hourKey + '\')" class="flex items-center justify-between px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-600/50" style="background-color: #374151">';
            html += '<div class="flex items-center">';
            html += '<i class="fas fa-chevron-' + (isCollapsed ? 'right' : 'down') + ' text-gray-400 mr-2 text-xs"></i>';
            html += '<span class="text-gray-300 font-medium">' + hourLabel + '</span>';
            html += '<span class="ml-2 text-gray-500 text-xs">' + hourDeals.length + ' deals</span>';
            if (hourProfitable > 0) html += '<span class="ml-2 bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded">' + hourProfitable + ' rentables</span>';
            html += '</div>';
            html += '</div>';

            // Contenu (masque si collapsed)
            if (!isCollapsed) {
                html += '<div class="overflow-x-auto rounded-b-lg" style="background-color: #2d3748">';
                html += '<table class="w-full text-sm">';
                html += buildDealTableHeader();
                html += '<tbody>';
                for (var hi = 0; hi < hourDeals.length; hi++) {
                    var hd = hourDeals[hi];
                    var hOrigIdx = dealScannerResults.indexOf(hd);
                    html += buildDealRowHtml(hd, globalNum++, hOrigIdx);
                }
                html += '</tbody></table></div>';
            } else {
                // Incrementer le compteur meme si collapsed
                globalNum += hourDeals.length;
            }

            html += '</div>';
        }

        html += '</div>';
    }

    container.innerHTML = html;
}

// --- Lier manuellement un ASIN a un deal ---
function promptLinkASIN(dealIndex) {
    var input = prompt('Entre l\'ASIN Amazon (ou l\'URL Amazon) pour ce deal :');
    if (!input || input.trim().length < 5) return;
    input = input.trim();

    // Extraire ASIN depuis URL si c'est une URL
    var asin = extractASINFromURL(input) || input.toUpperCase();
    if (asin.length !== 10) {
        alert('ASIN invalide. Un ASIN fait 10 caracteres (ex: B08K3XXXXXX)');
        return;
    }

    var deal = dealScannerResults[dealIndex];
    if (!deal) return;

    deal.asin = asin;
    deal.isAmazon = true;

    // Chercher dans le cache d'abord
    if (keepaCache[asin] && (Date.now() - keepaCache[asin].timestamp) < KEEPA_CACHE_TTL) {
        var cached = keepaCache[asin];
        deal.amazonPrice = cached.price;
        deal.keepaData = cached;
        if (deal.price > 0 && cached.price > 0) {
            var profitResult = calculateDealProfit(deal, cached);
            deal.profit = profitResult.profit;
            deal.roi = profitResult.roi;
            deal.fees = profitResult.fees;
        }
        renderDealResults();
    } else {
        // Lookup Keepa direct (pas la queue, appel immediat)
        var settings = loadOASettings();
        if (settings.keepaApiKey) {
            // Afficher l'ASIN lie + indicateur de chargement
            renderDealResults();
            // Mettre un indicateur de chargement dans la cellule Amazon price
            var loadingRow = document.getElementById('deal-row-' + dealIndex);
            if (loadingRow) {
                var apCell = loadingRow.querySelector('.deal-amazon-price');
                if (apCell) apCell.innerHTML = '<span class="text-amber-400 text-xs"><i class="fas fa-spinner fa-spin mr-1"></i></span>';
            }
            keepaLookup(asin, 'asin').then(function(result) {
                if (result) {
                    deal.amazonPrice = result.price;
                    deal.keepaData = result;
                    deal.title = result.title || deal.title;
                    deal.image = result.imageUrl || deal.image;
                    if (deal.price > 0 && result.price > 0) {
                        var profitResult = calculateDealProfit(deal, result);
                        deal.profit = profitResult.profit;
                        deal.roi = profitResult.roi;
                        deal.fees = profitResult.fees;
                    }
                    updateDealRow(dealIndex, deal);
                } else {
                    console.warn('[DealScanner] Keepa lookup: aucun resultat pour ' + asin);
                    // Feedback visible
                    var row = document.getElementById('deal-row-' + dealIndex);
                    if (row) {
                        var apCell = row.querySelector('.deal-amazon-price');
                        if (apCell) apCell.innerHTML = '<span class="text-red-400 text-xs" title="Produit non trouve sur Keepa">N/A</span>';
                    }
                }
            }).catch(function(err) {
                console.error('[DealScanner] Keepa lookup erreur:', err);
                var row = document.getElementById('deal-row-' + dealIndex);
                if (row) {
                    var apCell = row.querySelector('.deal-amazon-price');
                    if (apCell) apCell.innerHTML = '<span class="text-red-400 text-xs" title="Erreur Keepa">Err</span>';
                }
            });
        } else {
            alert('Configure ta cle API Keepa dans les Parametres OA pour obtenir les prix Amazon.');
            renderDealResults();
        }
    }
}

// --- Ajout manuel d'un deal ---
async function addManualDeal() {
    var inputEl = document.getElementById('deal-manual-input');
    var priceEl = document.getElementById('deal-manual-price');
    var sourceEl = document.getElementById('deal-manual-source');
    var resultEl = document.getElementById('deal-manual-result');

    var input = inputEl ? inputEl.value.trim() : '';
    var price = priceEl ? parseFloat(priceEl.value) : 0;
    var sourceName = sourceEl ? sourceEl.value.trim() : 'Manuel';

    if (!input) {
        if (resultEl) resultEl.innerHTML = '<p class="text-red-500 text-sm">Entre un ASIN, un lien Amazon ou un EAN</p>';
        return;
    }
    if (!price || price <= 0) {
        if (resultEl) resultEl.innerHTML = '<p class="text-red-500 text-sm">Entre le prix promo</p>';
        return;
    }

    // Detecter le type d'entree
    var asin = null;
    var ean = null;
    var isUrl = input.startsWith('http');

    if (isUrl) {
        asin = extractASINFromURL(input);
    } else if (/^B[A-Z0-9]{9}$/i.test(input)) {
        asin = input.toUpperCase();
    } else if (/^\d{8,13}$/.test(input)) {
        ean = input;
    } else {
        if (resultEl) resultEl.innerHTML = '<p class="text-red-500 text-sm">Format non reconnu. Entre un ASIN (B0XXXXXXXX), un lien Amazon ou un EAN (code-barre).</p>';
        return;
    }

    if (resultEl) resultEl.innerHTML = '<p class="text-amber-500 text-sm"><i class="fas fa-spinner fa-spin mr-1"></i>Recherche Keepa en cours...</p>';

    // Creer le deal
    var deal = {
        title: asin ? ('Produit ' + asin) : ('EAN ' + ean),
        link: asin ? ('https://www.' + (OA_MARKETPLACES[dealSellMarket] || OA_MARKETPLACES['de']).domain + '/dp/' + asin) : '',
        image: '',
        price: price,
        originalPrice: 0,
        discount: 0,
        merchant: sourceName || 'Manuel',
        isAmazon: true,
        asin: asin,
        ean: ean,
        amazonPrice: null,
        keepaData: null,
        profit: null,
        roi: null,
        fees: null,
        category: '',
        temperature: 0,
        date: new Date(),
        source: 'manual',
        sourceName: sourceName || 'Manuel',
        manual: true
    };

    // Lookup Keepa
    var settings = loadOASettings();
    if (settings.keepaApiKey) {
        var result = await keepaLookup(asin || ean, asin ? 'asin' : 'ean');
        if (result) {
            deal.asin = result.asin;
            deal.title = result.title || deal.title;
            deal.image = result.imageUrl || '';
            deal.amazonPrice = result.price;
            deal.keepaData = result;
            deal.link = 'https://www.' + (OA_MARKETPLACES[dealSellMarket] || OA_MARKETPLACES['de']).domain + '/dp/' + result.asin;

            if (deal.price > 0 && result.price > 0) {
                var profitCalc = calculateDealProfit(deal, result);
                deal.profit = profitCalc.profit;
                deal.roi = profitCalc.roi;
                deal.fees = profitCalc.fees;
            }

            if (resultEl) {
                if (deal.profit !== null && deal.profit > 0) {
                    resultEl.innerHTML = '<p class="text-green-500 text-sm"><i class="fas fa-check-circle mr-1"></i>Deal ajoute ! Profit: +' + deal.profit.toFixed(2) + '€ (ROI ' + deal.roi.toFixed(0) + '%)</p>';
                } else if (deal.profit !== null) {
                    resultEl.innerHTML = '<p class="text-red-500 text-sm"><i class="fas fa-times-circle mr-1"></i>Deal non rentable. Profit: ' + deal.profit.toFixed(2) + '€</p>';
                } else {
                    resultEl.innerHTML = '<p class="text-amber-500 text-sm"><i class="fas fa-info-circle mr-1"></i>Deal ajoute mais prix Amazon non disponible.</p>';
                }
            }
        } else {
            if (resultEl) resultEl.innerHTML = '<p class="text-amber-500 text-sm"><i class="fas fa-exclamation-triangle mr-1"></i>Produit non trouve sur Keepa. Deal ajoute sans prix Amazon.</p>';
        }
    } else {
        if (resultEl) resultEl.innerHTML = '<p class="text-amber-500 text-sm"><i class="fas fa-key mr-1"></i>Cle API Keepa non configuree. Va dans Parametres OA. Deal ajoute sans analyse.</p>';
    }

    // Ajouter au tableau
    dealScannerResults.unshift(deal); // En premier
    renderDealResults();

    // Vider les champs
    if (inputEl) inputEl.value = '';
    if (priceEl) priceEl.value = '';
}

// --- Envoyer un deal a la Checklist ---
function sendDealToChecklist(dealIndex) {
    var deal = dealScannerResults[dealIndex];
    if (!deal || !deal.asin) return;

    // Creer un objet produit compatible avec la checklist
    var product = {
        asin: deal.asin,
        title: deal.title,
        pricDE: deal.amazonPrice || 0,
        pricFR: deal.price,
        profit: deal.profit || 0,
        roi: deal.roi || 0,
        bsr: deal.keepaData ? deal.keepaData.bsr : 0,
        fbaSellers: deal.keepaData ? deal.keepaData.fbaSellers : 0,
        estSales: 0,
        amazonSells: false,
        category: deal.category,
        dealSource: deal.sourceName
    };

    // Ajouter temporairement dans oaScanResults pour que startChecklist fonctionne
    oaScanResults.push(product);
    var tempIndex = oaScanResults.length - 1;
    startChecklist(tempIndex);
    markDealChecklist(deal.link);
    showOANotification('Deal envoye a la Checklist : ' + deal.title.substring(0, 50), 'success');
}

// ===========================
// FEATURE 1 — HISTORIQUE / DEDUPLICATION
// ===========================

function loadDealHistory() {
    try {
        var saved = localStorage.getItem('dealHistory');
        if (saved) {
            dealHistory = JSON.parse(saved);
            // Nettoyer les deals de plus de 7 jours
            var now = Date.now();
            var maxAge = 7 * 24 * 60 * 60 * 1000;
            var cleaned = 0;
            Object.keys(dealHistory).forEach(function(key) {
                if (now - dealHistory[key].lastSeen > maxAge) {
                    delete dealHistory[key];
                    cleaned++;
                }
            });
            if (cleaned > 0) {
                console.log('[DealScanner] Historique: ' + cleaned + ' deals expires nettoyes');
                saveDealHistory();
            }
            console.log('[DealScanner] Historique charge: ' + Object.keys(dealHistory).length + ' deals');
        }
    } catch (e) {
        console.warn('[DealScanner] Erreur chargement historique:', e);
        dealHistory = {};
    }
}

function saveDealHistory() {
    try {
        localStorage.setItem('dealHistory', JSON.stringify(dealHistory));
    } catch (e) {
        console.warn('[DealScanner] Erreur sauvegarde historique:', e);
    }
}

function markDealsWithHistory(deals) {
    var now = Date.now();
    var newCount = 0;
    deals.forEach(function(deal) {
        var key = deal.link || deal.title;
        if (!key) return;
        var entry = dealHistory[key];
        if (entry) {
            deal.historyStatus = entry.status; // 'seen', 'checklist', 'ignored'
            deal.isNew = false;
            entry.lastSeen = now;
        } else {
            deal.historyStatus = 'new';
            deal.isNew = true;
            newCount++;
            dealHistory[key] = { firstSeen: now, lastSeen: now, status: 'new' };
        }
    });
    // Marquer les 'new' comme 'seen' apres affichage
    deals.forEach(function(deal) {
        var key = deal.link || deal.title;
        if (key && dealHistory[key] && dealHistory[key].status === 'new') {
            dealHistory[key].status = 'seen';
        }
    });
    saveDealHistory();
    return newCount;
}

function markDealIgnored(dealIndex) {
    if (dealIndex < 0 || dealIndex >= dealScannerResults.length) return;
    var deal = dealScannerResults[dealIndex];
    var key = deal.link || deal.title;
    if (key && dealHistory[key]) {
        dealHistory[key].status = 'ignored';
        deal.historyStatus = 'ignored';
        saveDealHistory();
    }
    renderDealResults();
}

function markDealChecklist(dealLink) {
    if (!dealLink) return;
    if (dealHistory[dealLink]) {
        dealHistory[dealLink].status = 'checklist';
        saveDealHistory();
    }
}

// ===========================
// FEATURE 2 — MATCHER NON-AMAZON VIA KEEPA SEARCH
// ===========================

async function matchNonAmazonDeals(deals) {
    var settings = loadOASettings();
    if (!settings.keepaApiKey) return 0;

    // Filtrer : deals sans ASIN, avec un titre, pas deja checkes
    var toMatch = deals.filter(function(d) {
        return !d.asin && !d.keepaSearchDone && !d.keepaChecked && d.title && d.price > 0;
    });

    if (toMatch.length === 0) return 0;

    // Trier par temperature decroissante (deals les plus chauds d'abord)
    toMatch.sort(function(a, b) { return (b.temperature || 0) - (a.temperature || 0); });

    // Limiter a 15 max (budget ~60 tokens, ~4 tokens par deal)
    var maxMatch = Math.min(toMatch.length, 15);
    console.log('[DealScanner] Matching non-Amazon: ' + maxMatch + ' deals (tokens=' + keepaTokensLeft + ')');

    var keepaStatsEl = document.getElementById('deal-stats-keepa');
    if (keepaStatsEl) keepaStatsEl.textContent = 'Recherche Amazon: 0/' + maxMatch + '...';

    // Recherche SEQUENTIELLE pour economiser les tokens (arret si plus de tokens)
    var matchedCount = 0;
    for (var mi = 0; mi < maxMatch; mi++) {
        var deal = toMatch[mi];
        if (keepaTokensLeft <= 0) {
            console.log('[DealScanner] Plus de tokens, arret matching (' + mi + '/' + maxMatch + ')');
            break;
        }
        try {
            var foundAsin = await keepaSearchByTitle(deal.title);
            deal.keepaSearchDone = true;
            if (foundAsin) {
                deal.asin = foundAsin;
                deal.matchedBySearch = true;
                matchedCount++;
            }
        } catch (e) {
            deal.keepaSearchDone = true;
        }
        if (keepaStatsEl) keepaStatsEl.textContent = 'Recherche Amazon: ' + (mi + 1) + '/' + maxMatch + '...';
        // Mettre a jour le tableau en temps reel
        renderDealResults(dealScannerResults);
    }

    console.log('[DealScanner] Matching termine: ' + matchedCount + '/' + maxMatch + ' trouves');
    if (keepaStatsEl) keepaStatsEl.textContent = matchedCount > 0 ? 'Match: ' + matchedCount + ' trouves' : '';

    return matchedCount;
}

// ===========================
// FEATURE 3 — MULTI-MARKETPLACE COMPARISON (FR+DE+IT+ES)
// ===========================

async function multiMarketplaceLookup(asins) {
    var settings = loadOASettings();
    if (!settings.keepaApiKey || asins.length === 0) return {};

    var domains = { de: 3, fr: 4, it: 8, es: 9 };
    var results = {}; // { asin: { de: {price, ...}, fr: {price, ...}, ... , best: 'de' } }

    // Initialiser
    asins.forEach(function(asin) { results[asin] = {}; });

    // Lancer les 4 lookups en parallele
    var promises = Object.keys(domains).map(function(market) {
        var domain = domains[market];
        var url = 'https://api.keepa.com/product?key=' + settings.keepaApiKey + '&domain=' + domain + '&asin=' + asins.join(',') + '&stats=180&fbafees=1';

        return fetch(url).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            if (data.products) {
                data.products.forEach(function(p) {
                    var parsed = parseKeepaProduct(p);
                    if (parsed && parsed.price > 0) {
                        results[p.asin][market] = parsed;
                    }
                });
            }
            console.log('[DealScanner] Multi-MKT ' + market.toUpperCase() + ': ' + (data.products ? data.products.length : 0) + ' produits, tokens=' + data.tokensLeft);
            return { market: market, tokensLeft: data.tokensLeft };
        }).catch(function(e) {
            console.warn('[DealScanner] Multi-MKT ' + market.toUpperCase() + ' erreur:', e.message);
            return { market: market, error: e.message };
        });
    });

    await Promise.all(promises);

    // Determiner le meilleur marche pour chaque ASIN
    asins.forEach(function(asin) {
        var r = results[asin];
        var bestMarket = null;
        var bestProfit = -Infinity;
        Object.keys(r).forEach(function(mkt) {
            if (r[mkt] && r[mkt].price > 0) {
                // On ne peut pas calculer le profit ici sans le deal, mais on peut comparer les prix
                if (r[mkt].price > bestProfit) {
                    bestProfit = r[mkt].price;
                    bestMarket = mkt;
                }
            }
        });
        r.best = bestMarket;
    });

    return results;
}

function calculateBestMarketplace(deal, multiData) {
    if (!multiData) return null;

    var settings = loadOASettings();
    var bestMarket = null;
    var bestProfit = -Infinity;
    var marketResults = {};

    Object.keys(KEEPA_DOMAINS).forEach(function(mkt) {
        var mktData = multiData[mkt];
        if (!mktData || !mktData.price || mktData.price <= 0) return;

        var profitResult = calculateDealProfit(deal, mktData);
        marketResults[mkt] = {
            price: mktData.price,
            profit: profitResult.profit,
            roi: profitResult.roi,
            fees: profitResult.fees
        };

        if (profitResult.profit > bestProfit) {
            bestProfit = profitResult.profit;
            bestMarket = mkt;
        }
    });

    return {
        best: bestMarket,
        markets: marketResults
    };
}

// ===========================
// FEATURE 4 — NOTIFICATIONS
// ===========================

async function sendDealNotifications(newProfitableDeals) {
    if (!newProfitableDeals || newProfitableDeals.length === 0) return;

    var settings = loadOASettings();

    // Tous les deals avec profit > 0 sont notifies
    var notifiable = newProfitableDeals;

    console.log('[DealScanner] ' + notifiable.length + ' deals a notifier (profit > 0)');

    for (var i = 0; i < notifiable.length; i++) {
        var deal = notifiable[i];
        var msg = dealNotificationMessage(deal);

        // Notification navigateur
        sendBrowserNotification(deal);

        // Telegram
        if (settings.telegramBotToken && settings.telegramChatId) {
            await sendTelegramNotification(settings, msg.telegram);
        }

        // EmailJS
        if (settings.emailjsServiceId && settings.emailjsTemplateId && settings.emailjsPublicKey) {
            await sendEmailNotification(settings, deal);
        }
    }
}

function dealNotificationMessage(deal) {
    var bestMkt = '';
    if (deal.multiMarket && deal.multiMarket.best) {
        bestMkt = ' (' + deal.multiMarket.best.toUpperCase() + ')';
    }
    var profitStr = deal.profit > 0 ? '+' + deal.profit.toFixed(2) + '€' : deal.profit.toFixed(2) + '€';
    var roiStr = deal.roi ? deal.roi.toFixed(0) + '%' : '';

    return {
        title: 'Deal rentable' + bestMkt,
        body: deal.title.substring(0, 60) + '\n' + deal.price.toFixed(2) + '€ → ' + profitStr + ' (' + roiStr + ' ROI)',
        telegram: '🔔 *Deal rentable' + bestMkt + '*\n\n'
            + '📦 ' + deal.title.substring(0, 80) + '\n'
            + '💰 Prix: ' + deal.price.toFixed(2) + '€'
            + (deal.amazonPrice ? ' → Amazon: ' + deal.amazonPrice.toFixed(2) + '€' : '') + '\n'
            + '✅ Profit: ' + profitStr + ' (ROI ' + roiStr + ')\n'
            + (deal.merchant ? '🏪 ' + deal.merchant : '') + '\n'
            + (deal.asin ? '🔗 ASIN: ' + deal.asin : '') + '\n\n'
            + '[Voir le deal](' + deal.link + ')'
    };
}

function sendBrowserNotification(deal) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var msg = dealNotificationMessage(deal);
    try {
        var notif = new Notification(msg.title, {
            body: msg.body,
            icon: deal.image || undefined,
            tag: 'deal-' + (deal.asin || deal.link),
            requireInteraction: true
        });
        notif.onclick = function() {
            window.focus();
            notif.close();
        };
    } catch (e) {
        console.warn('[DealScanner] Erreur notification browser:', e);
    }
}

async function sendTelegramNotification(settings, messageText) {
    var url = 'https://api.telegram.org/bot' + settings.telegramBotToken + '/sendMessage';
    try {
        var resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: settings.telegramChatId,
                text: messageText,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            })
        });
        var data = await resp.json();
        if (data.ok) {
            console.log('[DealScanner] Telegram envoye OK');
        } else {
            console.warn('[DealScanner] Telegram erreur:', data.description);
        }
    } catch (e) {
        console.warn('[DealScanner] Telegram erreur:', e.message);
    }
}

async function sendEmailNotification(settings, deal) {
    if (typeof emailjs === 'undefined') {
        console.warn('[DealScanner] EmailJS non charge (ajouter le script)');
        return;
    }
    try {
        var profitStr = deal.profit > 0 ? '+' + deal.profit.toFixed(2) + '€' : deal.profit.toFixed(2) + '€';
        await emailjs.send(settings.emailjsServiceId, settings.emailjsTemplateId, {
            deal_title: deal.title,
            deal_price: deal.price.toFixed(2) + '€',
            deal_profit: profitStr,
            deal_roi: (deal.roi || 0).toFixed(0) + '%',
            deal_link: deal.link,
            deal_asin: deal.asin || 'N/A',
            deal_merchant: deal.merchant || 'N/A',
            deal_amazon_price: deal.amazonPrice ? deal.amazonPrice.toFixed(2) + '€' : 'N/A'
        }, settings.emailjsPublicKey);
        console.log('[DealScanner] Email envoye OK');
    } catch (e) {
        console.warn('[DealScanner] EmailJS erreur:', e);
    }
}

function initOA() {
    console.log('[OA] Initialisation du module OA Scanner...');

    // Charger l'inventaire depuis localStorage
    loadOAInventory();

    // Restaurer les resultats du dernier scan
    loadScanResults();

    // Charger les caches Keepa pour le Deal Scanner
    loadKeepaCache();
    loadSearchCache();

    // Charger l'historique des deals
    loadDealHistory();

    // Mettre a jour le dashboard charges fixes
    updateFixedChargesDashboard();

    // Mettre a jour les labels marketplace (direction source/dest)
    updateMarketplaceLabels();

    // Drag & drop gere par les handlers inline dans le HTML (ondragover, ondragleave, ondrop)


    console.log('[OA] Module OA Scanner initialise.');

    // Chargement automatique des deals a l'ouverture
    fetchDeals();
}

// Lancer l'initialisation quand le DOM est pret
// Note: switchMode() et initMode() sont dans app.js
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOA);
} else {
    initOA();
}
