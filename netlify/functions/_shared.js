// ─── Source de vérité partagée entre tous les agents ──────────────────────

// ─── Seuils de rentabilité OA ─────────────────────────────────────────────
const MIN_PROFIT = 2;  // € net minimum
const MIN_ROI    = 25; // % ROI minimum

// ─── Inbound FBA dynamique selon le poids (même logique que le frontend) ─────
function getInboundCost(weightGrams) {
    if (!weightGrams || weightGrams <= 0) return 1.50; // fallback sans données poids
    if (weightGrams < 500)  return 1.50;
    if (weightGrams < 2000) return 2.00;
    if (weightGrams < 5000) return 3.00;
    return 4.50;
}

// ─── Surcharge EFN (European Fulfillment Network) depuis FR vers autre MP ─────
// Source : grille tarifaire Amazon EFN 2024 (envoi depuis France)
function getEfnCost(weightGrams) {
    if (!weightGrams || weightGrams <= 0) return 2.17; // fallback sans données poids
    if (weightGrams < 500)  return 1.58;
    if (weightGrams < 3000) return 2.17;
    if (weightGrams < 5000) return 3.86;
    return 6.00;
}

// ─── Calcul profit FBA (micro-entreprise BIC, URSSAF 12.2% du CA) ────────────
// marketplace : 'FR' | 'DE' | 'IT' | 'ES' — si != 'FR', ajoute frais EFN
function calcProfit(buyPrice, sellPrice, category, weightGrams, marketplace) {
    if (!buyPrice || !sellPrice || sellPrice <= 0) return null;
    const commissionRate = (category || '').toLowerCase().match(/electron|informatiq|high.tech/) ? 0.08 : 0.15;
    const commission     = sellPrice * commissionRate;
    const fbaFees        = sellPrice < 10 ? 2.50 : sellPrice < 30 ? 3.50 : 4.80;
    const inbound        = getInboundCost(weightGrams);
    const efn            = (marketplace && marketplace !== 'FR') ? getEfnCost(weightGrams) : 0;
    const prep           = 0.25;
    const urssaf         = sellPrice * 0.122; // 12.2% du CA (micro-BIC achat-revente)
    const totalCosts     = buyPrice + commission + fbaFees + inbound + efn + prep + urssaf;
    const netProfit      = sellPrice - totalCosts;
    const roi            = buyPrice > 0 ? (netProfit / buyPrice) * 100 : 0;
    return { netProfit: +netProfit.toFixed(2), roi: +roi.toFixed(1), efn: +efn.toFixed(2) };
}

// ─── Retailers par défaut ─────────────────────────────────────────────────
// Jours : 0=Dim 1=Lun 2=Mar 3=Mer 4=Jeu 5=Ven 6=Sam
// Charge par jour cible : ~10 retailers → 2-3 runs chacun (24 runs/jour)
const DEFAULT_RETAILERS = [
    // ── BEAUTÉ / PARAPHARMACIE — marges correctes sur grandes marques ────────
    { id: 'easypara',           name: 'Easypara',          url: 'https://www.easypara.fr',             type: 'prestashop', category: 'beaute',       days: [1,3,5], maxProducts: 30, active: true, scraperSitemap: true, sitemapUrl: 'https://www.easypara.fr/media/google_sitemap_1_index.xml' },
    { id: 'pharma-gdd',         name: 'Pharma GDD',        url: 'https://www.pharma-gdd.com',          type: 'prestashop', category: 'beaute',       days: [0,2,4], maxProducts: 30, active: true, scraperSitemap: true },
    // sante-discount: pas de sitemap produit (site WordPress blog uniquement)
    // aroma-zone: marque propre, non-revendable

    // ── JOUETS / LOISIRS — meilleure catégorie OA FR→DE/IT ──────────────────
    { id: '1001hobbies',        name: '1001Hobbies',       url: 'https://www.1001hobbies.fr',          type: 'prestashop', category: 'jouets',       days: [0,3,5], maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'joueclub',           name: 'Joué Club',         url: 'https://www.joueclub.fr',             type: 'prestashop', category: 'jouets',       days: [1,4],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'kingjouet',          name: 'King Jouet',        url: 'https://www.king-jouet.com',          type: 'generic',    category: 'jouets',       days: [0,3],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'lagranderecre',      name: 'La Grande Récré',   url: 'https://www.lagranderecre.fr',        type: 'generic',    category: 'jouets',       days: [2,5],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'maxitoys',           name: 'Maxi Toys',         url: 'https://www.maxitoys.fr',             type: 'prestashop', category: 'jouets',       days: [1,4],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'picwictoys',         name: 'Picwic Toys',       url: 'https://www.picwictoys.com',          type: 'prestashop', category: 'jouets',       days: [2,6],   maxProducts: 30, active: true, scraperSitemap: true },
    // oxybul: liquidé en 2020

    // ── INFORMATIQUE / ÉLECTRONIQUE — accessoires surtout ───────────────────
    { id: 'bureauvallee',       name: 'Bureau Vallée',     url: 'https://www.bureauvallee.fr',         type: 'generic',    category: 'informatique', days: [2,6],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'topachat',           name: 'Top Achat',         url: 'https://www.topachat.com',            type: 'generic',    category: 'informatique', days: [0,4],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'materielnet',        name: 'Materiel.net',      url: 'https://www.materiel.net',            type: 'generic',    category: 'informatique', days: [3,6],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'ldlc',               name: 'LDLC',              url: 'https://www.ldlc.com',                type: 'generic',    category: 'informatique', days: [1,5],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'fnac',               name: 'Fnac',              url: 'https://www.fnac.com',                type: 'generic',    category: 'informatique', days: [2,5],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'darty',              name: 'Darty',             url: 'https://www.darty.com',               type: 'generic',    category: 'informatique', days: [0,3],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'boulanger',          name: 'Boulanger',         url: 'https://www.boulanger.com',           type: 'generic',    category: 'informatique', days: [1,4],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'rueducommerce',      name: 'Rue du Commerce',   url: 'https://www.rueducommerce.fr',        type: 'generic',    category: 'informatique', days: [0,4],   maxProducts: 30, active: true, scraperSitemap: true },

    // ── ANIMALERIE — Royal Canin, Hill's, Purina rentables ──────────────────
    { id: 'zoomalia',           name: 'Zoomalia',          url: 'https://www.zoomalia.com',            type: 'prestashop', category: 'animalerie',   days: [0,3],   maxProducts: 30, active: true, scraperSitemap: true, sitemapUrl: 'https://www.zoomalia.com/1_index_sitemap.xml' },
    { id: 'wanimo',             name: 'Wanimo',            url: 'https://www.wanimo.com',              type: 'prestashop', category: 'animalerie',   days: [2,5],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'animalis',           name: 'Animalis',          url: 'https://www.animalis.com',            type: 'generic',    category: 'animalerie',   days: [1,4],   maxProducts: 30, active: true, scraperSitemap: true },

    // ── CUISINE / USTENSILES — Tefal, WMF, Zwilling rentables ───────────────
    { id: 'alicedelice',        name: 'Alice Délice',      url: 'https://www.alicedelice.com',         type: 'prestashop', category: 'cuisine',      days: [0,3],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'mathon',             name: 'Mathon',            url: 'https://www.mathon.fr',               type: 'prestashop', category: 'cuisine',      days: [2,6],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'cuisineaddict',      name: 'Cuisine Addict',    url: 'https://www.cuisineaddict.com',       type: 'prestashop', category: 'cuisine',      days: [1,4],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'meilleurduchef',     name: 'Meilleur du Chef',  url: 'https://www.meilleurduchef.com',      type: 'prestashop', category: 'cuisine',      days: [3,6],   maxProducts: 30, active: true, scraperSitemap: true },

    // ── SPORT / VÉLO ────────────────────────────────────────────────────────
    { id: 'probikeshop',        name: 'Probikeshop',       url: 'https://www.probikeshop.fr',          type: 'prestashop', category: 'sport',        days: [0,3],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'alltricks',          name: 'Alltricks',         url: 'https://www.alltricks.fr',            type: 'generic',    category: 'sport',        days: [2,5],   maxProducts: 30, active: true, scraperSitemap: true },

    // ── CULTURE / LOISIRS ───────────────────────────────────────────────────
    { id: 'cultura',            name: 'Cultura',           url: 'https://www.cultura.com',             type: 'generic',    category: 'culture',      days: [1,5],   maxProducts: 30, active: true, scraperSitemap: true },

    // ── BÉBÉ / PUÉRICULTURE ─────────────────────────────────────────────────
    { id: 'aubert',             name: 'Aubert',            url: 'https://www.aubert.com',              type: 'generic',    category: 'bebe',         days: [0,4],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'bambinou',           name: 'Bambinou',          url: 'https://www.bambinou.com',            type: 'prestashop', category: 'bebe',         days: [2,5],   maxProducts: 30, active: true, scraperSitemap: true },

    // ── JARDINAGE ───────────────────────────────────────────────────────────
    { id: 'jardindeco',         name: 'Jardindeco',        url: 'https://www.jardindeco.com',          type: 'prestashop', category: 'jardin',       days: [1,5],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'plantes-et-jardins', name: 'Plantes & Jardins', url: 'https://www.plantes-et-jardins.com', type: 'prestashop', category: 'jardin',       days: [3,6],   maxProducts: 30, active: true, scraperSitemap: true },

    // ── GRANDS RETAILERS MULTI-CATÉGORIES ───────────────────────────────────
    { id: 'leclerc',            name: 'E.Leclerc',         url: 'https://www.e.leclerc',               type: 'generic',    category: 'multi',        days: [3,6],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'cdiscount',          name: 'Cdiscount',         url: 'https://www.cdiscount.com',           type: 'generic',    category: 'multi',        days: [2,6],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'carrefour',          name: 'Carrefour',         url: 'https://www.carrefour.fr',            type: 'generic',    category: 'multi',        days: [1,4],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'conforama',          name: 'Conforama',         url: 'https://www.conforama.fr',            type: 'generic',    category: 'maison',       days: [0,5],   maxProducts: 30, active: true, scraperSitemap: true },
    { id: 'manomano',           name: 'ManoMano',          url: 'https://www.manomano.fr',             type: 'generic',    category: 'bricolage',    days: [0,6],   maxProducts: 30, active: true, scraperSitemap: true },
    // decathlon: marque propre (Quechua, Domyos…) — non-revendable
    // maisonsdumonde: marque propre — non-revendable
    // natureetdecouvertes: marque propre — non-revendable
];

module.exports = { calcProfit, getInboundCost, getEfnCost, MIN_PROFIT, MIN_ROI, DEFAULT_RETAILERS };
