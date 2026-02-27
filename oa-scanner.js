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
    // Frais Amazon
    commissionPct: 15,
    fbaFee: 5.00,
    storageFee: 26.00,

    // Couts utilisateur
    inboundShipping: 1.50,
    prepCost: 0.30,
    urssafPct: 12.3,
    toolAmortization: 0.70,

    // Criteres de selection
    minProfit: 4.00,
    minROI: 30,
    maxBSR: 50000,
    maxFBASellers: 5,
    amazonSells: false,

    // Capital
    capitalTotal: 755,
    maxPerProduct: 50,
    maxUnitsFirstBuy: 2
};

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
        { id: 'oa-toolAmortization', key: 'toolAmortization', type: 'float' },
        { id: 'oa-minProfit', key: 'minProfit', type: 'float' },
        { id: 'oa-minROI', key: 'minROI', type: 'float' },
        { id: 'oa-maxBSR', key: 'maxBSR', type: 'int' },
        { id: 'oa-maxFBASellers', key: 'maxFBASellers', type: 'int' },
        { id: 'oa-amazonSells', key: 'amazonSells', type: 'bool' },
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
        { id: 'oa-toolAmortization', key: 'toolAmortization' },
        { id: 'oa-minProfit', key: 'minProfit' },
        { id: 'oa-minROI', key: 'minROI' },
        { id: 'oa-maxBSR', key: 'maxBSR' },
        { id: 'oa-maxFBASellers', key: 'maxFBASellers' },
        { id: 'oa-amazonSells', key: 'amazonSells' },
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
        } else if (marketplace === 'fr') {
            oaDataFR = data;
            updateCSVStatus('fr', file.name, data.length);
            console.log('[OA] CSV FR charge:', data.length, 'produits');
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

    // Mapper les colonnes Keepa (recherche flexible)
    const colASIN = findColumn(headerMap, ['asin']);
    const colTitle = findColumn(headerMap, ['title', 'titre', 'product name', 'nom']);
    const colBSR = findColumn(headerMap, ['sales rank: current', 'sales rank current', 'salesrank', 'sales rank', 'bsr']);
    const colBSR90 = findColumn(headerMap, ['sales rank: 90 days avg', 'sales rank 90 days avg', 'sales rank: 90']);
    const colBuyBox = findColumn(headerMap, ['buy box: current', 'buy box current', 'buybox', 'buy box']);
    const colNewOffers = findColumn(headerMap, ['new offer count: current', 'new offer count current', 'new offer count', 'new offers', 'count of retrieved live offers: new, fba']);
    const colAmazonPrice = findColumn(headerMap, ['amazon: current', 'amazon current', 'amazon']);
    const colCategory = findColumn(headerMap, ['categories: root', 'categories root', 'category', 'categories']);
    const colNewPrice = findColumn(headerMap, ['new: current', 'new current', 'new price', 'new']);
    const colEstSales = findColumn(headerMap, ['estimated sales', 'est. sales', 'sales estimate', 'estimated monthly sales']);

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

        products.push({
            asin: asin,
            title: getVal(values, colTitle, 'Sans titre').trim(),
            price: price,
            bsr: bsr,
            bsr90: bsr90,
            amazonPrice: amazonPrice,
            amazonSells: amazonPrice > 0,
            fbaSellers: fbaSellers,
            category: getVal(values, colCategory, '').trim(),
            estSales: estSales
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
            merged.push({
                asin: pDE.asin,
                title: pDE.title || pFR.title,
                pricDE: pDE.price,
                pricFR: pFR.price,
                bsr: pDE.bsr || pFR.bsr,
                bsr90: pDE.bsr90 || pFR.bsr90,
                amazonSells: pDE.amazonSells,
                amazonPriceDE: pDE.amazonPrice,
                fbaSellers: pDE.fbaSellers,
                category: pDE.category || pFR.category,
                estSales: pDE.estSales || pFR.estSales,
                profit: 0,
                roi: 0
            });
        }
    });

    console.log('[OA] Fusion: ' + merged.length + ' produits en commun sur ' + dataDE.length + ' DE / ' + dataFR.length + ' FR');
    return merged;
}

function calculateProfit(product, settings) {
    const commission = product.pricDE * (settings.commissionPct / 100);
    const totalFees = commission + settings.fbaFee + settings.inboundShipping + settings.prepCost + settings.toolAmortization;
    const urssaf = product.pricDE * (settings.urssafPct / 100);
    const profit = product.pricDE - totalFees - urssaf - product.pricFR;
    const roi = product.pricFR > 0 ? (profit / product.pricFR) * 100 : 0;

    product.profit = Math.round(profit * 100) / 100;
    product.roi = Math.round(roi * 100) / 100;
    product.commission = Math.round(commission * 100) / 100;
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
        return true;
    });
}

function sortProducts(products) {
    return products.sort((a, b) => b.profit - a.profit);
}

function runScan() {
    console.log('[OA] Lancement du scan...');
    const settings = loadOASettings();

    if (oaDataDE.length === 0 || oaDataFR.length === 0) {
        showOANotification('Veuillez importer les 2 CSV (DE et FR) avant de lancer le scan', 'error');
        return;
    }

    // Fusionner
    let products = mergeData(oaDataDE, oaDataFR);

    // Calculer profits
    products = products.map(p => calculateProfit(p, settings));

    // Filtrer
    products = filterProducts(products, settings);

    // Trier
    products = sortProducts(products);

    oaScanResults = products;

    console.log('[OA] Scan termine: ' + products.length + ' produits trouves');
    renderScanResults(products);
    showOANotification(products.length + ' produits trouves !', 'success');
}

function renderScanResults(products) {
    const container = document.getElementById('oa-scan-results');
    if (!container) return;

    if (products.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-400">' +
            '<i class="fas fa-search fa-3x mb-4"></i>' +
            '<p>Aucun produit ne correspond aux criteres.</p>' +
            '<p class="text-sm mt-2">Essayez d\'ajuster vos parametres de filtrage.</p></div>';
        return;
    }

    let html = '<div class="overflow-x-auto">';
    html += '<table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-400 border-b border-gray-700">';
    html += '<th class="pb-3 pr-4">#</th>';
    html += '<th class="pb-3 pr-4">Produit</th>';
    html += '<th class="pb-3 pr-4 text-right">Prix FR</th>';
    html += '<th class="pb-3 pr-4 text-right">Prix DE</th>';
    html += '<th class="pb-3 pr-4 text-right">Profit</th>';
    html += '<th class="pb-3 pr-4 text-right">ROI</th>';
    html += '<th class="pb-3 pr-4 text-right">BSR</th>';
    html += '<th class="pb-3 pr-4 text-right">Vendeurs FBA</th>';
    html += '<th class="pb-3 pr-4 text-center">Action</th>';
    html += '</tr></thead><tbody>';

    products.forEach((p, i) => {
        const profitClass = p.profit >= 5 ? 'text-green-400' : (p.profit >= 3 ? 'text-yellow-400' : 'text-orange-400');
        const roiClass = p.roi >= 50 ? 'text-green-400' : (p.roi >= 30 ? 'text-yellow-400' : 'text-orange-400');
        const titleShort = p.title.length > 50 ? p.title.substring(0, 50) + '...' : p.title;

        html += '<tr class="border-b border-gray-800 hover:bg-gray-800/50">';
        html += '<td class="py-3 pr-4 text-gray-500">' + (i + 1) + '</td>';
        html += '<td class="py-3 pr-4">';
        html += '<div class="font-medium text-white">' + escapeHTML(titleShort) + '</div>';
        html += '<div class="text-xs text-gray-500">' + p.asin + '</div></td>';
        html += '<td class="py-3 pr-4 text-right text-blue-400">' + p.pricFR.toFixed(2) + ' &euro;</td>';
        html += '<td class="py-3 pr-4 text-right text-purple-400">' + p.pricDE.toFixed(2) + ' &euro;</td>';
        html += '<td class="py-3 pr-4 text-right font-bold ' + profitClass + '">' + p.profit.toFixed(2) + ' &euro;</td>';
        html += '<td class="py-3 pr-4 text-right font-bold ' + roiClass + '">' + p.roi.toFixed(0) + '%</td>';
        html += '<td class="py-3 pr-4 text-right text-gray-300">' + formatNumber(p.bsr) + '</td>';
        html += '<td class="py-3 pr-4 text-right text-gray-300">' + p.fbaSellers + '</td>';
        html += '<td class="py-3 pr-4 text-center">';
        html += '<button onclick="startChecklist(' + i + ')" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs">';
        html += '<i class="fas fa-clipboard-check mr-1"></i>Verifier</button></td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Resume en haut
    const avgProfit = products.reduce((s, p) => s + p.profit, 0) / products.length;
    const avgROI = products.reduce((s, p) => s + p.roi, 0) / products.length;

    let summary = '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">';
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-white">' + products.length + '</div>';
    summary += '<div class="text-xs text-gray-400">Produits trouves</div></div>';
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-green-400">' + avgProfit.toFixed(2) + ' &euro;</div>';
    summary += '<div class="text-xs text-gray-400">Profit moyen</div></div>';
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-blue-400">' + avgROI.toFixed(0) + '%</div>';
    summary += '<div class="text-xs text-gray-400">ROI moyen</div></div>';
    summary += '<div class="bg-gray-800 rounded-lg p-4 text-center">';
    summary += '<div class="text-2xl font-bold text-purple-400">' + products[0].profit.toFixed(2) + ' &euro;</div>';
    summary += '<div class="text-xs text-gray-400">Meilleur profit</div></div>';
    summary += '</div>';

    container.innerHTML = summary + html;
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

    const commission = pricDE * (settings.commissionPct / 100);
    const totalFees = commission + settings.fbaFee + settings.inboundShipping + settings.prepCost + settings.toolAmortization;
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

    const inventoryItem = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        asin: product.asin,
        title: product.title,
        pricFR: costPerUnit,
        pricDE: product.realPricDE || product.pricDE,
        quantity: quantity,
        costPerUnit: costPerUnit,
        totalCost: totalCost,
        expectedProfit: (product.realPricDE || product.pricDE) > 0 ? recalculateWithRealPrices().profit * quantity : product.profit * quantity,
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
    const commission = actualSalePrice * (settings.commissionPct / 100);
    const totalFees = commission + settings.fbaFee;
    const urssaf = actualSalePrice * (settings.urssafPct / 100);
    const realProfit = (actualSalePrice - totalFees - urssaf - product.costPerUnit) * product.quantity;

    product.status = 'vendu';
    product.actualSalePrice = actualSalePrice;
    product.realProfit = Math.round(realProfit * 100) / 100;
    product.dateUpdated = new Date().toISOString();

    saveOAInventory();
    renderInventory();
    console.log('[OA] Produit vendu:', productId, 'profit reel:', product.realProfit);
    showOANotification('Vente enregistree ! Profit reel: ' + product.realProfit.toFixed(2) + ' EUR', 'success');
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
        if (p.status === 'vendu' && p.actualSalePrice > 0) {
            const saleSettings = loadOASettings();
            const commission = p.actualSalePrice * (saleSettings.commissionPct / 100);
            const fbaFee = saleSettings.fbaFee;
            const revenue = (p.actualSalePrice - commission - fbaFee) * p.quantity;
            recovered += revenue;
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

    // Capital tracker
    const usedPct = cap.total > 0 ? Math.min(100, (cap.spent / cap.total) * 100) : 0;
    const recoveredPct = cap.total > 0 ? Math.min(100, (cap.recovered / cap.total) * 100) : 0;

    html += '<div class="bg-gray-800 rounded-lg p-4 mb-6">';
    html += '<h3 class="text-lg font-bold text-white mb-3"><i class="fas fa-wallet mr-2 text-yellow-400"></i>Capital</h3>';
    html += '<div class="grid grid-cols-4 gap-4 mb-3">';
    html += '<div class="text-center"><div class="text-lg font-bold text-white">' + cap.total.toFixed(2) + ' &euro;</div><div class="text-xs text-gray-400">Initial</div></div>';
    html += '<div class="text-center"><div class="text-lg font-bold text-red-400">' + cap.spent.toFixed(2) + ' &euro;</div><div class="text-xs text-gray-400">Investi</div></div>';
    html += '<div class="text-center"><div class="text-lg font-bold text-green-400">' + cap.recovered.toFixed(2) + ' &euro;</div><div class="text-xs text-gray-400">Recupere</div></div>';
    html += '<div class="text-center"><div class="text-lg font-bold text-blue-400">' + cap.available.toFixed(2) + ' &euro;</div><div class="text-xs text-gray-400">Disponible</div></div>';
    html += '</div>';

    // Barre de progression
    html += '<div class="w-full bg-gray-700 rounded-full h-3 overflow-hidden">';
    html += '<div class="h-full flex">';
    html += '<div class="bg-red-500 h-full" style="width:' + usedPct + '%"></div>';
    html += '<div class="bg-green-500 h-full" style="width:' + recoveredPct + '%"></div>';
    html += '</div></div>';
    html += '<div class="flex justify-between text-xs text-gray-500 mt-1">';
    html += '<span>Investi: ' + usedPct.toFixed(0) + '%</span>';
    html += '<span>Recupere: ' + recoveredPct.toFixed(0) + '%</span>';
    html += '</div></div>';

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

function showOASection(sectionName) {
    // Utilise la fonction showSection existante de app.js
    if (typeof showSection === 'function') {
        // Simuler un event pour showSection
        showSection(sectionName);
    }
}

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

    // Attacher drag & drop sur les zones CSV
    ['csv-zone-de', 'csv-zone-fr'].forEach(zoneId => {
        const zone = document.getElementById(zoneId);
        if (!zone) return;
        const marketplace = zoneId.includes('-de') ? 'de' : 'fr';

        zone.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.add('border-indigo-400', 'bg-indigo-50');
        });

        zone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('border-indigo-400', 'bg-indigo-50');
        });

        zone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('border-indigo-400', 'bg-indigo-50');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleCSVImport(e.dataTransfer.files[0], marketplace);
            }
        });
    });

    console.log('[OA] Module OA Scanner initialise.');
}

// Lancer l'initialisation quand le DOM est pret
// Note: switchMode() et initMode() sont dans app.js
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOA);
} else {
    initOA();
}
