// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🏪 ONGLET GROSSISTES (Metro, Faire, etc.)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var _grossistesData = [];

/**
 * Charge les produits grossistes depuis Supabase
 */
function loadGrossistesData() {
    var sb = _getOAClient();
    if (!sb) return;

    console.log('[Grossistes] Chargement des produits...');

    // Charge les 30 derniers jours
    var dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 30);

    sb.from('grossiste_products')
        .select('*')
        .gte('analyzed_at', dateLimit.toISOString())
        .order('analyzed_at', { ascending: false })
        .then(function(res) {
            if (res.error) {
                console.error('[Grossistes] Erreur chargement:', res.error);
                _showGrossistesError('Erreur chargement: ' + res.error.message);
                return;
            }

            _grossistesData = res.data || [];
            console.log('[Grossistes] Chargé:', _grossistesData.length, 'produits');

            renderGrossistesTab();
        })
        .catch(function(err) {
            console.error('[Grossistes] Erreur:', err);
            _showGrossistesError('Erreur connexion Supabase');
        });
}

/**
 * Rend le tableau grossistes avec filtres
 */
function renderGrossistesTab() {
    if (!_grossistesData.length) {
        _showGrossistesEmpty();
        return;
    }

    // Applique filtres
    var filtered = _applyGrossistesFilters(_grossistesData);

    // Update stats
    _updateGrossistesStats(filtered);

    // Rend tableau
    var tbody = document.getElementById('grossistes-tbody');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="15" class="p-10 text-center text-gray-400">'
            + '<p class="font-medium">Aucun produit ne correspond aux filtres</p></td></tr>';
        return;
    }

    var html = '';

    filtered.forEach(function(p) {
        // Badge statut analyse
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

        // Badge site
        var siteBadge = '';
        if (p.site === 'METRO' || p.site === 'metro') {
            siteBadge = '<span class="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded">Metro</span>';
        } else if (p.site === 'FAIRE' || p.site === 'faire') {
            siteBadge = '<span class="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-semibold rounded">Faire</span>';
        } else {
            siteBadge = '<span class="inline-block px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded">' + (p.site || 'N/A') + '</span>';
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

        // Amazon seller
        var amazonText = '';
        if (p.amazon_seller) {
            if (p.amazon_seller.toLowerCase().includes('not seen')) {
                amazonText = '<span class="text-green-600 text-xs">❌ Non</span>';
            } else if (p.amazon_seller.toLowerCase().includes('probably') || p.amazon_seller.toLowerCase().includes('yes')) {
                amazonText = '<span class="text-red-500 text-xs">✓ Oui</span>';
            } else {
                amazonText = '<span class="text-gray-500 text-xs">' + p.amazon_seller.substring(0, 10) + '</span>';
            }
        } else {
            amazonText = '<span class="text-gray-400 text-xs">—</span>';
        }

        // Score badge
        var scoreClass = p.score >= 100 ? 'bg-green-100 text-green-700'
                       : p.score >= 80 ? 'bg-blue-100 text-blue-700'
                       : p.score >= 50 ? 'bg-yellow-100 text-yellow-700'
                       : 'bg-gray-100 text-gray-600';
        var scoreBadge = '<span class="inline-block px-2 py-1 rounded text-xs font-bold ' + scoreClass + '">' + (p.score || 0) + '</span>';

        // Actions
        var actionsHtml = '';
        if (p.url_grossiste) {
            actionsHtml += '<a href="' + p.url_grossiste + '" target="_blank" class="text-indigo-600 hover:underline text-xs mr-2" title="Voir sur ' + p.site + '">🛒 Acheter</a>';
        }
        if (p.asin) {
            actionsHtml += '<a href="https://amazon.fr/dp/' + p.asin + '" target="_blank" class="text-gray-500 hover:underline text-xs" title="Voir sur Amazon">Amazon</a>';
        }

        html += '<tr class="border-b border-gray-100 hover:bg-gray-50">';
        html += '<td class="p-3">' + statusBadge + '</td>';
        html += '<td class="p-3">' + siteBadge + '</td>';
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
        html += '<td class="p-3 text-center">' + amazonText + '</td>';
        html += '<td class="p-3 text-center">' + scoreBadge + '</td>';
        html += '<td class="p-3 text-center text-sm">' + actionsHtml + '</td>';
        html += '</tr>';
    });

    tbody.innerHTML = html;

    // Update count label
    var label = document.getElementById('grossistes-count-label');
    if (label) {
        label.textContent = filtered.length + ' produit' + (filtered.length > 1 ? 's' : '');
    }
}

/**
 * Applique les filtres grossistes
 */
function _applyGrossistesFilters(data) {
    var status = document.getElementById('grossiste-filter-status');
    var site = document.getElementById('grossiste-filter-site');
    var brand = document.getElementById('grossiste-filter-brand');
    var roiMin = document.getElementById('grossiste-filter-roi');
    var profitMin = document.getElementById('grossiste-filter-profit');

    var filtered = data;

    // Filtre statut analyse
    if (status && status.value) {
        filtered = filtered.filter(function(p) {
            return (p.analysis_status || 'ANALYZED').toUpperCase() === status.value;
        });
    }

    // Filtre site
    if (site && site.value) {
        filtered = filtered.filter(function(p) {
            return (p.site || '').toUpperCase() === site.value.toUpperCase();
        });
    }

    // Filtre marque
    if (brand && brand.value) {
        filtered = filtered.filter(function(p) {
            return p.brand === brand.value;
        });
    }

    // Filtre ROI min
    if (roiMin && roiMin.value) {
        var minRoi = parseFloat(roiMin.value);
        filtered = filtered.filter(function(p) {
            return (p.roi || 0) >= minRoi;
        });
    }

    // Filtre profit min
    if (profitMin && profitMin.value) {
        var minProfit = parseFloat(profitMin.value);
        filtered = filtered.filter(function(p) {
            return (p.profit_net || 0) >= minProfit;
        });
    }

    return filtered;
}

/**
 * Update stats header
 */
function _updateGrossistesStats(data) {
    var total = data.length;
    var scraped = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'SCRAPED'; }).length;
    var analyzing = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'ANALYZING'; }).length;
    var analyzed = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'ANALYZED'; }).length;
    var errors = data.filter(function(p) { return (p.analysis_status || 'ANALYZED') === 'ERROR'; }).length;
    var profitable = data.filter(function(p) { return (p.profit_net || 0) > 0; }).length;

    var roiSum = 0;
    var roiCount = 0;
    data.forEach(function(p) {
        if (p.roi && p.roi > 0) {
            roiSum += p.roi;
            roiCount++;
        }
    });
    var avgRoi = roiCount > 0 ? roiSum / roiCount : 0;

    // Date dernière analyse
    var latestDate = null;
    data.forEach(function(p) {
        if (p.analyzed_at) {
            var d = new Date(p.analyzed_at);
            if (!latestDate || d > latestDate) {
                latestDate = d;
            }
        }
    });
    var dateText = latestDate ? _formatDate(latestDate) : '—';

    // Update DOM
    var statTotal = document.getElementById('grossistes-stat-total');
    var statScraped = document.getElementById('grossistes-stat-scraped');
    var statAnalyzing = document.getElementById('grossistes-stat-analyzing');
    var statAnalyzed = document.getElementById('grossistes-stat-analyzed');
    var statErrors = document.getElementById('grossistes-stat-errors');
    var statProfitable = document.getElementById('grossistes-stat-profitable');
    var statRoi = document.getElementById('grossistes-stat-roi');
    var statDate = document.getElementById('grossistes-stat-date');

    if (statTotal) statTotal.textContent = total;
    if (statScraped) statScraped.textContent = scraped;
    if (statAnalyzing) statAnalyzing.textContent = analyzing;
    if (statAnalyzed) statAnalyzed.textContent = analyzed;
    if (statErrors) statErrors.textContent = errors;
    if (statProfitable) statProfitable.textContent = profitable;
    if (statRoi) statRoi.textContent = avgRoi.toFixed(0) + '%';
    if (statDate) statDate.textContent = dateText;
}

/**
 * Affiche message erreur
 */
function _showGrossistesError(msg) {
    var tbody = document.getElementById('grossistes-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="15" class="p-10 text-center text-red-400">'
            + '<i class="fas fa-exclamation-triangle text-3xl mb-3 block"></i>'
            + '<p class="font-medium">' + msg + '</p></td></tr>';
    }
}

/**
 * Affiche message vide (pas de données)
 */
function _showGrossistesEmpty() {
    var tbody = document.getElementById('grossistes-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="15" class="p-10 text-center text-gray-400">'
            + '<i class="fas fa-store text-3xl mb-3 block text-gray-300"></i>'
            + '<p class="font-medium">Aucun produit grossiste analysé</p>'
            + '<p class="text-xs mt-2">Utilise l\'extension Chrome pour scraper Metro/Faire</p>'
            + '</td></tr>';
    }

    // Reset stats
    var statTotal = document.getElementById('grossistes-stat-total');
    var statScraped = document.getElementById('grossistes-stat-scraped');
    var statAnalyzing = document.getElementById('grossistes-stat-analyzing');
    var statAnalyzed = document.getElementById('grossistes-stat-analyzed');
    var statErrors = document.getElementById('grossistes-stat-errors');
    var statProfitable = document.getElementById('grossistes-stat-profitable');
    var statRoi = document.getElementById('grossistes-stat-roi');
    var statDate = document.getElementById('grossistes-stat-date');

    if (statTotal) statTotal.textContent = '0';
    if (statScraped) statScraped.textContent = '0';
    if (statAnalyzing) statAnalyzing.textContent = '0';
    if (statAnalyzed) statAnalyzed.textContent = '0';
    if (statErrors) statErrors.textContent = '0';
    if (statProfitable) statProfitable.textContent = '0';
    if (statRoi) statRoi.textContent = '0%';
    if (statDate) statDate.textContent = '—';
}

/**
 * Formate date pour affichage
 */
function _formatDate(date) {
    var now = new Date();
    var diff = now - date;
    var minutes = Math.floor(diff / 60000);
    var hours = Math.floor(diff / 3600000);
    var days = Math.floor(diff / 86400000);

    if (minutes < 60) {
        return 'Il y a ' + minutes + 'min';
    } else if (hours < 24) {
        return 'Il y a ' + hours + 'h';
    } else if (days < 7) {
        return 'Il y a ' + days + 'j';
    } else {
        return date.toLocaleDateString('fr-FR');
    }
}
