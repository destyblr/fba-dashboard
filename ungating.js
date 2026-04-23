// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 ONGLET UNGATING (Tracking marques débloquées)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var _unlockedBrands = [];  // Liste des marques débloquées
var BUDGET_UNGATING_MAX = 200;  // Budget max ungating (en €)

/**
 * Charge les marques débloquées depuis Supabase
 */
function loadUnlockedBrands() {
    var sb = _getOAClient();
    if (!sb) return;

    console.log('[Ungating] Chargement marques débloquées...');

    sb.from('unlocked_brands')
        .select('*')
        .order('unlocked_at', { ascending: false })
        .then(function(res) {
            if (res.error) {
                console.error('[Ungating] Erreur:', res.error);
                return;
            }

            _unlockedBrands = res.data || [];
            console.log('[Ungating] Chargé:', _unlockedBrands.length, 'marques');

            renderUngatingTab();
        })
        .catch(function(err) {
            console.error('[Ungating] Erreur:', err);
        });
}

/**
 * Vérifie si une marque est déjà débloquée
 */
function estMarqueDebloquee(brand) {
    if (!brand) return false;
    return _unlockedBrands.some(function(ub) {
        return ub.brand.toLowerCase() === brand.toLowerCase();
    });
}

/**
 * Marque une marque comme débloquée
 */
function markBrandAsUnlocked(productData) {
    var sb = _getOAClient();
    if (!sb) return;

    var prixMetro = productData.price_grossiste || 0;
    var salePrice = productData.sale_price || 0;
    var fees = productData.total_fees || 0;
    var breakeven = salePrice - fees;
    var unitLoss = prixMetro - breakeven;
    var totalCost = unitLoss * 10;

    var data = {
        brand: productData.brand,
        product_used: productData.product_name,
        asin_used: productData.asin,
        product_id: productData.id,
        metro_price: prixMetro,
        breakeven_price: breakeven,
        unit_loss: unitLoss,
        total_cost: totalCost,
        quantity: 10
    };

    sb.from('unlocked_brands')
        .insert(data)
        .then(function(res) {
            if (res.error) {
                console.error('[Ungating] Erreur sauvegarde:', res.error);
                alert('Erreur: ' + res.error.message);
                return;
            }

            console.log('[Ungating] Marque débloquée:', productData.brand);
            alert('✅ Marque ' + productData.brand + ' marquée comme débloquée !');

            // Recharge les données
            loadUnlockedBrands();
            renderAnalysisTab();
        })
        .catch(function(err) {
            console.error('[Ungating] Erreur:', err);
            alert('Erreur de connexion');
        });
}

/**
 * Affiche modal pour marquer une marque comme débloquée
 */
function showUnlockBrandModal(product) {
    var prixMetro = product.price_grossiste || 0;
    var salePrice = product.sale_price || 0;
    var fees = product.total_fees || 0;
    var breakeven = salePrice - fees;
    var unitLoss = prixMetro - breakeven;
    var totalCost = unitLoss * 10;

    var modal = '<div id="unlock-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;">'
        + '<div style="background:white;padding:30px;border-radius:12px;max-width:500px;width:90%;">'
        + '<h3 class="text-xl font-bold text-gray-800 mb-4">🎯 Marquer marque comme débloquée</h3>'
        + '<div class="mb-4">'
        + '<p class="text-sm text-gray-600 mb-2"><strong>Marque:</strong> ' + product.brand + '</p>'
        + '<p class="text-sm text-gray-600 mb-2"><strong>Produit:</strong> ' + product.product_name + '</p>'
        + '<p class="text-sm text-gray-600 mb-2"><strong>ASIN:</strong> ' + product.asin + '</p>'
        + '<p class="text-sm text-gray-600 mb-2"><strong>Prix Metro:</strong> ' + prixMetro.toFixed(2) + '€</p>'
        + '<p class="text-sm text-gray-600 mb-2"><strong>Breakeven:</strong> ' + breakeven.toFixed(2) + '€</p>'
        + '<p class="text-sm font-bold ' + (totalCost <= 0 && Math.abs(totalCost) <= 30 ? 'text-green-600' : 'text-orange-600') + '"><strong>Coût total (10 unités):</strong> ' + totalCost.toFixed(2) + '€</p>'
        + '</div>'
        + '<div class="flex gap-2 justify-end">'
        + '<button onclick="closeUnlockModal()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Annuler</button>'
        + '<button onclick="confirmUnlockBrand(' + product.id + ')" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">✅ Valider déblocage</button>'
        + '</div>'
        + '</div>'
        + '</div>';

    document.body.insertAdjacentHTML('beforeend', modal);
}

function closeUnlockModal() {
    var modal = document.getElementById('unlock-modal');
    if (modal) modal.remove();
}

function confirmUnlockBrand(productId) {
    var product = _analysisData.find(function(p) { return p.id === productId; });
    if (product) {
        markBrandAsUnlocked(product);
        closeUnlockModal();
    }
}

/**
 * Rend l'onglet Ungating
 */
function renderUngatingTab() {
    console.log('[Ungating] Rendering ungating tab...');

    // Stats
    var totalUnlocked = _unlockedBrands.length;
    var budgetUtilise = _unlockedBrands.reduce(function(sum, ub) {
        return sum + Math.abs(ub.total_cost || 0);
    }, 0);
    var totalUnits = _unlockedBrands.reduce(function(sum, ub) {
        return sum + (ub.quantity || 0);
    }, 0);

    // Compte marques disponibles dans analysis data
    var brandSet = new Set();
    _analysisData.forEach(function(p) {
        if (p.brand && p.asin) brandSet.add(p.brand);
    });
    var marquesDispo = brandSet.size;

    document.getElementById('ungating-stat-unlocked').textContent = totalUnlocked;
    document.getElementById('ungating-stat-budget').textContent = budgetUtilise.toFixed(0) + '€ / ' + BUDGET_UNGATING_MAX + '€';
    document.getElementById('ungating-stat-units').textContent = totalUnits;
    document.getElementById('ungating-stat-available').textContent = marquesDispo;

    // Barre de progression budget
    var budgetPercent = (budgetUtilise / BUDGET_UNGATING_MAX) * 100;
    var progressBar = document.getElementById('ungating-budget-progress');
    if (progressBar) {
        progressBar.style.width = Math.min(budgetPercent, 100) + '%';
        progressBar.className = 'h-full rounded-full transition-all ' +
            (budgetPercent < 50 ? 'bg-green-500' : budgetPercent < 80 ? 'bg-yellow-500' : 'bg-red-500');
    }

    // Tableau marques débloquées
    renderUnlockedBrandsTable();

    // Recommandations
    renderUngatingRecommendations();
}

/**
 * Tableau marques débloquées
 */
function renderUnlockedBrandsTable() {
    var tbody = document.getElementById('unlocked-brands-tbody');
    if (!tbody) return;

    if (!_unlockedBrands.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-gray-400">'
            + '<p class="font-medium">Aucune marque débloquée</p>'
            + '<p class="text-xs mt-2">Commence par acheter des produits pour ungating</p>'
            + '</td></tr>';
        return;
    }

    var html = '';
    _unlockedBrands.forEach(function(ub) {
        var date = new Date(ub.unlocked_at).toLocaleDateString('fr-FR');
        var cost = ub.total_cost || 0;
        var costClass = Math.abs(cost) <= 30 ? 'text-green-600 font-bold' : 'text-orange-600';

        html += '<tr class="border-b border-gray-100 hover:bg-gray-50">';
        html += '<td class="p-3 text-xs text-gray-500">' + date + '</td>';
        html += '<td class="p-3 font-bold text-gray-800">' + ub.brand + '</td>';
        html += '<td class="p-3 text-sm text-gray-600" title="' + (ub.product_used || '') + '">' + (ub.product_used || '—').substring(0, 40) + '...</td>';
        html += '<td class="p-3 text-center"><span class="' + costClass + '">' + cost.toFixed(2) + '€</span></td>';
        html += '<td class="p-3 text-center text-sm text-gray-600">' + (ub.asin_used || '—') + '</td>';
        html += '<td class="p-3 text-center">';
        if (ub.asin_used) {
            html += '<a href="https://www.amazon.fr/dp/' + ub.asin_used + '" target="_blank" class="text-blue-600 hover:underline text-xs">📦 Voir</a>';
        }
        html += '</td>';
        html += '</tr>';
    });

    tbody.innerHTML = html;
}

/**
 * Recommandations ungating
 */
function renderUngatingRecommendations() {
    var container = document.getElementById('ungating-recommendations');
    if (!container) return;

    // Filtre produits éligibles ungating (perte ≤30€, ASIN trouvé, marque pas débloquée)
    var eligible = _analysisData.filter(function(p) {
        if (!p.asin || !p.brand) return false;
        if (estMarqueDebloquee(p.brand)) return false;

        var prixMetro = p.price_grossiste || 0;
        var salePrice = p.sale_price || 0;
        var fees = p.total_fees || 0;
        if (salePrice === 0 || fees === 0 || prixMetro === 0) return false;

        var breakeven = salePrice - fees;
        var unitLoss = prixMetro - breakeven;
        var totalCost = unitLoss * 10;

        return totalCost < 0 && Math.abs(totalCost) <= 30;
    });

    // Trie par coût croissant (meilleur = moins cher)
    eligible.sort(function(a, b) {
        var costA = Math.abs((a.price_grossiste - (a.sale_price - a.total_fees)) * 10);
        var costB = Math.abs((b.price_grossiste - (b.sale_price - b.total_fees)) * 10);
        return costA - costB;
    });

    if (!eligible.length) {
        container.innerHTML = '<p class="text-gray-400 text-center py-6">Aucune recommandation pour le moment</p>';
        return;
    }

    var html = '<div class="space-y-3">';
    eligible.slice(0, 5).forEach(function(p, idx) {
        var prixMetro = p.price_grossiste || 0;
        var breakeven = (p.sale_price || 0) - (p.total_fees || 0);
        var totalCost = (prixMetro - breakeven) * 10;

        html += '<div class="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition">';
        html += '<div class="flex items-start justify-between">';
        html += '<div class="flex-1">';
        html += '<p class="font-bold text-gray-800">' + (idx + 1) + '. ' + p.brand + ' → <span class="text-green-600">' + totalCost.toFixed(2) + '€</span></p>';
        html += '<p class="text-sm text-gray-600 mt-1">' + p.product_name.substring(0, 60) + '...</p>';
        html += '<p class="text-xs text-gray-500 mt-2">📦 ASIN: ' + p.asin + ' | 🛒 Prix Metro: ' + prixMetro.toFixed(2) + '€</p>';
        html += '</div>';
        html += '<button onclick="showUnlockBrandModal(' + JSON.stringify(p).replace(/"/g, '&quot;') + ')" class="ml-4 px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">🎯 Débloquer</button>';
        html += '</div>';
        html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
}
