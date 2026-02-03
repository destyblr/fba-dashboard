// ===========================
// VARIABLES GLOBALES
// ===========================

let charts = {}; // Stockage des graphiques Chart.js
let products = []; // Liste des produits
let currentData = {}; // Données actuelles
let suiviHebdo = []; // Historique des semaines
let tempHebdoProduits = []; // Produits temporaires pour formulaire

// ===========================
// INITIALISATION
// ===========================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard Amazon FBA chargé !');

    // Initialiser les graphiques (structure vide)
    initCharts();

    // Si Firebase n'est pas configure, charger les donnees locales
    // Sinon, auth.js gere le chargement apres authentification
    if (typeof firebaseConfig === 'undefined' ||
        typeof initFirebase === 'undefined' ||
        firebaseConfig.apiKey === "REMPLACE_PAR_TA_CLE_API") {
        loadData();
        calculateAll();
        loadProducts();
        loadSuiviHebdo();
    }
});

// ===========================
// NAVIGATION ENTRE SECTIONS
// ===========================

function showSection(sectionName) {
    // Masquer toutes les sections
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => section.classList.add('hidden'));

    // Afficher la section demandée
    const targetSection = document.getElementById(`section-${sectionName}`);
    if (targetSection) {
        targetSection.classList.remove('hidden');
    }

    // Mettre à jour la navigation active
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    event.target.closest('.nav-item').classList.add('active');

    // Si on affiche les graphiques, les rafraîchir
    if (sectionName === 'graphiques') {
        updateCharts();
    }

    // Si on affiche le stock, rafraichir les donnees
    if (sectionName === 'stock') {
        initStockSection();
    }

    // Si on affiche la fiscalite, rafraichir les calculs
    if (sectionName === 'fiscalite') {
        initFiscalite();
    }
}

// ===========================
// CALCULS FINANCIERS
// ===========================

function calculateAll() {
    // Récupérer les valeurs des inputs
    const capital = parseFloat(document.getElementById('input-capital').value) || 0;
    const ca = parseFloat(document.getElementById('input-ca').value) || 0;
    const benefice = parseFloat(document.getElementById('input-benefice').value) || 0;
    const unites = parseFloat(document.getElementById('input-unites').value) || 0;
    const acos = parseFloat(document.getElementById('input-acos').value) || 0;

    const objCA = parseFloat(document.getElementById('input-obj-ca').value) || 1;
    const objBenefice = parseFloat(document.getElementById('input-obj-benefice').value) || 1;
    const objUnites = parseFloat(document.getElementById('input-obj-unites').value) || 1;
    const objACOS = parseFloat(document.getElementById('input-obj-acos').value) || 1;
    const joursStock = parseFloat(document.getElementById('input-jours-stock').value) || 0;

    // ===========================
    // CALCULS FISCALITÉ
    // ===========================

    // Récupérer le taux d'impôts depuis les paramètres (ou 13.3% par défaut)
    const tauxImpots = parseFloat(document.getElementById('param-impots')?.value || 13.3) / 100;

    // Taxes Micro-entreprise
    const taxesMicro = benefice * tauxImpots;

    // Gain Net "Poche" = Bénéfice - Taxes
    const gainNetPoche = benefice - taxesMicro;

    // Marge Net Finale = (Gain Net / CA) × 100
    const margeNetFinale = ca > 0 ? (gainNetPoche / ca) * 100 : 0;

    // ROI Réel = (Gain Net / Capital) × 100
    const roiReel = capital > 0 ? (gainNetPoche / capital) * 100 : 0;

    // ROI Global = (Bénéfice / Capital) × 100
    const roiGlobal = capital > 0 ? (benefice / capital) * 100 : 0;

    // Marge Nette (Après Pub) = (Bénéfice / CA) × 100
    const margeNette = ca > 0 ? (benefice / ca) * 100 : 0;

    // Gain Total = Bénéfice (pour l'instant, pourrait être la somme de plusieurs mois)
    const gainTotal = benefice;

    // ===========================
    // CALCULS SANTÉ FINANCIÈRE
    // ===========================

    // Seuil de Sécurité (simplifié: on considère que c'est le ratio capital restant)
    const seuilSecurite = capital > 0 ? ((capital - (capital - gainTotal)) / capital) * 100 : 0;

    // ===========================
    // CALCULS OBJECTIFS (Progression)
    // ===========================

    const progressionCA = objCA > 0 ? (ca / objCA) * 100 : 0;
    const progressionUnites = objUnites > 0 ? (unites / objUnites) * 100 : 0;
    const progressionACOS = objACOS > 0 ? (acos / objACOS) * 100 : 0;

    // ===========================
    // MISE À JOUR AFFICHAGE
    // ===========================

    // KPI Cards
    updateElement('kpi-gain', formatCurrency(gainTotal));
    updateElement('kpi-gain-evolution', `+${roiGlobal.toFixed(1)}% ROI`);
    updateElement('kpi-ca', formatCurrency(ca));
    updateElement('kpi-benefice', formatCurrency(benefice));
    updateElement('kpi-marge', `${margeNette.toFixed(0)}% Marge`);
    updateElement('kpi-acos', `${acos.toFixed(2)}%`);

    // Sidebar
    updateElement('sidebar-capital', formatCurrency(capital));
    updateElement('sidebar-gain', formatCurrency(gainTotal));

    // Santé Financière
    updateElement('sante-seuil', `${Math.min(seuilSecurite, 100).toFixed(0)}%`);
    updateElement('progress-seuil', '', Math.min(seuilSecurite, 100));

    // Calculer les jours de stock depuis les donnees reelles si disponibles
    const joursStockReel = calculerJoursStockMoyen();
    const joursStockAffiche = joursStockReel > 0 ? joursStockReel : joursStock;
    updateElement('jours-stock', `${Math.floor(joursStockAffiche)} jours`);

    updateElement('sante-benefice', formatCurrency(gainTotal));
    updateElement('sante-roi', `${roiGlobal.toFixed(2)}%`);

    // Objectifs
    updateElement('obj-ca-realise', formatCurrency(ca));
    updateElement('obj-ca-objectif', formatCurrency(objCA));
    updateElement('progress-ca', '', Math.min(progressionCA, 100));

    updateElement('obj-unites-realise', unites.toString());
    updateElement('obj-unites-objectif', objUnites.toString());
    updateElement('progress-unites', '', Math.min(progressionUnites, 100));

    updateElement('obj-acos-realise', `${acos.toFixed(2)}%`);
    updateElement('obj-acos-objectif', `${objACOS.toFixed(2)}%`);
    updateElement('progress-acos', '', Math.min(progressionACOS, 100));

    // Fiscalité
    updateElement('fiscal-taxes', formatCurrency(taxesMicro));
    updateElement('fiscal-poche', formatCurrency(gainNetPoche));
    updateElement('fiscal-marge', `${margeNetFinale.toFixed(2)}%`);

    updateElement('fiscal-detail-benefice', formatCurrency(benefice));
    updateElement('fiscal-detail-taxes', `-${formatCurrency(taxesMicro)}`);
    updateElement('fiscal-detail-poche', formatCurrency(gainNetPoche));
    updateElement('fiscal-roi-reel', `${roiReel.toFixed(2)}%`);
    updateElement('fiscal-roi-global', `${roiGlobal.toFixed(2)}%`);

    // Impact Fiscal (nouveau bloc)
    updateElement('impact-benefice-brut', formatCurrency(benefice));
    updateElement('impact-taux-impots', `(${(tauxImpots * 100).toFixed(1)}%)`);
    updateElement('impact-impots', `-${formatCurrency(taxesMicro)}`);
    updateElement('impact-gain-net', formatCurrency(gainNetPoche));
    updateElement('impact-roi-brut', `${roiGlobal.toFixed(2)}%`);
    updateElement('impact-roi-net', `${roiReel.toFixed(2)}%`);
    updateElement('impact-marge-brute', `${margeNette.toFixed(2)}%`);
    updateElement('impact-marge-nette', `${margeNetFinale.toFixed(2)}%`);

    // Tableau Comparatif (nouveau tableau)
    updateElement('table-roi-avant', `${roiGlobal.toFixed(2)}%`);
    updateElement('table-roi-apres', `${roiReel.toFixed(2)}%`);
    updateElement('table-marge-avant', `${margeNette.toFixed(2)}%`);
    updateElement('table-marge-apres', `${margeNetFinale.toFixed(2)}%`);
    updateElement('table-gain-avant', formatCurrency(benefice));
    updateElement('table-gain-apres', formatCurrency(gainNetPoche));
    updateElement('table-info-taux', `${(tauxImpots * 100).toFixed(1)}%`);

    // Sauvegarder les données calculées
    currentData = {
        capital, ca, benefice, unites, acos,
        objCA, objBenefice, objUnites, objACOS, joursStock,
        taxesMicro, gainNetPoche, margeNetFinale, roiReel, roiGlobal, margeNette, gainTotal
    };

    // Mettre à jour le récapitulatif des charges
    updateRecapCharges();
}

// ===========================
// FONCTIONS UTILITAIRES
// ===========================

function updateElement(id, value, width = null) {
    const element = document.getElementById(id);
    if (element) {
        if (width !== null) {
            // C'est une barre de progression
            element.style.width = `${width}%`;
        } else {
            element.textContent = value;
        }
    }
}

function formatCurrency(value) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(value);
}

// Calculer les jours de stock moyen depuis les donnees reelles
function calculerJoursStockMoyen() {
    if (typeof stockData === 'undefined' || typeof products === 'undefined') return 0;
    if (products.length === 0) return 0;

    let totalJours = 0;
    let nbProduits = 0;

    products.forEach(product => {
        const stock = stockData[product.id];
        if (!stock || !stock.stockActuel) return;

        const ventesSemaine = typeof getVentesMoyennesSemaine === 'function'
            ? getVentesMoyennesSemaine(product.id)
            : (product.unites ? product.unites / 4 : 0);
        const ventesJour = ventesSemaine / 7;

        if (ventesJour > 0) {
            totalJours += stock.stockActuel / ventesJour;
            nbProduits++;
        }
    });

    return nbProduits > 0 ? totalJours / nbProduits : 0;
}

// ===========================
// SAUVEGARDE / CHARGEMENT
// ===========================

function saveData() {
    // Ne pas sauvegarder si chargement en cours
    if (typeof isLoading !== 'undefined' && isLoading) {
        return;
    }

    const data = {
        capital: document.getElementById('input-capital').value,
        ca: document.getElementById('input-ca').value,
        benefice: document.getElementById('input-benefice').value,
        unites: document.getElementById('input-unites').value,
        acos: document.getElementById('input-acos').value,
        objCA: document.getElementById('input-obj-ca').value,
        objBenefice: document.getElementById('input-obj-benefice').value,
        objUnites: document.getElementById('input-obj-unites').value,
        objACOS: document.getElementById('input-obj-acos').value,
        joursStock: document.getElementById('input-jours-stock').value,
        products: products
    };

    localStorage.setItem('fba-dashboard-data', JSON.stringify(data));

    // Sauvegarder sur le cloud si disponible
    if (typeof saveDataToCloud === 'function') {
        saveDataToCloud();
    } else {
        showNotification('Donnees sauvegardees !', 'success');
    }
}

function loadData() {
    const savedData = localStorage.getItem('fba-dashboard-data');

    if (savedData) {
        const data = JSON.parse(savedData);

        // Charger les valeurs dans les inputs
        if (data.capital) document.getElementById('input-capital').value = data.capital;
        if (data.ca) document.getElementById('input-ca').value = data.ca;
        if (data.benefice) document.getElementById('input-benefice').value = data.benefice;
        if (data.unites) document.getElementById('input-unites').value = data.unites;
        if (data.acos) document.getElementById('input-acos').value = data.acos;
        if (data.objCA) document.getElementById('input-obj-ca').value = data.objCA;
        if (data.objBenefice) document.getElementById('input-obj-benefice').value = data.objBenefice;
        if (data.objUnites) document.getElementById('input-obj-unites').value = data.objUnites;
        if (data.objACOS) document.getElementById('input-obj-acos').value = data.objACOS;
        if (data.joursStock) document.getElementById('input-jours-stock').value = data.joursStock;

        // Charger les produits
        if (data.products) {
            products = data.products;
        }
    }

    // Charger les paramètres
    loadParams();
}

function showNotification(message, type = 'success') {
    // Créer une notification
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 px-6 py-4 rounded-lg shadow-lg text-white font-semibold z-50 ${
        type === 'success' ? 'bg-green-500' : 'bg-red-500'
    }`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Retirer après 3 secondes
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// ===========================
// GESTION DES PRODUITS
// ===========================

function addProduct() {
    const productId = Date.now();
    const product = {
        id: productId,
        nom: `Produit ${products.length + 1}`,
        ca: 0,
        benefice: 0,
        unites: 0,
        acos: 0
    };

    products.push(product);
    renderProducts();
    saveData();
}

function deleteProduct(productId) {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce produit ?')) {
        products = products.filter(p => p.id !== productId);
        renderProducts();
        saveData();
        showNotification('Produit supprimé', 'success');
    }
}

function updateProduct(productId, field, value) {
    const product = products.find(p => p.id === productId);
    if (product) {
        product[field] = field === 'nom' ? value : parseFloat(value) || 0;

        // Recalculer les totaux si nécessaire
        if (field !== 'nom') {
            updateProductDisplay(productId);
        }

        saveData();
    }
}

function updateProductDisplay(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    // Calculer la marge du produit
    const marge = product.ca > 0 ? (product.benefice / product.ca) * 100 : 0;

    // Mettre à jour l'affichage
    const margeElement = document.getElementById(`product-marge-${productId}`);
    if (margeElement) {
        margeElement.textContent = `${marge.toFixed(1)}%`;
    }
}

function loadProducts() {
    // Si aucun produit, en créer un par défaut
    if (products.length === 0) {
        addProduct();
    } else {
        renderProducts();
    }
}

function renderProducts() {
    const container = document.getElementById('products-container');
    container.innerHTML = '';

    products.forEach(product => {
        const marge = product.ca > 0 ? (product.benefice / product.ca) * 100 : 0;

        const productCard = document.createElement('div');
        productCard.className = 'bg-white p-6 rounded-xl shadow-md card';
        productCard.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <input type="text" value="${product.nom}"
                    onchange="updateProduct(${product.id}, 'nom', this.value)"
                    class="text-xl font-bold text-gray-800 bg-transparent border-b-2 border-transparent hover:border-purple-300 focus:border-purple-500 outline-none transition">
                <button onclick="deleteProduct(${product.id})" class="text-red-500 hover:text-red-700 transition">
                    <i class="fas fa-trash"></i>
                </button>
            </div>

            <div class="space-y-3">
                <div>
                    <label class="block text-sm text-gray-600 mb-1">CA (€)</label>
                    <input type="number" value="${product.ca}"
                        oninput="updateProduct(${product.id}, 'ca', this.value)"
                        class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 transition">
                </div>

                <div>
                    <label class="block text-sm text-gray-600 mb-1">Bénéfice (€)</label>
                    <input type="number" value="${product.benefice}"
                        oninput="updateProduct(${product.id}, 'benefice', this.value)"
                        class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 transition">
                </div>

                <div>
                    <label class="block text-sm text-gray-600 mb-1">Unités vendues</label>
                    <input type="number" value="${product.unites}"
                        oninput="updateProduct(${product.id}, 'unites', this.value)"
                        class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 transition">
                </div>

                <div>
                    <label class="block text-sm text-gray-600 mb-1">ACOS (%)</label>
                    <input type="number" step="0.01" value="${product.acos}"
                        oninput="updateProduct(${product.id}, 'acos', this.value)"
                        class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 transition">
                </div>

                <div class="pt-3 border-t border-gray-200 flex justify-between items-center">
                    <span class="text-gray-600 text-sm">Marge:</span>
                    <span class="font-bold text-lg ${marge > 20 ? 'text-green-600' : 'text-orange-600'}" id="product-marge-${product.id}">
                        ${marge.toFixed(1)}%
                    </span>
                </div>
            </div>
        `;

        container.appendChild(productCard);
    });
}

// ===========================
// GRAPHIQUES CHART.JS - VERSION AMELIOREE
// ===========================

let graphPeriode = 30; // Periode par defaut: 30 jours
let graphCharts = {}; // Stockage des nouveaux graphiques

function initCharts() {
    // Configuration commune
    Chart.defaults.font.family = 'system-ui, -apple-system, sans-serif';
    // Les anciens graphiques ne sont plus utilises, on utilise updateCharts()
}

function updateCharts() {
    // Verifier s'il y a des donnees
    const hasData = suiviHebdo && suiviHebdo.length > 0;
    const noDataDiv = document.getElementById('graph-no-data');

    if (!hasData) {
        if (noDataDiv) noDataDiv.classList.remove('hidden');
        return;
    }

    if (noDataDiv) noDataDiv.classList.add('hidden');

    // Filtrer les donnees selon la periode
    const dataFiltrees = filtrerDonneesParPeriode(graphPeriode);

    // Mettre a jour les KPIs
    updateGraphKPIs(dataFiltrees);

    // Mettre a jour tous les graphiques
    renderChartEvolutionCA(dataFiltrees);
    renderChartProduitsPerf(dataFiltrees);
    renderChartCoutsRepartition(dataFiltrees);
    renderChartEvolutionMarge(dataFiltrees);
    renderChartAcosSemaine(dataFiltrees);
    renderChartObjectifs(dataFiltrees);
    renderChartComparaison(dataFiltrees);
}

// Filtrer les donnees selon la periode selectionnee
function filtrerDonneesParPeriode(jours) {
    if (!suiviHebdo || suiviHebdo.length === 0) return [];

    if (jours === 'all') return [...suiviHebdo].reverse();

    const now = new Date();
    const limite = new Date(now.getTime() - (jours * 24 * 60 * 60 * 1000));

    return suiviHebdo.filter(s => {
        const date = new Date(s.dateDebut);
        return date >= limite;
    }).reverse();
}

// Changer la periode des graphiques
function setGraphPeriode(periode) {
    graphPeriode = periode;

    // Mettre a jour les boutons
    document.querySelectorAll('.graph-periode-btn').forEach(btn => {
        btn.classList.remove('bg-purple-600', 'text-white');
        btn.classList.add('bg-gray-100', 'text-gray-600');
    });

    const activeBtn = document.getElementById(`graph-periode-${periode}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-gray-100', 'text-gray-600');
        activeBtn.classList.add('bg-purple-600', 'text-white');
    }

    // Mettre a jour le texte d'info
    const infoTexts = {
        '7': '7 derniers jours',
        '30': '30 derniers jours',
        '90': '3 derniers mois',
        '180': '6 derniers mois',
        '365': '12 derniers mois',
        'all': 'Toutes les donnees'
    };
    updateElement('graph-periode-info', `Donnees: ${infoTexts[periode] || ''}`);

    // Rafraichir les graphiques
    updateCharts();
}

// Mettre a jour les KPIs en haut de page
function updateGraphKPIs(data) {
    if (!data || data.length === 0) return;

    // Calculs totaux
    let totalCA = 0;
    let totalBenefice = 0;
    let totalMarge = 0;
    let produitsPerf = {};

    data.forEach(semaine => {
        totalCA += semaine.totalCA || 0;
        totalBenefice += semaine.totalBenefice || 0;
        totalMarge += semaine.margeNetteMoyenne || 0;

        // Agreger par produit
        if (semaine.produits) {
            semaine.produits.forEach(p => {
                if (!produitsPerf[p.nom]) produitsPerf[p.nom] = 0;
                produitsPerf[p.nom] += p.caTotal || 0;
            });
        }
    });

    const margeMoyenne = data.length > 0 ? totalMarge / data.length : 0;

    // Trouver le meilleur produit
    let bestProduit = '--';
    let bestCA = 0;
    Object.entries(produitsPerf).forEach(([nom, ca]) => {
        if (ca > bestCA) {
            bestCA = ca;
            bestProduit = nom;
        }
    });

    // Calcul tendance (comparer avec periode precedente)
    const moitie = Math.floor(data.length / 2);
    const dataRecente = data.slice(moitie);
    const dataAncienne = data.slice(0, moitie);

    const caRecent = dataRecente.reduce((sum, s) => sum + (s.totalCA || 0), 0);
    const caAncien = dataAncienne.reduce((sum, s) => sum + (s.totalCA || 0), 0);
    const tendanceCA = caAncien > 0 ? ((caRecent - caAncien) / caAncien * 100) : 0;

    const benefRecent = dataRecente.reduce((sum, s) => sum + (s.totalBenefice || 0), 0);
    const benefAncien = dataAncienne.reduce((sum, s) => sum + (s.totalBenefice || 0), 0);
    const tendanceBenef = benefAncien > 0 ? ((benefRecent - benefAncien) / benefAncien * 100) : 0;

    // Mise a jour affichage
    updateElement('graph-kpi-ca', formatCurrency(totalCA));
    updateElement('graph-kpi-benefice', formatCurrency(totalBenefice));
    updateElement('graph-kpi-marge', margeMoyenne.toFixed(1) + '%');
    updateElement('graph-kpi-best', bestProduit.length > 15 ? bestProduit.substring(0, 15) + '...' : bestProduit);
    updateElement('graph-kpi-best-ca', formatCurrency(bestCA));

    // Tendances
    const trendCA = document.getElementById('graph-kpi-ca-trend');
    if (trendCA) {
        const icon = tendanceCA >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        const color = tendanceCA >= 0 ? 'text-green-300' : 'text-red-300';
        trendCA.innerHTML = `<i class="fas ${icon} ${color}"></i> <span class="${color}">${tendanceCA >= 0 ? '+' : ''}${tendanceCA.toFixed(1)}% vs periode prec.</span>`;
    }

    const trendBenef = document.getElementById('graph-kpi-benefice-trend');
    if (trendBenef) {
        const icon = tendanceBenef >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        const color = tendanceBenef >= 0 ? 'text-green-300' : 'text-red-300';
        trendBenef.innerHTML = `<i class="fas ${icon} ${color}"></i> <span class="${color}">${tendanceBenef >= 0 ? '+' : ''}${tendanceBenef.toFixed(1)}%</span>`;
    }
}

// Graphique 1: Evolution CA & Benefice
function renderChartEvolutionCA(data) {
    const ctx = document.getElementById('chart-evolution-ca');
    if (!ctx) return;

    if (graphCharts.evolutionCA) graphCharts.evolutionCA.destroy();

    const labels = data.map(s => s.semaine || formatDate(s.dateDebut));
    const caData = data.map(s => s.totalCA || 0);
    const benefData = data.map(s => s.totalBenefice || 0);

    graphCharts.evolutionCA = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'CA',
                data: caData,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.3,
                fill: true
            }, {
                label: 'Benefice',
                data: benefData,
                borderColor: 'rgb(34, 197, 94)',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => v + ' EUR' }
                }
            }
        }
    });
}

// Graphique 2: Performance par Produit
function renderChartProduitsPerf(data) {
    const ctx = document.getElementById('chart-produits-perf');
    if (!ctx) return;

    if (graphCharts.produitsPerf) graphCharts.produitsPerf.destroy();

    // Agreger CA par produit
    const produitsCA = {};
    data.forEach(semaine => {
        if (semaine.produits) {
            semaine.produits.forEach(p => {
                if (!produitsCA[p.nom]) produitsCA[p.nom] = 0;
                produitsCA[p.nom] += p.caTotal || 0;
            });
        }
    });

    // Trier par CA decroissant et prendre les 6 premiers
    const sorted = Object.entries(produitsCA).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const labels = sorted.map(([nom]) => nom.length > 20 ? nom.substring(0, 20) + '...' : nom);
    const values = sorted.map(([, ca]) => ca);

    const colors = [
        'rgba(59, 130, 246, 0.8)',
        'rgba(34, 197, 94, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(139, 92, 246, 0.8)',
        'rgba(107, 114, 128, 0.8)'
    ];

    graphCharts.produitsPerf = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'CA',
                data: values,
                backgroundColor: colors.slice(0, values.length),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { callback: v => v + ' EUR' }
                }
            }
        }
    });
}

// Graphique 3: Repartition des Couts
function renderChartCoutsRepartition(data) {
    const ctx = document.getElementById('chart-couts-repartition');
    if (!ctx) return;

    if (graphCharts.coutsRepartition) graphCharts.coutsRepartition.destroy();

    // Calculer les totaux
    let totalCA = 0;
    let totalBenefice = 0;
    let totalPPC = 0;

    data.forEach(s => {
        totalCA += s.totalCA || 0;
        totalBenefice += s.totalBenefice || 0;
        totalPPC += s.totalPPC || 0;
    });

    // Estimations
    const cogs = totalCA * 0.35; // Cout marchandises ~35%
    const fraisAmazon = totalCA * 0.25; // Frais Amazon ~25%
    const urssaf = totalCA * 0.123; // URSSAF 12.3%

    const values = [totalBenefice, cogs, fraisAmazon, totalPPC, urssaf];
    const labels = ['Benefice', 'Marchandises', 'Frais Amazon', 'Publicite PPC', 'URSSAF'];
    const colors = [
        'rgba(34, 197, 94, 0.8)',
        'rgba(107, 114, 128, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(139, 92, 246, 0.8)'
    ];

    graphCharts.coutsRepartition = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } }
        }
    });

    // Legende custom
    const legendDiv = document.getElementById('chart-couts-legend');
    if (legendDiv) {
        legendDiv.innerHTML = labels.map((label, i) => `
            <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded" style="background: ${colors[i]}"></span>
                <span>${label}: ${formatCurrency(values[i])}</span>
            </div>
        `).join('');
    }
}

// Graphique 4: Evolution Marge
function renderChartEvolutionMarge(data) {
    const ctx = document.getElementById('chart-evolution-marge');
    if (!ctx) return;

    if (graphCharts.evolutionMarge) graphCharts.evolutionMarge.destroy();

    const labels = data.map(s => s.semaine || formatDate(s.dateDebut));
    const margeData = data.map(s => s.margeNetteMoyenne || 0);

    // Couleurs selon la marge
    const colors = margeData.map(m => {
        if (m >= 20) return 'rgba(34, 197, 94, 0.8)';
        if (m >= 10) return 'rgba(245, 158, 11, 0.8)';
        return 'rgba(239, 68, 68, 0.8)';
    });

    graphCharts.evolutionMarge = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Marge %',
                data: margeData,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => v + '%' }
                }
            }
        }
    });
}

// Graphique 5: ACOS par Semaine
function renderChartAcosSemaine(data) {
    const ctx = document.getElementById('chart-acos-semaine');
    if (!ctx) return;

    if (graphCharts.acosSemaine) graphCharts.acosSemaine.destroy();

    const labels = data.map(s => s.semaine || formatDate(s.dateDebut));
    const acosData = data.map(s => s.acosMoyen || 0);

    // Couleurs selon ACOS (plus c'est bas, mieux c'est)
    const colors = acosData.map(a => {
        if (a <= 15) return 'rgba(34, 197, 94, 0.8)';
        if (a <= 25) return 'rgba(245, 158, 11, 0.8)';
        return 'rgba(239, 68, 68, 0.8)';
    });

    graphCharts.acosSemaine = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'ACOS %',
                data: acosData,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    max: Math.max(30, ...acosData) + 5,
                    ticks: { callback: v => v + '%' }
                }
            }
        }
    });
}

// Graphique 6: Objectifs vs Realise
function renderChartObjectifs(data) {
    const container = document.getElementById('chart-objectifs-container');
    if (!container) return;

    // Calculer les totaux
    let totalCA = 0;
    let totalBenefice = 0;
    let totalUnites = 0;

    data.forEach(s => {
        totalCA += s.totalCA || 0;
        totalBenefice += s.totalBenefice || 0;
        totalUnites += s.totalUnites || 0;
    });

    // Objectifs depuis les inputs
    const objCA = parseFloat(document.getElementById('input-obj-ca')?.value || 10000);
    const objBenef = parseFloat(document.getElementById('input-obj-benefice')?.value || 2000);
    const objUnites = parseFloat(document.getElementById('input-obj-unites')?.value || 200);

    const objectifs = [
        { label: 'Chiffre d\'Affaires', realise: totalCA, objectif: objCA, unit: 'EUR' },
        { label: 'Benefice', realise: totalBenefice, objectif: objBenef, unit: 'EUR' },
        { label: 'Unites vendues', realise: totalUnites, objectif: objUnites, unit: '' }
    ];

    container.innerHTML = objectifs.map(obj => {
        const pct = obj.objectif > 0 ? Math.min((obj.realise / obj.objectif) * 100, 100) : 0;
        const pctDisplay = obj.objectif > 0 ? (obj.realise / obj.objectif) * 100 : 0;
        const color = pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-orange-500';
        const realiseStr = obj.unit === 'EUR' ? formatCurrency(obj.realise) : obj.realise;
        const objectifStr = obj.unit === 'EUR' ? formatCurrency(obj.objectif) : obj.objectif;

        return `
            <div>
                <div class="flex justify-between text-sm mb-1">
                    <span class="font-medium text-gray-700">${obj.label}</span>
                    <span class="text-gray-600">${realiseStr} / ${objectifStr}</span>
                </div>
                <div class="h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div class="h-full ${color} transition-all duration-500" style="width: ${pct}%"></div>
                </div>
                <div class="text-right text-xs text-gray-500 mt-1">${pctDisplay.toFixed(1)}%</div>
            </div>
        `;
    }).join('');
}

// Graphique 7: Comparaison Periodes
function renderChartComparaison(data) {
    const ctx = document.getElementById('chart-comparaison');
    if (!ctx) return;

    if (graphCharts.comparaison) graphCharts.comparaison.destroy();

    // Diviser en deux periodes
    const moitie = Math.floor(data.length / 2);
    const dataRecente = data.slice(moitie);
    const dataAncienne = data.slice(0, moitie);

    const caRecent = dataRecente.reduce((sum, s) => sum + (s.totalCA || 0), 0);
    const caAncien = dataAncienne.reduce((sum, s) => sum + (s.totalCA || 0), 0);
    const benefRecent = dataRecente.reduce((sum, s) => sum + (s.totalBenefice || 0), 0);
    const benefAncien = dataAncienne.reduce((sum, s) => sum + (s.totalBenefice || 0), 0);

    updateElement('compare-actuel', formatCurrency(caRecent));
    updateElement('compare-precedent', formatCurrency(caAncien));

    graphCharts.comparaison = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['CA', 'Benefice'],
            datasets: [{
                label: 'Periode actuelle',
                data: [caRecent, benefRecent],
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderRadius: 4
            }, {
                label: 'Periode precedente',
                data: [caAncien, benefAncien],
                backgroundColor: 'rgba(156, 163, 175, 0.8)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom' } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => v + ' EUR' }
                }
            }
        }
    });
}

// Export des graphiques
function exportGraphiques() {
    // Creer un resume texte
    const kpiCA = document.getElementById('graph-kpi-ca')?.textContent || '0';
    const kpiBenef = document.getElementById('graph-kpi-benefice')?.textContent || '0';
    const kpiMarge = document.getElementById('graph-kpi-marge')?.textContent || '0';
    const kpiBest = document.getElementById('graph-kpi-best')?.textContent || '--';

    const texte = `=== RAPPORT ANALYTICS ===
Date: ${new Date().toLocaleDateString('fr-FR')}
Periode: ${document.getElementById('graph-periode-info')?.textContent || ''}

CA Total: ${kpiCA}
Benefice Total: ${kpiBenef}
Marge Moyenne: ${kpiMarge}
Meilleur Produit: ${kpiBest}

Genere par FBA Dashboard`;

    // Copier dans le presse-papier
    navigator.clipboard.writeText(texte).then(() => {
        showNotification('Rapport copie dans le presse-papier !', 'success');
    }).catch(() => {
        // Fallback: telecharger comme fichier
        const blob = new Blob([texte], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rapport-analytics-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Rapport telecharge !', 'success');
    });
}

// ===========================
// GESTION DES PARAMÈTRES
// ===========================

function updateChargesFixes() {
    // Charges fixes mensuelles
    const amazonPro = parseFloat(document.getElementById('charge-amazon-pro')?.value || 0);
    const helium10 = parseFloat(document.getElementById('charge-helium10')?.value || 0);
    const canva = parseFloat(document.getElementById('charge-canva')?.value || 0);
    const ia = parseFloat(document.getElementById('charge-ia')?.value || 0);
    const comptable = parseFloat(document.getElementById('charge-comptable')?.value || 0);
    const banque = parseFloat(document.getElementById('charge-banque')?.value || 0);
    const assurance = parseFloat(document.getElementById('charge-assurance')?.value || 0);
    const credit = parseFloat(document.getElementById('charge-credit')?.value || 0);
    const autresAbonnements = parseFloat(document.getElementById('charge-autres-abonnements')?.value || 0);

    const totalMensuelles = amazonPro + helium10 + canva + ia + comptable + banque + assurance + credit + autresAbonnements;

    // Charges fixes annuelles (lissées sur 12 mois)
    const gs1 = parseFloat(document.getElementById('charge-gs1')?.value || 0);
    const inpi = parseFloat(document.getElementById('charge-inpi')?.value || 0);
    const photos = parseFloat(document.getElementById('charge-photos')?.value || 0);
    const formation = parseFloat(document.getElementById('charge-formation')?.value || 0);
    const web = parseFloat(document.getElementById('charge-web')?.value || 0);
    const juridique = parseFloat(document.getElementById('charge-juridique')?.value || 0);
    const autresFixes = parseFloat(document.getElementById('charge-autres-fixes')?.value || 0);

    const totalAnnuelles = gs1 + inpi + photos + formation + web + juridique + autresFixes;

    // Total global
    const totalGlobal = totalMensuelles + totalAnnuelles;

    // Mettre à jour l'affichage
    updateElement('total-charges-fixes-mensuelles', formatCurrency(totalMensuelles));
    updateElement('total-charges-fixes-annuelles', formatCurrency(totalAnnuelles));
    updateElement('total-global-charges-fixes', formatCurrency(totalGlobal));

    // Sauvegarder et recalculer
    saveParams();
    calculateAll();
}

function saveParams() {
    // Ne pas sauvegarder si chargement en cours
    if (typeof isLoading !== 'undefined' && isLoading) {
        return;
    }

    const params = {
        tva: document.getElementById('param-tva')?.value || 20,
        impots: document.getElementById('param-impots')?.value || 13.3,
        capital: document.getElementById('param-capital')?.value || 3000,
        objectifROI: document.getElementById('param-objectif-roi')?.value || 30,
        objectifMarge: document.getElementById('param-objectif-marge')?.value || 25,
        stockSecurite: document.getElementById('param-stock-securite')?.value || 15,

        // Charges fixes mensuelles
        chargeAmazonPro: document.getElementById('charge-amazon-pro')?.value || 39,
        chargeHelium10: document.getElementById('charge-helium10')?.value || 0,
        chargeCanva: document.getElementById('charge-canva')?.value || 0,
        chargeIA: document.getElementById('charge-ia')?.value || 0,
        chargeComptable: document.getElementById('charge-comptable')?.value || 0,
        chargeBanque: document.getElementById('charge-banque')?.value || 0,
        chargeAssurance: document.getElementById('charge-assurance')?.value || 0,
        chargeCredit: document.getElementById('charge-credit')?.value || 0,
        chargeAutresAbonnements: document.getElementById('charge-autres-abonnements')?.value || 0,

        // Charges fixes annuelles
        chargeGS1: document.getElementById('charge-gs1')?.value || 0,
        chargeINPI: document.getElementById('charge-inpi')?.value || 0,
        chargePhotos: document.getElementById('charge-photos')?.value || 0,
        chargeFormation: document.getElementById('charge-formation')?.value || 0,
        chargeWeb: document.getElementById('charge-web')?.value || 0,
        chargeJuridique: document.getElementById('charge-juridique')?.value || 0,
        chargeAutresFixes: document.getElementById('charge-autres-fixes')?.value || 0
    };

    localStorage.setItem('fba-dashboard-params', JSON.stringify(params));
    updateRecapCharges();

    // Sauvegarder sur le cloud si disponible
    if (typeof saveParamsToCloud === 'function') {
        saveParamsToCloud();
    }
}

function loadParams() {
    const savedParams = localStorage.getItem('fba-dashboard-params');

    if (savedParams) {
        const params = JSON.parse(savedParams);

        // Charger les valeurs dans les inputs - Paramètres généraux
        if (document.getElementById('param-tva')) document.getElementById('param-tva').value = params.tva || 20;
        if (document.getElementById('param-impots')) document.getElementById('param-impots').value = params.impots || 13.3;
        if (document.getElementById('param-capital')) document.getElementById('param-capital').value = params.capital || 3000;
        if (document.getElementById('param-objectif-roi')) document.getElementById('param-objectif-roi').value = params.objectifROI || 30;
        if (document.getElementById('param-objectif-marge')) document.getElementById('param-objectif-marge').value = params.objectifMarge || 25;
        if (document.getElementById('param-stock-securite')) document.getElementById('param-stock-securite').value = params.stockSecurite || 15;

        // Charger les charges fixes mensuelles
        if (document.getElementById('charge-amazon-pro')) document.getElementById('charge-amazon-pro').value = params.chargeAmazonPro || 39;
        if (document.getElementById('charge-helium10')) document.getElementById('charge-helium10').value = params.chargeHelium10 || 0;
        if (document.getElementById('charge-canva')) document.getElementById('charge-canva').value = params.chargeCanva || 0;
        if (document.getElementById('charge-ia')) document.getElementById('charge-ia').value = params.chargeIA || 0;
        if (document.getElementById('charge-comptable')) document.getElementById('charge-comptable').value = params.chargeComptable || 0;
        if (document.getElementById('charge-banque')) document.getElementById('charge-banque').value = params.chargeBanque || 0;
        if (document.getElementById('charge-assurance')) document.getElementById('charge-assurance').value = params.chargeAssurance || 0;
        if (document.getElementById('charge-credit')) document.getElementById('charge-credit').value = params.chargeCredit || 0;
        if (document.getElementById('charge-autres-abonnements')) document.getElementById('charge-autres-abonnements').value = params.chargeAutresAbonnements || 0;

        // Charger les charges fixes annuelles
        if (document.getElementById('charge-gs1')) document.getElementById('charge-gs1').value = params.chargeGS1 || 0;
        if (document.getElementById('charge-inpi')) document.getElementById('charge-inpi').value = params.chargeINPI || 0;
        if (document.getElementById('charge-photos')) document.getElementById('charge-photos').value = params.chargePhotos || 0;
        if (document.getElementById('charge-formation')) document.getElementById('charge-formation').value = params.chargeFormation || 0;
        if (document.getElementById('charge-web')) document.getElementById('charge-web').value = params.chargeWeb || 0;
        if (document.getElementById('charge-juridique')) document.getElementById('charge-juridique').value = params.chargeJuridique || 0;
        if (document.getElementById('charge-autres-fixes')) document.getElementById('charge-autres-fixes').value = params.chargeAutresFixes || 0;
    }

    updateChargesFixes();
    updateRecapCharges();
}

function syncCapital() {
    // Synchroniser le capital entre la section Paramètres et Pilotage Mensuel
    const capitalParams = parseFloat(document.getElementById('param-capital')?.value || 0);
    const capitalPilotage = document.getElementById('input-capital');

    if (capitalPilotage) {
        capitalPilotage.value = capitalParams;
    }
}

function updateRecapCharges() {
    // Calculer le total des charges fixes depuis tous les champs
    const amazonPro = parseFloat(document.getElementById('charge-amazon-pro')?.value || 0);
    const helium10 = parseFloat(document.getElementById('charge-helium10')?.value || 0);
    const canva = parseFloat(document.getElementById('charge-canva')?.value || 0);
    const ia = parseFloat(document.getElementById('charge-ia')?.value || 0);
    const comptable = parseFloat(document.getElementById('charge-comptable')?.value || 0);
    const banque = parseFloat(document.getElementById('charge-banque')?.value || 0);
    const assurance = parseFloat(document.getElementById('charge-assurance')?.value || 0);
    const credit = parseFloat(document.getElementById('charge-credit')?.value || 0);
    const autresAbonnements = parseFloat(document.getElementById('charge-autres-abonnements')?.value || 0);
    const gs1 = parseFloat(document.getElementById('charge-gs1')?.value || 0);
    const inpi = parseFloat(document.getElementById('charge-inpi')?.value || 0);
    const photos = parseFloat(document.getElementById('charge-photos')?.value || 0);
    const formation = parseFloat(document.getElementById('charge-formation')?.value || 0);
    const web = parseFloat(document.getElementById('charge-web')?.value || 0);
    const juridique = parseFloat(document.getElementById('charge-juridique')?.value || 0);
    const autresFixes = parseFloat(document.getElementById('charge-autres-fixes')?.value || 0);

    const chargesFixes = amazonPro + helium10 + canva + ia + comptable + banque + assurance + credit +
                         autresAbonnements + gs1 + inpi + photos + formation + web + juridique + autresFixes;

    // Récupérer le bénéfice actuel pour calculer les impôts
    const benefice = parseFloat(document.getElementById('input-benefice')?.value || 0);
    const tauxImpots = parseFloat(document.getElementById('param-impots')?.value || 13.3) / 100;
    const impots = benefice * tauxImpots;

    const totalCharges = chargesFixes + impots;

    // Mettre à jour l'affichage
    updateElement('recap-charges-fixes', formatCurrency(chargesFixes));
    updateElement('recap-charges-variables', formatCurrency(0)); // Plus de charges variables séparées
    updateElement('recap-impots', formatCurrency(impots));
    updateElement('recap-total-charges', formatCurrency(totalCharges));
}

// ===========================
// GESTION SOURCING PRODUITS
// ===========================

let comparisonProducts = []; // Stockage des produits à comparer

function calculateSourcing() {
    // ===========================
    // 1. RÉCUPÉRATION DES DONNÉES
    // ===========================

    // Dimensions et poids
    const longueur = parseFloat(document.getElementById('sourcing-longueur')?.value || 0);
    const largeur = parseFloat(document.getElementById('sourcing-largeur')?.value || 0);
    const hauteur = parseFloat(document.getElementById('sourcing-hauteur')?.value || 0);
    const volume = longueur * largeur * hauteur;
    const poids = parseFloat(document.getElementById('sourcing-poids')?.value || 0); // en grammes

    const categorieSelect = document.getElementById('sourcing-categorie');
    const tauxCommission = parseFloat(categorieSelect?.value || 0) / 100;

    // ===========================
    // 2. CONVERSION USD/EUR (+3%)
    // ===========================
    const prixUSD = parseFloat(document.getElementById('sourcing-prix-usd')?.value || 0);
    const tauxEURUSD = parseFloat(document.getElementById('sourcing-taux-eur-usd')?.value || 0.92);
    const prixConverti = prixUSD > 0 ? (prixUSD * tauxEURUSD * 1.03) : 0; // +3% marge sécurité
    updateElement('sourcing-prix-converti', formatCurrency(prixConverti));

    // Prix et coûts
    const prixVente = parseFloat(document.getElementById('sourcing-prix-vente')?.value || 0);
    const coutAchat = parseFloat(document.getElementById('sourcing-cout-achat')?.value || 0);

    // ===========================
    // 3. TRANSPORT AUTO (€/u)
    // ===========================
    const qteTransport = parseFloat(document.getElementById('sourcing-qte-transport')?.value || 0);
    const factureTransport = parseFloat(document.getElementById('sourcing-facture-transport')?.value || 0);
    const fraisTransport = qteTransport > 0 ? (factureTransport / qteTransport) : 0;
    updateElement('sourcing-frais-transport-calc', formatCurrency(fraisTransport) + '/u');

    // ===========================
    // 4. CONTRÔLE QUALITÉ AUTO (€/u)
    // ===========================
    const qteQC = parseFloat(document.getElementById('sourcing-qte-qc')?.value || 0);
    const factureQC = parseFloat(document.getElementById('sourcing-facture-qc')?.value || 0);
    const controleQualite = qteQC > 0 ? (factureQC / qteQC) : 0;
    updateElement('sourcing-controle-qualite-calc', formatCurrency(controleQualite) + '/u');

    // ===========================
    // 5. STOCKAGE FBA AUTO (basé sur poids si renseigné)
    // ===========================
    let fraisStockage = parseFloat(document.getElementById('sourcing-frais-stockage')?.value || 0);

    // Si le poids est renseigné et que le stockage n'est pas manuel, calculer automatiquement
    // Grille Amazon approximative (€/mois, lissé sur 6 mois) :
    // < 500g : 0.30€, 500g-1kg : 0.45€, 1-2kg : 0.60€, 2-5kg : 1.00€, >5kg : 1.50€
    if (poids > 0 && fraisStockage === 0) {
        const poidsKg = poids / 1000;
        if (poidsKg < 0.5) fraisStockage = 0.30;
        else if (poidsKg < 1) fraisStockage = 0.45;
        else if (poidsKg < 2) fraisStockage = 0.60;
        else if (poidsKg < 5) fraisStockage = 1.00;
        else fraisStockage = 1.50;

        // Mettre à jour le champ pour que l'utilisateur voit le calcul auto
        document.getElementById('sourcing-frais-stockage').value = fraisStockage.toFixed(2);
    }

    // ===========================
    // 6. CONCURRENCE - TOP 5 + MÉDIANE + PRIX MOYEN
    // ===========================
    const top1 = parseFloat(document.getElementById('sourcing-top1')?.value || 0);
    const top2 = parseFloat(document.getElementById('sourcing-top2')?.value || 0);
    const top3 = parseFloat(document.getElementById('sourcing-top3')?.value || 0);
    const top4 = parseFloat(document.getElementById('sourcing-top4')?.value || 0);
    const top5 = parseFloat(document.getElementById('sourcing-top5')?.value || 0);

    // Moyenne CA Top 5
    const moyenneTop5 = (top1 + top2 + top3 + top4 + top5) / 5;

    // Médiane CA Top 5
    const top5Array = [top1, top2, top3, top4, top5].filter(v => v > 0).sort((a, b) => a - b);
    const medianeTop5 = top5Array.length > 0 ? top5Array[Math.floor(top5Array.length / 2)] : 0;

    // Prix moyen Top 5 (estimation basée sur le CA moyen et le prix de vente)
    // On estime que le CA = Prix × Quantité vendue
    // Donc Prix moyen ≈ Prix de vente du produit analysé (approximation)
    // Meilleure approche : si on a le prix de vente, on garde cette logique
    const prixMoyenTop5 = prixVente; // Simplifié - pourrait être affiné avec plus de données

    updateElement('sourcing-moyenne-top5', formatCurrency(moyenneTop5));
    updateElement('sourcing-mediane-top5', formatCurrency(medianeTop5));
    updateElement('sourcing-prix-moyen-top5', formatCurrency(prixMoyenTop5));

    const noteAvis = parseFloat(document.getElementById('sourcing-note-avis')?.value || 0);
    const nbReviews = parseFloat(document.getElementById('sourcing-nb-reviews')?.value || 0);

    // ===========================
    // 7. CALCULS FINANCIERS DÉTAILLÉS
    // ===========================

    // Commission Amazon
    const commissionAmazon = prixVente * tauxCommission;

    // ===========================
    // 8. FRAIS FBA AUTO (basés sur volume ET poids selon grille Amazon)
    // ===========================
    // Grille Amazon FBA 2025 (approximative, à ajuster selon marketplace)
    let fraisFBA;

    if (poids > 0 && volume > 0) {
        const poidsKg = poids / 1000;

        // Petits articles standards
        if (poidsKg <= 0.5 && volume <= 1000) {
            fraisFBA = 2.50;
        }
        // Articles standards
        else if (poidsKg <= 1 && volume <= 5000) {
            fraisFBA = 3.50;
        }
        // Articles moyens
        else if (poidsKg <= 2 && volume <= 10000) {
            fraisFBA = 5.00;
        }
        // Grands articles
        else if (poidsKg <= 5 && volume <= 30000) {
            fraisFBA = 6.50;
        }
        // Très grands articles
        else if (poidsKg <= 10 && volume <= 60000) {
            fraisFBA = 9.00;
        }
        // Articles surdimensionnés
        else {
            fraisFBA = 12.00 + (poidsKg - 10) * 0.50; // 12€ + 0.50€ par kg supplémentaire
        }
    }
    // Fallback sur volume seul si pas de poids
    else if (volume > 0) {
        if (volume < 1000) {
            fraisFBA = 2.50;
        } else if (volume < 5000) {
            fraisFBA = 3.50;
        } else if (volume < 10000) {
            fraisFBA = 5.00;
        } else {
            fraisFBA = 6.50;
        }
    } else {
        fraisFBA = 3.50; // Valeur par défaut
    }

    // ===========================
    // 9. COÛT PPC (basé sur ACOS)
    // ===========================
    // ACOS = (Coût pub / CA) × 100
    // Donc Coût PPC = Prix vente × (ACOS / 100)
    const acos = parseFloat(document.getElementById('sourcing-acos')?.value || 0);
    const coutPPC = prixVente * (acos / 100);

    updateElement('sourcing-cout-ppc-calc', formatCurrency(coutPPC));
    updateElement('calc-cout-ppc', `-${formatCurrency(coutPPC)}`);
    updateElement('calc-acos-pourcent', `(ACOS ${acos.toFixed(1)}%)`);

    // ===========================
    // 10. COÛTS DE LANCEMENT
    // ===========================
    const coutPhotos = parseFloat(document.getElementById('sourcing-cout-photos')?.value || 0);
    const coutDesign = parseFloat(document.getElementById('sourcing-cout-design')?.value || 0);
    const coutCertif = parseFloat(document.getElementById('sourcing-cout-certif')?.value || 0);
    const coutEchantillons = parseFloat(document.getElementById('sourcing-cout-echantillons')?.value || 0);
    const coutMarketing = parseFloat(document.getElementById('sourcing-cout-marketing')?.value || 0);

    const totalLancement = coutPhotos + coutDesign + coutCertif + coutEchantillons + coutMarketing;
    updateElement('sourcing-total-lancement', formatCurrency(totalLancement));

    // ===========================
    // 11. CALCULS FINANCIERS FINAUX
    // ===========================

    // Coût total par unité (INCLUANT PPC)
    const coutTotal = coutAchat + fraisTransport + controleQualite + fraisStockage + commissionAmazon + fraisFBA + coutPPC;

    // Bénéfice brut unitaire (APRÈS PPC)
    const beneficeBrut = prixVente - coutTotal;

    // Marge nette (%) (APRÈS PPC)
    const margeNette = prixVente > 0 ? (beneficeBrut / prixVente) * 100 : 0;

    // ROI unitaire (%) (APRÈS PPC)
    const coutInvestissement = coutAchat + fraisTransport + controleQualite;
    const roiUnitaire = coutInvestissement > 0 ? (beneficeBrut / coutInvestissement) * 100 : 0;

    // ===========================
    // 11. AMORTISSEMENT COÛTS DE LANCEMENT
    // ===========================
    const qteCommande = parseFloat(document.getElementById('sourcing-qte-commande')?.value || 0);

    // Coût de lancement amorti par unité
    const coutLancementUnitaire = qteCommande > 0 ? (totalLancement / qteCommande) : 0;
    updateElement('sourcing-cout-lancement-unitaire', formatCurrency(coutLancementUnitaire) + '/u');

    // COÛT TOTAL UNITAIRE (incluant lancement amorti)
    const coutTotalUnitaire = coutTotal + coutLancementUnitaire;
    updateElement('calc-cout-lancement-unitaire', `-${formatCurrency(coutLancementUnitaire)}`);
    updateElement('calc-cout-total-unitaire', formatCurrency(coutTotalUnitaire));

    // Bénéfice NET après amortissement lancement (première commande)
    const beneficeNetPremiereCommande = prixVente - coutTotalUnitaire;

    // Marge nette APRÈS amortissement lancement
    const margeNettePremiereCommande = prixVente > 0 ? (beneficeNetPremiereCommande / prixVente) * 100 : 0;

    // ===========================
    // 12. BREAK-EVEN ET CAPITAL TOTAL
    // ===========================

    // Break-even = Coûts de lancement / Bénéfice brut par unité (récurrent)
    const breakeven = beneficeBrut > 0 ? Math.ceil(totalLancement / beneficeBrut) : 0;
    updateElement('sourcing-breakeven', `${breakeven} u`);

    // Capital total nécessaire = (Coût d'investissement × Quantité) + Coûts de lancement
    const coutStock = coutInvestissement * qteCommande;
    const capitalTotal = coutStock + totalLancement;
    updateElement('sourcing-capital-total', formatCurrency(capitalTotal));

    // Récupérer les objectifs depuis les paramètres
    const objectifMarge = parseFloat(document.getElementById('param-objectif-marge')?.value || 25);
    const objectifROI = parseFloat(document.getElementById('param-objectif-roi')?.value || 30);

    // ===========================
    // MISE À JOUR AFFICHAGE
    // ===========================

    updateElement('sourcing-volume', `${volume.toFixed(0)} cm³`);
    updateElement('sourcing-moyenne-top5', formatCurrency(moyenneTop5));

    updateElement('calc-prix-vente', formatCurrency(prixVente));
    updateElement('calc-cout-achat', formatCurrency(coutAchat));
    updateElement('calc-frais-transport', `-${formatCurrency(fraisTransport)}`);
    updateElement('calc-controle-qualite', `-${formatCurrency(controleQualite)}`);
    updateElement('calc-frais-stockage', `-${formatCurrency(fraisStockage)}`);
    updateElement('calc-taux-commission', `(${(tauxCommission * 100).toFixed(0)}%)`);
    updateElement('calc-commission', `-${formatCurrency(commissionAmazon)}`);
    updateElement('calc-frais-fba', `-${formatCurrency(fraisFBA)}`);
    updateElement('calc-benefice-brut', formatCurrency(beneficeBrut));
    updateElement('calc-marge-nette', `${margeNette.toFixed(1)}%`);
    updateElement('calc-roi-unitaire', `${roiUnitaire.toFixed(1)}%`);

    updateElement('objectif-marge-sourcing', `${objectifMarge}%`);
    updateElement('objectif-roi-sourcing', `${objectifROI}%`);

    // ===========================
    // 13. SAUVEGARDER LES DONNÉES
    // ===========================
    window.currentSourcingData = {
        nom: document.getElementById('sourcing-nom')?.value || 'Produit sans nom',
        // Financier
        prixVente, prixUSD, prixConverti, coutAchat,
        fraisTransport, controleQualite, fraisStockage,
        commissionAmazon, fraisFBA,
        acos, coutPPC, // ACOS et coût PPC
        // Bénéfices et marges
        beneficeBrut, margeNette, roiUnitaire,
        coutLancementUnitaire, coutTotalUnitaire,
        beneficeNetPremiereCommande, margeNettePremiereCommande,
        // Concurrence
        top1, top2, top3, top4, top5, moyenneTop5, medianeTop5, prixMoyenTop5,
        noteAvis, nbReviews,
        // Dimensions
        volume, poids, longueur, largeur, hauteur,
        // Lancement
        totalLancement, breakeven, capitalTotal, qteCommande,
        // Meta
        tauxCommission: tauxCommission * 100
    };

    // ===========================
    // 13. DÉCISION GO/NO-GO (SCORING DYNAMIQUE)
    // ===========================
    updateDecisionSourcing(margeNette, roiUnitaire, noteAvis, nbReviews, top1, moyenneTop5, objectifMarge, objectifROI);
}

function updateDecisionSourcing(marge, roi, note, nbReviews, top1, moyenneTop5, objectifMarge, objectifROI) {
    const decisionBlock = document.getElementById('sourcing-decision');
    const decisionTitre = document.getElementById('decision-titre');
    const decisionMessage = document.getElementById('decision-message');
    const decisionEmoji = document.getElementById('decision-emoji');

    // ===========================
    // SYSTÈME DE SCORING DYNAMIQUE (sur 100 points)
    // Basé sur les objectifs définis dans les paramètres
    // ===========================

    let score = 0;
    let raisons = [];
    let points = [];

    // ===== CRITÈRES FINANCIERS (50 points) =====

    // 1. Marge Nette (25 points max) - DYNAMIQUE basée sur objectif
    let scoreMarge = 0;
    const ratioMarge = objectifMarge > 0 ? (marge / objectifMarge) : 0;

    if (ratioMarge >= 1.5) {
        // Marge ≥ 150% de l'objectif
        scoreMarge = 25;
        points.push(`✓ Excellente marge (${marge.toFixed(1)}% >> ${objectifMarge}%)`);
    } else if (ratioMarge >= 1.2) {
        // Marge ≥ 120% de l'objectif
        scoreMarge = 22;
        points.push(`✓ Très bonne marge (${marge.toFixed(1)}% > ${objectifMarge}%)`);
    } else if (ratioMarge >= 1.0) {
        // Marge ≥ objectif
        scoreMarge = 18;
        points.push(`✓ Marge atteint l'objectif (${marge.toFixed(1)}% ≥ ${objectifMarge}%)`);
    } else if (ratioMarge >= 0.8) {
        // Marge ≥ 80% de l'objectif
        scoreMarge = 12;
        raisons.push(`Marge proche objectif (${marge.toFixed(1)}% vs ${objectifMarge}%)`);
    } else if (ratioMarge >= 0.5) {
        // Marge ≥ 50% de l'objectif
        scoreMarge = 6;
        raisons.push(`⚠️ Marge en-dessous objectif (${marge.toFixed(1)}% vs ${objectifMarge}%)`);
    } else if (marge > 0) {
        scoreMarge = 2;
        raisons.push(`❌ Marge très faible (${marge.toFixed(1)}% << ${objectifMarge}%)`);
    }
    score += scoreMarge;

    // 2. ROI Unitaire (25 points max) - DYNAMIQUE basé sur objectif
    let scoreROI = 0;
    const ratioROI = objectifROI > 0 ? (roi / objectifROI) : 0;

    if (ratioROI >= 2.0) {
        // ROI ≥ 200% de l'objectif
        scoreROI = 25;
        points.push(`✓ ROI excellent (${roi.toFixed(1)}% >> ${objectifROI}%)`);
    } else if (ratioROI >= 1.5) {
        // ROI ≥ 150% de l'objectif
        scoreROI = 22;
        points.push(`✓ Très bon ROI (${roi.toFixed(1)}% > ${objectifROI}%)`);
    } else if (ratioROI >= 1.0) {
        // ROI ≥ objectif
        scoreROI = 18;
        points.push(`✓ ROI atteint l'objectif (${roi.toFixed(1)}% ≥ ${objectifROI}%)`);
    } else if (ratioROI >= 0.8) {
        // ROI ≥ 80% de l'objectif
        scoreROI = 12;
        raisons.push(`ROI proche objectif (${roi.toFixed(1)}% vs ${objectifROI}%)`);
    } else if (ratioROI >= 0.5) {
        // ROI ≥ 50% de l'objectif
        scoreROI = 6;
        raisons.push(`⚠️ ROI en-dessous objectif (${roi.toFixed(1)}% vs ${objectifROI}%)`);
    } else if (roi > 0) {
        scoreROI = 2;
        raisons.push(`❌ ROI très faible (${roi.toFixed(1)}% << ${objectifROI}%)`);
    }
    score += scoreROI;

    // ===== CRITÈRES MARCHÉ (30 points) =====

    // 3. Potentiel CA (15 points max)
    let scoreCA = 0;
    if (top1 >= 15000) {
        scoreCA = 15;
        points.push('✓ Gros marché (≥15k€/mois)');
    } else if (top1 >= 10000) {
        scoreCA = 12;
        points.push('✓ Bon marché (10-15k€/mois)');
    } else if (top1 >= 5000) {
        scoreCA = 8;
        raisons.push(`Marché moyen (${formatCurrency(top1)}/mois)`);
    } else if (top1 >= 2000) {
        scoreCA = 4;
        raisons.push(`⚠️ Petit marché (${formatCurrency(top1)}/mois)`);
    } else if (top1 > 0) {
        raisons.push(`⚠️ Très petit marché (${formatCurrency(top1)}/mois)`);
    }
    score += scoreCA;

    // 4. Niveau de Concurrence (15 points max) - Basé sur nb reviews du #1
    let scoreConcurrence = 0;
    if (nbReviews > 0) {
        if (nbReviews < 500) {
            scoreConcurrence = 15;
            points.push('✓ Faible concurrence (<500 avis)');
        } else if (nbReviews < 2000) {
            scoreConcurrence = 10;
            points.push('✓ Concurrence modérée (500-2000 avis)');
        } else if (nbReviews < 5000) {
            scoreConcurrence = 5;
            raisons.push(`Forte concurrence (${nbReviews} avis)`);
        } else {
            raisons.push(`⚠️ Concurrence très élevée (${nbReviews} avis)`);
        }
    }
    score += scoreConcurrence;

    // ===== CRITÈRES QUALITÉ (20 points) =====

    // 5. Note Moyenne (10 points max)
    let scoreNote = 0;
    if (note >= 4.5) {
        scoreNote = 10;
        points.push('✓ Excellente note (≥4.5/5)');
    } else if (note >= 4.0) {
        scoreNote = 7;
        points.push('✓ Bonne note (4.0-4.5/5)');
    } else if (note >= 3.5) {
        scoreNote = 3;
        raisons.push(`Note moyenne (${note}/5)`);
    } else if (note > 0) {
        raisons.push(`⚠️ Note faible (${note}/5)`);
    }
    score += scoreNote;

    // 6. Potentiel de Différenciation (10 points max)
    // Basé sur l'existence de notes dans "Idées d'amélioration"
    const ameliorations = document.getElementById('sourcing-ameliorations')?.value || '';
    let scoreDiff = 0;
    if (ameliorations.length > 50) {
        scoreDiff = 10;
        points.push('✓ Stratégie de différenciation définie');
    } else if (ameliorations.length > 20) {
        scoreDiff = 5;
    }
    score += scoreDiff;

    // ===========================
    // DÉCISION FINALE
    // ===========================

    let decision, couleur, emoji, message;

    if (score >= 70) {
        decision = "🟢 GO - PRODUIT VIABLE";
        couleur = "from-green-50 to-emerald-50 border-green-300";
        emoji = "🟢";
        message = `Score: ${score}/100 - Produit recommandé ! ${points.join(' • ')}`;
        if (raisons.length > 0) {
            message += ` | Points d'attention: ${raisons.join(', ')}`;
        }
    } else if (score >= 50) {
        decision = "🟠 ÉTUDE APPROFONDIE";
        couleur = "from-orange-50 to-yellow-50 border-orange-300";
        emoji = "🟠";
        message = `Score: ${score}/100 - Potentiel mais nécessite plus d'analyse. ${points.join(' • ')} | ⚠️ ${raisons.join(', ')}`;
    } else if (score > 0) {
        decision = "🔴 NO-GO - NON RECOMMANDÉ";
        couleur = "from-red-50 to-pink-50 border-red-300";
        emoji = "🔴";
        message = `Score: ${score}/100 - Produit non viable. Problèmes majeurs: ${raisons.join(', ')}`;
    } else {
        decision = "⚪ EN ATTENTE D'ANALYSE";
        couleur = "from-gray-50 to-slate-50 border-gray-300";
        emoji = "⚪";
        message = "Remplissez les informations ci-dessous pour obtenir une recommandation basée sur un scoring de 100 points";
    }

    // Mise à jour de l'affichage
    if (score > 0) {
        decisionBlock.classList.remove('hidden');
    }

    decisionBlock.className = `mb-6 p-6 rounded-xl shadow-lg border-2 bg-gradient-to-r ${couleur}`;
    decisionTitre.textContent = `Décision: ${decision}`;
    decisionMessage.textContent = message;
    decisionEmoji.textContent = emoji;

    // Mise à jour des métriques de décision
    updateElement('decision-marge', `${marge.toFixed(1)}%`);
    updateElement('decision-roi', `${roi.toFixed(1)}%`);
    updateElement('decision-note', note > 0 ? `${note}/5 ⭐` : '-');
    updateElement('decision-concurrent', top1 > 0 ? formatCurrency(top1) : '-');

    // Sauvegarder le score pour la comparaison
    if (window.currentSourcingData) {
        window.currentSourcingData.score = score;
        window.currentSourcingData.decision = decision;
    }
}

function addToComparison() {
    if (!window.currentSourcingData) {
        showNotification('Veuillez d\'abord remplir les informations du produit', 'error');
        return;
    }

    const nom = document.getElementById('sourcing-nom')?.value || 'Produit sans nom';

    if (!nom || nom === 'Produit sans nom') {
        showNotification('Veuillez donner un nom au produit avant de l\'ajouter', 'error');
        return;
    }

    // Vérifier si le produit n'est pas déjà dans la comparaison
    const exists = comparisonProducts.find(p => p.nom === nom);
    if (exists) {
        showNotification('Ce produit est déjà dans la comparaison', 'error');
        return;
    }

    // Ajouter le produit à la liste de comparaison
    comparisonProducts.push({...window.currentSourcingData, dateAjout: new Date().toISOString()});

    // Afficher la section comparaison
    document.getElementById('comparaison-section').classList.remove('hidden');

    // Rendre le tableau de comparaison
    renderComparison();

    showNotification(`"${nom}" ajouté à la comparaison !`, 'success');
}

function renderComparison() {
    if (comparisonProducts.length === 0) {
        document.getElementById('comparaison-section').classList.add('hidden');
        return;
    }

    const table = document.getElementById('comparison-table');
    const tbody = document.getElementById('comparison-tbody');

    // Créer les en-têtes de colonnes (1 par produit)
    const thead = table.querySelector('thead tr');
    thead.innerHTML = '<th class="text-left py-3 px-3 font-semibold text-gray-700 sticky left-0 bg-white min-w-[150px]">Critère</th>';

    comparisonProducts.forEach((product, index) => {
        thead.innerHTML += `
            <th class="text-center py-3 px-3 font-semibold text-gray-700 min-w-[120px]">
                <div class="flex flex-col items-center gap-1">
                    <span>${product.nom}</span>
                    <button onclick="removeFromComparison(${index})" class="text-red-500 hover:text-red-700 text-xs">
                        <i class="fas fa-times-circle"></i> Retirer
                    </button>
                </div>
            </th>
        `;
    });

    // Créer les lignes de comparaison
    const rows = [
        { label: 'Décision', getValue: (p) => p.decision || '-', getClass: (p) => getDecisionColor(p.decision) },
        { label: 'Score Global', getValue: (p) => `${p.score || 0}/100`, getClass: (p) => getScoreColor(p.score) },
        { label: '', getValue: () => '', getClass: () => 'bg-gray-100 font-bold', isSection: true },
        { label: 'Prix de vente', getValue: (p) => formatCurrency(p.prixVente || 0) },
        { label: 'Coût total/u', getValue: (p) => formatCurrency((p.coutAchat || 0) + (p.fraisTransport || 0) + (p.controleQualite || 0) + (p.fraisStockage || 0)) },
        { label: 'Bénéfice/u', getValue: (p) => formatCurrency(p.beneficeBrut || 0), getClass: (p) => (p.beneficeBrut > 0 ? 'text-green-700 font-bold' : 'text-red-700 font-bold') },
        { label: 'Marge nette', getValue: (p) => `${(p.margeNette || 0).toFixed(1)}%`, getClass: (p) => (p.margeNette >= 30 ? 'text-green-700 font-bold' : p.margeNette >= 20 ? 'text-orange-600' : 'text-red-600') },
        { label: 'ROI unitaire', getValue: (p) => `${(p.roiUnitaire || 0).toFixed(1)}%`, getClass: (p) => (p.roiUnitaire >= 100 ? 'text-green-700 font-bold' : p.roiUnitaire >= 50 ? 'text-orange-600' : 'text-red-600') },
        { label: '', getValue: () => '', getClass: () => 'bg-gray-100', isSection: true },
        { label: 'CA #1 (€/mois)', getValue: (p) => formatCurrency(p.top1 || 0) },
        { label: 'Moy. Top 5', getValue: (p) => formatCurrency(p.moyenneTop5 || 0) },
        { label: 'Note produit', getValue: (p) => p.noteAvis > 0 ? `${p.noteAvis}/5 ⭐` : '-' },
        { label: 'Avis concurrent #1', getValue: (p) => p.nbReviews || '-', getClass: (p) => (p.nbReviews < 500 ? 'text-green-700' : p.nbReviews < 2000 ? 'text-orange-600' : 'text-red-600') },
        { label: '', getValue: () => '', getClass: () => 'bg-gray-100', isSection: true },
        { label: 'Volume (cm³)', getValue: (p) => (p.volume || 0).toFixed(0) },
        { label: 'Commission (%)', getValue: (p) => `${(p.tauxCommission || 0).toFixed(0)}%` },
    ];

    tbody.innerHTML = '';
    rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-200 hover:bg-gray-50';

        if (row.isSection) {
            tr.innerHTML = `<td colspan="${comparisonProducts.length + 1}" class="${row.getClass ? row.getClass() : ''} py-1"></td>`;
        } else {
            let cells = `<td class="py-3 px-3 font-medium text-gray-700 sticky left-0 bg-white">${row.label}</td>`;
            comparisonProducts.forEach(product => {
                const value = row.getValue(product);
                const className = row.getClass ? row.getClass(product) : '';
                cells += `<td class="py-3 px-3 text-center ${className}">${value}</td>`;
            });
            tr.innerHTML = cells;
        }

        tbody.appendChild(tr);
    });
}

function getDecisionColor(decision) {
    if (!decision) return '';
    if (decision.includes('GO - PRODUIT VIABLE')) return 'bg-green-100 text-green-800 font-bold';
    if (decision.includes('ÉTUDE APPROFONDIE')) return 'bg-orange-100 text-orange-800 font-bold';
    if (decision.includes('NO-GO')) return 'bg-red-100 text-red-800 font-bold';
    return '';
}

function getScoreColor(score) {
    if (score >= 70) return 'text-green-700 font-bold text-lg';
    if (score >= 50) return 'text-orange-600 font-bold text-lg';
    return 'text-red-600 font-bold text-lg';
}

function removeFromComparison(index) {
    if (confirm('Retirer ce produit de la comparaison ?')) {
        comparisonProducts.splice(index, 1);
        renderComparison();
        showNotification('Produit retiré de la comparaison', 'success');
    }
}

function clearComparison() {
    if (confirm('Vider toute la comparaison ?')) {
        comparisonProducts = [];
        document.getElementById('comparaison-section').classList.add('hidden');
        showNotification('Comparaison vidée', 'success');
    }
}

function saveSourcingAnalysis() {
    const analysis = {
        date: document.getElementById('sourcing-date')?.value || new Date().toISOString().split('T')[0],
        nom: document.getElementById('sourcing-nom')?.value || 'Produit sans nom',
        longueur: document.getElementById('sourcing-longueur')?.value,
        largeur: document.getElementById('sourcing-largeur')?.value,
        hauteur: document.getElementById('sourcing-hauteur')?.value,
        categorie: document.getElementById('sourcing-categorie')?.selectedOptions[0]?.text || '',
        prixVente: document.getElementById('sourcing-prix-vente')?.value,
        coutAchat: document.getElementById('sourcing-cout-achat')?.value,
        fraisTransport: document.getElementById('sourcing-frais-transport')?.value,
        controleQualite: document.getElementById('sourcing-controle-qualite')?.value,
        fraisStockage: document.getElementById('sourcing-frais-stockage')?.value,
        top1: document.getElementById('sourcing-top1')?.value,
        top2: document.getElementById('sourcing-top2')?.value,
        top3: document.getElementById('sourcing-top3')?.value,
        top4: document.getElementById('sourcing-top4')?.value,
        top5: document.getElementById('sourcing-top5')?.value,
        noteAvis: document.getElementById('sourcing-note-avis')?.value,
        nbReviews: document.getElementById('sourcing-nb-reviews')?.value,
        lienVendeur: document.getElementById('sourcing-lien-vendeur')?.value,
        plaintes: document.getElementById('sourcing-plaintes')?.value,
        ameliorations: document.getElementById('sourcing-ameliorations')?.value,
        ...window.currentSourcingData
    };

    // Sauvegarder dans localStorage (historique)
    let historique = JSON.parse(localStorage.getItem('fba-sourcing-historique') || '[]');
    historique.unshift(analysis);

    // Garder seulement les 20 dernières analyses
    if (historique.length > 20) {
        historique = historique.slice(0, 20);
    }

    localStorage.setItem('fba-sourcing-historique', JSON.stringify(historique));

    showNotification(`Analyse "${analysis.nom}" sauvegardée !`, 'success');
}

function resetSourcing() {
    if (confirm('Êtes-vous sûr de vouloir réinitialiser l\'analyse en cours ?')) {
        // Réinitialiser tous les champs
        document.getElementById('sourcing-nom').value = '';
        document.getElementById('sourcing-date').value = '';
        document.getElementById('sourcing-longueur').value = '';
        document.getElementById('sourcing-largeur').value = '';
        document.getElementById('sourcing-hauteur').value = '';
        document.getElementById('sourcing-poids').value = '';
        document.getElementById('sourcing-prix-usd').value = '';
        document.getElementById('sourcing-taux-eur-usd').value = '0.92';
        document.getElementById('sourcing-categorie').value = '';
        document.getElementById('sourcing-prix-vente').value = '';
        document.getElementById('sourcing-cout-achat').value = '';
        document.getElementById('sourcing-qte-transport').value = '';
        document.getElementById('sourcing-facture-transport').value = '';
        document.getElementById('sourcing-qte-qc').value = '';
        document.getElementById('sourcing-facture-qc').value = '';
        document.getElementById('sourcing-frais-stockage').value = '';
        document.getElementById('sourcing-acos').value = '';
        document.getElementById('sourcing-top1').value = '';
        document.getElementById('sourcing-top2').value = '';
        document.getElementById('sourcing-top3').value = '';
        document.getElementById('sourcing-top4').value = '';
        document.getElementById('sourcing-top5').value = '';
        document.getElementById('sourcing-note-avis').value = '';
        document.getElementById('sourcing-nb-reviews').value = '';
        document.getElementById('sourcing-lien-vendeur').value = '';
        document.getElementById('sourcing-plaintes').value = '';
        document.getElementById('sourcing-ameliorations').value = '';
        document.getElementById('sourcing-cout-photos').value = '';
        document.getElementById('sourcing-cout-design').value = '';
        document.getElementById('sourcing-cout-certif').value = '';
        document.getElementById('sourcing-cout-echantillons').value = '';
        document.getElementById('sourcing-cout-marketing').value = '';
        document.getElementById('sourcing-qte-commande').value = '';

        // Masquer le bloc de décision
        document.getElementById('sourcing-decision').classList.add('hidden');

        // Réinitialiser les données courantes
        window.currentSourcingData = null;

        showNotification('Formulaire réinitialisé', 'success');
    }
}

// ===========================
// LANCER UN PRODUIT (Sourcing → Produits)
// ===========================
function lancerProduit() {
    // Vérifier que les données existent
    if (!window.currentSourcingData) {
        showNotification('Veuillez d\'abord analyser le produit', 'error');
        return;
    }

    const data = window.currentSourcingData;
    const nom = data.nom || 'Produit sans nom';

    // Vérifier que le produit a un nom
    if (nom === 'Produit sans nom' || !nom) {
        showNotification('Veuillez donner un nom au produit', 'error');
        return;
    }

    // Vérifier le score minimal (au moins 50 pour "ÉTUDE APPROFONDIE")
    const score = data.score || 0;
    if (score < 40) {
        if (!confirm(`⚠️ Le score du produit est faible (${score}/100). Voulez-vous quand même le lancer ?`)) {
            return;
        }
    }

    // ===========================
    // CALCUL DES MÉTRIQUES ESTIMÉES
    // ===========================

    // Estimer les unités vendues mensuelles basées sur le CA moyen Top 5
    // CA moyen Top 5 / Prix de vente = Unités estimées
    const unitesEstimees = data.moyenneTop5 > 0 && data.prixVente > 0
        ? Math.round(data.moyenneTop5 / data.prixVente)
        : 0;

    // CA estimé mensuel = Prix de vente × Unités estimées
    const caEstime = data.prixVente * unitesEstimees;

    // Bénéfice estimé mensuel = Bénéfice brut unitaire × Unités estimées
    const beneficeEstime = data.beneficeBrut * unitesEstimees;

    // ACOS initial (estimé à 30% pour le lancement - à ajuster)
    const acosEstime = 30;

    // ===========================
    // CRÉER LE NOUVEAU PRODUIT
    // ===========================
    const nouveauProduit = {
        id: Date.now(),
        nom: nom,
        ca: caEstime,
        benefice: beneficeEstime,
        unites: unitesEstimees,
        acos: acosEstime,
        // Données supplémentaires du sourcing (pour référence)
        dateLancement: new Date().toISOString(),
        prixVente: data.prixVente,
        margeNette: data.margeNette,
        roiUnitaire: data.roiUnitaire,
        scoreSourcing: score,
        capitalInvesti: data.capitalTotal || 0
    };

    // Vérifier si le produit n'existe pas déjà
    const exists = products.find(p => p.nom === nom);
    if (exists) {
        if (!confirm(`Un produit "${nom}" existe déjà. Voulez-vous le remplacer ?`)) {
            return;
        }
        // Remplacer le produit existant
        const index = products.findIndex(p => p.nom === nom);
        products[index] = nouveauProduit;
    } else {
        // Ajouter le nouveau produit
        products.push(nouveauProduit);
    }

    // Sauvegarder les données
    saveData();

    // Sauvegarder l'analyse dans l'historique
    saveSourcingAnalysis();

    // Afficher la page Produits
    showSection('produits');

    // Rafraîchir l'affichage des produits
    renderProducts();

    // Notification de succès
    showNotification(`🚀 Produit "${nom}" lancé avec succès ! CA estimé: ${formatCurrency(caEstime)}/mois`, 'success');

    // Optionnel : Réinitialiser le formulaire de sourcing
    if (confirm('Voulez-vous réinitialiser le formulaire de sourcing pour analyser un nouveau produit ?')) {
        resetSourcing();
    }
}

// ===========================
// SUIVI HEBDOMADAIRE
// ===========================

// Charger les données du suivi hebdomadaire
function loadSuiviHebdo() {
    const saved = localStorage.getItem('fba-suivi-hebdo');
    if (saved) {
        suiviHebdo = JSON.parse(saved);
        updateKPIsHebdo();
        renderHistoriqueHebdo();
        updateFiltresHebdo();
        initChartsHebdo();
        genererInsightsHebdo();
    }
}

// Sauvegarder les données
function saveSuiviHebdo() {
    // Ne pas sauvegarder si chargement en cours
    if (typeof isLoading !== 'undefined' && isLoading) {
        return;
    }

    localStorage.setItem('fba-suivi-hebdo', JSON.stringify(suiviHebdo));

    // Sauvegarder sur le cloud si disponible
    if (typeof saveHebdoToCloud === 'function') {
        saveHebdoToCloud();
    }
}

// Ouvrir le formulaire nouvelle semaine
function nouvelleSemaine() {
    document.getElementById('hebdo-formulaire').classList.remove('hidden');

    // Initialiser la date à aujourd'hui
    const today = new Date();
    document.getElementById('hebdo-date-debut').value = today.toISOString().split('T')[0];

    // Réinitialiser
    tempHebdoProduits = [];
    document.getElementById('hebdo-produits-container').innerHTML = '';

    // Ajouter le premier produit
    ajouterProduitHebdo();

    // Scroll vers le formulaire
    document.getElementById('hebdo-formulaire').scrollIntoView({ behavior: 'smooth' });
}

// Ajouter un produit au formulaire
function ajouterProduitHebdo() {
    const index = tempHebdoProduits.length;
    tempHebdoProduits.push({
        produitId: null,
        unitesVendues: 0,
        caTotal: 0,
        depensesPPC: 0,
        remboursements: 0,
        stockRestant: 0
    });

    const container = document.getElementById('hebdo-produits-container');
    const produitDiv = document.createElement('div');
    produitDiv.className = 'p-4 border-2 border-gray-200 rounded-lg';
    produitDiv.id = `hebdo-produit-${index}`;

    // Créer le dropdown des produits
    let optionsProduits = '<option value="">Sélectionner un produit...</option>';
    products.forEach(p => {
        optionsProduits += `<option value="${p.id}">${p.nom}</option>`;
    });

    produitDiv.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <h4 class="font-semibold text-gray-800">Produit ${index + 1}</h4>
            ${index > 0 ? `<button onclick="retirerProduitHebdo(${index})" class="text-red-600 hover:text-red-800"><i class="fas fa-trash"></i></button>` : ''}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="md:col-span-2">
                <label class="block text-xs font-medium text-gray-700 mb-1">Produit</label>
                <select onchange="selectionnerProduitHebdo(${index}, this.value)"
                    class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 transition">
                    ${optionsProduits}
                </select>
            </div>

            <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">📦 Unités vendues</label>
                <input type="number" step="1" id="hebdo-${index}-unites"
                    class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 transition"
                    placeholder="0"
                    oninput="calculerTotauxHebdo()">
            </div>

            <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">💶 CA Total (€)</label>
                <input type="number" step="0.01" id="hebdo-${index}-ca"
                    class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 transition"
                    placeholder="0.00"
                    oninput="calculerTotauxHebdo()">
            </div>

            <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">📢 Dépenses PPC (€)</label>
                <input type="number" step="0.01" id="hebdo-${index}-ppc"
                    class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 transition"
                    placeholder="0.00"
                    oninput="calculerTotauxHebdo()">
            </div>

            <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">🔄 Remboursements (€)</label>
                <input type="number" step="0.01" id="hebdo-${index}-remb"
                    class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 transition"
                    placeholder="0.00"
                    oninput="calculerTotauxHebdo()">
            </div>

            <div class="md:col-span-2">
                <label class="block text-xs font-medium text-gray-700 mb-1">📦 Stock restant fin semaine (unités)</label>
                <input type="number" step="1" id="hebdo-${index}-stock"
                    class="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 transition"
                    placeholder="0">
            </div>
        </div>

        <div class="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div class="text-xs text-gray-600 mb-2">📊 Résultats calculés :</div>
            <div class="grid grid-cols-3 gap-2 text-xs">
                <div>
                    <span class="text-gray-600">Bénéfice:</span>
                    <div class="font-bold text-blue-700" id="hebdo-${index}-benefice-calc">0 €</div>
                </div>
                <div>
                    <span class="text-gray-600">Marge:</span>
                    <div class="font-bold text-blue-700" id="hebdo-${index}-marge-calc">0%</div>
                </div>
                <div>
                    <span class="text-gray-600">ACOS:</span>
                    <div class="font-bold text-blue-700" id="hebdo-${index}-acos-calc">0%</div>
                </div>
            </div>
        </div>
    `;

    container.appendChild(produitDiv);
}

// Retirer un produit
function retirerProduitHebdo(index) {
    tempHebdoProduits.splice(index, 1);
    document.getElementById('hebdo-produits-container').innerHTML = '';
    tempHebdoProduits.forEach((_, i) => {
        ajouterProduitHebdo();
        // Restaurer les valeurs
        const p = tempHebdoProduits[i];
        if (p.produitId) {
            document.querySelector(`#hebdo-produit-${i} select`).value = p.produitId;
        }
        document.getElementById(`hebdo-${i}-unites`).value = p.unitesVendues || '';
        document.getElementById(`hebdo-${i}-ca`).value = p.caTotal || '';
        document.getElementById(`hebdo-${i}-ppc`).value = p.depensesPPC || '';
        document.getElementById(`hebdo-${i}-remb`).value = p.remboursements || '';
        document.getElementById(`hebdo-${i}-stock`).value = p.stockRestant || '';
    });
    calculerTotauxHebdo();
}

// Sélectionner un produit
function selectionnerProduitHebdo(index, produitId) {
    if (produitId) {
        tempHebdoProduits[index].produitId = parseInt(produitId);
    }
    calculerTotauxHebdo();
}

// Calculer les totaux et résultats
function calculerTotauxHebdo() {
    let totalCA = 0;
    let totalBenefice = 0;
    let totalPPC = 0;
    let totalUnites = 0;

    tempHebdoProduits.forEach((p, index) => {
        const unites = parseFloat(document.getElementById(`hebdo-${index}-unites`)?.value || 0);
        const ca = parseFloat(document.getElementById(`hebdo-${index}-ca`)?.value || 0);
        const ppc = parseFloat(document.getElementById(`hebdo-${index}-ppc`)?.value || 0);
        const remb = parseFloat(document.getElementById(`hebdo-${index}-remb`)?.value || 0);

        // Mettre à jour les données temp
        p.unitesVendues = unites;
        p.caTotal = ca;
        p.depensesPPC = ppc;
        p.remboursements = remb;
        p.stockRestant = parseFloat(document.getElementById(`hebdo-${index}-stock`)?.value || 0);

        // Récupérer le produit pour les coûts
        const produit = products.find(pr => pr.id === p.produitId);

        if (produit && ca > 0) {
            // Calculs basés sur les données du produit
            const prixMoyenVente = ca / unites;

            // Estimer les coûts (simplifié - à affiner avec données sourcing si disponibles)
            const coutUnitaire = produit.ca > 0 && produit.unites > 0 ?
                (produit.ca - produit.benefice) / produit.unites : 0;

            const cogs = coutUnitaire * unites;
            const benefice = ca - cogs - ppc - remb;
            const marge = ca > 0 ? (benefice / ca) * 100 : 0;
            const acos = ca > 0 ? (ppc / ca) * 100 : 0;

            // Afficher les résultats
            updateElement(`hebdo-${index}-benefice-calc`, formatCurrency(benefice));
            updateElement(`hebdo-${index}-marge-calc`, `${marge.toFixed(1)}%`);
            updateElement(`hebdo-${index}-acos-calc`, `${acos.toFixed(1)}%`);

            totalCA += ca;
            totalBenefice += benefice;
            totalPPC += ppc;
            totalUnites += unites;
        } else {
            updateElement(`hebdo-${index}-benefice-calc`, '0 €');
            updateElement(`hebdo-${index}-marge-calc`, '0%');
            updateElement(`hebdo-${index}-acos-calc`, '0%');

            totalCA += ca;
            totalPPC += ppc;
            totalUnites += unites;
        }
    });

    // Afficher les totaux
    const margeMoyenne = totalCA > 0 ? (totalBenefice / totalCA) * 100 : 0;
    const acosMoyen = totalCA > 0 ? (totalPPC / totalCA) * 100 : 0;

    updateElement('hebdo-form-total-ca', formatCurrency(totalCA));
    updateElement('hebdo-form-total-benefice', formatCurrency(totalBenefice));
    updateElement('hebdo-form-marge-moy', `${margeMoyenne.toFixed(1)}%`);
    updateElement('hebdo-form-acos-moy', `${acosMoyen.toFixed(1)}%`);

    // Objectif
    const objectifCA = parseFloat(document.getElementById('hebdo-objectif-ca')?.value || 0);
    if (objectifCA > 0) {
        const progressionObjectif = (totalCA / objectifCA) * 100;
        const atteint = progressionObjectif >= 100;
        updateElement('hebdo-form-objectif-atteint',
            `${atteint ? '✅' : '⚠️'} ${progressionObjectif.toFixed(0)}% (${formatCurrency(totalCA)} / ${formatCurrency(objectifCA)})`
        );
    } else {
        updateElement('hebdo-form-objectif-atteint', '-');
    }
}

// Sauvegarder la semaine
function sauvegarderSemaineHebdo() {
    const dateDebut = document.getElementById('hebdo-date-debut').value;
    const objectifCA = parseFloat(document.getElementById('hebdo-objectif-ca')?.value || 0);

    if (!dateDebut) {
        showNotification('Veuillez sélectionner une date', 'error');
        return;
    }

    if (tempHebdoProduits.length === 0 || !tempHebdoProduits[0].produitId) {
        showNotification('Veuillez ajouter au moins un produit', 'error');
        return;
    }

    // Calculer le numéro de semaine
    const date = new Date(dateDebut);
    const weekNumber = getWeekNumber(date);
    const year = date.getFullYear();
    const semaine = `${year}-W${weekNumber.toString().padStart(2, '0')}`;

    // Calculer la date de fin (dimanche)
    const dateFin = new Date(date);
    dateFin.setDate(date.getDate() + (7 - date.getDay()));

    // Créer les données produits
    const produits = [];
    let totalCA = 0;
    let totalBenefice = 0;
    let totalPPC = 0;
    let totalRemb = 0;
    let totalUnites = 0;

    tempHebdoProduits.forEach((p, index) => {
        if (!p.produitId) return;

        const produit = products.find(pr => pr.id === p.produitId);
        if (!produit) return;

        const unites = parseFloat(document.getElementById(`hebdo-${index}-unites`)?.value || 0);
        const ca = parseFloat(document.getElementById(`hebdo-${index}-ca`)?.value || 0);
        const ppc = parseFloat(document.getElementById(`hebdo-${index}-ppc`)?.value || 0);
        const remb = parseFloat(document.getElementById(`hebdo-${index}-remb`)?.value || 0);
        const stock = parseFloat(document.getElementById(`hebdo-${index}-stock`)?.value || 0);

        if (ca === 0) return;

        const prixMoyen = unites > 0 ? ca / unites : 0;
        const coutUnitaire = produit.ca > 0 && produit.unites > 0 ?
            (produit.ca - produit.benefice) / produit.unites : 0;
        const cogs = coutUnitaire * unites;
        const benefice = ca - cogs - ppc - remb;
        const marge = ca > 0 ? (benefice / ca) * 100 : 0;
        const acos = ca > 0 ? (ppc / ca) * 100 : 0;

        produits.push({
            produitId: p.produitId,
            nom: produit.nom,
            unitesVendues: unites,
            caTotal: ca,
            depensesPPC: ppc,
            remboursements: remb,
            stockRestant: stock,
            prixMoyenVente: prixMoyen,
            cogs: cogs,
            beneficeNet: benefice,
            margeNette: marge,
            acosReel: acos
        });

        totalCA += ca;
        totalBenefice += benefice;
        totalPPC += ppc;
        totalRemb += remb;
        totalUnites += unites;
    });

    if (produits.length === 0) {
        showNotification('Aucun produit valide à enregistrer', 'error');
        return;
    }

    const margeMoyenne = totalCA > 0 ? (totalBenefice / totalCA) * 100 : 0;
    const acosMoyen = totalCA > 0 ? (totalPPC / totalCA) * 100 : 0;
    const objectifAtteint = objectifCA > 0 && totalCA >= objectifCA;
    const progressionObjectif = objectifCA > 0 ? (totalCA / objectifCA) * 100 : 0;

    // Créer l'objet semaine
    const nouvelleSemaine = {
        id: Date.now(),
        semaine: semaine,
        dateDebut: dateDebut,
        dateFin: dateFin.toISOString().split('T')[0],
        objectifCA: objectifCA,
        produits: produits,
        totalUnites: totalUnites,
        totalCA: totalCA,
        totalPPC: totalPPC,
        totalRemboursements: totalRemb,
        totalBenefice: totalBenefice,
        margeNetteMoyenne: margeMoyenne,
        acosMoyen: acosMoyen,
        objectifAtteint: objectifAtteint,
        progressionObjectif: progressionObjectif
    };

    // Ajouter au début de la liste
    suiviHebdo.unshift(nouvelleSemaine);

    // Deduire les ventes du stock
    produits.forEach(p => {
        if (p.produitId && p.unitesVendues > 0) {
            deduireVentesDuStock(p.produitId, p.unitesVendues);
        }
    });

    // Sauvegarder
    saveSuiviHebdo();

    // Fermer le formulaire
    annulerSemaineHebdo();

    // Rafraîchir l'affichage
    updateKPIsHebdo();
    renderHistoriqueHebdo();
    updateFiltresHebdo();
    initChartsHebdo();
    genererInsightsHebdo();

    showNotification(`Semaine ${semaine} enregistrée avec succès !`, 'success');
}

// Annuler la saisie
function annulerSemaineHebdo() {
    document.getElementById('hebdo-formulaire').classList.add('hidden');
    tempHebdoProduits = [];
    document.getElementById('hebdo-produits-container').innerHTML = '';
}

// Mettre à jour les KPIs
function updateKPIsHebdo() {
    if (suiviHebdo.length === 0) {
        updateElement('hebdo-semaine-actuelle', 'Aucune donnée');
        updateElement('hebdo-kpi-ca', '0 €');
        updateElement('hebdo-kpi-benefice', '0 €');
        updateElement('hebdo-kpi-acos', '0%');
        updateElement('hebdo-kpi-objectif', '0%');
        updateElement('hebdo-kpi-ca-evolution', '-');
        updateElement('hebdo-kpi-benefice-evolution', '-');
        updateElement('hebdo-kpi-acos-evolution', '-');
        updateElement('hebdo-kpi-objectif-detail', '-');
        return;
    }

    const derniere = suiviHebdo[0];
    const precedente = suiviHebdo[1];

    // Semaine actuelle
    const dateDebut = new Date(derniere.dateDebut);
    const dateFin = new Date(derniere.dateFin);
    updateElement('hebdo-semaine-actuelle',
        `${derniere.semaine} (${formatDate(dateDebut)} - ${formatDate(dateFin)})`
    );

    // KPIs
    updateElement('hebdo-kpi-ca', formatCurrency(derniere.totalCA));
    updateElement('hebdo-kpi-benefice', formatCurrency(derniere.totalBenefice));
    updateElement('hebdo-kpi-acos', `${derniere.acosMoyen.toFixed(1)}%`);
    updateElement('hebdo-kpi-objectif', `${derniere.progressionObjectif.toFixed(0)}%`);
    updateElement('hebdo-kpi-objectif-detail',
        `${derniere.objectifAtteint ? '✅' : '⚠️'} ${formatCurrency(derniere.totalCA)} / ${formatCurrency(derniere.objectifCA)}`
    );

    // Évolutions vs semaine précédente
    if (precedente) {
        const evolCA = ((derniere.totalCA - precedente.totalCA) / precedente.totalCA) * 100;
        const evolBenef = ((derniere.totalBenefice - precedente.totalBenefice) / precedente.totalBenefice) * 100;
        const evolACOS = derniere.acosMoyen - precedente.acosMoyen;

        updateElement('hebdo-kpi-ca-evolution',
            `${evolCA >= 0 ? '↗️' : '↘️'} ${evolCA >= 0 ? '+' : ''}${evolCA.toFixed(1)}%`
        );
        updateElement('hebdo-kpi-benefice-evolution',
            `${evolBenef >= 0 ? '↗️' : '↘️'} ${evolBenef >= 0 ? '+' : ''}${evolBenef.toFixed(1)}%`
        );
        updateElement('hebdo-kpi-acos-evolution',
            `${evolACOS <= 0 ? '↗️' : '↘️'} ${evolACOS <= 0 ? '' : '+'}${evolACOS.toFixed(1)}%`
        );
    } else {
        updateElement('hebdo-kpi-ca-evolution', 'Première semaine');
        updateElement('hebdo-kpi-benefice-evolution', 'Première semaine');
        updateElement('hebdo-kpi-acos-evolution', 'Première semaine');
    }
}

// Rendre l'historique
function renderHistoriqueHebdo() {
    const tbody = document.getElementById('hebdo-historique-tbody');
    const filtreProduit = document.getElementById('hebdo-filtre-produit')?.value || '';
    const filtrePeriode = document.getElementById('hebdo-filtre-periode')?.value || '8';

    if (suiviHebdo.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-8 text-center text-gray-400">
                    <i class="fas fa-calendar-times text-4xl mb-3"></i>
                    <p>Aucune donnée hebdomadaire enregistrée</p>
                    <p class="text-sm">Cliquez sur "Nouvelle Semaine" pour commencer le suivi</p>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    const limit = filtrePeriode === 'all' ? suiviHebdo.length : parseInt(filtrePeriode);
    const semaines = suiviHebdo.slice(0, limit);

    semaines.forEach(semaine => {
        // Ligne TOTAL de la semaine
        const objectifClass = semaine.objectifAtteint ? 'text-green-600' : 'text-orange-600';
        html += `
            <tr class="bg-blue-50 font-semibold border-t-2 border-blue-200">
                <td class="p-3">${semaine.semaine}</td>
                <td class="p-3">📊 TOTAL</td>
                <td class="p-3 text-center">${semaine.totalUnites}</td>
                <td class="p-3 text-right">${formatCurrency(semaine.totalCA)}<br>
                    <span class="text-xs ${objectifClass}">🎯 ${semaine.progressionObjectif.toFixed(0)}%</span>
                </td>
                <td class="p-3 text-right">${formatCurrency(semaine.totalPPC)}</td>
                <td class="p-3 text-right">${formatCurrency(semaine.totalRemboursements)}</td>
                <td class="p-3 text-right">${formatCurrency(semaine.totalBenefice)}<br>
                    <span class="text-xs text-gray-600">${semaine.margeNetteMoyenne.toFixed(1)}%</span>
                </td>
                <td class="p-3 text-center">${semaine.acosMoyen.toFixed(1)}%</td>
                <td class="p-3 text-center">-</td>
            </tr>
        `;

        // Lignes par produit
        semaine.produits.forEach(p => {
            if (filtreProduit && p.produitId !== parseInt(filtreProduit)) return;

            html += `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 text-gray-400">${semaine.semaine}</td>
                    <td class="p-3">${p.nom}</td>
                    <td class="p-3 text-center">${p.unitesVendues}</td>
                    <td class="p-3 text-right">${formatCurrency(p.caTotal)}</td>
                    <td class="p-3 text-right">${formatCurrency(p.depensesPPC)}</td>
                    <td class="p-3 text-right">${formatCurrency(p.remboursements)}</td>
                    <td class="p-3 text-right">${formatCurrency(p.beneficeNet)}<br>
                        <span class="text-xs text-gray-600">${p.margeNette.toFixed(1)}%</span>
                    </td>
                    <td class="p-3 text-center">${p.acosReel.toFixed(1)}%</td>
                    <td class="p-3 text-center">${p.stockRestant}</td>
                </tr>
            `;
        });
    });

    tbody.innerHTML = html;
}

// Mettre à jour les filtres
function updateFiltresHebdo() {
    const select = document.getElementById('hebdo-filtre-produit');
    if (!select) return;

    // Récupérer tous les produits uniques
    const produitsUniques = new Set();
    suiviHebdo.forEach(s => {
        s.produits.forEach(p => {
            produitsUniques.add(JSON.stringify({ id: p.produitId, nom: p.nom }));
        });
    });

    let html = '<option value="">Tous les produits</option>';
    Array.from(produitsUniques).forEach(pStr => {
        const p = JSON.parse(pStr);
        html += `<option value="${p.id}">${p.nom}</option>`;
    });

    select.innerHTML = html;
}

// Initialiser les graphiques
function initChartsHebdo() {
    if (suiviHebdo.length === 0) return;

    const semaines = suiviHebdo.slice(0, 8).reverse();
    const labels = semaines.map(s => s.semaine);
    const dataCA = semaines.map(s => s.totalCA);
    const dataBenefice = semaines.map(s => s.totalBenefice);
    const dataACOS = semaines.map(s => s.acosMoyen);

    // Graphique CA & Bénéfice
    const ctx1 = document.getElementById('chart-hebdo-ca-benefice');
    if (ctx1) {
        if (charts.hebdoCABenefice) charts.hebdoCABenefice.destroy();

        charts.hebdoCABenefice = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'CA',
                        data: dataCA,
                        borderColor: 'rgb(59, 130, 246)',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.3
                    },
                    {
                        label: 'Bénéfice',
                        data: dataBenefice,
                        borderColor: 'rgb(34, 197, 94)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: true }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    // Graphique ACOS
    const ctx2 = document.getElementById('chart-hebdo-acos');
    if (ctx2) {
        if (charts.hebdoACOS) charts.hebdoACOS.destroy();

        charts.hebdoACOS = new Chart(ctx2, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'ACOS (%)',
                    data: dataACOS,
                    borderColor: 'rgb(168, 85, 247)',
                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: true }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
}

// Générer les insights
function genererInsightsHebdo() {
    const container = document.getElementById('hebdo-insights-content');
    if (!container || suiviHebdo.length === 0) {
        if (container) {
            container.innerHTML = '<p class="text-gray-500">Ajoutez des données pour obtenir des insights personnalisés...</p>';
        }
        return;
    }

    const derniere = suiviHebdo[0];
    const precedente = suiviHebdo[1];
    let insights = [];

    // Objectif atteint/non atteint
    if (derniere.objectifAtteint) {
        insights.push(`✅ Objectif CA semaine ATTEINT (${derniere.progressionObjectif.toFixed(0)}% → ${formatCurrency(derniere.totalCA)}/${formatCurrency(derniere.objectifCA)})`);
    } else if (derniere.progressionObjectif >= 90) {
        insights.push(`🟠 Objectif CA presque atteint (${derniere.progressionObjectif.toFixed(0)}% → ${formatCurrency(derniere.totalCA)}/${formatCurrency(derniere.objectifCA)})`);
    } else {
        insights.push(`🔴 Objectif CA NON atteint (${derniere.progressionObjectif.toFixed(0)}% → ${formatCurrency(derniere.totalCA)}/${formatCurrency(derniere.objectifCA)})`);
    }

    // Top produit
    const topProduit = derniere.produits.reduce((max, p) =>
        p.beneficeNet > (max?.beneficeNet || 0) ? p : max, null
    );
    if (topProduit) {
        insights.push(`🔥 Top produit : ${topProduit.nom} (${formatCurrency(topProduit.beneficeNet)} bénéfice)`);
    }

    // ACOS élevé
    derniere.produits.forEach(p => {
        if (p.acosReel > 30) {
            insights.push(`⚠️ ACOS élevé : ${p.nom} (${p.acosReel.toFixed(1)}% vs objectif ~25%)`);
        }
    });

    // Progression vs semaine précédente
    if (precedente) {
        const evolCA = ((derniere.totalCA - precedente.totalCA) / precedente.totalCA) * 100;
        if (evolCA > 0) {
            insights.push(`📈 Progression : +${evolCA.toFixed(1)}% CA vs semaine précédente`);
        } else if (evolCA < -10) {
            insights.push(`📉 Attention : ${evolCA.toFixed(1)}% CA vs semaine précédente`);
        }

        const evolRemb = ((derniere.totalRemboursements - precedente.totalRemboursements) / precedente.totalRemboursements) * 100;
        if (evolRemb > 20) {
            insights.push(`⚠️ Remboursements en hausse : +${evolRemb.toFixed(0)}% (${formatCurrency(derniere.totalRemboursements)} vs ${formatCurrency(precedente.totalRemboursements)})`);
        }
    }

    // Stock faible
    derniere.produits.forEach(p => {
        const moyenneVentes = p.unitesVendues; // Par semaine
        const semainesRestantes = moyenneVentes > 0 ? p.stockRestant / moyenneVentes : 0;

        if (semainesRestantes < 3 && semainesRestantes > 0) {
            insights.push(`🔴 Stock URGENT : ${p.nom} (${p.stockRestant}u → ~${semainesRestantes.toFixed(1)} semaines)`);
        } else if (semainesRestantes < 6 && semainesRestantes >= 3) {
            insights.push(`🟠 Stock à surveiller : ${p.nom} (${p.stockRestant}u → ~${semainesRestantes.toFixed(1)} semaines)`);
        }
    });

    // Afficher les insights
    container.innerHTML = insights.map(i => `<p class="text-sm">${i}</p>`).join('');
}

// Fonction utilitaire : calculer le numéro de semaine
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}

// Fonction utilitaire : formater une date
function formatDate(date) {
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month}`;
}

// ===========================
// GESTION DU STOCK
// ===========================

let stockData = {}; // Donnees de stock par produit
let stockCommandes = []; // Commandes fournisseurs
let stockCharts = {}; // Graphiques stock

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', function() {
    loadStockData();
    setTimeout(() => {
        initStockSection();
    }, 500);
});

function loadStockData() {
    const savedStock = localStorage.getItem('fba-stock-data');
    if (savedStock) {
        const data = JSON.parse(savedStock);
        stockData = data.stockData || {};
        stockCommandes = data.commandes || [];
    }
}

function saveStockData() {
    // Ne pas sauvegarder si chargement en cours
    if (typeof isLoading !== 'undefined' && isLoading) {
        return;
    }

    const data = {
        stockData: stockData,
        commandes: stockCommandes
    };
    localStorage.setItem('fba-stock-data', JSON.stringify(data));

    // Sauvegarder sur le cloud si disponible
    if (typeof saveStockToCloud === 'function') {
        saveStockToCloud();
    }
}

function initStockSection() {
    renderStockTable();
    updateStockKPIs();
    populateStockSelects();
    renderCommandes();
    updateStockRecommandations();
    updateStockAlertBadge();
}

// Navigation entre sous-sections
function showStockTab(tabName) {
    // Masquer tous les contenus
    document.querySelectorAll('.stock-content').forEach(el => el.classList.add('hidden'));
    // Afficher le contenu cible
    const target = document.getElementById(`stock-content-${tabName}`);
    if (target) target.classList.remove('hidden');

    // Mettre a jour les boutons
    document.querySelectorAll('.stock-tab').forEach(btn => {
        btn.classList.remove('bg-purple-600', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700');
    });
    const activeBtn = document.getElementById(`stock-tab-${tabName}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-gray-200', 'text-gray-700');
        activeBtn.classList.add('bg-purple-600', 'text-white');
    }

    // Initialiser les graphiques si necessaire
    if (tabName === 'graphiques') {
        initStockCharts();
    }
}

// Calcul des ventes moyennes par semaine depuis suivi hebdo
function getVentesMoyennesSemaine(productId) {
    if (!suiviHebdo || suiviHebdo.length === 0) return 0;

    let totalVentes = 0;
    let nbSemaines = 0;

    suiviHebdo.forEach(semaine => {
        semaine.produits.forEach(p => {
            if (p.id === productId || p.nom === getProductNameById(productId)) {
                totalVentes += p.unitesVendues || 0;
                nbSemaines++;
            }
        });
    });

    return nbSemaines > 0 ? totalVentes / nbSemaines : 0;
}

function getProductNameById(id) {
    const product = products.find(p => p.id === id);
    return product ? product.nom : '';
}

// Calcul du statut de stock
function getStockStatus(joursRestants) {
    if (joursRestants <= 7) return { label: 'Critique', color: 'red', icon: '🔴' };
    if (joursRestants <= 14) return { label: 'A surveiller', color: 'yellow', icon: '🟡' };
    if (joursRestants <= 90) return { label: 'OK', color: 'green', icon: '🟢' };
    return { label: 'Surstock', color: 'gray', icon: '⚫' };
}

// Rendu du tableau de stock
function renderStockTable() {
    const tbody = document.getElementById('stock-table-body');
    const emptyMsg = document.getElementById('stock-empty-message');
    const filtre = document.getElementById('stock-filtre-statut')?.value || '';

    if (!tbody) return;

    if (products.length === 0) {
        tbody.innerHTML = '';
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        return;
    }

    if (emptyMsg) emptyMsg.classList.add('hidden');

    let html = '';
    let hasVisibleRows = false;

    products.forEach(product => {
        const stock = stockData[product.id] || {};
        const stockActuel = stock.stockActuel || 0;
        const enTransit = stock.enTransit || 0;
        const ventesSemaine = getVentesMoyennesSemaine(product.id) || (product.unites ? product.unites / 4 : 0);
        const ventesJour = ventesSemaine / 7;
        const joursRestants = ventesJour > 0 ? stockActuel / ventesJour : 999;
        const status = getStockStatus(joursRestants);

        // Filtrer par statut
        if (filtre) {
            const statusMap = { 'critique': 'red', 'attention': 'yellow', 'ok': 'green', 'surstock': 'gray' };
            if (statusMap[filtre] !== status.color) return;
        }

        hasVisibleRows = true;

        // Calculer date de rupture estimee
        const dateRupture = new Date();
        dateRupture.setDate(dateRupture.getDate() + Math.floor(joursRestants));
        const dateRuptureStr = joursRestants < 999 ? dateRupture.toLocaleDateString('fr-FR') : '-';

        const statusColors = {
            'red': 'bg-red-100 text-red-800 border-red-300',
            'yellow': 'bg-yellow-100 text-yellow-800 border-yellow-300',
            'green': 'bg-green-100 text-green-800 border-green-300',
            'gray': 'bg-gray-100 text-gray-800 border-gray-300'
        };

        html += `
            <tr class="border-b hover:bg-gray-50 transition">
                <td class="p-3">
                    <div class="font-medium text-gray-800">${product.nom}</div>
                    <div class="text-xs text-gray-500">${stock.fournisseur || 'Fournisseur non defini'}</div>
                </td>
                <td class="p-3 text-center">
                    <span class="font-bold text-lg">${stockActuel}</span>
                </td>
                <td class="p-3 text-center">
                    <span class="text-blue-600 font-medium">${enTransit > 0 ? '+' + enTransit : '-'}</span>
                </td>
                <td class="p-3 text-center">
                    <span class="font-medium">${ventesSemaine.toFixed(1)}</span>
                </td>
                <td class="p-3 text-center">
                    <span class="font-bold ${status.color === 'red' ? 'text-red-600' : status.color === 'yellow' ? 'text-yellow-600' : 'text-gray-800'}">${joursRestants < 999 ? Math.floor(joursRestants) + 'j' : '-'}</span>
                </td>
                <td class="p-3 text-center text-sm text-gray-600">${dateRuptureStr}</td>
                <td class="p-3 text-center">
                    <span class="px-3 py-1 rounded-full text-xs font-semibold border ${statusColors[status.color]}">
                        ${status.icon} ${status.label}
                    </span>
                </td>
                <td class="p-3 text-center">
                    <button onclick="openStockModal(${product.id})" class="text-purple-600 hover:text-purple-800 font-medium text-sm">
                        <i class="fas fa-edit mr-1"></i>Configurer
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    if (!hasVisibleRows && filtre) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-gray-500">Aucun produit avec ce statut.</td></tr>`;
    }
}

// Modal configuration stock
function openStockModal(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const stock = stockData[productId] || {};

    document.getElementById('stock-modal-title').textContent = `Configurer: ${product.nom}`;
    document.getElementById('stock-edit-id').value = productId;
    document.getElementById('stock-edit-actuel').value = stock.stockActuel || 0;
    document.getElementById('stock-edit-transit').value = stock.enTransit || 0;
    document.getElementById('stock-edit-cout').value = stock.coutAchat || '';
    document.getElementById('stock-edit-securite').value = stock.stockSecurite || 14;
    document.getElementById('stock-edit-fournisseur').value = stock.fournisseur || '';
    document.getElementById('stock-edit-delai').value = stock.delaiLivraison || 21;
    document.getElementById('stock-edit-moq').value = stock.moq || 100;
    document.getElementById('stock-edit-contact').value = stock.contact || '';
    document.getElementById('stock-edit-longueur').value = stock.longueur || '';
    document.getElementById('stock-edit-largeur').value = stock.largeur || '';
    document.getElementById('stock-edit-hauteur').value = stock.hauteur || '';
    document.getElementById('stock-edit-poids').value = stock.poids || '';

    document.getElementById('stock-modal').classList.remove('hidden');
}

function closeStockModal() {
    document.getElementById('stock-modal').classList.add('hidden');
}

function saveStockConfig() {
    const productId = parseInt(document.getElementById('stock-edit-id').value);

    stockData[productId] = {
        stockActuel: parseInt(document.getElementById('stock-edit-actuel').value) || 0,
        enTransit: parseInt(document.getElementById('stock-edit-transit').value) || 0,
        coutAchat: parseFloat(document.getElementById('stock-edit-cout').value) || 0,
        stockSecurite: parseInt(document.getElementById('stock-edit-securite').value) || 14,
        fournisseur: document.getElementById('stock-edit-fournisseur').value,
        delaiLivraison: parseInt(document.getElementById('stock-edit-delai').value) || 21,
        moq: parseInt(document.getElementById('stock-edit-moq').value) || 100,
        contact: document.getElementById('stock-edit-contact').value,
        longueur: parseFloat(document.getElementById('stock-edit-longueur').value) || 0,
        largeur: parseFloat(document.getElementById('stock-edit-largeur').value) || 0,
        hauteur: parseFloat(document.getElementById('stock-edit-hauteur').value) || 0,
        poids: parseFloat(document.getElementById('stock-edit-poids').value) || 0
    };

    saveStockData();
    closeStockModal();
    renderStockTable();
    updateStockKPIs();
    updateStockRecommandations();
    updateStockAlertBadge();
    showNotification('Configuration stock enregistree !', 'success');
}

// Mise a jour des KPIs
function updateStockKPIs() {
    let valeurTotale = 0;
    let unitesTotales = 0;
    let coutStockageMensuel = 0;
    let alertes = 0;
    let rotationTotale = 0;
    let nbProduitsAvecStock = 0;

    products.forEach(product => {
        const stock = stockData[product.id] || {};
        const stockActuel = stock.stockActuel || 0;
        const coutAchat = stock.coutAchat || 0;

        unitesTotales += stockActuel;
        valeurTotale += stockActuel * coutAchat;

        // Calcul cout stockage simplifie (0.03 EUR/unite/mois par defaut)
        const coutStockageUnite = calculateStorageCost(stock);
        coutStockageMensuel += stockActuel * coutStockageUnite;

        // Calcul alertes
        const ventesSemaine = getVentesMoyennesSemaine(product.id) || 0;
        const ventesJour = ventesSemaine / 7;
        const joursRestants = ventesJour > 0 ? stockActuel / ventesJour : 999;

        if (joursRestants <= 14 && stockActuel > 0) alertes++;

        // Rotation
        if (stockActuel > 0 && ventesSemaine > 0) {
            const venteMensuelle = ventesSemaine * 4;
            rotationTotale += venteMensuelle / stockActuel;
            nbProduitsAvecStock++;
        }
    });

    const rotationMoyenne = nbProduitsAvecStock > 0 ? rotationTotale / nbProduitsAvecStock : 0;

    // Mise a jour affichage
    updateElement('stock-kpi-valeur', formatCurrency(valeurTotale));
    updateElement('stock-kpi-unites', `${unitesTotales} unites totales`);
    updateElement('stock-kpi-cout', formatCurrency(coutStockageMensuel));
    updateElement('stock-kpi-cout-unite', unitesTotales > 0 ? formatCurrency(coutStockageMensuel / unitesTotales) + '/unite' : '0 EUR/unite');

    const alerteEl = document.getElementById('stock-kpi-alertes');
    if (alerteEl) {
        alerteEl.textContent = alertes;
        alerteEl.className = `text-3xl font-bold ${alertes > 0 ? 'text-red-600' : 'text-green-600'}`;
    }
    updateElement('stock-kpi-alertes-detail', alertes > 0 ? `${alertes} produit(s) en alerte` : 'Aucune alerte');
    updateElement('stock-kpi-rotation', rotationMoyenne.toFixed(1) + 'x');
}

function calculateStorageCost(stock) {
    // Calcul simplifie base sur le volume
    const longueur = stock.longueur || 20;
    const largeur = stock.largeur || 15;
    const hauteur = stock.hauteur || 10;
    const volumeM3 = (longueur * largeur * hauteur) / 1000000;

    // Tarif Amazon FR: ~26 EUR/m3/mois pour standard
    return volumeM3 * 26;
}

// Badge d'alerte dans la sidebar
function updateStockAlertBadge() {
    let alertes = 0;
    products.forEach(product => {
        const stock = stockData[product.id] || {};
        const stockActuel = stock.stockActuel || 0;
        const ventesSemaine = getVentesMoyennesSemaine(product.id) || 0;
        const ventesJour = ventesSemaine / 7;
        const joursRestants = ventesJour > 0 ? stockActuel / ventesJour : 999;
        if (joursRestants <= 14 && stockActuel > 0) alertes++;
    });

    const badge = document.getElementById('stock-alert-badge');
    if (badge) {
        if (alertes > 0) {
            badge.textContent = alertes;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

// Recommandations de reapprovisionnement
function updateStockRecommandations() {
    const container = document.getElementById('stock-recommandations');
    if (!container) return;

    let recommandations = [];

    products.forEach(product => {
        const stock = stockData[product.id] || {};
        const stockActuel = stock.stockActuel || 0;
        const enTransit = stock.enTransit || 0;
        const delaiLivraison = stock.delaiLivraison || 21;
        const stockSecurite = stock.stockSecurite || 14;
        const moq = stock.moq || 100;
        const ventesSemaine = getVentesMoyennesSemaine(product.id) || 0;
        const ventesJour = ventesSemaine / 7;

        if (ventesJour <= 0) return;

        const joursRestants = stockActuel / ventesJour;
        const stockALivraison = stockActuel - (ventesJour * delaiLivraison) + enTransit;

        // Si le stock a la livraison sera sous le seuil de securite
        if (stockALivraison < (ventesJour * stockSecurite)) {
            const quantiteNecessaire = Math.ceil((ventesJour * (delaiLivraison + stockSecurite + 30)) - stockActuel - enTransit);
            const quantiteACommander = Math.max(quantiteNecessaire, moq);
            const dateCommande = new Date();
            const dateIdealCommande = new Date();
            dateIdealCommande.setDate(dateIdealCommande.getDate() + Math.max(0, joursRestants - delaiLivraison - stockSecurite));

            const urgence = joursRestants <= 14 ? 'URGENT' : joursRestants <= 21 ? 'Bientot' : 'Planifie';
            const urgenceColor = joursRestants <= 14 ? 'red' : joursRestants <= 21 ? 'orange' : 'blue';

            recommandations.push({
                produit: product.nom,
                quantite: quantiteACommander,
                dateIdeal: dateIdealCommande,
                urgence,
                urgenceColor,
                joursRestants: Math.floor(joursRestants),
                fournisseur: stock.fournisseur || 'Non defini'
            });
        }
    });

    if (recommandations.length === 0) {
        container.innerHTML = '<p class="text-gray-500">Tous vos stocks sont suffisants. Aucune commande necessaire.</p>';
        return;
    }

    // Trier par urgence
    recommandations.sort((a, b) => a.joursRestants - b.joursRestants);

    container.innerHTML = recommandations.map(r => `
        <div class="p-4 bg-white rounded-lg border-l-4 border-${r.urgenceColor}-500 shadow-sm">
            <div class="flex justify-between items-start">
                <div>
                    <span class="font-bold text-gray-800">${r.produit}</span>
                    <span class="ml-2 px-2 py-0.5 text-xs rounded-full bg-${r.urgenceColor}-100 text-${r.urgenceColor}-800">${r.urgence}</span>
                </div>
                <span class="text-sm text-gray-500">${r.joursRestants}j restants</span>
            </div>
            <div class="mt-2 text-sm text-gray-600">
                <i class="fas fa-truck mr-1"></i> Commander <strong>${r.quantite} unites</strong> chez ${r.fournisseur}
            </div>
            <div class="mt-1 text-xs text-gray-500">
                Date ideale de commande: ${r.dateIdeal.toLocaleDateString('fr-FR')}
            </div>
        </div>
    `).join('');
}

// Gestion des commandes fournisseurs
function populateStockSelects() {
    const selects = ['commande-produit', 'packaging-produit'];

    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        const currentValue = select.value;
        const firstOption = select.options[0];
        select.innerHTML = '';
        select.appendChild(firstOption);

        products.forEach(product => {
            const option = document.createElement('option');
            option.value = product.id;
            option.textContent = product.nom;
            select.appendChild(option);
        });

        if (currentValue) select.value = currentValue;
    });
}

function openCommandeModal() {
    populateStockSelects();
    document.getElementById('commande-produit').value = '';
    document.getElementById('commande-quantite').value = '';
    document.getElementById('commande-cout').value = '';
    document.getElementById('commande-livraison').value = '';
    document.getElementById('commande-notes').value = '';
    document.getElementById('commande-modal').classList.remove('hidden');
}

function closeCommandeModal() {
    document.getElementById('commande-modal').classList.add('hidden');
}

function prefillCommandeInfo() {
    const productId = parseInt(document.getElementById('commande-produit').value);
    if (!productId) return;

    const stock = stockData[productId] || {};
    const moq = stock.moq || 100;
    const coutAchat = stock.coutAchat || 0;
    const delaiLivraison = stock.delaiLivraison || 21;

    document.getElementById('commande-quantite').value = moq;
    document.getElementById('commande-cout').value = (moq * coutAchat).toFixed(2);

    const dateLivraison = new Date();
    dateLivraison.setDate(dateLivraison.getDate() + delaiLivraison);
    document.getElementById('commande-livraison').value = dateLivraison.toISOString().split('T')[0];
}

function saveCommande() {
    const productId = parseInt(document.getElementById('commande-produit').value);
    if (!productId) {
        showNotification('Selectionnez un produit', 'error');
        return;
    }

    const product = products.find(p => p.id === productId);
    const stock = stockData[productId] || {};

    const commande = {
        id: Date.now(),
        productId,
        productNom: product.nom,
        fournisseur: stock.fournisseur || 'Non defini',
        quantite: parseInt(document.getElementById('commande-quantite').value) || 0,
        cout: parseFloat(document.getElementById('commande-cout').value) || 0,
        dateCommande: new Date().toISOString(),
        dateLivraison: document.getElementById('commande-livraison').value,
        notes: document.getElementById('commande-notes').value,
        statut: 'en_cours'
    };

    stockCommandes.push(commande);

    // Ajouter au stock en transit
    if (!stockData[productId]) stockData[productId] = {};
    stockData[productId].enTransit = (stockData[productId].enTransit || 0) + commande.quantite;

    saveStockData();
    closeCommandeModal();
    renderCommandes();
    renderStockTable();
    updateStockKPIs();
    showNotification('Commande enregistree !', 'success');
}

function renderCommandes() {
    const tbody = document.getElementById('stock-commandes-body');
    const emptyMsg = document.getElementById('stock-commandes-empty');

    if (!tbody) return;

    const commandesActives = stockCommandes.filter(c => c.statut !== 'livree');

    if (commandesActives.length === 0) {
        tbody.innerHTML = '';
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        return;
    }

    if (emptyMsg) emptyMsg.classList.add('hidden');

    tbody.innerHTML = commandesActives.map(c => {
        const dateCommande = new Date(c.dateCommande).toLocaleDateString('fr-FR');
        const dateLivraison = new Date(c.dateLivraison).toLocaleDateString('fr-FR');
        const joursRestants = Math.ceil((new Date(c.dateLivraison) - new Date()) / (1000 * 60 * 60 * 24));

        const statutColors = {
            'en_cours': 'bg-blue-100 text-blue-800',
            'expediee': 'bg-yellow-100 text-yellow-800',
            'livree': 'bg-green-100 text-green-800'
        };
        const statutLabels = {
            'en_cours': 'En cours',
            'expediee': 'Expediee',
            'livree': 'Livree'
        };

        return `
            <tr class="border-b hover:bg-gray-50">
                <td class="p-3 text-sm">${dateCommande}</td>
                <td class="p-3 font-medium">${c.productNom}</td>
                <td class="p-3 text-sm text-gray-600">${c.fournisseur}</td>
                <td class="p-3 text-center font-semibold">${c.quantite}</td>
                <td class="p-3 text-right font-semibold">${formatCurrency(c.cout)}</td>
                <td class="p-3 text-center">
                    <span class="text-sm">${dateLivraison}</span>
                    <span class="text-xs text-gray-500 block">(${joursRestants}j)</span>
                </td>
                <td class="p-3 text-center">
                    <select onchange="updateCommandeStatut(${c.id}, this.value)" class="text-xs px-2 py-1 rounded ${statutColors[c.statut]}">
                        <option value="en_cours" ${c.statut === 'en_cours' ? 'selected' : ''}>En cours</option>
                        <option value="expediee" ${c.statut === 'expediee' ? 'selected' : ''}>Expediee</option>
                        <option value="livree" ${c.statut === 'livree' ? 'selected' : ''}>Livree</option>
                    </select>
                </td>
                <td class="p-3 text-center">
                    <button onclick="deleteCommande(${c.id})" class="text-red-600 hover:text-red-800 text-sm">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateCommandeStatut(commandeId, newStatut) {
    const commande = stockCommandes.find(c => c.id === commandeId);
    if (!commande) return;

    const oldStatut = commande.statut;
    commande.statut = newStatut;

    // Si livree, transferer du transit au stock actuel
    if (newStatut === 'livree' && oldStatut !== 'livree') {
        const stock = stockData[commande.productId] || {};
        stockData[commande.productId] = {
            ...stock,
            stockActuel: (stock.stockActuel || 0) + commande.quantite,
            enTransit: Math.max(0, (stock.enTransit || 0) - commande.quantite)
        };
    }

    saveStockData();
    renderCommandes();
    renderStockTable();
    updateStockKPIs();
    showNotification('Statut mis a jour !', 'success');
}

function deleteCommande(commandeId) {
    const commande = stockCommandes.find(c => c.id === commandeId);
    if (!commande) return;

    if (confirm('Supprimer cette commande ?')) {
        // Retirer du transit si pas livree
        if (commande.statut !== 'livree') {
            const stock = stockData[commande.productId] || {};
            stockData[commande.productId] = {
                ...stock,
                enTransit: Math.max(0, (stock.enTransit || 0) - commande.quantite)
            };
        }

        stockCommandes = stockCommandes.filter(c => c.id !== commandeId);
        saveStockData();
        renderCommandes();
        renderStockTable();
        updateStockKPIs();
        showNotification('Commande supprimee', 'success');
    }
}

// ===========================
// SIMULATEUR PACKAGING
// ===========================

const AMAZON_TIERS = [
    { name: 'Small Standard', maxL: 38, maxW: 26, maxH: 5, maxWeight: 0.5, fraisExp: 2.50, stockageM3: 26 },
    { name: 'Large Standard', maxL: 45, maxW: 34, maxH: 26, maxWeight: 12, fraisExp: 4.50, stockageM3: 26 },
    { name: 'Small Oversize', maxL: 61, maxW: 46, maxH: 46, maxWeight: 2, fraisExp: 6.50, stockageM3: 36 },
    { name: 'Large Oversize', maxL: 120, maxW: 60, maxH: 60, maxWeight: 30, fraisExp: 12.00, stockageM3: 36 },
    { name: 'Special Oversize', maxL: 999, maxW: 999, maxH: 999, maxWeight: 999, fraisExp: 25.00, stockageM3: 50 }
];

function prefillPackagingDimensions() {
    const productId = parseInt(document.getElementById('packaging-produit').value);
    if (!productId) return;

    const stock = stockData[productId] || {};
    document.getElementById('packaging-longueur').value = stock.longueur || '';
    document.getElementById('packaging-largeur').value = stock.largeur || '';
    document.getElementById('packaging-hauteur').value = stock.hauteur || '';
    document.getElementById('packaging-poids').value = stock.poids || '';

    calculatePackaging();
}

function determineAmazonTier(longueur, largeur, hauteur, poids) {
    // Trier dimensions pour comparaison
    const dims = [longueur, largeur, hauteur].sort((a, b) => b - a);
    const [l, w, h] = dims;

    for (const tier of AMAZON_TIERS) {
        if (l <= tier.maxL && w <= tier.maxW && h <= tier.maxH && poids <= tier.maxWeight) {
            return tier;
        }
    }
    return AMAZON_TIERS[AMAZON_TIERS.length - 1]; // Special Oversize
}

function calculatePackaging() {
    const longueur = parseFloat(document.getElementById('packaging-longueur').value) || 0;
    const largeur = parseFloat(document.getElementById('packaging-largeur').value) || 0;
    const hauteur = parseFloat(document.getElementById('packaging-hauteur').value) || 0;
    const poids = parseFloat(document.getElementById('packaging-poids').value) || 0;
    const ventes = parseInt(document.getElementById('packaging-ventes').value) || 100;

    if (longueur === 0 || largeur === 0 || hauteur === 0) {
        document.getElementById('packaging-tier-name').textContent = '-';
        document.getElementById('packaging-tier-dimensions').textContent = 'Entrez les dimensions';
        return;
    }

    const tier = determineAmazonTier(longueur, largeur, hauteur, poids);

    // Afficher le tier
    const tierIcons = {
        'Small Standard': '📦',
        'Large Standard': '📦',
        'Small Oversize': '📦',
        'Large Oversize': '🏗️',
        'Special Oversize': '🚚'
    };
    const tierColors = {
        'Small Standard': 'text-green-700',
        'Large Standard': 'text-blue-700',
        'Small Oversize': 'text-orange-700',
        'Large Oversize': 'text-red-700',
        'Special Oversize': 'text-purple-700'
    };

    document.getElementById('packaging-tier-icon').textContent = tierIcons[tier.name] || '📦';
    document.getElementById('packaging-tier-name').textContent = tier.name;
    document.getElementById('packaging-tier-name').className = `text-2xl font-bold ${tierColors[tier.name]}`;
    document.getElementById('packaging-tier-dimensions').textContent = `${longueur} x ${largeur} x ${hauteur} cm, ${poids} kg`;

    // Calculer les frais
    const volumeM3 = (longueur * largeur * hauteur) / 1000000;
    const fraisStockageUnite = volumeM3 * tier.stockageM3;
    const fraisExpedition = tier.fraisExp;
    const fraisTotalMensuel = (fraisExpedition * ventes) + (fraisStockageUnite * ventes);

    document.getElementById('packaging-frais-expedition').textContent = formatCurrency(fraisExpedition);
    document.getElementById('packaging-frais-stockage').textContent = formatCurrency(fraisStockageUnite);
    document.getElementById('packaging-frais-total').textContent = formatCurrency(fraisTotalMensuel);

    // Verifier optimisation possible
    checkPackagingOptimisation(longueur, largeur, hauteur, poids, tier, ventes);
}

function checkPackagingOptimisation(longueur, largeur, hauteur, poids, currentTier, ventes) {
    const optimDiv = document.getElementById('packaging-optimisation');
    const suggestionDiv = document.getElementById('packaging-suggestion');
    const economieDiv = document.getElementById('packaging-economie');

    // Trouver le tier precedent si possible
    const currentIndex = AMAZON_TIERS.findIndex(t => t.name === currentTier.name);

    if (currentIndex <= 0) {
        optimDiv.classList.add('hidden');
        return;
    }

    const tierInferieur = AMAZON_TIERS[currentIndex - 1];

    // Calculer les dimensions necessaires pour passer au tier inferieur
    const dims = [longueur, largeur, hauteur].sort((a, b) => b - a);
    const reductions = [];

    if (dims[0] > tierInferieur.maxL) reductions.push(`Longueur: ${dims[0]} → ${tierInferieur.maxL} cm (-${(dims[0] - tierInferieur.maxL).toFixed(1)} cm)`);
    if (dims[1] > tierInferieur.maxW) reductions.push(`Largeur: ${dims[1]} → ${tierInferieur.maxW} cm (-${(dims[1] - tierInferieur.maxW).toFixed(1)} cm)`);
    if (dims[2] > tierInferieur.maxH) reductions.push(`Hauteur: ${dims[2]} → ${tierInferieur.maxH} cm (-${(dims[2] - tierInferieur.maxH).toFixed(1)} cm)`);
    if (poids > tierInferieur.maxWeight) reductions.push(`Poids: ${poids} → ${tierInferieur.maxWeight} kg (-${(poids - tierInferieur.maxWeight).toFixed(2)} kg)`);

    if (reductions.length === 0) {
        optimDiv.classList.add('hidden');
        return;
    }

    // Calculer economie potentielle
    const economieParUnite = currentTier.fraisExp - tierInferieur.fraisExp;
    const economieMensuelle = economieParUnite * ventes;

    optimDiv.classList.remove('hidden');
    suggestionDiv.innerHTML = `
        <p class="mb-2">Pour passer en <strong>${tierInferieur.name}</strong>, reduisez:</p>
        <ul class="list-disc list-inside space-y-1">
            ${reductions.map(r => `<li>${r}</li>`).join('')}
        </ul>
    `;
    economieDiv.textContent = formatCurrency(economieMensuelle);
}

// ===========================
// GRAPHIQUES STOCK
// ===========================

function initStockCharts() {
    // Destruction des anciens graphiques
    Object.values(stockCharts).forEach(chart => {
        if (chart) chart.destroy();
    });
    stockCharts = {};

    // Donnees pour les graphiques
    const labels = products.map(p => p.nom);
    const stockActuels = products.map(p => (stockData[p.id]?.stockActuel || 0));
    const enTransits = products.map(p => (stockData[p.id]?.enTransit || 0));
    const valeurs = products.map(p => {
        const stock = stockData[p.id] || {};
        return (stock.stockActuel || 0) * (stock.coutAchat || 0);
    });
    const joursRestants = products.map(p => {
        const stock = stockData[p.id] || {};
        const ventesSemaine = getVentesMoyennesSemaine(p.id) || 0;
        const ventesJour = ventesSemaine / 7;
        return ventesJour > 0 ? Math.min((stock.stockActuel || 0) / ventesJour, 90) : 90;
    });

    // Graphique Evolution Stock
    const ctxEvolution = document.getElementById('chart-stock-evolution');
    if (ctxEvolution) {
        stockCharts.evolution = new Chart(ctxEvolution, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Stock Actuel',
                        data: stockActuels,
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderRadius: 4
                    },
                    {
                        label: 'En Transit',
                        data: enTransits,
                        backgroundColor: 'rgba(16, 185, 129, 0.8)',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    // Graphique Valeur Stock (Doughnut)
    const ctxValeur = document.getElementById('chart-stock-valeur');
    if (ctxValeur && valeurs.some(v => v > 0)) {
        stockCharts.valeur = new Chart(ctxValeur, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: valeurs,
                    backgroundColor: [
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(139, 92, 246, 0.8)'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }

    // Graphique Previsions Rupture
    const ctxRupture = document.getElementById('chart-stock-rupture');
    if (ctxRupture) {
        const colors = joursRestants.map(j => {
            if (j <= 7) return 'rgba(239, 68, 68, 0.8)';
            if (j <= 14) return 'rgba(245, 158, 11, 0.8)';
            return 'rgba(16, 185, 129, 0.8)';
        });

        stockCharts.rupture = new Chart(ctxRupture, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jours avant rupture',
                    data: joursRestants,
                    backgroundColor: colors,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 90,
                        ticks: {
                            callback: (value) => value + 'j'
                        }
                    }
                }
            }
        });
    }

    // Graphique Couts Stockage
    const ctxCouts = document.getElementById('chart-stock-couts');
    if (ctxCouts) {
        const couts = products.map(p => {
            const stock = stockData[p.id] || {};
            return (stock.stockActuel || 0) * calculateStorageCost(stock);
        });

        stockCharts.couts = new Chart(ctxCouts, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cout stockage mensuel',
                    data: couts,
                    backgroundColor: 'rgba(245, 158, 11, 0.8)',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => value + ' EUR'
                        }
                    }
                }
            }
        });
    }
}

// Connexion avec le suivi hebdomadaire - deduire les ventes du stock
function deduireVentesDuStock(productId, unites) {
    if (!stockData[productId]) return;

    stockData[productId].stockActuel = Math.max(0, (stockData[productId].stockActuel || 0) - unites);
    saveStockData();

    // Mettre a jour si on est sur l'onglet stock
    if (!document.getElementById('section-stock').classList.contains('hidden')) {
        renderStockTable();
        updateStockKPIs();
        updateStockRecommandations();
        updateStockAlertBadge();
    }
}

// ===========================
// GESTION FISCALITE
// ===========================

let fiscalData = {}; // Donnees fiscales par mois

// Initialisation de la section fiscalite
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        initFiscalite();
    }, 600);
});

function initFiscalite() {
    loadFiscalData();
    populateFiscalMois();
    updateFiscalite();
}

function loadFiscalData() {
    const saved = localStorage.getItem('fba-fiscal-data');
    if (saved) {
        fiscalData = JSON.parse(saved);
    }
}

function saveFiscalData() {
    localStorage.setItem('fba-fiscal-data', JSON.stringify(fiscalData));
}

// Generer la liste des mois disponibles
function populateFiscalMois() {
    const select = document.getElementById('fiscal-select-mois');
    if (!select) return;

    const moisNoms = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
                      'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    select.innerHTML = '';

    // Generer les 12 derniers mois + mois actuel
    for (let i = 0; i <= 12; i++) {
        let month = currentMonth - i;
        let year = currentYear;

        if (month < 0) {
            month += 12;
            year -= 1;
        }

        const option = document.createElement('option');
        option.value = `${year}-${(month + 1).toString().padStart(2, '0')}`;
        option.textContent = `${moisNoms[month]} ${year}`;
        if (i === 0) option.selected = true;
        select.appendChild(option);
    }

    // Mettre a jour le titre du mois actuel
    const moisActuel = document.getElementById('fiscal-mois-actuel');
    if (moisActuel) {
        moisActuel.textContent = `${moisNoms[currentMonth]} ${currentYear}`;
    }
}

// Calculer le CA d'un mois depuis le suivi hebdomadaire
function getCAMensuel(yearMonth) {
    if (!suiviHebdo || suiviHebdo.length === 0) return { ca: 0, ppc: 0, benefice: 0, unites: 0 };

    const [year, month] = yearMonth.split('-').map(Number);
    let totalCA = 0;
    let totalPPC = 0;
    let totalBenefice = 0;
    let totalUnites = 0;

    suiviHebdo.forEach(semaine => {
        const dateDebut = new Date(semaine.dateDebut);
        const semaineMonth = dateDebut.getMonth() + 1;
        const semaineYear = dateDebut.getFullYear();

        // Si la semaine est dans le mois
        if (semaineYear === year && semaineMonth === month) {
            totalCA += semaine.totalCA || 0;
            totalPPC += semaine.totalPPC || 0;
            totalBenefice += semaine.totalBenefice || 0;
            totalUnites += semaine.totalUnites || 0;
        }
    });

    return { ca: totalCA, ppc: totalPPC, benefice: totalBenefice, unites: totalUnites };
}

// Calculer les charges fixes mensuelles depuis les parametres
function getChargesMensuelles() {
    let total = 0;

    // Charges mensuelles
    const chargesMensuelles = [
        'param-amazon-pro', 'param-helium', 'param-canva', 'param-ia',
        'param-comptable', 'param-banque', 'param-assurance', 'param-credit', 'param-autres'
    ];

    chargesMensuelles.forEach(id => {
        const el = document.getElementById(id);
        if (el) total += parseFloat(el.value) || 0;
    });

    // Charges annuelles divisees par 12
    const chargesAnnuelles = [
        'param-gs1', 'param-inpi', 'param-photos', 'param-formation',
        'param-site', 'param-juridique', 'param-autres-fixes'
    ];

    chargesAnnuelles.forEach(id => {
        const el = document.getElementById(id);
        if (el) total += (parseFloat(el.value) || 0) / 12;
    });

    return total;
}

// Mettre a jour tous les calculs fiscaux
function updateFiscalite() {
    const selectedMois = document.getElementById('fiscal-select-mois')?.value;
    const mode = document.getElementById('fiscal-mode')?.value || 'mensuel';
    const tauxURSSAF = parseFloat(document.getElementById('fiscal-taux-urssaf')?.value || 12.3) / 100;
    const tauxIR = parseFloat(document.getElementById('fiscal-taux-ir')?.value || 1.0) / 100;
    const optionVFL = document.getElementById('fiscal-option-vfl')?.value === 'oui';

    if (!selectedMois) return;

    // Calculer le CA du mois
    let donneesMois = getCAMensuel(selectedMois);

    // Mode trimestriel: additionner 3 mois
    if (mode === 'trimestriel') {
        const [year, month] = selectedMois.split('-').map(Number);
        for (let i = 1; i <= 2; i++) {
            let m = month - i;
            let y = year;
            if (m <= 0) { m += 12; y -= 1; }
            const moisPrec = getCAMensuel(`${y}-${m.toString().padStart(2, '0')}`);
            donneesMois.ca += moisPrec.ca;
            donneesMois.ppc += moisPrec.ppc;
            donneesMois.benefice += moisPrec.benefice;
            donneesMois.unites += moisPrec.unites;
        }
    }

    const ca = donneesMois.ca;
    const ppc = donneesMois.ppc;
    const beneficeBrut = donneesMois.benefice;

    // Calculs fiscaux
    const cotisationsURSSAF = ca * tauxURSSAF;
    const versementIR = optionVFL ? ca * tauxIR : 0;
    const totalAPayer = cotisationsURSSAF + versementIR;

    // Charges fixes
    const chargesFixes = getChargesMensuelles() * (mode === 'trimestriel' ? 3 : 1);

    // Estimation COGS et frais Amazon (si pas dans suivi hebdo, estimation)
    const cogs = ca > 0 ? ca * 0.35 : 0; // Estimation 35% du CA
    const fraisAmazon = ca > 0 ? ca * 0.30 : 0; // Estimation 30% (commissions + FBA)

    // Benefice net reel
    const beneficeNet = ca - cogs - fraisAmazon - ppc - cotisationsURSSAF - versementIR - chargesFixes;

    // Mise a jour de l'affichage
    // Bloc principal
    updateElement('fiscal-ca-mois', formatCurrency(ca));
    updateElement('fiscal-urssaf-mois', formatCurrency(cotisationsURSSAF));
    updateElement('fiscal-net-mois', formatCurrency(beneficeNet));

    // Recap declaration
    updateElement('fiscal-recap-ca', formatCurrency(ca));
    updateElement('fiscal-recap-urssaf', formatCurrency(cotisationsURSSAF));
    updateElement('fiscal-recap-ir', optionVFL ? formatCurrency(versementIR) : '0 EUR (non active)');
    updateElement('fiscal-recap-total', formatCurrency(totalAPayer));

    // Detail benefice
    updateElement('fiscal-detail-ca', formatCurrency(ca));
    updateElement('fiscal-detail-cogs', '-' + formatCurrency(cogs));
    updateElement('fiscal-detail-amazon', '-' + formatCurrency(fraisAmazon));
    updateElement('fiscal-detail-ppc', '-' + formatCurrency(ppc));
    updateElement('fiscal-detail-urssaf', '-' + formatCurrency(cotisationsURSSAF));
    updateElement('fiscal-detail-ir', optionVFL ? '-' + formatCurrency(versementIR) : '0 EUR');
    updateElement('fiscal-detail-charges', '-' + formatCurrency(chargesFixes));
    updateElement('fiscal-detail-net', formatCurrency(beneficeNet));

    // Ancien systeme de fiscalite (compatibilite)
    updateElement('fiscal-taxes', formatCurrency(cotisationsURSSAF));
    updateElement('fiscal-poche', formatCurrency(beneficeNet));
    updateElement('fiscal-marge', ca > 0 ? (beneficeNet / ca * 100).toFixed(2) + '%' : '0%');

    // Mettre a jour l'historique
    renderFiscalHistorique();
}

// Afficher l'historique des declarations
function renderFiscalHistorique() {
    const tbody = document.getElementById('fiscal-historique-body');
    if (!tbody) return;

    const moisNoms = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin',
                      'Juil', 'Aout', 'Sep', 'Oct', 'Nov', 'Dec'];

    const tauxURSSAF = parseFloat(document.getElementById('fiscal-taux-urssaf')?.value || 12.3) / 100;
    const tauxIR = parseFloat(document.getElementById('fiscal-taux-ir')?.value || 1.0) / 100;
    const optionVFL = document.getElementById('fiscal-option-vfl')?.value === 'oui';
    const chargesFixes = getChargesMensuelles();

    const now = new Date();
    const currentYear = now.getFullYear();

    let totalCA = 0;
    let totalURSSAF = 0;
    let totalIR = 0;
    let totalPaye = 0;
    let totalNet = 0;
    let nbMois = 0;

    let html = '';

    // Parcourir les 12 mois de l'annee en cours
    for (let month = 0; month < 12; month++) {
        const yearMonth = `${currentYear}-${(month + 1).toString().padStart(2, '0')}`;
        const donnees = getCAMensuel(yearMonth);

        if (donnees.ca === 0 && month > now.getMonth()) continue; // Ignorer les mois futurs sans donnees

        const ca = donnees.ca;
        const urssaf = ca * tauxURSSAF;
        const ir = optionVFL ? ca * tauxIR : 0;
        const paye = urssaf + ir;

        // Estimation benefice
        const cogs = ca * 0.35;
        const fraisAmazon = ca * 0.30;
        const net = ca - cogs - fraisAmazon - donnees.ppc - urssaf - ir - chargesFixes;
        const marge = ca > 0 ? (net / ca * 100) : 0;

        totalCA += ca;
        totalURSSAF += urssaf;
        totalIR += ir;
        totalPaye += paye;
        totalNet += net;
        if (ca > 0) nbMois++;

        const margeColor = marge >= 15 ? 'text-green-600' : marge >= 5 ? 'text-yellow-600' : 'text-red-600';

        html += `
            <tr class="border-b hover:bg-gray-50 ${ca === 0 ? 'opacity-50' : ''}">
                <td class="p-3 font-medium">${moisNoms[month]} ${currentYear}</td>
                <td class="p-3 text-right">${formatCurrency(ca)}</td>
                <td class="p-3 text-right text-orange-600">${formatCurrency(urssaf)}</td>
                <td class="p-3 text-right text-purple-600">${optionVFL ? formatCurrency(ir) : '-'}</td>
                <td class="p-3 text-right text-red-600">${formatCurrency(paye)}</td>
                <td class="p-3 text-right ${net >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrency(net)}</td>
                <td class="p-3 text-center ${margeColor}">${marge.toFixed(1)}%</td>
            </tr>
        `;
    }

    tbody.innerHTML = html || '<tr><td colspan="7" class="p-8 text-center text-gray-500">Aucune donnee. Saisissez vos ventes dans le Suivi Hebdomadaire.</td></tr>';

    // Totaux
    const margeGlobale = totalCA > 0 ? (totalNet / totalCA * 100) : 0;
    updateElement('fiscal-total-ca', formatCurrency(totalCA));
    updateElement('fiscal-total-urssaf', formatCurrency(totalURSSAF));
    updateElement('fiscal-total-ir', optionVFL ? formatCurrency(totalIR) : '-');
    updateElement('fiscal-total-paye', formatCurrency(totalPaye));
    updateElement('fiscal-total-net', formatCurrency(totalNet));
    updateElement('fiscal-total-marge', margeGlobale.toFixed(1) + '%');
}

// Copier les montants pour la declaration
function copierDeclaration() {
    const ca = document.getElementById('fiscal-recap-ca')?.textContent || '0';
    const urssaf = document.getElementById('fiscal-recap-urssaf')?.textContent || '0';

    const texte = `CA a declarer: ${ca}\nCotisations URSSAF: ${urssaf}`;

    navigator.clipboard.writeText(texte).then(() => {
        showNotification('Montants copies dans le presse-papier !', 'success');
    }).catch(() => {
        showNotification('Erreur lors de la copie', 'error');
    });
}
