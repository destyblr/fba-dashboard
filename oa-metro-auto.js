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

    sb.from('grossiste_products')
        .select('*')
        .eq('source', 'SCRIPT_UNDETECTED')  // FILTRE PAR SOURCE
        .order('id', { ascending: false })
        .limit(500)  // Augmente limite pour voir tous les produits
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
 * Remplit le filtre marques
 */
function _populateBrandFilter(data) {
    var brands = new Set();
    data.forEach(function(p) {
        if (p.brand) brands.add(p.brand);
    });

    var select = document.getElementById('metro-auto-filter-brand');
    if (!select) return;

    var currentValue = select.value;
    select.innerHTML = '<option value="">Toutes les marques</option>';

    Array.from(brands).sort().forEach(function(brand) {
        var opt = document.createElement('option');
        opt.value = brand;
        opt.textContent = brand;
        select.appendChild(opt);
    });

    if (currentValue) select.value = currentValue;
}

/**
 * Rend le tableau Metro Auto
 */
function renderMetroAutoTab() {
    console.log('[Metro Auto] renderMetroAutoTab called, data length:', _metroAutoData.length);

    if (!_metroAutoData.length) {
        _showMetroAutoEmpty();
        return;
    }

    // Rempli filtre marques
    _populateBrandFilter(_metroAutoData);

    var filtered = _applyMetroAutoFilters(_metroAutoData);
    console.log('[Metro Auto] After filters, filtered length:', filtered.length);
    _updateMetroAutoStats(filtered);

    var tbody = document.getElementById('metro-auto-tbody');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-gray-400">'
            + '<p class="font-medium">Aucun produit</p></td></tr>';
        return;
    }

    var html = '';

    filtered.forEach(function(p) {
        // Date
        var date = p.analyzed_at ? new Date(p.analyzed_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—';

        // Actions
        var actionsHtml = '';
        if (p.url_grossiste) {
            actionsHtml += '<a href="' + p.url_grossiste + '" target="_blank" class="text-indigo-600 hover:underline text-xs font-semibold">🛒 Voir sur Metro</a>';
        }

        html += '<tr class="border-b border-gray-100 hover:bg-gray-50">';
        html += '<td class="p-3 text-xs text-gray-500">' + date + '</td>';
        html += '<td class="p-3"><span class="font-semibold text-gray-700 text-xs">' + (p.brand || '—') + '</span></td>';
        html += '<td class="p-3 text-gray-700" title="' + (p.product_name || '') + '">' + (p.product_name || '—') + '</td>';
        html += '<td class="p-3 text-center font-bold text-blue-600 text-lg">' + (p.price_grossiste ? p.price_grossiste.toFixed(2) + '€' : '—') + '</td>';
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
    var brand = document.getElementById('metro-auto-filter-brand');
    var filtered = data;

    if (brand && brand.value) {
        filtered = filtered.filter(function(p) {
            return p.brand === brand.value;
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
