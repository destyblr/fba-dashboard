// ─────────────────────────────────────────────────────────────────────────────
// OA Supabase — Remplace Netlify Blobs par Supabase
// Python local (main.py) → Supabase → ce fichier → tableau
// ─────────────────────────────────────────────────────────────────────────────

var OA_SUPABASE_URL = 'https://ittbipdvkutbiiqeukdg.supabase.co';
var OA_SUPABASE_KEY = 'sb_publishable_uC4DebkXoayJkKDabA_A1w_7ft2qxwd';

var _sbOAClient = null;

function _getOAClient() {
    if (!_sbOAClient) {
        if (typeof supabase === 'undefined') {
            console.error('[OA] Supabase JS client non chargé');
            return null;
        }
        _sbOAClient = supabase.createClient(OA_SUPABASE_URL, OA_SUPABASE_KEY);
    }
    return _sbOAClient;
}

// ── Mapping Supabase → format attendu par le dashboard ───────────────────────
function _mapDeal(d) {
    var mp = d.marketplace_recommandee || 'FR';
    var mpPrices = { FR: d.buy_box_fr, DE: d.buy_box_de, IT: d.buy_box_it, ES: d.buy_box_es };
    var amzPrice = mpPrices[mp] || d.buy_box_90j_moy_fr;

    var netProfit = null, roi = null;
    if (d.prix_achat > 0 && amzPrice && d.total_frais != null) {
        netProfit = Math.round((amzPrice - d.total_frais - d.prix_achat) * 100) / 100;
        roi = netProfit > 0 ? Math.round(netProfit / d.prix_achat * 1000) / 10 : 0;
    }

    return {
        id:              d.id,
        asin:            d.asin,
        amazonTitle:     d.titre,
        title:           d.titre,
        category:        d.categorie,
        bsr:             d.bsr_fr,
        offerCountNew:   d.nb_vendeurs_fba,
        amazonIsSeller:  d.amazon_en_stock,
        amazonPrice:     amzPrice,
        bestMarketplace: mp,
        priceFR:         d.buy_box_fr,
        priceDE:         d.buy_box_de,
        priceIT:         d.buy_box_it,
        priceES:         d.buy_box_es,
        price:           d.prix_achat || null,
        totalFees:       d.total_frais,
        netProfit:       netProfit,
        roi:             roi,
        retailerLink:    d.lien_google_shopping,
        retailer:        'Keepa',
        statut:          d.statut,
        alerte:          d.alerte_arbitrage,
        scoreDeal:       d.score_deal,
    };
}

// ── Override loadCatalog ──────────────────────────────────────────────────────
function loadCatalog() {
    var sb = _getOAClient();
    if (!sb) { renderCatalogEmpty('Supabase non configuré'); return; }

    var today = new Date().toISOString().split('T')[0];

    sb.from('deals')
      .select('*')
      .gte('date_scan', today + 'T00:00:00')
      .order('score_deal', { ascending: false })
      .then(function(res) {
          if (res.error) {
              renderCatalogEmpty('Erreur Supabase : ' + res.error.message);
              console.error('[OA]', res.error);
              return;
          }

          catalogData     = (res.data || []).map(_mapDeal);
          catalogFiltered = catalogData;

          var setEl = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
          var profitable = catalogData.filter(function(p) { return (p.roi || 0) >= 25 && (p.netProfit || 0) >= 2; }).length;
          setEl('catalog-stat-products',   catalogData.length);
          setEl('catalog-stat-profitable', profitable);
          setEl('catalog-last-run', catalogData.length > 0 ? 'Aujourd\'hui' : 'Aucun run');

          renderCatalogTable();
          if (typeof updateCatalogFilters === 'function') updateCatalogFilters();
      })
      .catch(function(e) {
          renderCatalogEmpty('Erreur connexion Supabase');
          console.error('[OA]', e);
      });
}

// ── Sauvegarder prix_achat dans Supabase ─────────────────────────────────────
function saveOAPrixAchat(dealId, prix) {
    var sb = _getOAClient();
    if (!sb || !dealId) return;

    sb.from('deals')
      .update({ prix_achat: prix })
      .eq('id', dealId)
      .then(function(res) {
          if (res.error) { console.error('[OA] Save error', res.error); return; }

          // Recalcul local sans rechargement complet
          var idx = -1;
          for (var i = 0; i < catalogData.length; i++) {
              if (catalogData[i].id === dealId) { idx = i; break; }
          }
          if (idx >= 0) {
              var p = catalogData[idx];
              p.price = prix;
              if (prix > 0 && p.amazonPrice && p.totalFees != null) {
                  p.netProfit = Math.round((p.amazonPrice - p.totalFees - prix) * 100) / 100;
                  p.roi = p.netProfit > 0 ? Math.round(p.netProfit / prix * 1000) / 10 : 0;
              } else {
                  p.netProfit = null;
                  p.roi = null;
              }
              renderCatalogTable();
          }
      });
}

// ── Override renderCatalogTable ───────────────────────────────────────────────
function renderCatalogTable() {
    var tbody = document.getElementById('catalog-tbody');
    if (!tbody) return;

    var data = catalogData;

    // Filtres
    var getVal = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var minRoiAdv  = parseFloat(getVal('catalog-min-roi-adv')) || 0;
    var maxSellers = parseInt(getVal('catalog-max-sellers'));
    var maxBsr     = parseInt(getVal('catalog-max-bsr'));
    var minPrice   = parseFloat(getVal('catalog-min-price')) || 0;
    var maxPrice   = parseFloat(getVal('catalog-max-price')) || 0;
    var noAmz      = (document.getElementById('catalog-no-amazon') || {}).checked;
    var minProfitF = parseFloat(getVal('catalog-min-profit')) || 0;
    var minRoiF    = parseFloat(getVal('catalog-min-roi'))    || 0;

    if (minRoiAdv > 0)                            data = data.filter(function(p) { return (p.roi || 0) >= minRoiAdv; });
    if (!isNaN(maxSellers) && maxSellers > 0)     data = data.filter(function(p) { return p.offerCountNew == null || p.offerCountNew <= maxSellers; });
    if (!isNaN(maxBsr) && maxBsr > 0)             data = data.filter(function(p) { return !p.bsr || p.bsr <= maxBsr; });
    if (minPrice > 0)                             data = data.filter(function(p) { return (p.amazonPrice || 0) >= minPrice; });
    if (maxPrice > 0)                             data = data.filter(function(p) { return (p.amazonPrice || 0) <= maxPrice; });
    if (noAmz)                                    data = data.filter(function(p) { return !p.amazonIsSeller; });
    if (minProfitF > 0)                           data = data.filter(function(p) { return (p.netProfit || 0) >= minProfitF; });
    if (minRoiF > 0)                              data = data.filter(function(p) { return (p.roi || 0) >= minRoiF; });

    // Tri
    var sortKey = typeof catalogSortKey !== 'undefined' ? catalogSortKey : 'profit';
    data = data.slice().sort(function(a, b) {
        if (sortKey === 'profit') return (b.netProfit || -99999) - (a.netProfit || -99999);
        if (sortKey === 'roi')    return (b.roi       || -99999) - (a.roi       || -99999);
        if (sortKey === 'bsr')    return (a.bsr       || 9999999) - (b.bsr      || 9999999);
        return (b.scoreDeal || 0) - (a.scoreDeal || 0);
    });

    if (!data.length) {
        renderCatalogEmpty('Aucun deal — lance python main.py sur ton PC ce matin');
        return;
    }

    var mpFlags   = { FR: '🇫🇷', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸' };
    var mpDomains = { FR: 'fr', DE: 'de', IT: 'it', ES: 'es' };

    tbody.innerHTML = data.map(function(p) {
        var profitable = (p.roi || 0) >= 25 && (p.netProfit || 0) >= 2;
        var borderline = !profitable && (p.netProfit || 0) > 0;
        var negative   = (p.netProfit || 0) < 0 && p.netProfit != null;
        var rowClass   = profitable ? 'bg-green-50 border-l-4 border-l-green-400'
                       : borderline ? 'bg-amber-50 border-l-4 border-l-amber-300'
                       : negative   ? 'bg-red-50/50 border-l-4 border-l-red-300'
                       : 'border-l-4 border-l-transparent';

        var amzDomain = mpDomains[p.bestMarketplace] || 'fr';
        var amzUrl    = p.asin ? 'https://www.amazon.' + amzDomain + '/dp/' + p.asin : '#';
        var scoreColor = (p.scoreDeal || 0) >= 70 ? 'bg-green-100 text-green-700'
                       : (p.scoreDeal || 0) >= 40 ? 'bg-amber-100 text-amber-700'
                       : 'bg-gray-100 text-gray-500';

        // ── Colonne PRODUIT ──
        var prodCol = '<div class="flex items-center gap-2">'
            + '<span class="text-xs font-bold px-1.5 py-0.5 rounded ' + scoreColor + ' flex-shrink-0">' + (p.scoreDeal || '?') + '</span>'
            + '<div class="min-w-0">'
            + '<a href="' + amzUrl + '" target="_blank" class="font-medium text-gray-800 hover:text-indigo-600 text-xs leading-tight block truncate" title="' + (p.amazonTitle || '') + '">' + (p.amazonTitle || '').slice(0, 50) + '</a>'
            + '<div class="text-xs text-gray-400 font-mono truncate">' + (p.asin || '') + ' · ' + (p.category || '') + '</div>'
            + (p.alerte ? '<div class="text-xs text-amber-600 font-semibold">⚡ ' + p.alerte + '</div>' : '')
            + '</div></div>';

        // ── Colonne ACHAT ── lien Google Shopping + input prix
        var currentPrice = p.price ? p.price.toFixed(2) : '';
        var achatCol = '<div class="flex flex-col gap-1.5">'
            + (p.retailerLink ? '<a href="' + p.retailerLink + '" target="_blank" class="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold whitespace-nowrap">🔍 Trouver</a>' : '')
            + '<input type="number" step="0.01" min="0" placeholder="Prix €" value="' + currentPrice + '" '
            + 'class="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-sm text-center focus:border-indigo-400 outline-none bg-white" '
            + 'onchange="saveOAPrixAchat(' + JSON.stringify(p.id) + ', parseFloat(this.value)||0)" />'
            + '</div>';

        // ── Colonne AMAZON ──
        var mpPrices = [['DE', p.priceDE], ['FR', p.priceFR], ['IT', p.priceIT], ['ES', p.priceES]]
            .filter(function(x) { return x[1]; })
            .map(function(x) { return (mpFlags[x[0]] || '') + x[1].toFixed(0) + '€'; }).join(' ');
        var amazonCol = p.amazonPrice
            ? '<div class="font-bold text-sm">' + (mpFlags[p.bestMarketplace] || '') + ' ' + p.amazonPrice.toFixed(2) + '€</div>'
              + (mpPrices ? '<div class="text-xs text-gray-400 leading-tight">' + mpPrices + '</div>' : '')
            : '<span class="text-gray-300 text-xs">—</span>';

        // ── Profit / ROI / Marge ──
        var profitColor = profitable ? 'text-green-600' : ((p.netProfit || 0) > 0 ? 'text-amber-600' : 'text-red-500');
        var marge = (p.amazonPrice && p.netProfit != null) ? p.netProfit / p.amazonPrice * 100 : null;
        var noPrice = '<span class="text-gray-300 text-xs" title="Entre le prix achat →">—</span>';
        var profitCol = p.netProfit != null ? '<span class="font-bold ' + profitColor + ' text-sm">' + (p.netProfit >= 0 ? '+' : '') + p.netProfit.toFixed(2) + '€</span>' : noPrice;
        var roiCol    = p.roi != null ? '<span class="font-semibold text-xs ' + profitColor + '">' + p.roi.toFixed(0) + '%</span>' : noPrice;
        var margeCol  = marge != null ? '<span class="font-semibold text-xs ' + profitColor + '">' + marge.toFixed(0) + '%</span>' : noPrice;

        // ── BSR ──
        var bsrCol = p.bsr
            ? '<span class="text-xs font-mono text-gray-600">' + Number(p.bsr).toLocaleString('fr') + '</span>'
            : '<span class="text-gray-300 text-xs">—</span>';

        // ── Vendeurs ──
        var vendCol = '<span class="font-semibold text-sm text-gray-700">' + (p.offerCountNew != null ? p.offerCountNew : '?') + '</span>';

        // ── AMZ ──
        var amzCol = p.amazonIsSeller
            ? '<span class="text-xs bg-red-100 text-red-700 rounded px-1.5 py-0.5 font-semibold">AMZ concu</span>'
            : '<span class="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-semibold">Libre</span>';

        // ── Éligible ──
        var eligCol = p.statut === 'ELIGIBLE'
            ? '<span class="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-semibold">✓ Éligible</span>'
            : p.statut === 'RESTRICTED'
            ? '<span class="text-xs bg-red-100 text-red-700 rounded px-1.5 py-0.5 font-semibold">✗ Restreint</span>'
            : '<span class="text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">À vérif.</span>';

        // ── Actions ──
        var actionsCol = '<div class="flex flex-col gap-1">'
            + (p.asin ? '<a href="' + amzUrl + '" target="_blank" class="text-xs text-orange-600 hover:underline font-semibold">Amazon ↗</a>' : '')
            + (p.retailerLink ? '<a href="' + p.retailerLink + '" target="_blank" class="text-xs text-indigo-500 hover:underline">Shopping ↗</a>' : '')
            + '</div>';

        return '<tr class="' + rowClass + ' hover:bg-gray-50/50 transition-colors">'
            + '<td class="p-2">'              + prodCol    + '</td>'
            + '<td class="p-2">'              + achatCol   + '</td>'
            + '<td class="p-2">'              + amazonCol  + '</td>'
            + '<td class="p-2 text-right">'   + profitCol  + '</td>'
            + '<td class="p-2 text-right">'   + roiCol     + '</td>'
            + '<td class="p-2 text-right">'   + margeCol   + '</td>'
            + '<td class="p-2 text-center">'  + bsrCol     + '</td>'
            + '<td class="p-2 text-center">'  + vendCol    + '</td>'
            + '<td class="p-2 text-center">'  + amzCol     + '</td>'
            + '<td class="p-2 text-center">'  + eligCol    + '</td>'
            + '<td class="p-2 text-center">'  + actionsCol + '</td>'
            + '</tr>';
    }).join('');

    // Pagination
    var pag = document.getElementById('catalog-pagination');
    var cnt = document.getElementById('catalog-count');
    if (pag) pag.classList.remove('hidden');
    if (cnt) cnt.textContent = data.length + ' produit' + (data.length > 1 ? 's' : '');
}
