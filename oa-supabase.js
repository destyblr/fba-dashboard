// ─────────────────────────────────────────────────────────────────────────────
// OA Supabase — Python local → Supabase → Dashboard
// ─────────────────────────────────────────────────────────────────────────────

var OA_SUPABASE_URL = 'https://ittbipdvkutbiiqeukdg.supabase.co';
var OA_SUPABASE_KEY = 'sb_publishable_uC4DebkXoayJkKDabA_A1w_7ft2qxwd';

var _sbOAClient  = null;
var _oaData      = [];           // deals du jour (mapped)
var _cbData      = [];           // tous deals avec prix EU (cross-border)
var _runData     = [];           // historique des runs
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
var _urssafOn = (localStorage.getItem('oa_urssaf') !== 'false');

// ── Frais prep (persisté en localStorage) ─────────────────────────────────────
var _prepFee = parseFloat(localStorage.getItem('oa_prep_fee') || '0.50');
var _prepOn  = (localStorage.getItem('oa_prep') !== 'false');

function toggleUrssaf() {
    _urssafOn = !_urssafOn;
    localStorage.setItem('oa_urssaf', _urssafOn ? 'true' : 'false');
    var btn = document.getElementById('btn-urssaf-toggle');
    if (btn) {
        btn.textContent = _urssafOn ? 'Avec URSSAF' : 'Sans URSSAF';
        btn.className = _urssafOn
            ? 'text-xs px-3 py-1 rounded-full font-semibold bg-purple-100 text-purple-700 border border-purple-300 cursor-pointer'
            : 'text-xs px-3 py-1 rounded-full font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-pointer line-through';
    }
    renderRawTab();
    renderDealsTab();
    renderCrossBorderTab();
}

function togglePrep() {
    _prepOn = !_prepOn;
    localStorage.setItem('oa_prep', _prepOn ? 'true' : 'false');
    var cls = _prepOn
        ? 'text-xs px-3 py-1 rounded-full font-semibold bg-orange-100 text-orange-700 border border-orange-300 cursor-pointer'
        : 'text-xs px-3 py-1 rounded-full font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-pointer line-through';
    ['btn-prep-toggle', 'btn-prep-toggle-param'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (btn) { btn.textContent = _prepOn ? 'Avec prep' : 'Sans prep'; btn.className = cls; }
    });
    renderRawTab();
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
    // Sync les boutons toggles
    var btnU = document.getElementById('btn-urssaf-toggle');
    if (btnU) {
        btnU.textContent = _urssafOn ? 'Avec URSSAF' : 'Sans URSSAF';
        btnU.className = _urssafOn
            ? 'text-xs px-3 py-1 rounded-full font-semibold bg-purple-100 text-purple-700 border border-purple-300 cursor-pointer'
            : 'text-xs px-3 py-1 rounded-full font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-pointer line-through';
    }
    var prepCls = _prepOn
        ? 'text-xs px-3 py-1 rounded-full font-semibold bg-orange-100 text-orange-700 border border-orange-300 cursor-pointer'
        : 'text-xs px-3 py-1 rounded-full font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-pointer line-through';
    ['btn-prep-toggle', 'btn-prep-toggle-param'].forEach(function(id) {
        var btnP = document.getElementById(id);
        if (btnP) { btnP.textContent = _prepOn ? 'Avec prep' : 'Sans prep'; btnP.className = prepCls; }
    });
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
          if (res.error) { console.error('[CB]', res.error.message); return; }
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
    var tabs = ['raw', 'deals', 'crossborder', 'rapport'];
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
    var arbTip = 'Arbitrage = produit vendu plus cher sur une marketplace EU\n'
        + 'que sur Amazon.fr (écart ≥ 15%).\n'
        + 'Opportunité : acheter en FR, revendre en DE/IT/ES via EFN.\n'
        + (p.alerte ? 'Détail : ' + p.alerte : 'Pas d\'écart détecté sur ce produit.');
    var alerteCell = p.alerte
        ? '<span class="text-amber-600 font-semibold" title="' + arbTip + '" style="cursor:help">⚡ ' + p.alerte + '</span>'
        : '<span class="text-gray-300" title="' + arbTip + '" style="cursor:help">—</span>';

    // Col 23 — Sourcing (lien Google Shopping)
    var sourcingCell = p.lienGS
        ? '<a href="' + p.lienGS + '" target="_blank" class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold whitespace-nowrap">🔍 GS</a>'
        : '<span class="text-gray-300">—</span>';

    return '<tr class="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">'
        // 1 — Score
        + '<td class="p-2 text-center"><span class="font-bold px-1.5 py-0.5 rounded ' + scoreColor + '" title="Score 0-100&#10;BSR &lt; 5k → +40pts | &lt; 20k → +30pts | &lt; 50k → +20pts&#10;ROI ≥ 50% → +40pts | ≥ 35% → +30pts | ≥ 25% → +20pts&#10;Vendeurs FBA ≤ 3 → +20pts | ≤ 8 → +10pts&#10;Score ≥ 70 = deal intéressant" style="cursor:help">' + (p.score || '?') + '</span></td>'
        // 2 — Statut
        + '<td class="p-2 text-center">' + eligBadge + '</td>'
        // 3 — Titre
        + '<td class="p-2"><a href="' + amzUrl + '" target="_blank" class="font-semibold text-gray-800 hover:text-indigo-600 leading-tight block truncate max-w-[180px]" title="' + (p.titre || '') + '">' + (p.titre || '—').slice(0, 50) + '</a></td>'
        // 4 — ASIN
        + '<td class="p-2 font-mono text-gray-500 whitespace-nowrap">' + (p.asin || '—') + '</td>'
        // 5 — Catégorie
        + '<td class="p-2 text-gray-500 whitespace-nowrap">' + (p.categorie || '—') + '</td>'
        // 6 — BSR
        + '<td class="p-2 text-center font-mono text-gray-600" title="Best Seller Rank — rang de vente dans la catégorie&#10;Plus le rang est bas, plus le produit se vend&#10;&lt; 1 000 = excellent&#10;&lt; 10 000 = très bon&#10;&lt; 30 000 = bon&#10;&lt; 50 000 = acceptable&#10;Keepa surveille l\'historique BSR" style="cursor:help">' + (p.bsr ? '#' + Number(p.bsr).toLocaleString('fr') : '—') + '</td>'
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
        + '<td class="p-2 text-center text-orange-500">' + feeTip(p.referralFee, tipReferral) + '</td>'
        // 13 — Frais FBA
        + '<td class="p-2 text-center text-red-400">' + feeTip(p.fraisFba, tipFba) + '</td>'
        // 14 — Envoi FBA
        + '<td class="p-2 text-center text-red-400">' + feeTip(p.envoiFba, tipEnvoi) + '</td>'
        // 15 — Frais EFN
        + '<td class="p-2 text-center text-red-400">' + feeTip(p.fraisEfn, tipEfn) + '</td>'
        // 16 — Prep (toggle)
        + (function() {
            if (_prepOn) {
                return '<td class="p-2 text-center text-orange-400">' + feeTip(_prepFee, tipPrep) + '</td>';
            } else {
                return '<td class="p-2 text-center text-gray-300" title="' + tipPrep + '"><span style="opacity:.4">—</span></td>';
            }
        })()
        // 17 — URSSAF (toggle)
        + (function() {
            if (_urssafOn) {
                return '<td class="p-2 text-center text-purple-500">' + feeTip(p.urssaf, tipUrssaf) + '</td>';
            } else {
                return '<td class="p-2 text-center text-gray-300 line-through" title="URSSAF désactivé"><span style="text-decoration:line-through;opacity:.4">' + (p.urssaf != null ? p.urssaf.toFixed(2) + '€' : '—') + '</span></td>';
            }
        })()
        // 18 — Total frais (ajusté selon toggle URSSAF + Prep)
        + (function() {
            var tot = p.frais;
            if (!_urssafOn && p.urssaf != null) tot = tot != null ? Math.round((tot - p.urssaf) * 100) / 100 : null;
            if (_prepOn) tot = tot != null ? Math.round((tot + _prepFee) * 100) / 100 : null;
            var extras = [];
            if (!_urssafOn) extras.push('URSSAF exclu');
            if (_prepOn) extras.push('Prep inclu');
            var tip = tipTotal + (extras.length ? '\n⚠ ' + extras.join(', ') : '');
            return '<td class="p-2 text-center font-bold text-red-500">' + feeTip(tot, tip) + '</td>';
        })()
        // 19 — Profit net FR (€) ajusté
        + (function() {
            var urssafAdj = _urssafOn ? 0 : (p.urssaf || 0);
            var prepAdj   = _prepOn ? _prepFee : 0;
            var pn = p.profitNetFr != null ? Math.round((p.profitNetFr + urssafAdj - prepAdj) * 100) / 100 : null;
            return '<td class="p-2 text-center font-semibold ' + ((pn || 0) >= 0 ? 'text-green-600' : 'text-red-500') + '" title="Buy Box moy 90j − frais − prix achat estimé (70%)">' + (pn != null ? (pn >= 0 ? '+' : '') + pn.toFixed(2) + '€' : '<span class="text-gray-300">—</span>') + '</td>';
        })()
        // 19 — ROI estimé FR (%)
        + '<td class="p-2 text-center font-semibold ' + ((p.roiFr || 0) >= 25 ? 'text-green-600' : 'text-gray-500') + '">' + pctCell(p.roiFr) + '</td>'
        // 20 — Meilleure marketplace
        + '<td class="p-2 text-center font-semibold">' + bestMPCell + '</td>'
        // 20 — ROI meilleur (%)
        + '<td class="p-2 text-center font-semibold ' + ((p.roiMeilleur || 0) >= 25 ? 'text-green-600' : 'text-gray-500') + '">' + pctCell(p.roiMeilleur) + '</td>'
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
        tbody.innerHTML = '<tr><td colspan="12" class="p-10 text-center text-gray-400">'
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
            + '<td class="p-3 text-center">'
                + (p.lienGS ? '<a href="' + p.lienGS + '" target="_blank" class="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 font-semibold whitespace-nowrap">🔍 GS</a>' : '<span class="text-gray-300 text-xs">—</span>')
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
            + '<td class="p-2 text-center ' + (_urssafOn ? 'text-purple-500' : 'text-gray-300') + '">' + tip(_urssafOn ? f.urssaf : null, tUrssaf) + '</td>'
            // Stockage
            + '<td class="p-2 text-center text-gray-400">' + tip(f.stockage, tStockage) + '</td>'
            // Prep (toggle)
            + '<td class="p-2 text-center ' + (_prepOn ? 'text-orange-400' : 'text-gray-300') + '">' + tip(_prepOn ? f.prep : null, tPrep) + '</td>'
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
        var pct = Math.min(100, Math.round(last.tokens_before / 1440 * 100));
        tokensBar = '<div class="w-full bg-gray-200 rounded-full h-2 mt-1"><div class="bg-indigo-500 h-2 rounded-full" style="width:' + pct + '%"></div></div>'
            + '<div class="text-xs text-gray-500 mt-1">' + last.tokens_before + ' tokens au départ (~1440/jour max)</div>';
    }

    var summary = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">'
        + '<div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">'
        + '<div class="text-xs text-gray-400 mb-1">Dernier run</div>'
        + '<div class="text-lg font-bold text-gray-800">' + lastStatus + ' — ' + lastDate + '</div>'
        + '<div class="text-sm text-gray-500 mt-1">Stratégie : <span class="font-semibold text-indigo-600">' + (last.strategy || '—') + '</span>'
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
        + '</div></div>';

    var statusIcon = function(s) {
        return s === 'success'  ? '✅' : s === 'skipped' ? '⏭'
             : s === 'error'    ? '❌' : s === 'no_deals' ? '⚠️' : '—';
    };
    var stratColor = function(s) {
        return s === 'full_eu'  ? 'bg-green-100 text-green-700'
             : s === 'full'     ? 'bg-blue-100 text-blue-700'
             : s === 'standard' ? 'bg-indigo-100 text-indigo-700'
             : s === 'reduced'  ? 'bg-amber-100 text-amber-700'
             : 'bg-gray-100 text-gray-500';
    };

    var rows = _runData.map(function(r, i) {
        var dt = r.date ? new Date(r.date) : null;
        var dateStr = dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—';
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
            + '<td class="p-2 text-center text-xs text-gray-500">' + dateStr + '</td>'
            + '<td class="p-2 text-center text-xs font-mono text-gray-600">' + timeStr + '</td>'
            + '<td class="p-2 text-center"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ' + stratColor(r.strategy) + '">' + (r.strategy || '—') + '</span></td>'
            + '<td class="p-2 text-center text-xs font-mono">' + tokens + '</td>'
            + '<td class="p-2 text-center text-xs font-semibold">' + (r.deals_found || '—') + '</td>'
            + '<td class="p-2 text-center text-xs font-semibold text-green-600">' + (r.deals_eligible || '—') + '</td>'
            + '<td class="p-2 text-center text-xs font-semibold text-blue-500">' + (r.deals_cross_border || '—') + '</td>'
            + '<td class="p-2 text-center text-xs text-gray-400">' + duree + '</td>'
            + '<td class="p-2 text-center">' + statusIcon(r.status) + '</td>'
            + (hasDetail ? '<td class="p-2 text-center text-gray-300 text-xs">▼</td>' : '<td></td>')
            + '</tr>';

        var detailRow = '<tr id="' + detailId + '" class="hidden bg-indigo-50/40">'
            + '<td colspan="10" class="p-4">'
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
            + '</div></td></tr>';

        return mainRow + (hasDetail ? detailRow : '');
    }).join('');

    wrap.innerHTML = summary
        + '<div class="bg-white rounded-xl shadow-sm overflow-x-auto">'
        + '<table class="w-full text-sm">'
        + '<thead><tr class="bg-gray-50 text-left border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-500">'
        + '<th class="p-2 text-center">Date</th>'
        + '<th class="p-2 text-center">Heure</th>'
        + '<th class="p-2 text-center">Stratégie</th>'
        + '<th class="p-2 text-center">Tokens</th>'
        + '<th class="p-2 text-center">Deals</th>'
        + '<th class="p-2 text-center text-green-600">Éligibles</th>'
        + '<th class="p-2 text-center text-blue-500">Cross-B.</th>'
        + '<th class="p-2 text-center">Durée</th>'
        + '<th class="p-2 text-center">Statut</th>'
        + '<th class="p-2"></th>'
        + '</tr></thead>'
        + '<tbody>' + rows + '</tbody>'
        + '</table></div>';
}
