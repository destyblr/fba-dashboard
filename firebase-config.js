// ===========================
// CONFIGURATION FIREBASE
// ===========================
//
// INSTRUCTIONS:
// 1. Va sur https://console.firebase.google.com
// 2. Cree un nouveau projet (ex: "mon-fba-dashboard")
// 3. Active Firestore Database (mode test pour commencer)
// 4. Active Authentication > Email/Password
// 5. Va dans Project Settings > General > Your apps > Web app
// 6. Copie les valeurs ci-dessous
//
// ===========================

const firebaseConfig = {
    apiKey: "AIzaSyBYTKgBgUsT97TByuMEuoxU_OeCXj-YIK8",
    authDomain: "mon-fba-dashboard.firebaseapp.com",
    projectId: "mon-fba-dashboard",
    storageBucket: "mon-fba-dashboard.firebasestorage.app",
    messagingSenderId: "472848698348",
    appId: "1:472848698348:web:00444413a96151fea70ec9"
};

// ===========================
// INITIALISATION FIREBASE
// ===========================

let app = null;
let db = null;
let auth = null;

function initFirebase() {
    try {
        // Initialiser Firebase
        app = firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();

        console.log('Firebase initialise avec succes !');
        return true;
    } catch (error) {
        console.error('Erreur initialisation Firebase:', error);
        return false;
    }
}

// ===========================
// FONCTIONS FIRESTORE (BASE DE DONNEES)
// ===========================

// Sauvegarder les donnees utilisateur
async function saveToFirebase(collection, data) {
    const user = auth.currentUser;
    if (!user) {
        console.error('Utilisateur non connecte');
        return false;
    }

    try {
        await db.collection('users').doc(user.uid).collection(collection).doc('data').set({
            ...data,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`Donnees ${collection} sauvegardees`);
        return true;
    } catch (error) {
        console.error('Erreur sauvegarde Firebase:', error);
        return false;
    }
}

// Charger les donnees utilisateur
async function loadFromFirebase(collection) {
    const user = auth.currentUser;
    if (!user) {
        console.error('Utilisateur non connecte');
        return null;
    }

    try {
        const doc = await db.collection('users').doc(user.uid).collection(collection).doc('data').get();

        if (doc.exists) {
            console.log(`Donnees ${collection} chargees`);
            return doc.data();
        } else {
            console.log(`Pas de donnees ${collection} trouvees`);
            return null;
        }
    } catch (error) {
        console.error('Erreur chargement Firebase:', error);
        return null;
    }
}

// Ecouter les changements en temps reel
function listenToFirebase(collection, callback) {
    const user = auth.currentUser;
    if (!user) return null;

    return db.collection('users').doc(user.uid).collection(collection).doc('data')
        .onSnapshot((doc) => {
            if (doc.exists) {
                callback(doc.data());
            }
        }, (error) => {
            console.error('Erreur listener Firebase:', error);
        });
}

// ===========================
// FONCTIONS D'AUTHENTIFICATION
// ===========================

// Inscription
async function signUp(email, password) {
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        console.log('Inscription reussie:', userCredential.user.email);
        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error('Erreur inscription:', error);
        return { success: false, error: getAuthErrorMessage(error.code) };
    }
}

// Connexion
async function signIn(email, password) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        console.log('Connexion reussie:', userCredential.user.email);
        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error('Erreur connexion:', error);
        return { success: false, error: getAuthErrorMessage(error.code) };
    }
}

// Deconnexion
async function signOut() {
    try {
        await auth.signOut();
        console.log('Deconnexion reussie');
        return { success: true };
    } catch (error) {
        console.error('Erreur deconnexion:', error);
        return { success: false, error: error.message };
    }
}

// Reinitialiser mot de passe
async function resetPassword(email) {
    try {
        await auth.sendPasswordResetEmail(email);
        return { success: true };
    } catch (error) {
        console.error('Erreur reset password:', error);
        return { success: false, error: getAuthErrorMessage(error.code) };
    }
}

// Observer les changements d'etat d'authentification
function onAuthStateChange(callback) {
    return auth.onAuthStateChanged(callback);
}

// Obtenir l'utilisateur actuel
function getCurrentUser() {
    return auth.currentUser;
}

// Messages d'erreur en francais
function getAuthErrorMessage(errorCode) {
    const messages = {
        'auth/email-already-in-use': 'Cet email est deja utilise',
        'auth/invalid-email': 'Email invalide',
        'auth/operation-not-allowed': 'Operation non autorisee',
        'auth/weak-password': 'Mot de passe trop faible (min 6 caracteres)',
        'auth/user-disabled': 'Ce compte a ete desactive',
        'auth/user-not-found': 'Aucun compte avec cet email',
        'auth/wrong-password': 'Mot de passe incorrect',
        'auth/too-many-requests': 'Trop de tentatives, reessayez plus tard',
        'auth/network-request-failed': 'Erreur reseau, verifiez votre connexion'
    };
    return messages[errorCode] || 'Une erreur est survenue';
}
