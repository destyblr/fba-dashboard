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
let isLoading = false;

// Charger les donnees depuis Google Sheets
async function loadFromGoogleSheets() {
    isLoading = true; // Empecher la sauvegarde pendant le chargement
    try {
        console.log("Chargement depuis Google Sheets...");
        const response = await fetch(GOOGLE_SCRIPT_URL);
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
        showNotification("Mode hors-ligne", "error");
        loadFromLocalStorage();
    }
    isLoading = false; // Autoriser la sauvegarde
}

// Sauvegarder vers Google Sheets
async function saveToGoogleSheets() {
    // Ne pas sauvegarder pendant le chargement
    if (isLoading) {
        console.log("Sauvegarde ignoree (chargement en cours)");
        return;
    }

    try {
        // Collecter toutes les donnees
        collectAllData();

        // Sauvegarder en local aussi
        localStorage.setItem('fba-all-data', JSON.stringify(allData));

        // Envoyer vers Google Sheets
        console.log("Sauvegarde vers Google Sheets...");
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(allData)
        });

        console.log("Donnees sauvegardees !");
        showNotification("Sauvegarde reussie !", "success");
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
    if (data.main) {
        if (data.main.capital !== undefined) setInputValue('input-capital', data.main.capital);
        if (data.main.ca !== undefined) setInputValue('input-ca', data.main.ca);
        if (data.main.benefice !== undefined) setInputValue('input-benefice', data.main.benefice);
        if (data.main.unites !== undefined) setInputValue('input-unites', data.main.unites);
        if (data.main.acos !== undefined) setInputValue('input-acos', data.main.acos);
        if (data.main.objCA !== undefined) setInputValue('input-obj-ca', data.main.objCA);
        if (data.main.objBenefice !== undefined) setInputValue('input-obj-benefice', data.main.objBenefice);
        if (data.main.objUnites !== undefined) setInputValue('input-obj-unites', data.main.objUnites);
        if (data.main.objACOS !== undefined) setInputValue('input-obj-acos', data.main.objACOS);
        if (data.main.joursStock !== undefined) setInputValue('input-jours-stock', data.main.joursStock);
    }

    // Parametres
    if (data.params) {
        if (data.params.tva !== undefined) setInputValue('param-tva', data.params.tva);
        if (data.params.impots !== undefined) setInputValue('param-impots', data.params.impots);
        if (data.params.capital !== undefined) setInputValue('param-capital', data.params.capital);
        if (data.params.objectifROI !== undefined) setInputValue('param-objectif-roi', data.params.objectifROI);
        if (data.params.objectifMarge !== undefined) setInputValue('param-objectif-marge', data.params.objectifMarge);
        if (data.params.stockSecurite !== undefined) setInputValue('param-stock-securite', data.params.stockSecurite);
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
        if (typeof loadProducts === 'function') loadProducts();
    }

    // Suivi hebdo
    if (data.hebdo && data.hebdo.suiviHebdo) {
        suiviHebdo = data.hebdo.suiviHebdo;
        if (typeof loadSuiviHebdo === 'function') loadSuiviHebdo();
    }

    // Stock
    if (data.stock) {
        if (data.stock.stockData) stockData = data.stock.stockData;
        if (data.stock.commandes) stockCommandes = data.stock.commandes;
        if (typeof initStockSection === 'function') initStockSection();
    }

    // Recalculer
    if (typeof calculateAll === 'function') calculateAll();
    if (typeof updateChargesFixes === 'function') updateChargesFixes();
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
        } catch (e) {
            console.error("Erreur parsing localStorage:", e);
        }
    }
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
    // Attendre un peu que les autres scripts soient charges
    setTimeout(() => {
        loadFromGoogleSheets();
    }, 1000);
});

// Sauvegarder quand on quitte la page
window.addEventListener('beforeunload', function() {
    collectAllData();
    localStorage.setItem('fba-all-data', JSON.stringify(allData));
});

console.log("Google Sheets Sync charge !");
