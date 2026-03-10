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

    return {
        id:          d.id,
        asin:        d.asin,
        titre:       d.titre,
        categorie:   d.categorie,
        bsr:         d.bsr_fr,
        vendeurs:    d.nb_vendeurs_fba,
        amzEnStock:  d.amazon_en_stock,
        buyBoxFR:    d.buy_box_fr,
        buyBoxDE:    d.buy_box_de,
        buyBoxIT:    d.buy_box_it,
        buyBoxES:    d.buy_box_es,
        moy90j:      d.buy_box_90j_moy_fr,
        min90j:      d.buy_box_90j_min_fr,
        frais:       d.total_frais,
        statut:      d.statut,
        mp:          mp,
        amzPrice:    amzPrice,
        prixAchat:   d.prix_achat || null,
        netProfit:   netProfit,
        roi:         roi,
        score:       d.score_deal,
        alerte:      d.alerte_arbitrage,
        lienGS:      d.lien_google_shopping,
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

          // KPIs
          var s = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
          s('kpi-oa-total',    _oaData.length);
          s('kpi-oa-score70',  _oaData.filter(function(d) { return (d.score || 0) >= 70; }).length);
          s('kpi-oa-eligible', _oaData.filter(function(d) { return d.statut === 'ELIGIBLE'; }).length);
          s('kpi-oa-avec-prix',_oaData.filter(function(d) { return d.prixAchat > 0; }).length);
          s('catalog-last-run', _oaData.length > 0 ? 'Aujourd\'hui' : 'Aucun run');

          renderRawTab();
          renderDealsTab();
      })
      .catch(function(e) { _showRawEmpty('Erreur connexion Supabase'); console.error('[OA]', e); });
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

// ── TAB : Données brutes ──────────────────────────────────────────────────────
function renderRawTab() {
    var tbody = document.getElementById('raw-tbody');
    if (!tbody) return;

    if (!_oaData.length) {
        _showRawEmpty('Aucune donnée — lance python main.py sur ton PC');
        return;
    }

    tbody.innerHTML = _oaData.map(function(p) {
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

        var otherPrices = [['DE', p.buyBoxDE], ['IT', p.buyBoxIT], ['ES', p.buyBoxES]]
            .filter(function(x) { return x[1]; })
            .map(function(x) { return (MP_FLAGS[x[0]] || '') + ' ' + x[1].toFixed(0) + '€'; })
            .join(' · ');

        return '<tr class="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">'
            + '<td class="p-2"><span class="text-xs font-bold px-1.5 py-0.5 rounded ' + scoreColor + '">' + (p.score || '?') + '</span></td>'
            + '<td class="p-2">'
                + '<a href="' + amzUrl + '" target="_blank" class="font-semibold text-gray-800 hover:text-indigo-600 text-xs leading-tight block truncate max-w-xs" title="' + (p.titre || '') + '">' + (p.titre || '').slice(0, 55) + '</a>'
                + '<div class="text-[10px] text-gray-400 font-mono">' + (p.asin || '') + ' · ' + (p.categorie || '') + '</div>'
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

function _showRawEmpty(msg) {
    var tbody = document.getElementById('raw-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="p-10 text-center text-gray-400">'
        + '<i class="fas fa-database text-3xl mb-3 block text-gray-300"></i>'
        + '<p class="font-medium">' + msg + '</p></td></tr>';
}

// ── TAB : Deals ───────────────────────────────────────────────────────────────
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
        tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-gray-400">'
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

        var noPrix = '<span class="text-gray-300 text-xs" title="Entre le prix achat →">—</span>';

        var profitCell = hasPrix && p.netProfit != null
            ? '<span class="font-bold ' + profitColor + '">' + (p.netProfit >= 0 ? '+' : '') + p.netProfit.toFixed(2) + '€</span>'
            : noPrix;

        var roiCell = hasPrix && p.roi != null
            ? '<span class="font-bold ' + profitColor + '">' + p.roi.toFixed(0) + '%</span>'
            : noPrix;

        var currentPrix = p.prixAchat ? p.prixAchat.toFixed(2) : '';

        return '<tr class="' + rowBorder + ' border-b border-gray-50 hover:bg-gray-50/50 transition-colors">'
            + '<td class="p-2"><span class="text-xs font-bold px-1.5 py-0.5 rounded ' + scoreColor + '">' + (p.score || '?') + '</span></td>'
            + '<td class="p-2">'
                + '<a href="' + amzUrl + '" target="_blank" class="font-semibold text-gray-800 hover:text-indigo-600 text-xs leading-tight block truncate max-w-xs" title="' + (p.titre || '') + '">' + (p.titre || '').slice(0, 55) + '</a>'
                + '<div class="text-[10px] text-gray-400 font-mono">' + (p.asin || '') + ' · ' + (p.categorie || '') + '</div>'
                + (p.alerte ? '<div class="text-[10px] text-amber-600 font-semibold">⚡ ' + p.alerte + '</div>' : '')
            + '</td>'
            + '<td class="p-2 text-center">'
                + (p.moy90j ? '<div class="font-bold text-sm text-gray-800">' + p.moy90j.toFixed(2) + '€</div>' : '<span class="text-gray-300 text-xs">—</span>')
                + (p.min90j ? '<div class="text-[10px] text-gray-400">min ' + p.min90j.toFixed(2) + '€</div>' : '')
            + '</td>'
            + '<td class="p-2 text-center"><span class="font-semibold text-sm">' + (MP_FLAGS[p.mp] || '') + ' ' + p.mp + '</span></td>'
            + '<td class="p-2 text-center text-xs text-red-500 font-semibold">' + (p.frais ? p.frais.toFixed(2) + '€' : '—') + '</td>'
            + '<td class="p-2 text-center">'
                + (p.lienGS ? '<a href="' + p.lienGS + '" target="_blank" class="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold mb-1 whitespace-nowrap">🔍 Trouver</a><br>' : '')
                + '<input type="number" step="0.01" min="0" placeholder="Prix €" value="' + currentPrix + '" '
                + 'class="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-sm text-center focus:border-indigo-400 outline-none bg-white" '
                + 'onchange="saveOAPrixAchat(' + JSON.stringify(p.id) + ', parseFloat(this.value)||0)" />'
            + '</td>'
            + '<td class="p-2 text-center">' + profitCell + '</td>'
            + '<td class="p-2 text-center">' + roiCell + '</td>'
            + '<td class="p-2 text-center">'
                + (p.asin ? '<a href="' + amzUrl + '" target="_blank" class="text-xs text-orange-500 hover:underline font-semibold">Amazon ↗</a>' : '')
            + '</td>'
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
        var el = document.getElementById('kpi-oa-avec-prix');
        if (el) el.textContent = _oaData.filter(function(d) { return d.prixAchat > 0; }).length;

        renderDealsTab();
    });
}

// ── Compatibilité — évite erreurs si app.js appelle ces fonctions ─────────────
function renderCatalogTable() { renderRawTab(); }
function filterCatalog()      {}
function resetCatalogFilters(){}
