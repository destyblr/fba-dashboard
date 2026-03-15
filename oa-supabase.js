// ─────────────────────────────────────────────────────────────────────────────
// OA Supabase — Python local → Supabase → Dashboard
// ─────────────────────────────────────────────────────────────────────────────

var OA_SUPABASE_URL = 'https://ittbipdvkutbiiqeukdg.supabase.co';
var OA_SUPABASE_KEY = 'sb_publishable_uC4DebkXoayJkKDabA_A1w_7ft2qxwd';

var _sbOAClient  = null;
var _oaData      = [];           // deals du jour (mapped)
var _cbData      = [];           // tous deals avec prix EU (cross-border)
var _runData     = [];           // historique des runs
var _poolData    = [];           // pool ELIGIBLE persistant
var _oaTab       = 'deals';      // onglet actif

var MP_FLAGS   = { FR: '🇫🇷', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸' };
var MP_DOMAINS = { FR: 'fr',   DE: 'de',   IT: 'it',   ES: 'es'   };

// ── TVA EU & frais de stockage ────────────────────────────────────────────────
var TVA_EU = { DE: 0.19, IT: 0.22, ES: 0.21 };
var STORAGE_DAYS    = 30;    // jours rotation estimée (paramètre)
var STORAGE_RATE    = 0.26;  // €/m³/jour (Amazon Jan-Sep)
var STORAGE_VOL_M3  = {      // volume estimé par size_tier
    'small_standard':          0.0003,
    'large_standard_400':      0.0010,
    'large_standard_over_400': 0.0020,
    'extra_large':             0.0050,
};

// ── Toggle URSSAF (persisté en localStorage) ──────────────────────────────────
var _urssafOn = (localStorage.getItem('oa_urssaf') === 'true');

// ── Frais prep (persisté en localStorage) ─────────────────────────────────────
var _prepFee = parseFloat(localStorage.getItem('oa_prep_fee') || '0.50');
var _prepOn  = (localStorage.getItem('oa_prep') === 'true');

function _syncToggleBtns() {
    var uCls = _urssafOn ? 'text-xs px-3 py-1 rounded-full font-semibold bg-purple-100 text-purple-700 border border-purple-300 cursor-pointer'
                         : 'text-xs px-3 py-1 rounded-full font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-pointer line-through';
    var pCls = _prepOn   ? 'text-xs px-3 py-1 rounded-full font-semibold bg-orange-100 text-orange-700 border border-orange-300 cursor-pointer'
                         : 'text-xs px-3 py-1 rounded-full font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-pointer line-through';
    ['btn-urssaf-toggle', 'btn-urssaf-toggle-cb'].forEach(function(id) {
        var b = document.getElementById(id);
        if (b) { b.className = uCls; b.textContent = _urssafOn ? 'Avec URSSAF' : 'Sans URSSAF'; }
    });
    ['btn-prep-toggle', 'btn-prep-toggle-cb', 'btn-prep-toggle-param'].forEach(function(id) {
        var b = document.getElementById(id);
        if (b) { b.className = pCls; b.textContent = _prepOn ? 'Avec prep' : 'Sans prep'; }
    });
    // Show/hide URSSAF columns
    ['th-deals-urssaf', 'th-cb-urssaf'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = _urssafOn ? '' : 'none';
    });
    // Show/hide Prep columns
    ['th-deals-prep', 'th-cb-prep'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = _prepOn ? '' : 'none';
    });
}

function toggleUrssaf() {
    _urssafOn = !_urssafOn;
    localStorage.setItem('oa_urssaf', _urssafOn ? 'true' : 'false');
    _syncToggleBtns();
    renderDealsTab();
    renderCrossBorderTab();
}

function togglePrep() {
    _prepOn = !_prepOn;
    localStorage.setItem('oa_prep', _prepOn ? 'true' : 'false');
    _syncToggleBtns();
    renderDealsTab();
    renderCrossBorderTab();
}

function updatePrepFee(val) {
    var v = parseFloat(val);
    if (isNaN(v) || v < 0) return;
    _prepFee = v;
    localStorage.setItem('oa_prep_fee', v.toString());
    // Sync les deux inputs (toggle bar + Paramètres)
    ['oa-param-prep-fee'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && parseFloat(el.value) !== v) el.value = v;
    });
    if (_prepOn) {
        renderRawTab();
        renderDealsTab();
        renderCrossBorderTab();
    }
}

function updateStorageDays(val) {
    var v = parseInt(val);
    if (isNaN(v) || v < 1) return;
    STORAGE_DAYS = v;
    renderRawTab();
    renderDealsTab();
    renderCrossBorderTab();
}

function _initOAParamInputs() {
    var prep = document.getElementById('oa-param-prep-fee');
    if (prep) prep.value = _prepFee;
    var days = document.getElementById('oa-param-storage-days');
    if (days) days.value = STORAGE_DAYS;
    _syncToggleBtns();
}

// ── Calcul frais cross-border (en JS, avec TVA EU) ────────────────────────────
function _calcCBFees(d) {
    var mp      = d.bestMP && d.bestMP !== 'FR' ? d.bestMP : (d.mp || 'DE');
    var priceEU = { DE: d.buyBoxDE, IT: d.buyBoxIT, ES: d.buyBoxES }[mp] || d.bestPrice || 0;
    if (!priceEU) return null;

    var tvaRate  = TVA_EU[mp] || 0;
    var tva      = Math.round(priceEU * tvaRate / (1 + tvaRate) * 100) / 100;
    var priceHT  = Math.round(priceEU / (1 + tvaRate) * 100) / 100;

    var refRate  = (d.categorie && d.categorie.indexOf('Electronics') >= 0) ? 0.08 : 0.15;
    var commis   = Math.round(priceEU * refRate * 100) / 100;
    var fba      = d.fraisFba  || 7.50;
    var efn      = d.fraisEfn  || 5.00;
    var envoi    = d.envoiFba  || 1.20;
    var urssaf   = _urssafOn ? Math.round(priceHT * 0.123 * 100) / 100 : 0;

    var vol      = STORAGE_VOL_M3[d.sizeTier] || STORAGE_VOL_M3['large_standard_400'];
    var stockage = Math.round(vol * STORAGE_RATE * STORAGE_DAYS * 100) / 100;
    var prep     = _prepOn ? _prepFee : 0;

    var total    = Math.round((tva + commis + fba + efn + envoi + urssaf + stockage + prep) * 100) / 100;

    var prixAchat = (d.moy90j || d.buyBoxFR || 0) * 0.70;
    var profit    = prixAchat > 0 ? Math.round((priceHT - total - prixAchat) * 100) / 100 : null;
    var roi       = (prixAchat > 0 && profit != null) ? Math.round(profit / prixAchat * 1000) / 10 : null;

    return { mp, priceEU, priceHT, tvaRate, tva, commis, refRate, fba, efn, envoi,
             urssaf, stockage, prep, total, prixAchat, profit, roi };
}

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
        stockageFba:  d.stockage_fba,
        fraisEfn:     d.frais_efn,
        urssaf:       d.urssaf,
        frais:        d.total_frais,
        roiFr:        d.roi_fr,
        profitNetFr:  d.profit_net_fr,
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
        weightG:      d.weight_g,
        sizeTier:     d.size_tier,
        verdict:      d.verdict    || null,
        analyseIa:    d.analyse_ia || null,
        dateScan:     d.date_scan  || null,
    };
}

// ── Chargement depuis Supabase ────────────────────────────────────────────────
function loadCatalog() {
    var sb = _getOAClient();
    if (!sb) { _showRawEmpty('Supabase non configuré'); return; }

    var since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    sb.from('deals')
      .select('*')
      .gte('date_scan', since + 'T00:00:00')
      .or('source.is.null,source.neq.cross_border')
      .order('score_deal', { ascending: false })
      .then(function(res) {
          if (res.error) { _showRawEmpty('Erreur : ' + res.error.message); return; }

          _oaData = (res.data || []).map(_mapDeal);

          var total     = _oaData.length;
          var score70   = _oaData.filter(function(d) { return (d.score || 0) >= 70; }).length;
          var eligible  = _oaData.filter(function(d) { return d.statut === 'ELIGIBLE'; }).length;
          var avecPrix  = _oaData.filter(function(d) { return d.prixAchat > 0; }).length;
          var lastRun   = total > 0 && _oaData[0].dateScan
              ? new Date(_oaData[0].dateScan).toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})
              : 'Aucun run';

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

          _initOAParamInputs();
          renderRawTab();
          renderDealsTab();
          renderCatalogTable();
          _renderAccueilTopDeals();
          loadCrossBorderData();
      })
      .catch(function(e) { _showRawEmpty('Erreur connexion Supabase'); console.error('[OA]', e); });
}

// ── Cross Border — tous les ASINs en base avec prix EU ───────────────────────
function loadCrossBorderData() {
    var sb = _getOAClient();
    if (!sb) return;

    sb.from('deals')
      .select('*')
      .or('source.eq.cross_border,buy_box_de.not.is.null,buy_box_it.not.is.null,buy_box_es.not.is.null')
      .order('roi_meilleur', { ascending: false })
      .limit(200)
      .then(function(res) {
          if (res.error) {
              var cbTb = document.getElementById('crossborder-tbody');
              if (cbTb) cbTb.innerHTML = '<tr><td colspan="17" class="p-10 text-center text-red-400">Erreur : ' + res.error.message + '</td></tr>';
              return;
          }
          _cbData = (res.data || []).map(_mapDeal);
          renderCrossBorderTab();
      })
      .catch(function(e) { console.error('[CB]', e); });
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
    var tabs = ['raw', 'deals', 'crossborder', 'rapport', 'pool'];
    tabs.forEach(function(t) {
        var el  = document.getElementById('oa-tab-' + t);
        var btn = document.getElementById('oa-tab-btn-' + t);
        if (!el || !btn) return;
        if (t === tab) {
            el.classList.remove('hidden');
            btn.classList.add('text-indigo-600', 'border-indigo-600');
            btn.classList.remove('text-gray-400', 'border-transparent');
        } else {
            el.classList.add('hidden');
            btn.classList.remove('text-indigo-600', 'border-indigo-600');
            btn.classList.add('text-gray-400', 'border-transparent');
        }
    });
    if (tab === 'rapport' && !_runData.length) loadRunHistory();
    if (tab === 'pool' && !_poolData.length) loadPoolData();
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


    var pctCell = function(v) { return v != null ? v.toFixed(1) + '%' : '<span class="text-gray-300">—</span>'; };
    var priceCell = function(v) { return v ? v.toFixed(2) + '€' : '<span class="text-gray-300">—</span>'; };

    // Tooltips calcul frais
    var bb = p.moy90j || p.buyBoxFR || 0;
    var tierLabel = p.sizeTier || '?';
    var wg = p.weightG || 0;
    var cartonKg = wg > 0 ? (wg / 1000 * 10).toFixed(2) : '?';
    var refRate = p.categorie && (p.categorie.indexOf('Electronics') >= 0 || p.categorie.indexOf('Informatique') >= 0) ? '8%' : '15%';
    var tipReferral  = bb ? 'Buy Box moy 90j (' + bb.toFixed(2) + '€) × ' + refRate : 'Prix × ' + refRate;
    var tipFba       = 'Tier: ' + tierLabel + '\nGrille fixe Amazon selon poids/dimensions';
    var tipEnvoi     = wg ? wg + 'g × 10u/carton = ' + cartonKg + 'kg\nTarif colissimo au poids' : 'Tarif selon poids carton';
    var tipUrssaf    = bb ? 'Buy Box moy 90j (' + bb.toFixed(2) + '€) × 12.3%\nCotisation auto-entrepreneur' : 'Prix × 12.3%';
    var tipEfn       = 'Frais EFN vers Allemagne (DE)\nTier: ' + tierLabel + ' — grille cross-border Amazon';
    var tipPrep      = _prepOn
        ? 'Frais préparation/étiquetage : ' + _prepFee.toFixed(2) + '€/unité\n(Configurable dans Paramètres OA)'
        : 'Frais prep désactivés\n(Toggle "Avec prep" ou configurer dans Paramètres OA)';
    var tipTotal     = 'Commission Amz + Traitement FBA\n+ Envoi entrepôt + URSSAF'
        + (_prepOn ? ' + Prep' : '');
    var feeTip = function(v, tip) {
        return '<span title="' + tip + '" style="cursor:help;border-bottom:1px dotted #999">' + (v != null ? v.toFixed(2) + '€' : '—') + '</span>';
    };

    // Col 19 — Meilleure marketplace
    var bestMPCell = (p.bestMP && p.bestMP !== 'FR')
        ? MP_FLAGS[p.bestMP] + ' ' + p.bestMP
        : '<span class="text-gray-300">—</span>';

    // Col 22 — Alerte arbitrage
    var euPrices = [['🇩🇪 DE', p.buyBoxDE], ['🇮🇹 IT', p.buyBoxIT], ['🇪🇸 ES', p.buyBoxES]]
        .map(function(x) { return x[0] + ' : ' + (x[1] ? x[1].toFixed(2) + '€' : '—'); })
        .join('\n');
    var arbTip = 'Prix EU actuels :\n' + euPrices
        + '\n🇫🇷 FR : ' + (p.buyBoxFR ? p.buyBoxFR.toFixed(2) + '€' : '—')
        + (p.alerte ? '\n\n⚡ ' + p.alerte : '\n\nPas d\'écart ≥ 15% détecté.');
    var alerteCell = p.alerte
        ? '<span class="text-amber-600 font-semibold" title="' + arbTip + '" style="cursor:help">⚡ ' + p.alerte + '</span>'
        : '<span class="text-gray-300" title="' + arbTip + '" style="cursor:help">—</span>';

    // Col 23 — Sourcing (lien Google Shopping)
    var sourcingCell = p.lienGS
        ? '<a href="' + p.lienGS + '" target="_blank" class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold whitespace-nowrap">🔍 GS</a>'
        : '<span class="text-gray-300">—</span>';

    return '<tr class="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">'
        // 1 — Score
        + '<td class="p-1.5 text-center"><span class="font-bold px-1.5 py-0.5 rounded text-[11px] ' + scoreColor + '" title="Score 0-100&#10;BSR &lt; 5k → +40pts | &lt; 20k → +30pts | &lt; 50k → +20pts&#10;ROI ≥ 50% → +40pts | ≥ 35% → +30pts | ≥ 25% → +20pts&#10;Vendeurs FBA ≤ 3 → +20pts | ≤ 8 → +10pts&#10;Score ≥ 70 = deal intéressant" style="cursor:help">' + (p.score || '?') + '</span></td>'
        // 2 — Statut
        + '<td class="p-1.5 text-center">' + eligBadge + '</td>'
        // 3 — Titre
        + '<td class="p-1.5"><a href="' + amzUrl + '" target="_blank" class="font-semibold text-gray-800 hover:text-indigo-600 leading-tight block truncate max-w-[200px] md:max-w-xs" title="' + (p.titre || '') + '">' + (p.titre || '—').slice(0, 55) + '</a></td>'
        // 4 — ASIN (masqué sur mobile)
        + '<td class="p-1.5 font-mono text-gray-500 whitespace-nowrap hidden md:table-cell text-[10px]">' + (p.asin || '—') + '</td>'
        // 5 — Catégorie (masqué sur petits écrans)
        + '<td class="p-1.5 text-gray-500 whitespace-nowrap hidden sm:table-cell">' + (p.categorie || '—') + '</td>'
        // 6 — BSR
        + '<td class="p-1.5 text-center font-mono text-gray-600 whitespace-nowrap" title="Best Seller Rank" style="cursor:help">' + (p.bsr ? '#' + Number(p.bsr).toLocaleString('fr') : '—') + '</td>'
        // 7 — Vendeurs FBA
        + '<td class="p-1.5 text-center font-semibold">' + (p.vendeurs != null ? p.vendeurs : '?') + '</td>'
        // 8 — Amazon vendeur
        + '<td class="p-1.5 text-center">' + amzBadge + '</td>'
        // 9 — Buy Box actuel FR
        + '<td class="p-1.5 text-center font-bold whitespace-nowrap">' + priceCell(p.buyBoxFR) + '</td>'
        // 10 — Buy Box moy 90j
        + '<td class="p-1.5 text-center font-bold text-gray-800 whitespace-nowrap">' + priceCell(p.moy90j) + '</td>'
        // 11 — Buy Box min 90j (masqué sur petits écrans)
        + '<td class="p-1.5 text-center text-gray-500 whitespace-nowrap hidden sm:table-cell">' + priceCell(p.min90j) + '</td>'
        // 12 — Alerte arbitrage
        + '<td class="p-1.5 text-center whitespace-nowrap">' + alerteCell + '</td>'
        // 13 — Sourcing
        + '<td class="p-1.5 text-center">' + sourcingCell + '</td>'
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
    if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="p-10 text-center text-gray-400">'
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
        tbody.innerHTML = '<tr><td colspan="19" class="p-10 text-center text-gray-400">'
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
            + '<td class="p-3 text-center text-xs text-orange-500">' + (p.referralFee != null ? p.referralFee.toFixed(2) + '€' : '<span class="text-gray-300">—</span>') + '</td>'
            + '<td class="p-3 text-center text-xs text-orange-500">' + (p.fraisFba != null ? p.fraisFba.toFixed(2) + '€' : '<span class="text-gray-300">—</span>') + '</td>'
            + '<td class="p-3 text-center text-xs text-orange-500">' + (p.envoiFba != null ? p.envoiFba.toFixed(2) + '€' : '<span class="text-gray-300">—</span>') + '</td>'
            + (function() {
                var vol = STORAGE_VOL_M3[p.sizeTier] || STORAGE_VOL_M3['large_standard_400'];
                var stk = Math.round(vol * STORAGE_RATE * STORAGE_DAYS * 100) / 100;
                return '<td class="p-3 text-center text-xs text-gray-400">' + stk.toFixed(2) + '€</td>';
            })()
            + '<td style="' + (_urssafOn ? '' : 'display:none') + '" class="p-3 text-center text-xs text-orange-500">' + (p.urssaf != null ? p.urssaf.toFixed(2) + '€' : '—') + '</td>'
            + '<td style="' + (_prepOn ? '' : 'display:none') + '" class="p-3 text-center text-xs text-orange-500">' + (_prepFee.toFixed(2)) + '€</td>'
            + '<td class="p-3 text-center text-xs text-red-600 font-semibold">' + (p.frais != null ? p.frais.toFixed(2) + '€' : '—') + '</td>'
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
            + (function() {
                if (!p.verdict) return '<td class="p-3 text-center"><span class="text-gray-300 text-xs">—</span></td>';
                var cls = p.verdict === 'BUY'  ? 'bg-green-100 text-green-700 border border-green-300'
                        : p.verdict === 'RISKY' ? 'bg-amber-100 text-amber-700 border border-amber-300'
                        : 'bg-red-100 text-red-600 border border-red-300';
                var icon = p.verdict === 'BUY' ? '✅' : p.verdict === 'RISKY' ? '⚠️' : '❌';
                var tip = p.analyseIa ? ' title="' + p.analyseIa.replace(/"/g, '&quot;') + '"' : '';
                return '<td class="p-3 text-center"><span class="text-xs font-bold px-2 py-0.5 rounded-full cursor-help ' + cls + '"' + tip + '>' + icon + ' ' + p.verdict + '</span></td>';
            })()
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

// ── Cross Border Tab ──────────────────────────────────────────────────────────
function renderCrossBorderTab() {
    var tbody = document.getElementById('crossborder-tbody');
    if (!tbody) return;

    if (!_cbData.length) {
        tbody.innerHTML = '<tr><td colspan="17" class="p-10 text-center text-gray-400">'
            + '<i class="fas fa-globe-europe text-3xl mb-3 block text-gray-300"></i>'
            + '<p class="font-medium">Aucune opportunité cross-border</p>'
            + '<p class="text-xs mt-1">Lance <code class="bg-gray-100 px-1 rounded text-indigo-600">python main.py</code> avec tokens &ge; 250 pour activer Agent 2 EU</p>'
            + '</td></tr>';
        return;
    }

    var tip = function(v, t) {
        return '<span title="' + t + '" style="cursor:help;border-bottom:1px dotted #999">'
            + (v != null ? v.toFixed(2) + '€' : '<span class=\'text-gray-300\'>—</span>')
            + '</span>';
    };
    var pct = function(v, green) {
        if (v == null) return '<span class="text-gray-300">—</span>';
        var c = v >= (green || 25) ? 'text-green-600 font-bold' : v >= 0 ? 'text-amber-600 font-semibold' : 'text-red-500 font-semibold';
        return '<span class="' + c + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
    };
    var fmt = function(v) { return v != null ? v.toFixed(2) + '€' : '<span class="text-gray-300">—</span>'; };

    tbody.innerHTML = _cbData.map(function(d) {
        var f = _calcCBFees(d);
        if (!f) return '';

        var amzUrl = d.asin ? 'https://www.amazon.' + (MP_DOMAINS[f.mp] || 'de') + '/dp/' + d.asin : '#';
        var gsCell = d.lienGS
            ? '<a href="' + d.lienGS + '" target="_blank" class="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold">🔍 GS</a>'
            : '<span class="text-gray-300">—</span>';

        // Tooltips détaillés
        var tTva      = 'Prix TTC ' + f.mp + ' (' + f.priceEU.toFixed(2) + '€)\n× ' + (f.tvaRate * 100).toFixed(0) + '% TVA locale\n= ' + f.tva.toFixed(2) + '€ reversé à l\'état ' + f.mp;
        var tCommis   = 'Prix TTC (' + f.priceEU.toFixed(2) + '€) × ' + (f.refRate * 100).toFixed(0) + '%\nCommission Amazon';
        var tFba      = 'Tier: ' + (d.sizeTier || '?') + '\nTraitement FBA (grille fixe)';
        var tEfn      = 'Frais EFN FR → ' + f.mp + '\nExpédition depuis entrepôt FR au client EU';
        var tEnvoi    = (d.weightG || 0) + 'g — livraison à l\'entrepôt FR';
        var tUrssaf   = !_urssafOn ? 'URSSAF désactivé' : 'Prix HT (' + f.priceHT.toFixed(2) + '€) × 12.3%\nCotisation auto-entrepreneur';
        var tStockage = 'Vol. estimé (' + (d.sizeTier || '?') + ')\n× ' + STORAGE_RATE + '€/m³/j × ' + STORAGE_DAYS + ' jours';
        var tPrep     = _prepOn
            ? 'Frais préparation/étiquetage : ' + _prepFee.toFixed(2) + '€/unité\n(Configurable dans Paramètres OA)'
            : 'Frais prep désactivés';
        var tTotal    = 'TVA + Commission + FBA + EFN + Envoi' + (_urssafOn ? ' + URSSAF' : '') + ' + Stockage' + (_prepOn ? ' + Prep' : '');
        var tProfit   = 'Prix HT (' + f.priceHT.toFixed(2) + '€) − total frais (' + f.total.toFixed(2) + '€)\n− achat estimé (' + f.prixAchat.toFixed(2) + '€ = moy90j × 70%)'
            + (_prepOn ? '\n(Prep ' + _prepFee.toFixed(2) + '€ inclus)' : '');

        var profitColor = (f.profit || 0) >= 5 ? 'text-green-600 font-bold'
                        : (f.profit || 0) >= 0 ? 'text-amber-600 font-semibold'
                        : 'text-red-500 font-semibold';
        var profitCell  = f.profit != null
            ? '<span class="' + profitColor + '" title="' + tProfit + '">' + (f.profit >= 0 ? '+' : '') + f.profit.toFixed(2) + '€</span>'
            : '<span class="text-gray-300">—</span>';

        var alerteCell = d.alerte
            ? '<span class="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded">⚡ ' + d.alerte + '</span>'
            : '<span class="text-gray-300">—</span>';

        return '<tr class="border-b border-gray-50 hover:bg-gray-50 transition">'
            // Titre
            + '<td class="p-2 max-w-[180px]"><a href="' + amzUrl + '" target="_blank" class="font-medium text-gray-800 hover:text-indigo-600 text-xs block truncate" title="' + (d.titre || '') + '">' + (d.titre || '').substring(0, 45) + '</a></td>'
            // ASIN
            + '<td class="p-2 font-mono text-xs text-gray-400">' + (d.asin || '') + '</td>'
            // Prix FR
            + '<td class="p-2 text-center text-sm font-semibold">' + fmt(d.buyBoxFR) + '</td>'
            // Prix EU
            + '<td class="p-2 text-center text-sm font-bold text-blue-600">' + fmt(f.priceEU) + ' <span class="text-xs text-gray-400">' + f.mp + '</span></td>'
            // TVA EU
            + '<td class="p-2 text-center text-orange-500">' + tip(f.tva, tTva) + '</td>'
            // Commission
            + '<td class="p-2 text-center text-orange-400">' + tip(f.commis, tCommis) + '</td>'
            // Traitement FBA
            + '<td class="p-2 text-center text-red-400">' + tip(f.fba, tFba) + '</td>'
            // EFN
            + '<td class="p-2 text-center text-red-400">' + tip(f.efn, tEfn) + '</td>'
            // Envoi entrepôt
            + '<td class="p-2 text-center text-red-300">' + tip(f.envoi, tEnvoi) + '</td>'
            // URSSAF (toggle)
            + '<td style="' + (_urssafOn ? '' : 'display:none') + '" class="p-2 text-center text-purple-500">' + tip(f.urssaf, tUrssaf) + '</td>'
            // Stockage
            + '<td class="p-2 text-center text-gray-400">' + tip(f.stockage, tStockage) + '</td>'
            // Prep (toggle)
            + '<td style="' + (_prepOn ? '' : 'display:none') + '" class="p-2 text-center text-orange-400">' + tip(f.prep, tPrep) + '</td>'
            // Total frais
            + '<td class="p-2 text-center font-bold text-red-500">' + tip(f.total, tTotal) + '</td>'
            // Profit net EU
            + '<td class="p-2 text-center">' + profitCell + '</td>'
            // ROI EU
            + '<td class="p-2 text-center">' + pct(f.roi, 25) + '</td>'
            // Alerte
            + '<td class="p-2 text-center">' + alerteCell + '</td>'
            // Sourcing
            + '<td class="p-2 text-center">' + gsCell + '</td>'
            + '</tr>';
    }).join('');
}

// ── TAB : Rapport — historique des runs ───────────────────────────────────────
function loadRunHistory() {
    var sb = _getOAClient();
    if (!sb) return;

    sb.from('runs')
      .select('*')
      .order('date', { ascending: false })
      .limit(30)
      .then(function(res) {
          if (res.error) { console.error('[OA Runs]', res.error); return; }
          _runData = res.data || [];
          renderRunTab();
      })
      .catch(function(e) { console.error('[OA Runs]', e); });
}

function renderRunTab() {
    var wrap = document.getElementById('rapport-content');
    if (!wrap) return;

    if (!_runData.length) {
        wrap.innerHTML = '<p class="text-center text-gray-400 py-10">Aucun run enregistré — lance <code class="bg-gray-100 px-1 rounded text-indigo-600">python main.py</code></p>';
        return;
    }

    var last = _runData[0];
    var lastDate = last.date ? new Date(last.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    var lastStatus = last.status === 'success'  ? '✅ Succès'
                   : last.status === 'skipped'  ? '⏭ Skip'
                   : last.status === 'error'    ? '❌ Erreur'
                   : last.status === 'no_deals' ? '⚠ Aucun deal'
                   : last.status || '—';
    var tokensBar = '';
    if (last.tokens_before != null) {
        var pct = Math.min(100, Math.round(last.tokens_before / 60 * 100));
        tokensBar = '<div class="w-full bg-gray-200 rounded-full h-2 mt-1"><div class="bg-indigo-500 h-2 rounded-full" style="width:' + pct + '%"></div></div>'
            + '<div class="text-xs text-gray-500 mt-1">' + last.tokens_before + ' / 60 tokens (bucket max = 60)</div>';
    }

    var summary = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">'
        + '<div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">'
        + '<div class="text-xs text-gray-400 mb-1">Dernier run</div>'
        + '<div class="text-lg font-bold text-gray-800">' + lastStatus + ' — ' + lastDate + '</div>'
        + '<div class="text-sm text-gray-500 mt-1">Catégorie : <span class="font-semibold text-indigo-600">' + (last.strategy || '—') + '</span>'
        + ' | ' + (last.deals_found || 0) + ' deals | ' + (last.deals_eligible || 0) + ' éligibles | ' + (last.deals_cross_border || 0) + ' CB'
        + (last.duree_secondes ? ' | ' + Math.round(last.duree_secondes / 60) + 'min' : '')
        + '</div></div>'
        + '<div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">'
        + '<div class="text-xs text-gray-400 mb-1">Tokens dernier run</div>'
        + (last.tokens_before != null
            ? '<div class="text-lg font-bold text-gray-800">' + (last.tokens_before || 0) + ' → ' + (last.tokens_after || '?')
              + ' <span class="text-sm font-normal text-red-500">(-' + (last.tokens_used || 0) + ')</span></div>'
            : '<div class="text-gray-400">—</div>')
        + tokensBar
        + '</div></div>'
        + _buildRunCharts();

    var statusIcon = function(s) {
        return s === 'success'  ? '✅' : s === 'skipped' ? '⏭'
             : s === 'error'    ? '❌' : s === 'no_deals' ? '⚠️' : '—';
    };
    var catColors = {
        'Toys & Games':     'bg-blue-100 text-blue-700',
        'Sports & Outdoors':'bg-green-100 text-green-700',
        'Kitchen':          'bg-orange-100 text-orange-700',
        'Home & Garden':    'bg-purple-100 text-purple-700',
        'Electronics':      'bg-cyan-100 text-cyan-700',
        'Pet Supplies':     'bg-amber-100 text-amber-700',
        'Office Products':  'bg-indigo-100 text-indigo-700',
    };
    var catColor = function(s) { return catColors[s] || 'bg-gray-100 text-gray-500'; };

    // Grouper par date
    var todayStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    var groups = {};
    var groupOrder = [];
    _runData.forEach(function(r, i) {
        var dt = r.date ? new Date(r.date) : null;
        var dateStr = dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—';
        if (!groups[dateStr]) { groups[dateStr] = []; groupOrder.push(dateStr); }
        groups[dateStr].push({ r: r, i: i });
    });

    var buildRow = function(r, i) {
        var dt = r.date ? new Date(r.date) : null;
        var timeStr = dt ? dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
        var duree   = r.duree_secondes ? Math.round(r.duree_secondes / 60) + 'min' : '—';
        var tokens  = (r.tokens_before != null && r.tokens_after != null)
            ? r.tokens_before + ' → ' + r.tokens_after + ' <span class="text-red-400">(-' + (r.tokens_used || 0) + ')</span>'
            : (r.tokens_before != null ? r.tokens_before : '—');
        var detailId  = 'run-detail-' + i;
        var hasDetail = r.consignes_agent1 || r.consignes_agent2 || r.error;

        var mainRow = '<tr class="border-b border-gray-50 hover:bg-gray-50 transition' + (hasDetail ? ' cursor-pointer' : '') + '"'
            + (hasDetail ? ' onclick="document.getElementById(\'' + detailId + '\').classList.toggle(\'hidden\')"' : '')
            + '>'
            + '<td class="p-2 text-center text-xs font-mono text-gray-600">' + timeStr + '</td>'
            + '<td class="p-2 text-center"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ' + catColor(r.strategy) + '">' + (r.strategy || '—') + '</span></td>'
            + '<td class="p-2 text-center text-xs font-mono">' + tokens + '</td>'
            + '<td class="p-2 text-center text-xs font-semibold">' + (r.deals_found || '—') + '</td>'
            + '<td class="p-2 text-center text-xs font-semibold text-green-600">' + (r.deals_eligible || '—') + '</td>'
            + '<td class="p-2 text-center text-xs font-semibold text-blue-500">' + (r.deals_cross_border || '—') + '</td>'
            + '<td class="p-2 text-center text-xs text-gray-400">' + duree + '</td>'
            + '<td class="p-2 text-center">' + statusIcon(r.status) + '</td>'
            + (hasDetail ? '<td class="p-2 text-center text-gray-300 text-xs">▼</td>' : '<td></td>')
            + '</tr>';

        var detailRow = hasDetail
            ? '<tr id="' + detailId + '" class="hidden bg-indigo-50/40">'
              + '<td colspan="9" class="p-4">'
              + '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">'
              + (r.consignes_agent1
                  ? '<div class="bg-white rounded-lg p-3 border border-indigo-100">'
                    + '<div class="font-semibold text-indigo-700 mb-1">📋 Consignes → Agent 1</div>'
                    + '<pre class="text-gray-600 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">' + r.consignes_agent1 + '</pre>'
                    + '</div>' : '')
              + (r.consignes_agent2
                  ? '<div class="bg-white rounded-lg p-3 border border-blue-100">'
                    + '<div class="font-semibold text-blue-700 mb-1">📋 Consignes → Agent 2 EU</div>'
                    + '<pre class="text-gray-600 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">' + r.consignes_agent2 + '</pre>'
                    + '</div>' : '')
              + (r.error
                  ? '<div class="bg-red-50 rounded-lg p-3 border border-red-200 md:col-span-2">'
                    + '<div class="font-semibold text-red-600 mb-1">❌ Erreur</div>'
                    + '<pre class="text-red-500 whitespace-pre-wrap font-mono text-[11px]">' + r.error + '</pre>'
                    + '</div>' : '')
              + '</div></td></tr>'
            : '';
        return mainRow + detailRow;
    };

    var thead = '<table class="w-full text-sm">'
        + '<thead><tr class="bg-gray-50 text-left border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-500">'
        + '<th class="p-2 text-center">Heure</th>'
        + '<th class="p-2 text-center">Catégorie</th>'
        + '<th class="p-2 text-center">Tokens</th>'
        + '<th class="p-2 text-center">Deals</th>'
        + '<th class="p-2 text-center text-green-600">Éligibles</th>'
        + '<th class="p-2 text-center text-blue-500">Cross-B.</th>'
        + '<th class="p-2 text-center">Durée</th>'
        + '<th class="p-2 text-center">Statut</th>'
        + '<th class="p-2"></th>'
        + '</tr></thead>';

    var accordionBlocks = groupOrder.map(function(dateStr) {
        var items = groups[dateStr];
        var isToday = (dateStr === todayStr);
        var groupId = 'run-group-' + dateStr.replace('/', '-');
        // Résumé du jour
        var totalDeals = items.reduce(function(s, x) { return s + (x.r.deals_found || 0); }, 0);
        var totalElig  = items.reduce(function(s, x) { return s + (x.r.deals_eligible || 0); }, 0);
        var totalTok   = items.reduce(function(s, x) { return s + (x.r.tokens_used || 0); }, 0);
        var nbSuccess  = items.filter(function(x) { return x.r.status === 'success'; }).length;
        var nbSkip     = items.filter(function(x) { return x.r.status === 'skipped'; }).length;
        var summary = nbSuccess + ' run' + (nbSuccess > 1 ? 's' : '')
            + (nbSkip ? ' + ' + nbSkip + ' skip' : '')
            + (totalTok ? ' · ' + totalTok + ' tokens' : '')
            + (totalDeals ? ' · ' + totalDeals + ' deals' : '')
            + (totalElig ? ' · <span class="text-green-600 font-semibold">' + totalElig + ' éligibles</span>' : '');

        var rows = items.map(function(x) { return buildRow(x.r, x.i); }).join('');

        return '<div class="bg-white rounded-xl shadow-sm mb-3 overflow-hidden">'
            + '<div class="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-gray-50 border-b border-gray-100" onclick="var el=document.getElementById(\'' + groupId + '\');el.classList.toggle(\'hidden\');this.querySelector(\'.acc-arrow\').classList.toggle(\'rotate-180\')">'
            + '<div class="flex items-center gap-3">'
            + '<span class="font-bold text-gray-700 text-sm">' + dateStr + (isToday ? ' <span class="text-xs font-normal text-indigo-500 ml-1">Aujourd\'hui</span>' : '') + '</span>'
            + '<span class="text-xs text-gray-400">' + summary + '</span>'
            + '</div>'
            + '<svg class="acc-arrow w-4 h-4 text-gray-400 transition-transform' + (isToday ? ' rotate-180' : '') + '" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>'
            + '</div>'
            + '<div id="' + groupId + '"' + (isToday ? '' : ' class="hidden"') + '>'
            + '<div class="overflow-x-auto">'
            + thead + '<tbody>' + rows + '</tbody></table>'
            + '</div></div></div>';
    }).join('');

    wrap.innerHTML = summary + accordionBlocks;
}

// ── Graphiques rapport ────────────────────────────────────────────────────────
function _buildRunCharts() {
    var KNOWN_CATS = ['Toys & Games','Sports & Outdoors','Kitchen','Home & Garden','Electronics','Pet Supplies','Office Products'];

    // ── Graphique 1 : ELIGIBLE cumulé par catégorie ───────────────────────────
    var catElig = {};
    var catRuns = {};
    _runData.forEach(function(r) {
        if (KNOWN_CATS.indexOf(r.strategy) < 0) return;
        catElig[r.strategy] = (catElig[r.strategy] || 0) + (r.deals_eligible || 0);
        catRuns[r.strategy] = (catRuns[r.strategy] || 0) + 1;
    });
    var cats = Object.keys(catElig).sort(function(a, b) { return catElig[b] - catElig[a]; });
    var maxElig = cats.reduce(function(m, c) { return Math.max(m, catElig[c]); }, 1);

    var catBars = cats.length ? cats.map(function(cat) {
        var pct  = Math.round(catElig[cat] / maxElig * 100);
        var short = cat.replace(' & ', '/').replace('Sports/', 'Sports/').substring(0, 8);
        var hasElig = catElig[cat] > 0;
        return '<div class="flex flex-col items-center flex-1">'
            + '<div class="text-[10px] text-gray-500 mb-1 font-semibold">' + catElig[cat] + '</div>'
            + '<div class="w-full flex items-end justify-center" style="height:60px">'
            + '<div class="w-3/4 rounded-t ' + (hasElig ? 'bg-green-400' : 'bg-gray-200') + '" style="height:' + Math.max(6, pct) + '%"></div></div>'
            + '<div class="text-[9px] text-indigo-600 mt-1 text-center leading-tight font-medium">' + short + '</div>'
            + '<div class="text-[9px] text-gray-300">' + catRuns[cat] + ' run' + (catRuns[cat] > 1 ? 's' : '') + '</div>'
            + '</div>';
    }).join('')
    : '<div class="text-xs text-gray-400 text-center w-full py-4">Pas encore de données</div>';

    // ── Graphique 2 : Jauge tokens actuelle (estimée) ─────────────────────────
    // Cherche le dernier run qui a tokens_after (success ou skipped avec tokens_before)
    var lastWithTokens = null;
    for (var i = 0; i < _runData.length; i++) {
        if (_runData[i].tokens_before != null) { lastWithTokens = _runData[i]; break; }
    }
    var gaugeHtml = '<div class="text-xs text-gray-400 text-center py-4">Données insuffisantes</div>';
    if (lastWithTokens) {
        var baseTokens = lastWithTokens.tokens_after != null ? lastWithTokens.tokens_after : lastWithTokens.tokens_before;
        var runDate    = lastWithTokens.date ? new Date(lastWithTokens.date) : null;
        var elapsed    = runDate ? Math.floor((Date.now() - runDate.getTime()) / 60000) : 0; // minutes
        var estimated  = Math.min(60, baseTokens + elapsed);
        var pctGauge   = Math.round(estimated / 60 * 100);
        var gaugeColor = estimated >= 60 ? 'bg-green-400' : estimated >= 40 ? 'bg-amber-400' : 'bg-red-400';
        var minsToFull = estimated >= 60 ? 0 : (60 - estimated);
        var statusTxt  = estimated >= 60
            ? '<span class="text-green-600 font-semibold">Prêt à lancer ✓</span>'
            : '<span class="text-amber-600">~' + minsToFull + ' min pour être plein</span>';
        var runTimeStr = runDate ? runDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '?';
        gaugeHtml = '<div class="flex flex-col items-center justify-center h-full gap-3 py-2">'
            + '<div class="text-3xl font-bold ' + (estimated >= 60 ? 'text-green-600' : 'text-gray-700') + '">' + estimated + '<span class="text-lg font-normal text-gray-400"> / 60</span></div>'
            + '<div class="w-full bg-gray-100 rounded-full h-4 overflow-hidden">'
            + '<div class="' + gaugeColor + ' h-4 rounded-full transition-all" style="width:' + pctGauge + '%"></div></div>'
            + '<div class="text-xs text-gray-500">' + statusTxt + '</div>'
            + '<div class="text-[10px] text-gray-300">Basé sur run ' + runTimeStr + ' + refill 1/min</div>'
            + '</div>';
    }

    return '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">'
        + '<div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">'
        + '<div class="text-xs font-semibold text-gray-600 mb-3">ELIGIBLE cumulé par catégorie</div>'
        + '<div class="flex items-end gap-1 w-full">' + catBars + '</div>'
        + '</div>'
        + '<div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">'
        + '<div class="text-xs font-semibold text-gray-600 mb-3">Tokens actuels (estimé)</div>'
        + gaugeHtml
        + '</div></div>';
}

// ── Pool ELIGIBLE ─────────────────────────────────────────────────────────────
function loadPoolData() {
    var sb = _getOAClient();
    if (!sb) return;
    document.getElementById('pool-table-container').innerHTML =
        '<p class="text-center text-gray-400 py-10"><i class="fas fa-spinner fa-spin text-2xl block mb-3 text-gray-300"></i>Chargement...</p>';

    sb.from('eligible_pool')
      .select('*')
      .order('date_found', { ascending: false })
      .limit(500)
      .then(function(res) {
          if (res.error) {
              document.getElementById('pool-table-container').innerHTML =
                  '<p class="text-center text-red-400 py-10">Erreur : ' + res.error.message + '</p>';
              return;
          }
          _poolData = res.data || [];
          renderPoolTab();
      })
      .catch(function(e) { console.error('[Pool]', e); });
}

function renderPoolTab() {
    // Stats par catégorie
    var catCount = {};
    _poolData.forEach(function(p) {
        var c = p.categorie || 'Autre';
        catCount[c] = (catCount[c] || 0) + 1;
    });
    var statsHtml = '<div class="bg-white p-3 rounded-xl shadow-sm border border-indigo-100 text-center col-span-2 md:col-span-1">'
        + '<div class="text-2xl font-bold text-indigo-600">' + _poolData.length + '</div>'
        + '<div class="text-xs text-gray-400">ASINs dans le pool</div></div>';
    Object.keys(catCount).sort().forEach(function(cat) {
        statsHtml += '<div class="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center">'
            + '<div class="text-xl font-bold text-gray-700">' + catCount[cat] + '</div>'
            + '<div class="text-xs text-gray-400">' + cat.replace(' & ', '/') + '</div></div>';
    });
    document.getElementById('pool-stats').innerHTML = statsHtml;

    if (!_poolData.length) {
        document.getElementById('pool-table-container').innerHTML =
            '<p class="text-center text-gray-400 py-10">Pool vide — les ASINs ELIGIBLE s\'accumuleront au fil des runs.</p>';
        return;
    }

    var rows = _poolData.map(function(p) {
        var dt = p.date_found ? new Date(p.date_found).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
        var asinLink = '<a href="https://www.amazon.fr/dp/' + p.asin + '" target="_blank" class="text-indigo-600 hover:underline font-mono">' + p.asin + '</a>';
        return '<tr class="border-b border-gray-50 hover:bg-gray-50">'
            + '<td class="p-2">' + asinLink + '</td>'
            + '<td class="p-2 text-xs text-gray-700 max-w-xs truncate">' + (p.titre || '—') + '</td>'
            + '<td class="p-2 text-xs text-center"><span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[11px]">' + (p.categorie || '—') + '</span></td>'
            + '<td class="p-2 text-xs text-center text-gray-500">' + (p.brand || '—') + '</td>'
            + '<td class="p-2 text-xs text-center text-gray-400">' + dt + '</td>'
            + '<td class="p-2 text-xs text-center font-semibold text-gray-600">' + (p.nb_vus || 1) + '</td>'
            + '</tr>';
    }).join('');

    document.getElementById('pool-table-container').innerHTML =
        '<div class="bg-white rounded-xl shadow-sm overflow-x-auto">'
        + '<table class="w-full text-sm">'
        + '<thead><tr class="bg-gray-50 text-left border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-500">'
        + '<th class="p-2">ASIN</th><th class="p-2">Titre</th>'
        + '<th class="p-2 text-center">Catégorie</th><th class="p-2 text-center">Marque</th>'
        + '<th class="p-2 text-center">Date</th><th class="p-2 text-center">Nb vus</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
