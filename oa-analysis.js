// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 ONGLET ANALYSE OA (Produits Metro avec ASIN + Matching)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var _analysisData = [];

/**
 * Charge les produits analysés (avec ASIN)
 */
function loadAnalysisData() {
    var sb = _getOAClient();
    if (!sb) return;

    console.log('[Analysis] Chargement des produits analysés...');

    sb.from('grossiste_products')
        .select('*')
        .eq('source', 'SCRIPT_UNDETECTED')
        .not('analysis_status', 'is', null)  // Tous les produits analysés (avec ou sans ASIN)
        .order('analyzed_at', { ascending: false })  // Plus récents en premier
        .limit(200)
        .then(function(res) {
            if (res.error) {
                console.error('[Analysis] Erreur:', res.error);
                _showAnalysisError('Erreur: ' + res.error.message);
                return;
            }

            _analysisData = res.data || [];
            console.log('[Analysis] Chargé:', _analysisData.length, 'produits');

            renderAnalysisTab();
        })
        .catch(function(err) {
            console.error('[Analysis] Erreur:', err);
            _showAnalysisError('Erreur connexion Supabase');
        });
}

/**
 * Détermine la source du produit et retourne un badge HTML
 */
function _getSourceBadge(product) {
    var source = product.source || 'SCRIPT_UNDETECTED';
    var url = product.url_grossiste || '';

    // Détection intelligente de la source
    var sourceName = 'Inconnu';
    var badgeClass = 'bg-gray-100 text-gray-700';
    var icon = '📦';

    if (source === 'METRO' || url.includes('metro')) {
        sourceName = 'Metro';
        badgeClass = 'bg-blue-100 text-blue-700';
        icon = '🏪';
    } else if (source === 'FAIRE' || url.includes('faire')) {
        sourceName = 'Faire';
        badgeClass = 'bg-purple-100 text-purple-700';
        icon = '🛍️';
    } else if (source === 'CDISCOUNT' || url.includes('cdiscount')) {
        sourceName = 'Cdiscount';
        badgeClass = 'bg-orange-100 text-orange-700';
        icon = '🛒';
    } else if (source === 'SCRIPT_UNDETECTED') {
        // Par défaut Metro pour les anciens produits
        sourceName = 'Metro';
        badgeClass = 'bg-blue-100 text-blue-700';
        icon = '🏪';
    }

    return '<span class="px-2 py-1 text-xs rounded ' + badgeClass + '">' + icon + ' ' + sourceName + '</span>';
}

/**
 * Rend le tableau Analyse OA
 */
function renderAnalysisTab() {
    console.log('[Analysis] renderAnalysisTab called, data length:', _analysisData.length);

    if (!_analysisData.length) {
        _showAnalysisEmpty();
        return;
    }

    var filtered = _applyAnalysisFilters(_analysisData);
    console.log('[Analysis] After filters, filtered length:', filtered.length);
    _updateAnalysisStats(filtered);

    var tbody = document.getElementById('analysis-tbody');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="20" class="p-10 text-center text-gray-400">'
            + '<p class="font-medium">Aucun produit</p></td></tr>';
        return;
    }

    var html = '';

    filtered.forEach(function(p) {
        // Date
        var date = p.analyzed_at ? new Date(p.analyzed_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—';

        // Source
        var sourceBadge = _getSourceBadge(p);

        // Score de confiance et statut
        var confidence = p.matching_confidence || 0;
        var confidenceClass, confidenceText, statusBadge;

        if (!p.asin) {
            // Pas d'ASIN trouvé
            confidenceClass = 'text-red-600';
            confidenceText = '❌ Pas trouvé';
            var reason = p.validation_reason || 'UNKNOWN';
            if (reason === 'NO_ASIN_FOUND') {
                statusBadge = '<span class="px-2 py-1 text-xs rounded bg-red-100 text-red-700">Pas sur Amazon</span>';
            } else if (reason.startsWith('LOW_CONFIDENCE_')) {
                var conf = reason.replace('LOW_CONFIDENCE_', '');
                statusBadge = '<span class="px-2 py-1 text-xs rounded bg-orange-100 text-orange-700">Confiance ' + conf + '</span>';
            } else {
                statusBadge = '<span class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">' + reason + '</span>';
            }
        } else {
            // ASIN trouvé
            confidenceClass = confidence >= 0.9 ? 'text-green-600' : confidence >= 0.85 ? 'text-blue-600' : confidence >= 0.5 ? 'text-orange-600' : 'text-red-600';
            confidenceText = (confidence * 100).toFixed(0) + '%';

            var status = p.analysis_status || 'MATCHED';
            if (status === 'ANALYZED') {
                statusBadge = '<span class="px-2 py-1 text-xs rounded bg-green-100 text-green-700">✅ Analysé</span>';
            } else if (status === 'MATCHED') {
                statusBadge = '<span class="px-2 py-1 text-xs rounded bg-blue-100 text-blue-700">🔵 Matché</span>';
            } else if (status === 'MANUAL_VALIDATION') {
                statusBadge = '<span class="px-2 py-1 text-xs rounded bg-orange-100 text-orange-700">⚠️ À vérifier</span>';
            } else {
                statusBadge = '<span class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">' + status + '</span>';
            }
        }

        // Données SellerAmp
        var prixMetro = p.price_grossiste || 0;
        var salePrice = p.sale_price || 0;
        var fees = p.total_fees || 0;

        // Max Cost (de SellerAmp - pour ROI ~30%)
        var maxCost = p.max_cost || 0;
        var maxCostText = maxCost > 0 ? maxCost.toFixed(2) + '€' : '—';
        var maxCostClass = '';
        if (maxCost > 0 && prixMetro > 0) {
            maxCostClass = prixMetro <= maxCost ? 'text-green-600 font-bold' : 'text-red-600 font-bold';
        }

        // Breakeven Cost (prix max pour 0 perte)
        var breakeven = 0;
        var breakevenText = '—';
        var breakevenClass = '';
        if (salePrice > 0 && fees > 0) {
            breakeven = salePrice - fees;
            breakevenText = breakeven.toFixed(2) + '€';
            if (prixMetro > 0) {
                breakevenClass = prixMetro <= breakeven ? 'text-green-600' : 'text-orange-600';
            }
        }

        // ROI réel (avec prix Metro actuel)
        var roi = 0;
        var roiText = '—';
        var roiClass = '';
        if (salePrice > 0 && fees > 0 && prixMetro > 0) {
            var profitReel = salePrice - fees - prixMetro;
            roi = (profitReel / prixMetro) * 100;
            roiText = roi.toFixed(1) + '%';
            roiClass = roi >= 25 ? 'text-green-600 font-bold' : roi >= 0 ? 'text-blue-600' : 'text-red-600 font-bold';
        }

        // Profit réel (avec prix Metro actuel)
        var profit = 0;
        var profitText = '—';
        var profitClass = '';
        if (salePrice > 0 && fees > 0 && prixMetro > 0) {
            profit = salePrice - fees - prixMetro;
            profitText = profit.toFixed(2) + '€';
            profitClass = profit > 5 ? 'text-green-600 font-bold' : profit >= 0 ? 'text-blue-600' : 'text-red-600 font-bold';
        }

        // Coût Ungating (pour 10 unités)
        var coutUngating10 = 0;
        var coutUngatingText = '—';
        var coutUngatingClass = '';
        if (salePrice > 0 && fees > 0 && prixMetro > 0) {
            var perteParUnite = prixMetro - breakeven;
            coutUngating10 = perteParUnite * 10;
            coutUngatingText = coutUngating10.toFixed(2) + '€';

            if (coutUngating10 < 0) {
                // C'est une perte
                coutUngatingClass = Math.abs(coutUngating10) <= 30
                    ? 'text-green-600 font-bold'    // ≤30€ → BON
                    : Math.abs(coutUngating10) <= 50
                    ? 'text-orange-600'              // 30-50€ → MOYEN
                    : 'text-red-600';                // >50€ → CHER
            } else {
                // Profit même en ungating !
                coutUngatingClass = 'text-blue-600 font-bold';
            }
        }

        // Fees
        var fees = p.total_fees || 0;
        var feesText = fees > 0 ? fees.toFixed(2) + '€' : '—';

        // BSR
        var bsr = p.bsr || 0;
        var bsrText = bsr > 0 ? bsr.toLocaleString('fr-FR') : '—';
        var bsrClass = bsr > 0 && bsr < 10000 ? 'text-green-600 font-bold' : bsr < 50000 ? 'text-blue-600' : 'text-gray-600';

        // Prix FBA Min
        var lowestFba = p.lowest_fba || 0;
        var lowestFbaText = lowestFba > 0 ? lowestFba.toFixed(2) + '€' : '—';
        var lowestFbaClass = '';
        if (lowestFba > 0 && prixMetro > 0) {
            lowestFbaClass = prixMetro < lowestFba ? 'text-green-600 font-bold' : 'text-red-600';
        }

        // Nb vendeurs FBA
        var nbFba = p.nb_fba || 0;
        var nbFbaText = nbFba > 0 ? nbFba.toString() : '—';
        var nbFbaClass = nbFba === 0 ? 'text-gray-400' : nbFba <= 5 ? 'text-green-600 font-bold' : nbFba <= 8 ? 'text-blue-600' : 'text-red-600 font-bold';

        // Amazon BB
        var amazonBb = p.amazon_bb || '';
        var amazonBbText = amazonBb ? amazonBb : '—';
        var amazonBbClass = amazonBb && amazonBb.includes('%') && parseFloat(amazonBb) > 0 ? 'text-red-600 font-bold' : 'text-green-600';

        // Risques (PL, IP, Meltable)
        var risques = [];
        if (p.private_label && (p.private_label.includes('Likely') || p.private_label.includes('Very Likely'))) {
            risques.push('🔴 PL');
        }
        if (p.ip_risk === 'Yes') {
            risques.push('⚠️ IP');
        }
        if (p.meltable === 'Yes') {
            risques.push('🔥 Melt');
        }
        var risquesText = risques.length > 0 ? risques.join(' ') : '✅ OK';
        var risquesClass = risques.length > 0 ? 'text-red-600 font-bold' : 'text-green-600';

        // Badge marque débloquée
        var brandText = p.brand || '—';
        if (p.brand && typeof estMarqueDebloquee === 'function' && estMarqueDebloquee(p.brand)) {
            brandText += '<span class="ml-2 px-2 py-1 text-xs bg-green-100 text-green-700 rounded">✅</span>';
        }

        // Actions
        var actionsHtml = '';
        if (p.asin) {
            actionsHtml += '<a href="https://www.amazon.fr/dp/' + p.asin + '" target="_blank" class="text-blue-600 hover:underline text-xs mr-2">📦 Amazon</a>';
        }
        if (p.url_grossiste) {
            actionsHtml += '<a href="' + p.url_grossiste + '" target="_blank" class="text-indigo-600 hover:underline text-xs mr-2">🛒 Metro</a>';
        }
        // Bouton débloquer (si ASIN trouvé et marque pas déjà débloquée)
        if (p.asin && p.brand && typeof estMarqueDebloquee === 'function' && !estMarqueDebloquee(p.brand) && coutUngating10 < 0 && Math.abs(coutUngating10) <= 30) {
            actionsHtml += '<button onclick="showUnlockBrandModal(' + JSON.stringify(p).replace(/"/g, '&quot;') + ')" class="text-green-600 hover:underline text-xs">🎯 Débloquer</button>';
        }

        html += '<tr class="border-b border-gray-100 hover:bg-gray-50">';
        html += '<td class="p-3 text-xs text-gray-500">' + date + '</td>';
        html += '<td class="p-3 text-center">' + sourceBadge + '</td>';
        html += '<td class="p-3"><span class="font-semibold text-gray-700 text-xs">' + brandText + '</span></td>';
        html += '<td class="p-3 text-gray-700 text-sm" title="' + (p.product_name || '') + '">' + (p.product_name || '—').substring(0, 50) + '...</td>';
        html += '<td class="p-3 text-center"><span class="' + confidenceClass + ' font-semibold">' + confidenceText + '</span></td>';
        html += '<td class="p-3 text-center">' + statusBadge + '</td>';
        html += '<td class="p-3 text-center font-bold text-blue-600">' + (p.price_grossiste ? p.price_grossiste.toFixed(2) + '€' : '—') + '</td>';
        html += '<td class="p-3 text-center font-bold text-indigo-600">' + (p.sale_price ? p.sale_price.toFixed(2) + '€' : '—') + '</td>';
        html += '<td class="p-3 text-center"><span class="' + maxCostClass + '">' + maxCostText + '</span></td>';
        html += '<td class="p-3 text-center"><span class="' + breakevenClass + '">' + breakevenText + '</span></td>';
        html += '<td class="p-3 text-center"><span class="' + coutUngatingClass + '">' + coutUngatingText + '</span></td>';
        html += '<td class="p-3 text-center"><span class="' + roiClass + '">' + roiText + '</span></td>';
        html += '<td class="p-3 text-center"><span class="' + profitClass + '">' + profitText + '</span></td>';
        html += '<td class="p-3 text-center text-xs text-gray-600">' + feesText + '</td>';
        html += '<td class="p-3 text-center text-xs"><span class="' + bsrClass + '">' + bsrText + '</span></td>';
        html += '<td class="p-3 text-center text-sm"><span class="' + lowestFbaClass + '">' + lowestFbaText + '</span></td>';
        html += '<td class="p-3 text-center text-sm"><span class="' + nbFbaClass + '">' + nbFbaText + '</span></td>';
        html += '<td class="p-3 text-center text-xs"><span class="' + amazonBbClass + '">' + amazonBbText + '</span></td>';
        html += '<td class="p-3 text-center text-xs"><span class="' + risquesClass + '">' + risquesText + '</span></td>';
        html += '<td class="p-3 text-center text-sm">' + actionsHtml + '</td>';
        html += '</tr>';
    });

    tbody.innerHTML = html;

    var label = document.getElementById('analysis-count-label');
    if (label) {
        label.textContent = filtered.length + ' produit' + (filtered.length > 1 ? 's' : '');
    }
}

/**
 * Applique les filtres
 */
function _applyAnalysisFilters(data) {
    var sourceFilter = document.getElementById('analysis-filter-source');
    var minConfidence = document.getElementById('analysis-filter-confidence');
    var status = document.getElementById('analysis-filter-status');
    var ungatingFilter = document.getElementById('analysis-filter-ungating');
    var filtered = data;

    // Filtre par source
    if (sourceFilter && sourceFilter.value) {
        var targetSource = sourceFilter.value;
        filtered = filtered.filter(function(p) {
            var source = p.source || 'SCRIPT_UNDETECTED';
            var url = p.url_grossiste || '';

            if (targetSource === 'METRO') {
                return source === 'METRO' || source === 'SCRIPT_UNDETECTED' || url.includes('metro');
            } else if (targetSource === 'FAIRE') {
                return source === 'FAIRE' || url.includes('faire');
            } else if (targetSource === 'CDISCOUNT') {
                return source === 'CDISCOUNT' || url.includes('cdiscount');
            }
            return false;
        });
    }

    // Filtre par confiance
    if (minConfidence && minConfidence.value) {
        var minConf = parseFloat(minConfidence.value);
        filtered = filtered.filter(function(p) {
            return (p.matching_confidence || 0) >= minConf;
        });
    }

    // Filtre par statut
    if (status && status.value) {
        filtered = filtered.filter(function(p) {
            return (p.analysis_status || 'MATCHED') === status.value;
        });
    }

    // Filtre "Bon pour ungating"
    if (ungatingFilter && ungatingFilter.value === 'yes') {
        filtered = filtered.filter(function(p) {
            if (!p.asin || !p.brand) return false;
            if (typeof estMarqueDebloquee === 'function' && estMarqueDebloquee(p.brand)) return false;

            var prixMetro = p.price_grossiste || 0;
            var salePrice = p.sale_price || 0;
            var fees = p.total_fees || 0;
            if (salePrice === 0 || fees === 0 || prixMetro === 0) return false;

            var breakeven = salePrice - fees;
            var coutTotal = (prixMetro - breakeven) * 10;

            return coutTotal < 0 && Math.abs(coutTotal) <= 30;
        });
    } else if (ungatingFilter && ungatingFilter.value === 'profit') {
        // Filtre "Profit uniquement" - ROI positif
        filtered = filtered.filter(function(p) {
            var prixMetro = p.price_grossiste || 0;
            var salePrice = p.sale_price || 0;
            var fees = p.total_fees || 0;
            if (salePrice === 0 || fees === 0 || prixMetro === 0) return false;

            var profit = salePrice - fees - prixMetro;
            return profit > 0;
        });
    }

    // Filtre "Produits OA sûrs"
    var oaSafeFilter = document.getElementById('analysis-filter-oa-safe');
    if (oaSafeFilter && oaSafeFilter.value === 'safe') {
        filtered = filtered.filter(function(p) {
            // Doit avoir profit positif
            var prixMetro = p.price_grossiste || 0;
            var salePrice = p.sale_price || 0;
            var fees = p.total_fees || 0;
            if (salePrice === 0 || fees === 0 || prixMetro === 0) return false;
            var profit = salePrice - fees - prixMetro;
            if (profit <= 0) return false;

            // Exclure si Amazon vend (Amazon BB > 0%)
            var amazonBb = p.amazon_bb || '';
            if (amazonBb && amazonBb.includes('%') && parseFloat(amazonBb) > 0) return false;

            // Exclure si > 8 vendeurs FBA
            var nbFba = p.nb_fba || 0;
            if (nbFba > 8) return false;

            // Exclure Private Label
            if (p.private_label && (p.private_label.includes('Likely') || p.private_label.includes('Very Likely'))) return false;

            // Exclure IP Risk
            if (p.ip_risk === 'Yes') return false;

            // Exclure Meltable
            if (p.meltable === 'Yes') return false;

            // BSR < 50k recommandé
            var bsr = p.bsr || 0;
            if (bsr > 50000) return false;

            return true;
        });
    }

    // Filtre Max vendeurs FBA
    var maxFbaFilter = document.getElementById('analysis-filter-max-fba');
    if (maxFbaFilter && maxFbaFilter.value) {
        var maxFba = parseInt(maxFbaFilter.value);
        filtered = filtered.filter(function(p) {
            var nbFba = p.nb_fba || 0;
            return nbFba <= maxFba;
        });
    }

    // Tri
    var sortFilter = document.getElementById('analysis-filter-sort');
    if (sortFilter && sortFilter.value) {
        var sortBy = sortFilter.value;

        if (sortBy === 'price_asc') {
            filtered.sort(function(a, b) {
                return (a.price_grossiste || 0) - (b.price_grossiste || 0);
            });
        } else if (sortBy === 'price_desc') {
            filtered.sort(function(a, b) {
                return (b.price_grossiste || 0) - (a.price_grossiste || 0);
            });
        } else if (sortBy === 'roi_desc') {
            filtered.sort(function(a, b) {
                var roiA = a.sale_price && a.total_fees && a.price_grossiste ?
                    ((a.sale_price - a.total_fees - a.price_grossiste) / a.price_grossiste) * 100 : -999;
                var roiB = b.sale_price && b.total_fees && b.price_grossiste ?
                    ((b.sale_price - b.total_fees - b.price_grossiste) / b.price_grossiste) * 100 : -999;
                return roiB - roiA;
            });
        } else if (sortBy === 'profit_desc') {
            filtered.sort(function(a, b) {
                var profitA = a.sale_price && a.total_fees && a.price_grossiste ?
                    a.sale_price - a.total_fees - a.price_grossiste : -999;
                var profitB = b.sale_price && b.total_fees && b.price_grossiste ?
                    b.sale_price - b.total_fees - b.price_grossiste : -999;
                return profitB - profitA;
            });
        }
        // 'date' = ordre par défaut (déjà trié par analyzed_at desc dans la requête)
    }

    return filtered;
}

/**
 * Update stats
 */
function _updateAnalysisStats(data) {
    var total = data.length;
    var withAsin = data.filter(function(p) { return p.asin; }).length;
    var noAsin = data.filter(function(p) { return !p.asin; }).length;
    var matched = data.filter(function(p) { return p.asin && (p.analysis_status || 'MATCHED') === 'MATCHED'; }).length;
    var analyzed = data.filter(function(p) { return p.asin && (p.analysis_status || 'MATCHED') === 'ANALYZED'; }).length;
    var manual = data.filter(function(p) { return p.asin && (p.analysis_status || 'MATCHED') === 'MANUAL_VALIDATION'; }).length;
    var highConf = data.filter(function(p) { return (p.matching_confidence || 0) >= 0.85; }).length;

    document.getElementById('analysis-stat-total').textContent = total;
    document.getElementById('analysis-stat-matched').textContent = matched + ' / ' + withAsin;
    document.getElementById('analysis-stat-analyzed').textContent = analyzed;
    document.getElementById('analysis-stat-manual').textContent = manual;
    document.getElementById('analysis-stat-highconf').textContent = highConf + ' (' + noAsin + ' échecs)';
}

/**
 * Affiche erreur
 */
function _showAnalysisError(msg) {
    var tbody = document.getElementById('analysis-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="20" class="p-10 text-center text-red-400">'
            + '<i class="fas fa-exclamation-triangle text-3xl mb-3 block"></i>'
            + '<p class="font-medium">' + msg + '</p></td></tr>';
    }
}

/**
 * Affiche vide
 */
function _showAnalysisEmpty() {
    var tbody = document.getElementById('analysis-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="20" class="p-10 text-center text-gray-400">'
            + '<i class="fas fa-search text-3xl mb-3 block text-gray-300"></i>'
            + '<p class="font-medium">Aucun produit analysé</p>'
            + '<p class="text-xs mt-2">Lance le worker pour matcher les ASINs</p>'
            + '</td></tr>';
    }

    document.getElementById('analysis-stat-total').textContent = '0';
    document.getElementById('analysis-stat-matched').textContent = '0';
    document.getElementById('analysis-stat-analyzed').textContent = '0';
    document.getElementById('analysis-stat-manual').textContent = '0';
    document.getElementById('analysis-stat-highconf').textContent = '0';
}
