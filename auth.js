// ===========================
// GESTION AUTHENTIFICATION UI
// ===========================

let isOnline = navigator.onLine;
let currentUserEmail = null;
let unsubscribeListeners = [];

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', function() {
    initAuthUI();
});

function initAuthUI() {
    // Verifier si Firebase est configure
    if (firebaseConfig.apiKey === "REMPLACE_PAR_TA_CLE_API") {
        showOfflineMode();
        return;
    }

    // Initialiser Firebase
    if (!initFirebase()) {
        showOfflineMode();
        return;
    }

    // Ecouter les changements de connexion
    onAuthStateChange((user) => {
        if (user) {
            currentUserEmail = user.email;
            showApp();
            loadAllDataFromFirebase();
        } else {
            currentUserEmail = null;
            showLoginScreen();
        }
    });

    // Ecouter le statut reseau
    window.addEventListener('online', () => {
        isOnline = true;
        updateOnlineStatus();
        syncPendingChanges();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        updateOnlineStatus();
    });
}

// Afficher l'ecran de connexion
function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    clearUnsubscribeListeners();
}

// Afficher l'application
function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    updateUserInfo();
    setupRealtimeListeners();
}

// Mode hors-ligne (sans Firebase)
function showOfflineMode() {
    console.log('Mode hors-ligne active (Firebase non configure)');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');

    // Masquer les elements lies a l'auth
    const userInfo = document.getElementById('user-info');
    if (userInfo) userInfo.classList.add('hidden');

    // Charger depuis localStorage comme avant
    loadData();
    loadStockData();
    if (typeof calculateAll === 'function') calculateAll();
    if (typeof loadProducts === 'function') loadProducts();
    if (typeof loadSuiviHebdo === 'function') loadSuiviHebdo();
    if (typeof initStockSection === 'function') initStockSection();
}

// Mettre a jour l'affichage utilisateur
function updateUserInfo() {
    const userInfo = document.getElementById('user-info');
    const userEmail = document.getElementById('user-email');

    if (userInfo && currentUserEmail) {
        userInfo.classList.remove('hidden');
        if (userEmail) userEmail.textContent = currentUserEmail;
    }
}

// Mettre a jour le statut en ligne
function updateOnlineStatus() {
    const indicator = document.getElementById('online-status');
    if (indicator) {
        if (isOnline) {
            indicator.innerHTML = '<i class="fas fa-wifi text-green-400"></i>';
            indicator.title = 'En ligne - Synchronise';
        } else {
            indicator.innerHTML = '<i class="fas fa-wifi-slash text-red-400"></i>';
            indicator.title = 'Hors ligne - Les modifications seront synchronisees';
        }
    }
}

// ===========================
// FORMULAIRES LOGIN
// ===========================

// Basculer entre login et inscription
function toggleAuthMode() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const forgotForm = document.getElementById('forgot-form');

    if (loginForm.classList.contains('hidden')) {
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
        forgotForm.classList.add('hidden');
    } else {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
        forgotForm.classList.add('hidden');
    }
}

// Afficher formulaire mot de passe oublie
function showForgotPassword() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('signup-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.remove('hidden');
}

// Retour au login
function backToLogin() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('signup-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.add('hidden');
}

// Traiter la connexion
async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    errorDiv.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Connexion...';

    const result = await signIn(email, password);

    if (!result.success) {
        errorDiv.textContent = result.error;
        errorDiv.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Se connecter';
}

// Traiter l'inscription
async function handleSignup(event) {
    event.preventDefault();

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm').value;
    const errorDiv = document.getElementById('signup-error');
    const btn = document.getElementById('signup-btn');

    errorDiv.classList.add('hidden');

    if (password !== confirmPassword) {
        errorDiv.textContent = 'Les mots de passe ne correspondent pas';
        errorDiv.classList.remove('hidden');
        return;
    }

    if (password.length < 6) {
        errorDiv.textContent = 'Le mot de passe doit faire au moins 6 caracteres';
        errorDiv.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Inscription...';

    const result = await signUp(email, password);

    if (!result.success) {
        errorDiv.textContent = result.error;
        errorDiv.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>Creer mon compte';
}

// Traiter le reset password
async function handleForgotPassword(event) {
    event.preventDefault();

    const email = document.getElementById('forgot-email').value;
    const errorDiv = document.getElementById('forgot-error');
    const successDiv = document.getElementById('forgot-success');
    const btn = document.getElementById('forgot-btn');

    errorDiv.classList.add('hidden');
    successDiv.classList.add('hidden');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Envoi...';

    const result = await resetPassword(email);

    if (result.success) {
        successDiv.textContent = 'Email envoye ! Verifiez votre boite de reception.';
        successDiv.classList.remove('hidden');
    } else {
        errorDiv.textContent = result.error;
        errorDiv.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Envoyer le lien';
}

// Deconnexion
async function handleLogout() {
    if (confirm('Voulez-vous vous deconnecter ?')) {
        clearUnsubscribeListeners();
        await signOut();
    }
}

// ===========================
// SYNCHRONISATION FIREBASE
// ===========================

// Charger toutes les donnees depuis Firebase
async function loadAllDataFromFirebase() {
    showNotification('Chargement des donnees...', 'success');

    try {
        // Charger les donnees principales
        const mainData = await loadFromFirebase('main');
        if (mainData) {
            if (mainData.capital !== undefined) document.getElementById('input-capital').value = mainData.capital;
            if (mainData.ca !== undefined) document.getElementById('input-ca').value = mainData.ca;
            if (mainData.benefice !== undefined) document.getElementById('input-benefice').value = mainData.benefice;
            if (mainData.unites !== undefined) document.getElementById('input-unites').value = mainData.unites;
            if (mainData.acos !== undefined) document.getElementById('input-acos').value = mainData.acos;
            if (mainData.objCA !== undefined) document.getElementById('input-obj-ca').value = mainData.objCA;
            if (mainData.objBenefice !== undefined) document.getElementById('input-obj-benefice').value = mainData.objBenefice;
            if (mainData.objUnites !== undefined) document.getElementById('input-obj-unites').value = mainData.objUnites;
            if (mainData.objACOS !== undefined) document.getElementById('input-obj-acos').value = mainData.objACOS;
            if (mainData.joursStock !== undefined) document.getElementById('input-jours-stock').value = mainData.joursStock;
            if (mainData.products) products = mainData.products;
        }

        // Charger le suivi hebdo
        const hebdoData = await loadFromFirebase('hebdo');
        if (hebdoData && hebdoData.suiviHebdo) {
            suiviHebdo = hebdoData.suiviHebdo;
        }

        // Charger les donnees de stock
        const stockDataLoaded = await loadFromFirebase('stock');
        if (stockDataLoaded) {
            stockData = stockDataLoaded.stockData || {};
            stockCommandes = stockDataLoaded.commandes || [];
        }

        // Charger les parametres
        const paramsData = await loadFromFirebase('params');
        if (paramsData) {
            loadParamsFromData(paramsData);
        }

        // Recalculer tout
        calculateAll();
        loadProducts();
        initStockSection();
        if (typeof loadSuiviHebdo === 'function') loadSuiviHebdo();

        showNotification('Donnees synchronisees !', 'success');
    } catch (error) {
        console.error('Erreur chargement Firebase:', error);
        showNotification('Erreur de chargement, mode local active', 'error');
        loadData(); // Fallback localStorage
    }
}

// Configurer les listeners temps reel
function setupRealtimeListeners() {
    // Ecouter les changements en temps reel
    const unsubMain = listenToFirebase('main', (data) => {
        console.log('Mise a jour main en temps reel');
        if (data.products) {
            products = data.products;
            loadProducts();
        }
    });

    const unsubHebdo = listenToFirebase('hebdo', (data) => {
        console.log('Mise a jour hebdo en temps reel');
        if (data.suiviHebdo) {
            suiviHebdo = data.suiviHebdo;
            if (typeof updateKPIsHebdo === 'function') updateKPIsHebdo();
            if (typeof renderHistoriqueHebdo === 'function') renderHistoriqueHebdo();
        }
    });

    const unsubStock = listenToFirebase('stock', (data) => {
        console.log('Mise a jour stock en temps reel');
        if (data.stockData) stockData = data.stockData;
        if (data.commandes) stockCommandes = data.commandes;
        if (typeof renderStockTable === 'function') renderStockTable();
        if (typeof updateStockKPIs === 'function') updateStockKPIs();
    });

    if (unsubMain) unsubscribeListeners.push(unsubMain);
    if (unsubHebdo) unsubscribeListeners.push(unsubHebdo);
    if (unsubStock) unsubscribeListeners.push(unsubStock);
}

// Nettoyer les listeners
function clearUnsubscribeListeners() {
    unsubscribeListeners.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
    });
    unsubscribeListeners = [];
}

// Charger les params depuis les donnees Firebase
function loadParamsFromData(data) {
    // Parametres generaux
    if (data.tva !== undefined && document.getElementById('param-tva')) document.getElementById('param-tva').value = data.tva;
    if (data.impots !== undefined && document.getElementById('param-impots')) document.getElementById('param-impots').value = data.impots;
    if (data.capital !== undefined && document.getElementById('param-capital')) document.getElementById('param-capital').value = data.capital;
    if (data.objectifROI !== undefined && document.getElementById('param-objectif-roi')) document.getElementById('param-objectif-roi').value = data.objectifROI;
    if (data.objectifMarge !== undefined && document.getElementById('param-objectif-marge')) document.getElementById('param-objectif-marge').value = data.objectifMarge;
    if (data.stockSecurite !== undefined && document.getElementById('param-stock-securite')) document.getElementById('param-stock-securite').value = data.stockSecurite;

    // Charges fixes mensuelles
    if (data.chargeAmazonPro !== undefined && document.getElementById('charge-amazon-pro')) document.getElementById('charge-amazon-pro').value = data.chargeAmazonPro;
    if (data.chargeHelium10 !== undefined && document.getElementById('charge-helium10')) document.getElementById('charge-helium10').value = data.chargeHelium10;
    if (data.chargeCanva !== undefined && document.getElementById('charge-canva')) document.getElementById('charge-canva').value = data.chargeCanva;
    if (data.chargeIA !== undefined && document.getElementById('charge-ia')) document.getElementById('charge-ia').value = data.chargeIA;
    if (data.chargeComptable !== undefined && document.getElementById('charge-comptable')) document.getElementById('charge-comptable').value = data.chargeComptable;
    if (data.chargeBanque !== undefined && document.getElementById('charge-banque')) document.getElementById('charge-banque').value = data.chargeBanque;
    if (data.chargeAssurance !== undefined && document.getElementById('charge-assurance')) document.getElementById('charge-assurance').value = data.chargeAssurance;
    if (data.chargeCredit !== undefined && document.getElementById('charge-credit')) document.getElementById('charge-credit').value = data.chargeCredit;
    if (data.chargeAutresAbonnements !== undefined && document.getElementById('charge-autres-abonnements')) document.getElementById('charge-autres-abonnements').value = data.chargeAutresAbonnements;

    // Charges fixes annuelles
    if (data.chargeGS1 !== undefined && document.getElementById('charge-gs1')) document.getElementById('charge-gs1').value = data.chargeGS1;
    if (data.chargeINPI !== undefined && document.getElementById('charge-inpi')) document.getElementById('charge-inpi').value = data.chargeINPI;
    if (data.chargePhotos !== undefined && document.getElementById('charge-photos')) document.getElementById('charge-photos').value = data.chargePhotos;
    if (data.chargeFormation !== undefined && document.getElementById('charge-formation')) document.getElementById('charge-formation').value = data.chargeFormation;
    if (data.chargeWeb !== undefined && document.getElementById('charge-web')) document.getElementById('charge-web').value = data.chargeWeb;
    if (data.chargeJuridique !== undefined && document.getElementById('charge-juridique')) document.getElementById('charge-juridique').value = data.chargeJuridique;
    if (data.chargeAutresFixes !== undefined && document.getElementById('charge-autres-fixes')) document.getElementById('charge-autres-fixes').value = data.chargeAutresFixes;

    // Mettre a jour l'affichage des charges
    if (typeof updateChargesFixes === 'function') updateChargesFixes();
}

// ===========================
// FONCTIONS DE SAUVEGARDE MODIFIEES
// ===========================

// Sauvegarder les donnees principales (remplace saveData)
async function saveDataToCloud() {
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

    // Sauvegarder en local aussi (backup)
    localStorage.setItem('fba-dashboard-data', JSON.stringify(data));

    // Sauvegarder sur Firebase si connecte
    if (getCurrentUser()) {
        await saveToFirebase('main', data);
    }

    showNotification('Donnees sauvegardees !', 'success');
}

// Sauvegarder le suivi hebdo
async function saveHebdoToCloud() {
    const data = { suiviHebdo: suiviHebdo };

    localStorage.setItem('fba-suivi-hebdo', JSON.stringify(suiviHebdo));

    if (getCurrentUser()) {
        await saveToFirebase('hebdo', data);
    }
}

// Sauvegarder les donnees de stock
async function saveStockToCloud() {
    const data = {
        stockData: stockData,
        commandes: stockCommandes
    };

    localStorage.setItem('fba-stock-data', JSON.stringify(data));

    if (getCurrentUser()) {
        await saveToFirebase('stock', data);
    }
}

// Sauvegarder les parametres
async function saveParamsToCloud() {
    const data = {
        // Parametres generaux
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

    localStorage.setItem('fba-dashboard-params', JSON.stringify(data));

    if (getCurrentUser()) {
        await saveToFirebase('params', data);
    }
}

// Synchroniser les changements en attente (apres reconnexion)
async function syncPendingChanges() {
    if (!getCurrentUser()) return;

    console.log('Synchronisation des changements en attente...');

    // Resynchroniser tout depuis le local
    await saveDataToCloud();
    await saveHebdoToCloud();
    await saveStockToCloud();
    await saveParamsToCloud();

    showNotification('Synchronisation terminee !', 'success');
}
