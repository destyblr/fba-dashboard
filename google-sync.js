// Configuration Google Sheets
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyl8p756Ol4nstEnZza1Wlh6YZVGOXFEc0liS6A0W6vy26FN61HO6Ud3o7E8vMgOb_I/exec";

// Variable pour stocker toutes les donnees
let allData = {
    main: {},
    params: {},
    hebdo: {},
    stock: {},
    products: []
};

// Flag pour empecher la sauvegarde pendant le chargement
let isLoading = true; // IMPORTANT: true par defaut!

// Flag pour confirmer que les donnees ont ete chargees avec succes
let dataLoadedSuccessfully = false;

// Charger les donnees depuis Google Sheets
async function loadFromGoogleSheets() {
    isLoading = true; // Empecher la sauvegarde pendant le chargement
    try {
        console.log("Chargement depuis Google Sheets...");
        // Ajouter un parametre anti-cache
        const url = GOOGLE_SCRIPT_URL + "?nocache=" + Date.now();
        const response = await fetch(url);
        const data = await response.json();

        if (data && Object.keys(data).length > 0) {
            allData = data;
            applyDataToPage(data);
            console.log("Donnees chargees depuis Google Sheets !");
            showNotification("Donnees synchronisees !", "success");
        } else {
            console.log("Aucune donnee dans Google Sheets, chargement local...");
            loadFromLocalStorage();
        }
    } catch (error) {
        console.error("Erreur Google Sheets:", error);
        showNotification("Erreur: " + error.message, "error");
        loadFromLocalStorage();
    }
    // Attendre plus longtemps avant d'autoriser les sauvegardes
    setTimeout(() => {
        isLoading = false;
        dataLoadedSuccessfully = true;
        console.log("=== SAUVEGARDES ACTIVEES (donnees chargees avec succes) ===");
    }, 5000); // 5 secondes pour etre sur que tout est charge
}

// Sauvegarder vers Google Sheets
async function saveToGoogleSheets() {
    // Ne pas sauvegarder pendant le chargement
    if (isLoading) {
        console.log("Sauvegarde BLOQUEE (chargement en cours)");
        return;
    }

    // Ne pas sauvegarder si les donnees n'ont jamais ete chargees
    if (!dataLoadedSuccessfully) {
        console.log("Sauvegarde BLOQUEE (donnees pas encore chargees)");
        return;
    }

    try {
        // Collecter toutes les donnees
        collectAllData();

        // Sauvegarder en local aussi
        localStorage.setItem('fba-all-data', JSON.stringify(allData));

        // Envoyer vers Google Sheets via GET (contourne CORS)
        console.log("Sauvegarde vers Google Sheets...");
        const dataEncoded = encodeURIComponent(JSON.stringify(allData));
        const url = GOOGLE_SCRIPT_URL + "?data=" + dataEncoded;

        const response = await fetch(url);
        const result = await response.json();

        if (result.success) {
            console.log("Donnees sauvegardees !", allData);
            showNotification("Sauvegarde reussie !", "success");
        }
        return true;
    } catch (error) {
        console.error("Erreur sauvegarde:", error);
        showNotification("Erreur de sauvegarde", "error");
        return false;
    }
}

// Collecter toutes les donnees de la page
function collectAllData() {
    // Donnees principales
    allData.main = {
        capital: document.getElementById('input-capital')?.value || 3000,
        ca: document.getElementById('input-ca')?.value || 0,
        benefice: document.getElementById('input-benefice')?.value || 0,
        unites: document.getElementById('input-unites')?.value || 0,
        acos: document.getElementById('input-acos')?.value || 0,
        objCA: document.getElementById('input-obj-ca')?.value || 0,
        objBenefice: document.getElementById('input-obj-benefice')?.value || 0,
        objUnites: document.getElementById('input-obj-unites')?.value || 0,
        objACOS: document.getElementById('input-obj-acos')?.value || 0,
        joursStock: document.getElementById('input-jours-stock')?.value || 0
    };

    // Parametres et charges
    allData.params = {
        tva: document.getElementById('param-tva')?.value || 20,
        impots: document.getElementById('param-impots')?.value || 13.3,
        capital: document.getElementById('param-capital')?.value || 3000,
        objectifROI: document.getElementById('param-objectif-roi')?.value || 30,
        objectifMarge: document.getElementById('param-objectif-marge')?.value || 25,
        stockSecurite: document.getElementById('param-stock-securite')?.value || 15,
        delaiTransport: document.getElementById('param-delai-transport')?.value || 30,
        alertePreventive: document.getElementById('param-alerte-preventive')?.value || 10,
        acosMax: document.getElementById('param-acos-max')?.value || 25,
        chargeAmazonPro: document.getElementById('charge-amazon-pro')?.value || 39,
        chargeHelium10: document.getElementById('charge-helium10')?.value || 0,
        chargeCanva: document.getElementById('charge-canva')?.value || 0,
        chargeIA: document.getElementById('charge-ia')?.value || 0,
        chargeComptable: document.getElementById('charge-comptable')?.value || 0,
        chargeBanque: document.getElementById('charge-banque')?.value || 0,
        chargeAssurance: document.getElementById('charge-assurance')?.value || 0,
        chargeCredit: document.getElementById('charge-credit')?.value || 0,
        chargeAutresAbonnements: document.getElementById('charge-autres-abonnements')?.value || 0,
        chargeGS1: document.getElementById('charge-gs1')?.value || 0,
        chargeINPI: document.getElementById('charge-inpi')?.value || 0,
        chargePhotos: document.getElementById('charge-photos')?.value || 0,
        chargeFormation: document.getElementById('charge-formation')?.value || 0,
        chargeWeb: document.getElementById('charge-web')?.value || 0,
        chargeJuridique: document.getElementById('charge-juridique')?.value || 0,
        chargeAutresFixes: document.getElementById('charge-autres-fixes')?.value || 0
    };

    // Produits
    if (typeof products !== 'undefined') {
        allData.products = products;
    }

    // Suivi hebdo
    if (typeof suiviHebdo !== 'undefined') {
        allData.hebdo = { suiviHebdo: suiviHebdo };
    }

    // Stock
    if (typeof stockData !== 'undefined') {
        allData.stock = {
            stockData: stockData,
            commandes: typeof stockCommandes !== 'undefined' ? stockCommandes : []
        };
    }

    allData.lastUpdate = new Date().toISOString();
}

// Appliquer les donnees a la page
function applyDataToPage(data) {
    // Donnees principales
    // NOTE: CA, Benefice, Unites, ACOS sont maintenant calcules automatiquement
    // depuis le suivi hebdo, donc on ne les charge plus depuis Google Sheets
    if (data.main) {
        if (data.main.capital !== undefined) setInputValue('input-capital', data.main.capital);
        // Ces valeurs sont calculees auto depuis suivi hebdo - ne pas charger
        // if (data.main.ca !== undefined) setInputValue('input-ca', data.main.ca);
        // if (data.main.benefice !== undefined) setInputValue('input-benefice', data.main.benefice);
        // if (data.main.unites !== undefined) setInputValue('input-unites', data.main.unites);
        // if (data.main.acos !== undefined) setInputValue('input-acos', data.main.acos);
        // Objectifs restent chargeables
        if (data.main.objCA !== undefined) setInputValue('input-obj-ca', data.main.objCA);
        if (data.main.objBenefice !== undefined) setInputValue('input-obj-benefice', data.main.objBenefice);
        if (data.main.objUnites !== undefined) setInputValue('input-obj-unites', data.main.objUnites);
        if (data.main.objACOS !== undefined) setInputValue('input-obj-acos', data.main.objACOS);
        // Jours stock est calcule auto aussi
        // if (data.main.joursStock !== undefined) setInputValue('input-jours-stock', data.main.joursStock);
    }

    // Parametres
    if (data.params) {
        if (data.params.tva !== undefined) setInputValue('param-tva', data.params.tva);
        if (data.params.impots !== undefined) setInputValue('param-impots', data.params.impots);
        if (data.params.capital !== undefined) setInputValue('param-capital', data.params.capital);
        if (data.params.objectifROI !== undefined) setInputValue('param-objectif-roi', data.params.objectifROI);
        if (data.params.objectifMarge !== undefined) setInputValue('param-objectif-marge', data.params.objectifMarge);
        if (data.params.stockSecurite !== undefined) setInputValue('param-stock-securite', data.params.stockSecurite);
        if (data.params.delaiTransport !== undefined) setInputValue('param-delai-transport', data.params.delaiTransport);
        if (data.params.alertePreventive !== undefined) setInputValue('param-alerte-preventive', data.params.alertePreventive);
        if (data.params.acosMax !== undefined) setInputValue('param-acos-max', data.params.acosMax);
        if (data.params.chargeAmazonPro !== undefined) setInputValue('charge-amazon-pro', data.params.chargeAmazonPro);
        if (data.params.chargeHelium10 !== undefined) setInputValue('charge-helium10', data.params.chargeHelium10);
        if (data.params.chargeCanva !== undefined) setInputValue('charge-canva', data.params.chargeCanva);
        if (data.params.chargeIA !== undefined) setInputValue('charge-ia', data.params.chargeIA);
        if (data.params.chargeComptable !== undefined) setInputValue('charge-comptable', data.params.chargeComptable);
        if (data.params.chargeBanque !== undefined) setInputValue('charge-banque', data.params.chargeBanque);
        if (data.params.chargeAssurance !== undefined) setInputValue('charge-assurance', data.params.chargeAssurance);
        if (data.params.chargeCredit !== undefined) setInputValue('charge-credit', data.params.chargeCredit);
        if (data.params.chargeAutresAbonnements !== undefined) setInputValue('charge-autres-abonnements', data.params.chargeAutresAbonnements);
        if (data.params.chargeGS1 !== undefined) setInputValue('charge-gs1', data.params.chargeGS1);
        if (data.params.chargeINPI !== undefined) setInputValue('charge-inpi', data.params.chargeINPI);
        if (data.params.chargePhotos !== undefined) setInputValue('charge-photos', data.params.chargePhotos);
        if (data.params.chargeFormation !== undefined) setInputValue('charge-formation', data.params.chargeFormation);
        if (data.params.chargeWeb !== undefined) setInputValue('charge-web', data.params.chargeWeb);
        if (data.params.chargeJuridique !== undefined) setInputValue('charge-juridique', data.params.chargeJuridique);
        if (data.params.chargeAutresFixes !== undefined) setInputValue('charge-autres-fixes', data.params.chargeAutresFixes);
    }

    // Produits
    if (data.products && Array.isArray(data.products)) {
        products = data.products;
        if (typeof renderProducts === 'function') renderProducts();
    }

    // Suivi hebdo (ne pas appeler loadSuiviHebdo qui recharge depuis localStorage)
    if (data.hebdo && data.hebdo.suiviHebdo) {
        suiviHebdo = data.hebdo.suiviHebdo;
        // Appeler directement les fonctions de rendu
        if (typeof updateKPIsHebdo === 'function') updateKPIsHebdo();
        if (typeof renderHistoriqueHebdo === 'function') renderHistoriqueHebdo();
        if (typeof initChartsHebdo === 'function') initChartsHebdo();
    }

    // Stock (ne pas recharger depuis localStorage)
    if (data.stock) {
        if (data.stock.stockData) stockData = data.stock.stockData;
        if (data.stock.commandes) stockCommandes = data.stock.commandes;
        if (typeof renderStockTable === 'function') renderStockTable();
        if (typeof updateStockKPIs === 'function') updateStockKPIs();
        if (typeof renderCommandes === 'function') renderCommandes();
    }

    // Recalculer
    if (typeof calculateAll === 'function') calculateAll();
    if (typeof updateChargesFixes === 'function') updateChargesFixes();

    // Mettre a jour le tableau de bord avec les donnees du suivi hebdo
    if (typeof updateDashboardFromSuiviHebdo === 'function') updateDashboardFromSuiviHebdo();

    // Calculer les objectifs automatiques
    if (typeof calculateAutoObjectives === 'function') calculateAutoObjectives();
}

// Helper pour set input value
function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

// Charger depuis localStorage (fallback)
function loadFromLocalStorage() {
    const saved = localStorage.getItem('fba-all-data');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            applyDataToPage(data);
            console.log("Donnees chargees depuis localStorage");
        } catch (e) {
            console.error("Erreur parsing localStorage:", e);
        }
    }
    // Activer les sauvegardes apres un delai meme en mode hors-ligne
    setTimeout(() => {
        isLoading = false;
        dataLoadedSuccessfully = true;
        console.log("=== SAUVEGARDES ACTIVEES (mode local) ===");
    }, 5000);
}

// Remplacer les fonctions existantes
function saveDataToCloud() {
    saveToGoogleSheets();
}

function saveParamsToCloud() {
    saveToGoogleSheets();
}

function saveHebdoToCloud() {
    saveToGoogleSheets();
}

function saveStockToCloud() {
    saveToGoogleSheets();
}

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', function() {
    // Bloquer les sauvegardes pendant le chargement initial
    isLoading = true;

    // Attendre un peu que les autres scripts soient charges
    setTimeout(() => {
        loadFromGoogleSheets();
    }, 1000);
});

// Ne PAS sauvegarder automatiquement - seulement quand l'utilisateur clique "Sauvegarder"

console.log("Google Sheets Sync charge !");
