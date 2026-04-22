// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🤖 ONGLET METRO AUTO (Script Undetected ChromeDriver)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var _metroAutoData = [];

/**
 * Charge les produits Metro Auto depuis Supabase (source=SCRIPT_UNDETECTED)
 */
function loadMetroAutoData() {
    var sb = _getOAClient();
    if (!sb) return;

    console.log('[Metro Auto] Chargement des produits...');

    var dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 30);

    sb.from('grossiste_products')
        .select('*')
        .eq('source', 'SCRIPT_UNDETECTED')  // FILTRE PAR SOURCE
        .gte('analyzed_at', dateLimit.toISOString())
        .order('analyzed_at', { ascending: false })
        .then(function(res) {
            if (res.error) {
                console.error('[Metro Auto] Erreur:', res.error);
                _showMetroAutoError('Erreur: ' + res.error.message);
                return;
            }

            _metroAutoData = res.data || [];
            console.log('[Metro Auto] Chargé:', _metroAutoData.length, 'produits');

            renderMetroAutoTab();
        })
        .catch(function(err) {
            console.error('[Metro Auto] Erreur:', err);
            _showMetroAutoError('Erreur connexion Supabase');
        });
}

/**
 * Rend le tableau Metro Auto
 */
function renderMetroAutoTab() {
    if (!_metroAutoData.length) {
        _showMetroAutoEmpty();
        return;
    }

    var filtered = _applyMetroAutoFilters(_metroAutoData);
    _updateMetroAutoStats(filtered);

    var tbody = document.getElementById('metro-auto-tbody');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="13" class="p-10 text-center text-gray-400">'
            + '<p class="font-medium">Aucun produit ne correspond aux filtres</p></td></tr>';
        return;
    }

    var html = '';

    filtered.forEach(function(p) {
        // Badge statut
        var statusBadge = '';
        var status = (p.analysis_status || 'ANALYZED').toUpperCase();
        if (status === 'SCRAPED') {
            statusBadge = '<span class="inline-block px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-semibold rounded">🟡 En attente</span>';
        } else if (status === 'ANALYZING') {
            statusBadge = '<span class="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">🔵 Analyse...</span>';
        } else if (status === 'ANALYZED') {
            statusBadge = '<span class="inline-block px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded">✅ Analysé</span>';
        } else if (status === 'ERROR') {
            statusBadge = '<span class="inline-block px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">❌ Erreur</span>';
        }

        // Confiance matching
        var confidence = p.matching_confidence || 0;
        var confidenceClass = confidence >= 0.9 ? 'text-green-600' : confidence >= 0.75 ? 'text-yellow-600' : 'text-red-500';
        var confidenceBadge = '<span class="' + confidenceClass + ' font-semibold">' + Math.round(confidence * 100) + '%</span>';

        // Profit & ROI
        var profit = p.profit_net || 0;
        var profitClass = profit > 0 ? 'text-green-600 font-bold' : 'text-red-500';
        var profitText = (profit > 0 ? '+' : '') + profit.toFixed(2) + '€';

        var roi = p.roi || 0;
        var roiClass = roi > 20 ? 'text-green-600 font-bold' : roi > 10 ? 'text-yellow-600' : 'text-gray-500';
        var roiText = roi.toFixed(0) + '%';

        // Score
        var scoreClass = p.score >= 100 ? 'bg-green-100 text-green-700'
                       : p.score >= 80 ? 'bg-blue-100 text-blue-700'
                       : p.score >= 50 ? 'bg-yellow-100 text-yellow-700'
                       : 'bg-gray-100 text-gray-600';
        var scoreBadge = '<span class="inline-block px-2 py-1 rounded text-xs font-bold ' + scoreClass + '">' + (p.score || 0) + '</span>';

        // Actions
        var actionsHtml = '';
        if (p.url_grossiste) {
            actionsHtml += '<a href="' + p.url_grossiste + '" target="_blank" class="text-indigo-600 hover:underline text-xs mr-2">🛒 Metro</a>';
        }
        if (p.asin) {
            actionsHtml += '<a href="https://amazon.fr/dp/' + p.asin + '" target="_blank" class="text-gray-500 hover:underline text-xs">Amazon</a>';
        }

        html += '<tr class="border-b border-gray-100 hover:bg-gray-50">';
        html += '<td class="p-3">' + statusBadge + '</td>';
        html += '<td class="p-3"><span class="font-semibold text-gray-700 text-xs">' + (p.brand || '—') + '</span></td>';
        html += '<td class="p-3 text-gray-700 max-w-xs truncate" title="' + (p.product_name || '') + '">' + (p.product_name || '—').substring(0, 50) + '</td>';
        html += '<td class="p-3 text-center"><a href="https://amazon.fr/dp/' + (p.asin || '') + '" target="_blank" class="text-indigo-600 hover:underline text-xs font-mono">' + (p.asin || '—') + '</a></td>';
        html += '<td class="p-3 text-center">' + confidenceBadge + '</td>';
        html += '<td class="p-3 text-center font-semibold text-blue-600">' + (p.price_grossiste ? p.price_grossiste.toFixed(2) + '€' : '—') + '</td>';
        html += '<td class="p-3 text-center font-semibold">' + (p.max_cost ? p.max_cost.toFixed(2) + '€' : '—') + '</td>';
        html += '<td class="p-3 text-center ' + profitClass + '">' + profitText + '</td>';
        html += '<td class="p-3 text-center ' + roiClass + '">' + roiText + '</td>';
        html += '<td class="p-3 text-center text-sm">' + (p.fba_sellers || '—') + '</td>';
        html += '<td class="p-3 text-center text-sm">' + (p.bsr ? p.bsr.toLocaleString() : '—') + '</td>';
        html += '<td class="p-3 text-center">' + scoreBadge + '</td>';
        html += '<td class="p-3 text-center text-sm">' + actionsHtml + '</td>';
        html += '</tr>';
    });

    tbody.innerHTML = html;

    var label = document.getElementById('metro-auto-count-label');
    if (label) {
        label.textContent = filtered.length + ' produit' + (filtered.length > 1 ? 's' : '');
    }
}

/**
 * Applique les filtres
 */
function _applyMetroAutoFilters(data) {
    var status = document.getElementById('metro-auto-filter-status');
    var brand = document.getElementById('metro-auto-filter-brand');
    var roiMin = document.getElementById('metro-auto-filter-roi');

    var filtered = data;

    if (status && status.value) {
        filtered = filtered.filter(function(p) {
            return (p.analysis_status || 'ANALYZED').toUpperCase() === status.value;
        });
    }

    if (brand && brand.value) {
        filtered = filtered.filter(function(p) {
            return p.brand === brand.value;
        });
    }

    if (roiMin && roiMin.value) {
        var minRoi = parseFloat(roiMin.value);
        filtered = filtered.filter(function(p) {
            return (p.roi || 0) >= minRoi;
        });
    }

    return filtered;
}

/**
 * Update stats
 */
function _updateMetroAutoStats(data) {
    var total = data.length;
    var scraped = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'SCRAPED'; }).length;
    var analyzing = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'ANALYZING'; }).length;
    var analyzed = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'ANALYZED'; }).length;
    var errors = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'ERROR'; }).length;
    var profitable = data.filter(function(p) { return (p.profit_net || 0) > 0; }).length;

    document.getElementById('metro-auto-stat-total').textContent = total;
    document.getElementById('metro-auto-stat-scraped').textContent = scraped;
    document.getElementById('metro-auto-stat-analyzing').textContent = analyzing;
    document.getElementById('metro-auto-stat-analyzed').textContent = analyzed;
    document.getElementById('metro-auto-stat-errors').textContent = errors;
    document.getElementById('metro-auto-stat-profitable').textContent = profitable;
}

/**
 * Affiche erreur
 */
function _showMetroAutoError(msg) {
    var tbody = document.getElementById('metro-auto-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="13" class="p-10 text-center text-red-400">'
            + '<i class="fas fa-exclamation-triangle text-3xl mb-3 block"></i>'
            + '<p class="font-medium">' + msg + '</p></td></tr>';
    }
}

/**
 * Affiche vide
 */
function _showMetroAutoEmpty() {
    var tbody = document.getElementById('metro-auto-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="13" class="p-10 text-center text-gray-400">'
            + '<i class="fas fa-robot text-3xl mb-3 block text-gray-300"></i>'
            + '<p class="font-medium">Aucun produit auto-scrapé</p>'
            + '<p class="text-xs mt-2">Lance: <code class="bg-gray-100 px-2 py-1 rounded">python metro_scraper.py --brand "Oral-B"</code></p>'
            + '</td></tr>';
    }

    document.getElementById('metro-auto-stat-total').textContent = '0';
    document.getElementById('metro-auto-stat-scraped').textContent = '0';
    document.getElementById('metro-auto-stat-analyzing').textContent = '0';
    document.getElementById('metro-auto-stat-analyzed').textContent = '0';
    document.getElementById('metro-auto-stat-errors').textContent = '0';
    document.getElementById('metro-auto-stat-profitable').textContent = '0';
}
