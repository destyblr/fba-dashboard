// ===========================
// OA CROSS-BORDER SCANNER
// Nexyla — Amazon FBA Europe
// ===========================

// ===========================
// VARIABLES GLOBALES OA
// ===========================

let oaDataDE = [];          // Donnees CSV Keepa Allemagne
let oaDataFR = [];          // Donnees CSV Keepa France
let oaScanResults = [];     // Resultats du scan filtre
let oaCurrentCheck = null;  // Produit en cours de verification
let oaCurrentCheckIndex = -1; // Index dans oaScanResults
let oaInventory = [];       // Inventaire OA

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

    // Criteres de selection
    minProfit: 5.00,
    minROI: 35,
    maxBSR: 30000,
    maxFBASellers: 5,
    amazonSells: false,
    minPriceDE: 15,
    maxPriceDE: 80,

    // Capital
    capitalTotal: 755,
    maxPerProduct: 40,
    maxUnitsFirstBuy: 2
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
        { id: 'oa-capitalTotal', key: 'capitalTotal', type: 'float' },
        { id: 'oa-maxPerProduct', key: 'maxPerProduct', type: 'float' },
        { id: 'oa-maxUnitsFirstBuy', key: 'maxUnitsFirstBuy', type: 'int' }
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        if (f.type === 'bool') {
            settings[f.key] = el.checked || false;
        } else if (f.type === 'int') {
            settings[f.key] = parseInt(el.value) || 0;
        } else {
            settings[f.key] = parseFloat(el.value) || 0;
        }
    });

    try {
        localStorage.setItem('oaSettings', JSON.stringify(settings));
        console.log('[OA] Parametres sauvegardes:', settings);
        showOANotification('Parametres sauvegardes !', 'success');

        // Auto-refresh : recalculer les resultats si on a des donnees
        if (oaScanResults.length > 0) {
            console.log('[OA] Recalcul avec les nouveaux parametres...');
            oaScanResults.forEach(p => calculateProfit(p, settings));
            oaScanResults = sortProducts(oaScanResults);
            const profitable = filterProducts(oaScanResults, settings);
            renderScanResults(oaScanResults, profitable.length);
            showOANotification('Resultats recalcules avec les nouveaux parametres (' + profitable.length + ' rentables)', 'success');
        }
        updateFixedChargesDashboard();
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
        { id: 'oa-capitalTotal', key: 'capitalTotal' },
        { id: 'oa-maxPerProduct', key: 'maxPerProduct' },
        { id: 'oa-maxUnitsFirstBuy', key: 'maxUnitsFirstBuy' }
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

    console.log('[OA] Parametres initialises');
}

function resetOASettings() {
    if (!confirm('Reinitialiser tous les parametres OA aux valeurs par defaut ?')) return;
    localStorage.removeItem('oaSettings');
    initOASettings();
    showOANotification('Parametres reinitialises aux valeurs par defaut', 'success');
    console.log('[OA] Parametres reinitialises');
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
    const pendingCharges = isCurrentMonth ? fixedMonthly : 0; // charges du mois en cours (pas encore prelevees)

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
            console.log('[OA] CSV DE charge:', data.length, 'produits');
            // Afficher le guide d'extraction ASINs si FR pas encore charge
            if (data.length > 0 && oaDataFR.length === 0) {
                showASINExtractGuide(data.length);
            }
        } else if (marketplace === 'fr') {
            oaDataFR = data;
            updateCSVStatus('fr', file.name, data.length);
            console.log('[OA] CSV FR charge:', data.length, 'produits');
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
        'package: weight (g)', 'emballage: poids (g)', 'package weight'
    ]);
    const colItemWeight = findColumn(headerMap, [
        'item: weight (g)', 'article: poids (g)', 'item weight'
    ]);
    const colPackageDim = findColumn(headerMap, [
        'package: dimension (cm cubed)', 'emballage: dimension (cm cubed)'
    ]);

    // Debug: afficher les colonnes detectees
    console.log('[OA] Colonnes detectees:', {
        ASIN: colASIN, Titre: colTitle, BSR: colBSR, BuyBox: colBuyBox,
        FBASellers: colNewOffers, Amazon: colAmazonPrice, NewPrice: colNewPrice,
        EstSales: colEstSales, BuyBox90: colBuyBox90, BuyBox90Drop: colBuyBox90Drop,
        FBAFee: colFBAFee, ReferralPct: colReferralPct, ReferralAmt: colReferralAmt
    });
    console.log('[OA] Nb headers:', headers.length, '| Premieres colonnes:', headers.slice(0, 5));

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
            weight: weight
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

    const totalFees = commission + fbaFee + inbound + settings.prepCost;
    const urssaf = product.pricDE * (settings.urssafPct / 100);
    const profit = product.pricDE - totalFees - urssaf - product.pricFR;
    const roi = product.pricFR > 0 ? (profit / product.pricFR) * 100 : 0;

    product.profit = Math.round(profit * 100) / 100;
    product.roi = Math.round(roi * 100) / 100;
    product.commission = Math.round(commission * 100) / 100;
    product.fbaFeeUsed = Math.round(fbaFee * 100) / 100;
    product.inboundUsed = Math.round(inbound * 100) / 100;
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
    showOANotification('CSV DE charge ! Copie les ASINs pour les chercher sur Amazon.fr via Keepa Product Viewer.', 'info');
}

// Copier tous les ASINs du CSV DE dans le presse-papier (pour Keepa Product Viewer)
function copyASINsToClipboard() {
    if (oaDataDE.length === 0) {
        showOANotification('Aucun CSV DE charge', 'error');
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

    if (oaDataDE.length === 0 || oaDataFR.length === 0) {
        showOANotification('Veuillez importer les 2 CSV (DE et FR) avant de lancer le scan', 'error');
        return;
    }

    // Construire l'entonnoir de filtrage
    const funnel = [];

    funnel.push({ step: 'CSV DE charges', count: oaDataDE.length, icon: 'file-csv', color: 'gray' });
    funnel.push({ step: 'CSV FR charges', count: oaDataFR.length, icon: 'file-csv', color: 'gray' });

    // Fusionner
    let products = mergeData(oaDataDE, oaDataFR);
    funnel.push({ step: 'ASINs en commun (fusion DE+FR)', count: products.length, icon: 'link', color: 'blue' });

    if (products.length === 0) {
        showOANotification('0 ASINs en commun entre DE et FR. Utilise le bouton "Copier les ASINs" pour chercher les memes produits sur Amazon.fr via Keepa Product Viewer.', 'error');
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
        funnel.push({ step: 'Prix DE ' + settings.minPriceDE + '-' + settings.maxPriceDE + ' \u20ac', count: remaining.length, icon: 'euro-sign', color: 'purple' });
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
    funnel.push({ step: 'Prix DE > Prix FR (ecart positif)', count: remaining.length, icon: 'arrow-up', color: 'green' });

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

    console.log('[OA] Scan termine: ' + finalFiltered.length + ' rentables sur ' + products.length + ' en commun');
    renderScanResults(products, finalFiltered.length, funnel);
    showOANotification(finalFiltered.length + ' produits rentables sur ' + products.length + ' en commun', finalFiltered.length > 0 ? 'success' : 'info');
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

function renderScanResults(products, profitableCount, funnel) {
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
        profitableCount = filterProducts(products, settings).length;
    }

    // === ENTONNOIR DE FILTRAGE ===
    let funnelHtml = '';
    if (funnel && funnel.length > 0) {
        funnelHtml += '<div class="bg-gray-800 rounded-xl p-5 mb-6">';
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
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-white">' + products.length + '</div>';
    summary += '<div class="text-xs text-gray-400">Produits en commun</div></div>';
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold ' + (positiveProfit.length > 0 ? 'text-emerald-400' : 'text-red-400') + '">' + positiveProfit.length + '</div>';
    summary += '<div class="text-xs text-gray-400">Profit positif</div></div>';
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-purple-400">' + bestProfit.toFixed(2) + ' &euro;</div>';
    summary += '<div class="text-xs text-gray-400">Meilleur profit</div></div>';
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold ' + (avgDiff > 0 ? 'text-green-400' : 'text-red-400') + '">' + avgDiff.toFixed(2) + ' &euro;</div>';
    summary += '<div class="text-xs text-gray-400">Ecart moyen DE-FR</div></div>';
    summary += '</div>';

    summary += '<div class="text-sm text-gray-400 mb-4">';
    summary += 'Affichage des <b>200 meilleurs</b> produits tries par profit decroissant';
    summary += '</div>';

    // Tableau — max 200 produits
    const maxDisplay = 200;
    const displayProducts = products.slice(0, maxDisplay);

    let html = '<div class="overflow-x-auto">';
    html += '<table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-400 border-b border-gray-700">';
    html += '<th class="pb-3 pr-4">#</th>';
    html += '<th class="pb-3 pr-4">Produit</th>';
    html += '<th class="pb-3 pr-4 text-right">Prix FR</th>';
    html += '<th class="pb-3 pr-4 text-right">Prix DE</th>';
    html += '<th class="pb-3 pr-4 text-right">Ecart</th>';
    html += '<th class="pb-3 pr-4 text-right cursor-help" title="Deja precis ! Le scanner utilise le vrai montant Keepa par produit (FBA pick&pack). L\'envoi a AMZ est calcule automatiquement selon le poids. Survolez chaque ligne pour voir le detail.">Frais <i class="fas fa-info-circle text-xs opacity-50"></i></th>';
    html += '<th class="pb-3 pr-4 text-right">Profit</th>';
    html += '<th class="pb-3 pr-4 text-right">ROI</th>';
    html += '<th class="pb-3 pr-4 text-right cursor-help" title="Best Sellers Rank : classement des ventes sur Amazon.de. Plus le chiffre est bas, plus le produit se vend. 1-100 = top ventes, 100-1000 = tres populaire, 1000-10000 = bon vendeur, 10000-30000 = ventes regulieres, 30000+ = ventes lentes">BSR <i class="fas fa-info-circle text-xs opacity-50"></i></th>';
    html += '<th class="pb-3 pr-4 text-right cursor-help" title="Nombre de vendeurs FBA (Fulfilled by Amazon) sur cette fiche produit. Moins il y en a, moins il y a de concurrence.">Sellers <i class="fas fa-info-circle text-xs opacity-50"></i></th>';
    html += '<th class="pb-3 pr-4 text-center">Liens</th>';
    html += '<th class="pb-3 pr-4 text-center">Action</th>';
    html += '</tr></thead><tbody>';

    displayProducts.forEach((p, i) => {
        // Couleur de la ligne selon profit
        const rowBg = p.profit >= 5 ? 'bg-green-900/20' :
                      p.profit >= 0 ? 'bg-yellow-900/10' :
                      p.profit >= -2 ? 'bg-orange-900/10' : '';
        const profitClass = p.profit >= 5 ? 'text-green-400' :
                           p.profit >= 0 ? 'text-emerald-300' :
                           p.profit >= -2 ? 'text-yellow-400' : 'text-red-400';
        const roiClass = p.roi >= 35 ? 'text-green-400' :
                        p.roi >= 0 ? 'text-yellow-400' : 'text-red-400';
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
        const feesTooltip = 'Commission: ' + (p.commission || 0).toFixed(2) + '\u20ac (' + (p.referralPct || settings.commissionPct) + '%)'
            + '\nFBA pick&pack: ' + (p.fbaFeeUsed || settings.fbaFee).toFixed(2) + '\u20ac (Keepa)'
            + '\nEnvoi a AMZ: ' + (p.inboundUsed || settings.inboundShipping).toFixed(2) + '\u20ac (auto: ' + inboundTier + ', ' + weightLabel + ')'
            + '\nEtiquetage: ' + settings.prepCost.toFixed(2) + '\u20ac (FNSKU)'
            + '\nURSSAF: ' + (p.urssaf || 0).toFixed(2) + '\u20ac (' + settings.urssafPct + '%)'
            + '\n---------'
            + '\nTotal: ' + totalFeesDisplay.toFixed(2) + '\u20ac';

        html += '<tr class="border-b border-gray-800 hover:bg-gray-800/50 ' + rowBg + '">';
        html += '<td class="py-2 pr-3 text-gray-500 text-xs">' + (i + 1) + '</td>';
        html += '<td class="py-2 pr-3 max-w-xs">';
        if (titleFR) {
            html += '<div class="font-medium text-white text-xs" title="' + escapeHTML(titleFR) + '"><span class="text-blue-400 font-bold mr-1">FR</span>' + escapeHTML(titleMainShort) + '</div>';
        }
        if (titleDE && titleDE !== titleFR) {
            const titleDEShort = titleDE.length > 50 ? titleDE.substring(0, 50) + '...' : titleDE;
            html += '<div class="text-xs text-gray-400 truncate" title="' + escapeHTML(titleDE) + '"><span class="text-purple-400 font-bold mr-1">DE</span>' + escapeHTML(titleDEShort) + '</div>';
        }
        if (!titleFR && titleDE) {
            html += '<div class="font-medium text-white text-xs" title="' + escapeHTML(titleDE) + '"><span class="text-purple-400 font-bold mr-1">DE</span>' + escapeHTML(titleMainShort) + '</div>';
        }
        html += '<div class="text-xs font-mono"><a href="https://www.amazon.fr/dp/' + p.asin + '" target="_blank" class="text-gray-500 hover:text-blue-400">' + p.asin + '</a></div></td>';
        html += '<td class="py-2 pr-3 text-right text-blue-400">' + p.pricFR.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right text-purple-400">' + p.pricDE.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right font-bold ' + ecartClass + '">' + (ecart > 0 ? '+' : '') + ecart.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right text-gray-400 text-xs cursor-help" title="' + escapeHTML(feesTooltip) + '">' + totalFeesDisplay.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right font-bold ' + profitClass + '">' + p.profit.toFixed(2) + '</td>';
        html += '<td class="py-2 pr-3 text-right ' + roiClass + '">' + p.roi.toFixed(0) + '%</td>';
        html += '<td class="py-2 pr-3 text-right text-gray-300 text-xs">' + formatNumber(p.bsr) + '</td>';
        html += '<td class="py-2 pr-3 text-right text-gray-300 text-xs">' + p.fbaSellers + '</td>';

        // Liens Amazon FR + DE
        html += '<td class="py-2 pr-3 text-center whitespace-nowrap">';
        html += '<a href="https://www.amazon.fr/dp/' + p.asin + '" target="_blank" class="text-blue-400 hover:text-blue-300 text-xs mr-2" title="Voir sur Amazon.fr">FR</a>';
        html += '<a href="https://www.amazon.de/dp/' + p.asin + '" target="_blank" class="text-purple-400 hover:text-purple-300 text-xs" title="Voir sur Amazon.de">DE</a>';
        html += '</td>';

        html += '<td class="py-2 pr-3 text-center whitespace-nowrap">';
        if (p.profit > 0) {
            html += '<button onclick="startChecklist(' + i + ')" class="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs">';
            html += '<i class="fas fa-clipboard-check mr-1"></i>Verifier</button>';
        } else if (p.profit > -3) {
            // Presque rentable — Quick Check pour voir si un deal existe
            const searchQuery = encodeURIComponent((titleFR || titleDE).substring(0, 60));
            html += '<a href="https://www.amazon.fr/s?k=' + searchQuery + '" target="_blank" class="bg-yellow-700 hover:bg-yellow-600 text-white px-3 py-1 rounded text-xs inline-block" title="Chercher un deal sur Amazon.fr">';
            html += '<i class="fas fa-search mr-1"></i>Deal?</a>';
        } else {
            html += '<span class="text-gray-600 text-xs" title="Profit trop negatif (' + p.profit.toFixed(2) + '\u20ac)">-</span>';
        }
        html += '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';

    container.innerHTML = funnelHtml + summary + html;
}

// ===========================
// 3. CHECKLIST
// ===========================

function startChecklist(productIndex) {
    if (productIndex < 0 || productIndex >= oaScanResults.length) return;

    oaCurrentCheck = Object.assign({}, oaScanResults[productIndex]);
    oaCurrentCheckIndex = productIndex;
    oaCurrentCheck.steps = [
        { id: 1, label: 'Verifier eligibilite sur Seller Central', status: null, timestamp: null },
        { id: 2, label: 'Verifier le prix de vente reel sur Amazon.de', status: null, timestamp: null, realPrice: null },
        { id: 3, label: 'Verifier les restrictions / avertissements', status: null, timestamp: null },
        { id: 4, label: 'Verifier le prix d\'achat reel sur Amazon.fr', status: null, timestamp: null, realPrice: null },
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
        if (step) step.classList.toggle('opacity-50', i > 1);
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
    // Activer les boutons/inputs de cette etape
    stepEl.querySelectorAll('button, input').forEach(el => el.disabled = false);
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

    // Desactiver les boutons de cette etape
    const stepEl = document.getElementById('check-step-' + step);
    if (stepEl) stepEl.querySelectorAll('button, input').forEach(el => el.disabled = true);

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
        oaCurrentCheck.verdict = 'go';
        console.log('[OA] Verdict: GO !');

        // Recalculer avec les prix reels
        const result = recalculateWithRealPrices();
        const recommendation = getQuantityRecommendation(oaCurrentCheck, loadOASettings());

        // Afficher le verdict GO
        const verdict = document.getElementById('check-verdict');
        const verdictGo = document.getElementById('verdict-go');
        const verdictProfit = document.getElementById('verdict-profit');
        const verdictRoi = document.getElementById('verdict-roi');
        const verdictReco = document.getElementById('verdict-recommendation');

        if (verdict) verdict.classList.remove('hidden');
        if (verdictGo) verdictGo.classList.remove('hidden');
        if (verdictProfit) verdictProfit.textContent = result.profit.toFixed(2) + ' \u20ac';
        if (verdictRoi) verdictRoi.textContent = result.roi.toFixed(0) + ' %';
        if (verdictReco) verdictReco.innerHTML = recommendation.html;

        // Mettre la quantite recommandee dans l'input
        const qtyInput = document.getElementById('verdict-quantity');
        if (qtyInput) qtyInput.value = recommendation.qty;
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
    const totalFees = commission + fbaFee + inbound + settings.prepCost;
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

function getQuantityRecommendation(product, settings) {
    const estSales = product.estSales || 0;

    if (estSales <= 0) {
        return { quantity: settings.maxUnitsFirstBuy, text: 'Ventes estimees inconnues, limiter a ' + settings.maxUnitsFirstBuy + ' unites', scale: '' };
    }

    const estimatedSalesForYou = estSales / (product.fbaSellers + 1);

    if (estimatedSalesForYou < 10) {
        return { quantity: 0, text: 'Trop lent, passe', scale: 'skip' };
    }

    const timeToSell1Unit = 30 / estimatedSalesForYou;

    // Premier achat
    const firstBuyQty = Math.min(2, settings.maxUnitsFirstBuy);
    const costPerUnit = product.realPricFR || product.pricFR;
    const totalCost = firstBuyQty * costPerUnit;

    // Verifier les limites de capital
    if (totalCost > settings.maxPerProduct) {
        const maxQty = Math.floor(settings.maxPerProduct / costPerUnit);
        if (maxQty < 1) {
            return { quantity: 0, text: 'Trop cher pour le budget par produit', scale: 'skip' };
        }
        return { quantity: maxQty, text: maxQty + ' unite(s) (limite budget)', scale: 'limited' };
    }

    const capitalAvailable = calculateCapital().available;
    if (totalCost > capitalAvailable * 0.15) {
        const maxQty = Math.floor((capitalAvailable * 0.15) / costPerUnit);
        if (maxQty < 1) {
            return { quantity: 0, text: 'Capital insuffisant (15% max)', scale: 'skip' };
        }
        return { quantity: Math.min(maxQty, firstBuyQty), text: Math.min(maxQty, firstBuyQty) + ' unite(s) (limite capital)', scale: 'limited' };
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
    const totalFees = commission + fbaFee + inbound + settings.prepCost;
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
        fbaFeeReal: product.fbaFeeReal || 0,
        referralPct: product.referralPct || 0,
        status: 'achete',
        dateAdded: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
        actualSalePrice: null,
        realProfit: null
    };

    addToInventory(inventoryItem);
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
            productDE = { price: fromScan.pricDE, asin: asin, title: fromScan.title, bsr: fromScan.bsr, fbaSellers: fromScan.fbaSellers, estSales: fromScan.estSales, amazonSells: fromScan.amazonSells, fbaFeeReal: fromScan.fbaFeeReal || 0, referralPct: fromScan.referralPct || 0, weight: fromScan.weight || 0, price90avg: 0, price90drop: 0, price90min: 0, price90max: 0 };
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
            stability: calculateStability(productDE),
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

    html += '<div class="grid grid-cols-4 gap-4 mb-4">';
    html += '<div class="text-center"><div class="text-xs text-gray-400">Prix FR (achat)</div><div class="text-xl font-bold text-blue-600">' + product.pricFR.toFixed(2) + ' &euro;</div></div>';
    html += '<div class="text-center"><div class="text-xs text-gray-400">Prix DE (vente)</div><div class="text-xl font-bold text-purple-600">' + product.pricDE.toFixed(2) + ' &euro;</div></div>';
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

function updateProductStatus(productId, newStatus) {
    loadOAInventory();
    const product = oaInventory.find(p => p.id === productId);
    if (!product) return;

    if (newStatus === 'vendu') {
        const priceStr = prompt('Prix de vente reel (en EUR) :');
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
    const totalFees = commission + fbaFee + inbound + settings.prepCost;
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
    const totalFees = commission + fbaFee + inbound + settings.prepCost;
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

            // Badge statut (cliquable)
            html += '<div class="flex items-center gap-2">';
            if (canAdvance) {
                html += '<button onclick="advanceProductStatus(\'' + p.id + '\')" class="' + statusColor + ' text-white px-3 py-1 rounded text-xs font-bold hover:opacity-80 cursor-pointer">';
                html += statusLabel + ' <i class="fas fa-arrow-right ml-1"></i></button>';
            } else {
                html += '<span class="' + statusColor + ' text-white px-3 py-1 rounded text-xs font-bold">' + statusLabel + '</span>';
            }
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

function showOANotification(message, type) {
    // Creer un toast notification
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all duration-300 transform translate-x-full';

    if (type === 'success') {
        toast.classList.add('bg-green-600');
    } else if (type === 'error') {
        toast.classList.add('bg-red-600');
    } else {
        toast.classList.add('bg-blue-600');
    }

    toast.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : (type === 'error' ? 'exclamation-circle' : 'info-circle')) + ' mr-2"></i>' + escapeHTML(message);

    document.body.appendChild(toast);

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

function initOA() {
    console.log('[OA] Initialisation du module OA Scanner...');

    // Charger l'inventaire depuis localStorage
    loadOAInventory();

    // Restaurer les resultats du dernier scan
    loadScanResults();

    // Mettre a jour le dashboard charges fixes
    updateFixedChargesDashboard();

    // Drag & drop gere par les handlers inline dans le HTML (ondragover, ondragleave, ondrop)

    console.log('[OA] Module OA Scanner initialise.');
}

// Lancer l'initialisation quand le DOM est pret
// Note: switchMode() et initMode() sont dans app.js
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOA);
} else {
    initOA();
}
