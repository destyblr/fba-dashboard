// ─────────────────────────────────────────────────────────────────────────────
// OA Supabase — Python local → Supabase → Dashboard
// ─────────────────────────────────────────────────────────────────────────────

var OA_SUPABASE_URL = 'https://ittbipdvkutbiiqeukdg.supabase.co';
var OA_SUPABASE_KEY = 'sb_publishable_uC4DebkXoayJkKDabA_A1w_7ft2qxwd';

var _sbOAClient  = null;
var _oaData      = [];           // données brutes (mapped)
var _oaTab       = 'raw';        // onglet actif

var MP_FLAGS   = { FR: '🇫🇷', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸' };
var MP_DOMAINS = { FR: 'fr',   DE: 'de',   IT: 'it',   ES: 'es'   };

// ── Client Supabase ───────────────────────────────────────────────────────────
function _getOAClient() {
    if (!_sbOAClient) {
        if (typeof supabase === 'undefined') { console.error('[OA] Supabase JS non chargé'); return null; }
        _sbOAClient = supabase.createClient(OA_SUPABASE_URL, OA_SUPABASE_KEY);
    }
    return _sbOAClient;
}

// ── Mapping Supabase row → objet interne ─────────────────────────────────────
function _mapDeal(d) {
    var mp       = d.marketplace_recommandee || 'FR';
    var amzPrice = { FR: d.buy_box_fr, DE: d.buy_box_de, IT: d.buy_box_it, ES: d.buy_box_es }[mp] || d.buy_box_90j_moy_fr;

    var netProfit = null, roi = null;
    if (d.prix_achat > 0 && amzPrice && d.total_frais != null) {
        netProfit = Math.round((amzPrice - d.total_frais - d.prix_achat) * 100) / 100;
        roi       = netProfit > 0 ? Math.round(netProfit / d.prix_achat * 1000) / 10 : 0;
    }

    // Meilleure marketplace (la plus haute Buy Box parmi DE/IT/ES vs FR)
    var prices = [
        { mp: 'FR', price: d.buy_box_fr },
        { mp: 'DE', price: d.buy_box_de },
        { mp: 'IT', price: d.buy_box_it },
        { mp: 'ES', price: d.buy_box_es },
    ].filter(function(x) { return x.price > 0; });
    var bestMP = null, bestPrice = 0;
    prices.forEach(function(x) { if (x.price > bestPrice) { bestPrice = x.price; bestMP = x.mp; } });
    var gainVsFR = (bestMP && bestMP !== 'FR' && d.buy_box_fr > 0)
        ? Math.round((bestPrice - d.buy_box_fr) * 100) / 100
        : null;

    return {
        id:           d.id,
        asin:         d.asin,
        titre:        d.titre,
        categorie:    d.categorie,
        bsr:          d.bsr_fr,
        vendeurs:     d.nb_vendeurs_fba,
        amzEnStock:   d.amazon_en_stock,
        buyBoxFR:     d.buy_box_fr,
        buyBoxDE:     d.buy_box_de,
        buyBoxIT:     d.buy_box_it,
        buyBoxES:     d.buy_box_es,
        moy90j:       d.buy_box_90j_moy_fr,
        min90j:       d.buy_box_90j_min_fr,
        referralFee:  d.referral_fee,
        fraisFba:     d.frais_fba,
        envoiFba:     d.envoi_fba,
        fraisEfn:     d.frais_efn,
        urssaf:       d.urssaf,
        frais:        d.total_frais,
        roiFr:        d.roi_fr,
        roiMeilleur:  d.roi_meilleur,
        statut:       d.statut,
        mp:           mp,
        amzPrice:     amzPrice,
        prixAchat:    d.prix_achat || null,
        netProfit:    netProfit,
        roi:          roi,
        score:        d.score_deal,
        alerte:       d.alerte_arbitrage,
        lienGS:       d.lien_google_shopping,
        bestMP:       bestMP,
        bestPrice:    bestPrice,
        gainVsFR:     gainVsFR,
    };
}

// ── Chargement depuis Supabase ────────────────────────────────────────────────
function loadCatalog() {
    var sb = _getOAClient();
    if (!sb) { _showRawEmpty('Supabase non configuré'); return; }

    var today = new Date().toISOString().split('T')[0];

    sb.from('deals')
      .select('*')
      .gte('date_scan', today + 'T00:00:00')
      .order('score_deal', { ascending: false })
      .then(function(res) {
          if (res.error) { _showRawEmpty('Erreur : ' + res.error.message); return; }

          _oaData = (res.data || []).map(_mapDeal);

          var total     = _oaData.length;
          var score70   = _oaData.filter(function(d) { return (d.score || 0) >= 70; }).length;
          var eligible  = _oaData.filter(function(d) { return d.statut === 'ELIGIBLE'; }).length;
          var avecPrix  = _oaData.filter(function(d) { return d.prixAchat > 0; }).length;
          var lastRun   = total > 0 ? 'Aujourd\'hui' : 'Aucun run';

          // KPIs sourcing (section-oa-sourcing)
          var s = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
          s('kpi-oa-total',    total);
          s('kpi-oa-score70',  score70);
          s('kpi-oa-eligible', eligible);
          s('kpi-oa-avec-prix',avecPrix);
          s('catalog-last-run',  lastRun);
          s('sourcing-last-run', lastRun);

          // KPIs accueil
          s('acc-kpi-total',     total);
          s('acc-kpi-eligible',  eligible);
          s('acc-kpi-score70',   score70);
          s('acc-kpi-avec-prix', avecPrix);
          s('acc-last-scan',     lastRun);

          // Date accueil
          var dateEl = document.getElementById('accueil-date');
          if (dateEl) {
              var now = new Date();
              dateEl.textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
          }

          renderRawTab();
          renderDealsTab();
          renderCatalogTable();
          _renderAccueilTopDeals();
      })
      .catch(function(e) { _showRawEmpty('Erreur connexion Supabase'); console.error('[OA]', e); });
}

// ── Top deals pour la page Accueil ───────────────────────────────────────────
function _renderAccueilTopDeals() {
    var el = document.getElementById('acc-top-deals');
    if (!el) return;

    var top5 = _oaData.slice(0, 5); // already sorted by score desc
    if (!top5.length) {
        el.innerHTML = '<div class="text-center text-gray-400 text-sm py-8">Aucun deal aujourd\'hui</div>';
        return;
    }

    el.innerHTML = top5.map(function(p) {
        var scoreColor = (p.score || 0) >= 70 ? 'bg-green-100 text-green-700'
                       : (p.score || 0) >= 40 ? 'bg-amber-100 text-amber-700'
                       : 'bg-gray-100 text-gray-500';
        var amzUrl = p.asin ? 'https://www.amazon.' + (MP_DOMAINS[p.mp] || 'fr') + '/dp/' + p.asin : '#';
        var eligBadge = p.statut === 'ELIGIBLE'
            ? '<span class="bg-green-100 text-green-700 text-[10px] px-1.5 py-0.5 rounded font-semibold">✓ Éligible</span>'
            : p.statut === 'RESTRICTED'
            ? '<span class="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-semibold">✗ Restreint</span>'
            : '';
        return '<div class="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition">'
            + '<span class="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ' + scoreColor + '">' + (p.score || '?') + '</span>'
            + '<div class="flex-1 min-w-0">'
                + '<a href="' + amzUrl + '" target="_blank" class="text-sm font-semibold text-gray-800 hover:text-indigo-600 block truncate">' + (p.titre || p.asin || '—').slice(0, 60) + '</a>'
                + '<div class="text-xs text-gray-400 font-mono">' + (p.asin || '') + (p.categorie ? ' · ' + p.categorie : '') + '</div>'
            + '</div>'
            + '<div class="shrink-0 text-right">'
                + (p.moy90j ? '<div class="text-sm font-bold text-gray-800">' + p.moy90j.toFixed(2) + '€</div>' : '')
                + eligBadge
            + '</div>'
            + '</div>';
    }).join('');
}

// ── Switcher onglets ──────────────────────────────────────────────────────────
function switchOATab(tab) {
    _oaTab = tab;
    var raw   = document.getElementById('oa-tab-raw');
    var deals = document.getElementById('oa-tab-deals');
    var btnR  = document.getElementById('oa-tab-btn-raw');
    var btnD  = document.getElementById('oa-tab-btn-deals');

    if (tab === 'raw') {
        if (raw)   raw.classList.remove('hidden');
        if (deals) deals.classList.add('hidden');
        if (btnR)  { btnR.classList.add('text-indigo-600', 'border-indigo-600'); btnR.classList.remove('text-gray-400', 'border-transparent'); }
        if (btnD)  { btnD.classList.remove('text-indigo-600', 'border-indigo-600'); btnD.classList.add('text-gray-400', 'border-transparent'); }
    } else {
        if (raw)   raw.classList.add('hidden');
        if (deals) deals.classList.remove('hidden');
        if (btnD)  { btnD.classList.add('text-indigo-600', 'border-indigo-600'); btnD.classList.remove('text-gray-400', 'border-transparent'); }
        if (btnR)  { btnR.classList.remove('text-indigo-600', 'border-indigo-600'); btnR.classList.add('text-gray-400', 'border-transparent'); }
    }
}

// ── Helpers row builders ──────────────────────────────────────────────────────
function _buildRawRow(p) {
    var scoreColor = (p.score || 0) >= 70 ? 'bg-green-100 text-green-700'
                   : (p.score || 0) >= 40 ? 'bg-amber-100 text-amber-700'
                   : 'bg-gray-100 text-gray-500';

    var amzUrl = p.asin ? 'https://www.amazon.' + (MP_DOMAINS[p.mp] || 'fr') + '/dp/' + p.asin : '#';

    var eligBadge = p.statut === 'ELIGIBLE'
        ? '<span class="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">✓ Éligible</span>'
        : p.statut === 'RESTRICTED'
        ? '<span class="bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">✗ Restreint</span>'
        : '<span class="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">À vérif.</span>';

    var amzBadge = p.amzEnStock
        ? '<span class="bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">Concurrence</span>'
        : '<span class="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">Libre</span>';

    var gainCell = p.gainVsFR != null
        ? '<span class="font-bold ' + (p.gainVsFR > 0 ? 'text-green-600' : 'text-red-500') + '">'
            + (p.gainVsFR > 0 ? '+' : '') + p.gainVsFR.toFixed(2) + '€</span>'
        : '<span class="text-gray-300">—</span>';

    var feeCell = function(v) { return v != null ? v.toFixed(2) + '€' : '<span class="text-gray-300">—</span>'; };
    var pctCell = function(v) { return v != null ? v.toFixed(1) + '%' : '<span class="text-gray-300">—</span>'; };
    var priceCell = function(v) { return v ? v.toFixed(2) + '€' : '<span class="text-gray-300">—</span>'; };

    // Col 19 — Meilleure marketplace
    var bestMPCell = p.bestMP
        ? (MP_FLAGS[p.bestMP] || '') + ' ' + p.bestMP
        : '<span class="text-gray-300">—</span>';

    // Col 22 — Alerte arbitrage
    var alerteCell = p.alerte
        ? '<span class="text-amber-600 font-semibold">⚡ ' + p.alerte + '</span>'
        : '<span class="text-gray-300">—</span>';

    // Col 23 — Sourcing (lien Google Shopping)
    var sourcingCell = p.lienGS
        ? '<a href="' + p.lienGS + '" target="_blank" class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold whitespace-nowrap">🔍 GS</a>'
        : '<span class="text-gray-300">—</span>';

    return '<tr class="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">'
        // 1 — Score
        + '<td class="p-2 text-center"><span class="font-bold px-1.5 py-0.5 rounded ' + scoreColor + '">' + (p.score || '?') + '</span></td>'
        // 2 — Statut
        + '<td class="p-2 text-center">' + eligBadge + '</td>'
        // 3 — Titre
        + '<td class="p-2"><a href="' + amzUrl + '" target="_blank" class="font-semibold text-gray-800 hover:text-indigo-600 leading-tight block truncate max-w-[180px]" title="' + (p.titre || '') + '">' + (p.titre || '—').slice(0, 50) + '</a></td>'
        // 4 — ASIN
        + '<td class="p-2 font-mono text-gray-500 whitespace-nowrap">' + (p.asin || '—') + '</td>'
        // 5 — Catégorie
        + '<td class="p-2 text-gray-500 whitespace-nowrap">' + (p.categorie || '—') + '</td>'
        // 6 — BSR
        + '<td class="p-2 text-center font-mono text-gray-600">' + (p.bsr ? '#' + Number(p.bsr).toLocaleString('fr') : '—') + '</td>'
        // 7 — Vendeurs FBA
        + '<td class="p-2 text-center font-semibold">' + (p.vendeurs != null ? p.vendeurs : '?') + '</td>'
        // 8 — Amazon vendeur
        + '<td class="p-2 text-center">' + amzBadge + '</td>'
        // 9 — Buy Box actuel FR
        + '<td class="p-2 text-center font-bold">' + priceCell(p.buyBoxFR) + '</td>'
        // 10 — Buy Box moy 90j
        + '<td class="p-2 text-center font-bold text-gray-800">' + priceCell(p.moy90j) + '</td>'
        // 11 — Buy Box min 90j
        + '<td class="p-2 text-center text-gray-500">' + priceCell(p.min90j) + '</td>'
        // 12 — Referral fee
        + '<td class="p-2 text-center text-orange-500">' + feeCell(p.referralFee) + '</td>'
        // 13 — Frais FBA
        + '<td class="p-2 text-center text-red-400">' + feeCell(p.fraisFba) + '</td>'
        // 14 — Envoi FBA
        + '<td class="p-2 text-center text-red-400">' + feeCell(p.envoiFba) + '</td>'
        // 15 — Frais EFN
        + '<td class="p-2 text-center text-red-400">' + feeCell(p.fraisEfn) + '</td>'
        // 16 — URSSAF
        + '<td class="p-2 text-center text-purple-500">' + feeCell(p.urssaf) + '</td>'
        // 17 — Total frais
        + '<td class="p-2 text-center font-bold text-red-500">' + feeCell(p.frais) + '</td>'
        // 18 — ROI estimé FR (%)
        + '<td class="p-2 text-center font-semibold ' + ((p.roiFr || 0) >= 25 ? 'text-green-600' : 'text-gray-500') + '">' + pctCell(p.roiFr) + '</td>'
        // 19 — Meilleure marketplace
        + '<td class="p-2 text-center font-semibold">' + bestMPCell + '</td>'
        // 20 — ROI meilleur (%)
        + '<td class="p-2 text-center font-semibold ' + ((p.roiMeilleur || 0) >= 25 ? 'text-green-600' : 'text-gray-500') + '">' + pctCell(p.roiMeilleur) + '</td>'
        // 21 — Gain vs FR
        + '<td class="p-2 text-center">' + gainCell + '</td>'
        // 22 — Alerte arbitrage
        + '<td class="p-2 text-center">' + alerteCell + '</td>'
        // 23 — Sourcing
        + '<td class="p-2 text-center">' + sourcingCell + '</td>'
        + '</tr>';
}

// ── TAB : Analyse (données brutes) — 12 colonnes ──────────────────────────────
function renderRawTab() {
    var tbody = document.getElementById('raw-tbody');
    if (!tbody) return;

    if (!_oaData.length) {
        _showRawEmpty('Aucune donnée — lance python main.py sur ton PC');
        return;
    }

    tbody.innerHTML = _oaData.map(_buildRawRow).join('');
}

function _showRawEmpty(msg) {
    var tbody = document.getElementById('raw-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="23" class="p-10 text-center text-gray-400">'
        + '<i class="fas fa-database text-3xl mb-3 block text-gray-300"></i>'
        + '<p class="font-medium">' + msg + '</p></td></tr>';
}

// ── Catalogue (section-oa-catalogue) — browse/filter ─────────────────────────
function renderCatalogTable(data) {
    var tbody = document.getElementById('cat-tbody');
    if (!tbody) return;

    var items = data !== undefined ? data : _oaData;

    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="p-10 text-center text-gray-400">'
            + '<i class="fas fa-store text-3xl mb-3 block text-gray-300"></i>'
            + '<p class="font-medium">Catalogue vide</p>'
            + '<p class="text-xs mt-1">Lance <code class="bg-gray-100 px-1 rounded text-indigo-600">python main.py</code> pour remplir le catalogue</p>'
            + '</td></tr>';
        return;
    }

    var label = document.getElementById('cat-count-label');
    if (label) label.textContent = items.length + ' produit' + (items.length !== 1 ? 's' : '');

    tbody.innerHTML = items.map(function(p) {
        var scoreColor = (p.score || 0) >= 70 ? 'bg-green-100 text-green-700'
                       : (p.score || 0) >= 40 ? 'bg-amber-100 text-amber-700'
                       : 'bg-gray-100 text-gray-500';

        var amzUrl = p.asin ? 'https://www.amazon.fr/dp/' + p.asin : '#';

        var eligBadge = p.statut === 'ELIGIBLE'
            ? '<span class="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">✓</span>'
            : p.statut === 'RESTRICTED'
            ? '<span class="bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">✗</span>'
            : '<span class="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">?</span>';

        var amzBadge = p.amzEnStock
            ? '<span class="bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[10px]">AMZ</span>'
            : '<span class="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px]">Libre</span>';

        var otherPrices = [['DE', p.buyBoxDE], ['IT', p.buyBoxIT], ['ES', p.buyBoxES]]
            .filter(function(x) { return x[1]; })
            .map(function(x) { return (MP_FLAGS[x[0]] || '') + ' ' + x[1].toFixed(0) + '€'; })
            .join(' · ');

        return '<tr class="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">'
            + '<td class="p-2"><span class="text-xs font-bold px-1.5 py-0.5 rounded ' + scoreColor + '">' + (p.score || '?') + '</span></td>'
            + '<td class="p-2">'
                + '<a href="' + amzUrl + '" target="_blank" class="font-semibold text-gray-800 hover:text-indigo-600 text-xs leading-tight block truncate max-w-xs" title="' + (p.titre || '') + '">' + (p.titre || '').slice(0, 55) + '</a>'
                + '<div class="text-[10px] text-gray-400 font-mono">' + (p.asin || '') + (p.categorie ? ' · ' + p.categorie : '') + '</div>'
            + '</td>'
            + '<td class="p-2 text-center font-mono text-xs text-gray-600">' + (p.bsr ? '#' + Number(p.bsr).toLocaleString('fr') : '—') + '</td>'
            + '<td class="p-2 text-center font-semibold text-xs">' + (p.vendeurs != null ? p.vendeurs : '?') + '</td>'
            + '<td class="p-2 text-center font-bold text-xs">' + (p.buyBoxFR ? p.buyBoxFR.toFixed(2) + '€' : '—') + '</td>'
            + '<td class="p-2 text-center text-xs">'
                + (p.moy90j ? '<div class="font-bold text-gray-800">' + p.moy90j.toFixed(2) + '€</div>' : '—')
                + (p.min90j ? '<div class="text-[10px] text-gray-400">min ' + p.min90j.toFixed(2) + '€</div>' : '')
            + '</td>'
            + '<td class="p-2 text-center text-[10px] text-gray-500 leading-snug">' + (otherPrices || '—') + '</td>'
            + '<td class="p-2 text-center text-xs text-red-500 font-semibold">' + (p.frais ? p.frais.toFixed(2) + '€' : '—') + '</td>'
            + '<td class="p-2 text-center text-[10px]">' + eligBadge + '</td>'
            + '<td class="p-2 text-center text-[10px]">' + amzBadge + '</td>'
            + '</tr>';
    }).join('');
}

function applyCatalogFilters() {
    var search    = ((document.getElementById('cat-search')        || {}).value || '').toLowerCase().trim();
    var statut    = ((document.getElementById('cat-statut-filter') || {}).value || 'all');
    var minScore  = parseInt((document.getElementById('cat-min-score') || {}).value) || 0;
    var maxBsr    = parseInt((document.getElementById('cat-max-bsr')   || {}).value) || 0;

    var filtered = _oaData.filter(function(p) {
        if (search && !(
            (p.titre  || '').toLowerCase().indexOf(search) >= 0 ||
            (p.asin   || '').toLowerCase().indexOf(search) >= 0
        )) return false;
        if (statut !== 'all' && p.statut !== statut) return false;
        if ((p.score || 0) < minScore) return false;
        if (maxBsr > 0 && p.bsr && p.bsr > maxBsr) return false;
        return true;
    });

    renderCatalogTable(filtered);
}

function resetCatalogFilters() {
    var ids = ['cat-search', 'cat-min-score', 'cat-max-bsr'];
    ids.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = id === 'cat-min-score' ? '0' : '';
    });
    var sel = document.getElementById('cat-statut-filter');
    if (sel) sel.value = 'all';
    renderCatalogTable(_oaData);
}

// ── TAB : Deals (éligibles seulement) — 11 colonnes ──────────────────────────
function renderDealsTab() {
    var tbody = document.getElementById('deals-tbody');
    if (!tbody) return;

    var minScore    = parseInt((document.getElementById('deal-min-score')    || {}).value) || 0;
    var maxBsr      = parseInt((document.getElementById('deal-max-bsr')      || {}).value) || 0;
    var eligOnly    = (document.getElementById('deal-eligible-only') || {}).checked;
    var noAmz       = (document.getElementById('deal-no-amz')        || {}).checked;

    var data = _oaData.filter(function(p) {
        if ((p.score || 0) < minScore) return false;
        if (maxBsr > 0 && p.bsr && p.bsr > maxBsr) return false;
        if (eligOnly && p.statut !== 'ELIGIBLE') return false;
        if (noAmz && p.amzEnStock) return false;
        return true;
    });

    var label = document.getElementById('deals-count-label');
    if (label) label.textContent = data.length + ' deal' + (data.length !== 1 ? 's' : '');

    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="11" class="p-10 text-center text-gray-400">'
            + '<i class="fas fa-search-dollar text-3xl mb-3 block text-gray-300"></i>'
            + '<p class="font-medium">Aucun deal avec ces filtres</p></td></tr>';
        return;
    }

    tbody.innerHTML = data.map(function(p) {
        var scoreColor = (p.score || 0) >= 70 ? 'bg-green-100 text-green-700'
                       : (p.score || 0) >= 40 ? 'bg-amber-100 text-amber-700'
                       : 'bg-gray-100 text-gray-500';

        var hasPrix    = p.prixAchat > 0;
        var profitable = hasPrix && (p.roi || 0) >= 25 && (p.netProfit || 0) >= 2;
        var rowBorder  = profitable ? 'border-l-4 border-l-green-400 bg-green-50'
                       : hasPrix && (p.netProfit || 0) > 0 ? 'border-l-4 border-l-amber-300 bg-amber-50'
                       : hasPrix && (p.netProfit || 0) < 0 ? 'border-l-4 border-l-red-300 bg-red-50/40'
                       : 'border-l-4 border-l-transparent';

        var amzUrl = p.asin ? 'https://www.amazon.' + (MP_DOMAINS[p.mp] || 'fr') + '/dp/' + p.asin : '#';

        var profitColor = profitable ? 'text-green-600'
                        : (p.netProfit || 0) > 0 ? 'text-amber-600'
                        : 'text-red-500';

        var noPrix = '<span class="text-gray-300 text-xs" title="Entre le prix achat">—</span>';

        var profitCell = hasPrix && p.netProfit != null
            ? '<span class="font-bold ' + profitColor + '">' + (p.netProfit >= 0 ? '+' : '') + p.netProfit.toFixed(2) + '€</span>'
            : noPrix;

        var roiCell = hasPrix && p.roi != null
            ? '<span class="font-bold ' + profitColor + '">' + p.roi.toFixed(0) + '%</span>'
            : noPrix;

        var currentPrix = p.prixAchat ? p.prixAchat.toFixed(2) : '';

        // Colonnes: Titre | ASIN | Marketplace | Prix vente 90j moy | Frais Amazon | Score | Alerte | Fournisseur (GS) | Prix achat (input) | Profit net | ROI
        return '<tr class="' + rowBorder + ' border-b border-gray-50 hover:bg-gray-50/50 transition-colors">'
            + '<td class="p-3">'
                + '<a href="' + amzUrl + '" target="_blank" class="font-semibold text-gray-800 hover:text-indigo-600 text-xs leading-tight block truncate max-w-xs" title="' + (p.titre || '') + '">' + (p.titre || '').slice(0, 55) + '</a>'
                + (p.alerte ? '<div class="text-[10px] text-amber-600 font-semibold mt-0.5">⚡ ' + p.alerte + '</div>' : '')
            + '</td>'
            + '<td class="p-3 font-mono text-xs text-gray-500">' + (p.asin || '—') + '</td>'
            + '<td class="p-3 text-center"><span class="font-semibold text-sm">' + (MP_FLAGS[p.mp] || '') + ' ' + (p.mp || '—') + '</span></td>'
            + '<td class="p-3 text-center font-bold text-gray-800">'
                + (p.moy90j ? p.moy90j.toFixed(2) + '€' : '<span class="text-gray-300 text-xs">—</span>')
            + '</td>'
            + '<td class="p-3 text-center text-xs text-red-500 font-semibold">' + (p.frais ? p.frais.toFixed(2) + '€' : '—') + '</td>'
            + '<td class="p-3 text-center"><span class="text-xs font-bold px-1.5 py-0.5 rounded ' + scoreColor + '">' + (p.score || '?') + '</span></td>'
            + '<td class="p-3 text-center text-xs text-amber-600">' + (p.alerte || '—') + '</td>'
            + '<td class="p-3 text-center">'
                + (p.lienGS ? '<a href="' + p.lienGS + '" target="_blank" class="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold whitespace-nowrap">🔍 Trouver</a>' : '<span class="text-gray-300 text-xs">—</span>')
            + '</td>'
            + '<td class="p-3 text-center bg-indigo-50/30">'
                + '<input type="number" step="0.01" min="0" placeholder="Prix €" value="' + currentPrix + '" '
                + 'class="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-sm text-center focus:border-indigo-400 outline-none bg-white" '
                + 'onchange="saveOAPrixAchat(' + JSON.stringify(p.id) + ', parseFloat(this.value)||0)" />'
            + '</td>'
            + '<td class="p-3 text-center bg-green-50/30">' + profitCell + '</td>'
            + '<td class="p-3 text-center bg-green-50/30">' + roiCell + '</td>'
            + '</tr>';
    }).join('');
}

// ── Sauvegarder prix_achat ────────────────────────────────────────────────────
function saveOAPrixAchat(dealId, prix) {
    var sb = _getOAClient();
    if (!sb || !dealId) return;

    sb.from('deals').update({ prix_achat: prix }).eq('id', dealId).then(function(res) {
        if (res.error) { console.error('[OA] Save error', res.error); return; }

        for (var i = 0; i < _oaData.length; i++) {
            if (_oaData[i].id === dealId) {
                var p = _oaData[i];
                p.prixAchat = prix;
                if (prix > 0 && p.amzPrice && p.frais != null) {
                    p.netProfit = Math.round((p.amzPrice - p.frais - prix) * 100) / 100;
                    p.roi       = p.netProfit > 0 ? Math.round(p.netProfit / prix * 1000) / 10 : 0;
                } else {
                    p.netProfit = null;
                    p.roi       = null;
                }
                break;
            }
        }

        // Mettre à jour le compteur KPI
        var avecPrix = _oaData.filter(function(d) { return d.prixAchat > 0; }).length;
        var s = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
        s('kpi-oa-avec-prix',  avecPrix);
        s('acc-kpi-avec-prix', avecPrix);

        renderDealsTab();
    });
}
