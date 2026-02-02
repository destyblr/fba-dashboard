# Guide de Deploiement - FBA Dashboard

Ce guide explique comment mettre ton dashboard en ligne avec synchronisation cloud.

---

## Etape 1 : Creer un projet Firebase (5 min)

### 1.1 Creer un compte Firebase
1. Va sur https://console.firebase.google.com
2. Connecte-toi avec ton compte Google
3. Clique sur **"Creer un projet"**
4. Nom du projet : `mon-fba-dashboard` (ou ce que tu veux)
5. Desactive Google Analytics (pas necessaire)
6. Clique sur **"Creer le projet"**

### 1.2 Activer Firestore (base de donnees)
1. Dans le menu gauche, clique sur **"Firestore Database"**
2. Clique sur **"Creer une base de donnees"**
3. Choisis **"Demarrer en mode test"** (on securisera apres)
4. Choisis la region **"eur3 (europe-west)"**
5. Clique sur **"Activer"**

### 1.3 Activer l'authentification
1. Dans le menu gauche, clique sur **"Authentication"**
2. Clique sur **"Commencer"**
3. Dans l'onglet **"Sign-in method"**, clique sur **"Adresse e-mail/Mot de passe"**
4. Active la premiere option (Adresse e-mail/Mot de passe)
5. Clique sur **"Enregistrer"**

### 1.4 Obtenir les cles de configuration
1. Clique sur l'icone **engrenage** (a cote de "Vue d'ensemble du projet")
2. Clique sur **"Parametres du projet"**
3. Descends jusqu'a **"Vos applications"**
4. Clique sur l'icone **Web** (`</>`)
5. Nom de l'application : `FBA Dashboard`
6. Clique sur **"Enregistrer l'application"**
7. **COPIE les valeurs** affichees (apiKey, authDomain, projectId, etc.)

---

## Etape 2 : Configurer ton projet (2 min)

### 2.1 Ouvre le fichier `firebase-config.js`

Remplace les valeurs par celles que tu as copiees :

```javascript
const firebaseConfig = {
    apiKey: "AIzaSyB...",              // Ta vraie cle
    authDomain: "mon-fba-dashboard.firebaseapp.com",
    projectId: "mon-fba-dashboard",
    storageBucket: "mon-fba-dashboard.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

### 2.2 Sauvegarde le fichier

---

## Etape 3 : Deployer sur Netlify (3 min)

### Option A : Glisser-deposer (le plus simple)

1. Va sur https://app.netlify.com
2. Cree un compte gratuit (ou connecte-toi)
3. Sur le dashboard, tu verras une zone **"Drag and drop"**
4. Ouvre ton dossier `amazon-fba-dashboard` dans l'explorateur
5. **Glisse tout le dossier** sur la zone de Netlify
6. Attends 30 secondes...
7. **C'est en ligne !** Tu recois une URL du type `random-name-123.netlify.app`

### Option B : Via GitHub (pour mises a jour automatiques)

1. Cree un repository GitHub avec ton projet
2. Sur Netlify, clique sur **"Add new site"** > **"Import an existing project"**
3. Connecte ton GitHub
4. Selectionne ton repository
5. Clique sur **"Deploy site"**

### Changer le nom du site (optionnel)

1. Sur Netlify, va dans **"Site settings"**
2. Clique sur **"Change site name"**
3. Choisis un nom : `mon-fba-dashboard` → `mon-fba-dashboard.netlify.app`

---

## Etape 4 : Securiser Firebase (important !)

Une fois que tout fonctionne, securise ta base de donnees :

### 4.1 Regles Firestore

1. Va sur Firebase Console > Firestore Database > **Regles**
2. Remplace les regles par :

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Chaque utilisateur ne peut acceder qu'a ses propres donnees
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Clique sur **"Publier"**

---

## Utilisation

### Premiere connexion
1. Va sur ton URL Netlify (ex: `mon-fba-dashboard.netlify.app`)
2. Clique sur **"Creer un compte"**
3. Entre ton email et un mot de passe
4. Tu es connecte !

### Connexion depuis un autre appareil
1. Va sur la meme URL depuis ton telephone
2. Connecte-toi avec le meme email/mot de passe
3. Toutes tes donnees sont synchronisees !

### Mode hors-ligne
- L'app fonctionne meme sans internet
- Les modifications sont sauvegardees localement
- Elles se synchronisent automatiquement quand tu retrouves internet

---

## Depannage

### "Firebase non configure"
→ Verifie que tu as bien remplace les valeurs dans `firebase-config.js`

### "Erreur de connexion"
→ Verifie que l'authentification Email/Password est activee sur Firebase

### "Donnees non synchronisees"
→ Verifie que Firestore est bien active et que les regles permettent l'acces

### Besoin d'aide ?
→ Verifie la console du navigateur (F12) pour voir les erreurs

---

## Resume des URLs

| Service | URL |
|---------|-----|
| Firebase Console | https://console.firebase.google.com |
| Netlify | https://app.netlify.com |
| Ton site | https://[ton-nom].netlify.app |

---

## Couts

**100% GRATUIT** pour un usage personnel :

- **Firebase** : Gratuit jusqu'a 1GB de stockage et 50K lectures/jour
- **Netlify** : Gratuit jusqu'a 100GB de bande passante/mois

Tu ne paieras jamais rien avec un usage normal !
