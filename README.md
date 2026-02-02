# Dashboard Amazon FBA - Pilotage Business

Application web interactive pour suivre et gérer votre business Amazon FBA.

## Fonctionnalités

- **Tableau de bord** avec indicateurs clés (KPI)
- **Pilotage mensuel** avec saisie de vos chiffres
- **Gestion multi-produits** (ajout/suppression de produits)
- **Graphiques interactifs** (évolution CA, bénéfices, ACOS, etc.)
- **Calculs fiscaux automatiques** (Taxes Micro 13,3%, Gain Net "Poche", ROI)
- **Sauvegarde locale** de vos données (localStorage)
- **Interface responsive** et professionnelle

## Installation & Utilisation

### Option 1: Utilisation locale (Simple)

1. **Ouvrir le fichier**
   - Double-cliquez sur `index.html`
   - L'application s'ouvre dans votre navigateur par défaut

2. **C'est tout !** Aucune installation requise.

### Option 2: Hébergement gratuit en ligne

#### Netlify (Recommandé - Drag & Drop)

1. Allez sur [Netlify Drop](https://app.netlify.com/drop)
2. Faites glisser le dossier `amazon-fba-dashboard` sur la page
3. Vous obtenez une URL publique instantanément (ex: `https://votre-site.netlify.app`)

#### GitHub Pages (Gratuit)

1. Créez un compte sur [GitHub](https://github.com)
2. Créez un nouveau repository
3. Uploadez les fichiers `index.html` et `app.js`
4. Allez dans Settings > Pages
5. Activez GitHub Pages
6. Votre site sera disponible sur `https://votre-username.github.io/nom-repo`

#### Vercel (Alternative)

1. Allez sur [Vercel](https://vercel.com)
2. Connectez-vous avec GitHub
3. Importez votre dossier
4. Déployé en quelques secondes !

## Structure du projet

```
amazon-fba-dashboard/
├── index.html          # Structure HTML principale
├── app.js              # Logique JavaScript (calculs, graphiques, etc.)
└── README.md           # Ce fichier
```

## Utilisation de l'application

### 1. Tableau de Bord
Vue d'ensemble avec les KPI principaux :
- Gain Total
- Chiffre d'Affaires
- Bénéfice Net
- ACOS

### 2. Pilotage Mensuel
Saisissez vos données mensuelles :
- Capital de départ
- Chiffre d'affaires
- Bénéfice net
- Unités vendues
- ACOS

Les calculs se mettent à jour automatiquement !

**N'oubliez pas de cliquer sur "Sauvegarder les données"** pour conserver vos modifications.

### 3. Gestion des Produits
- Cliquez sur **"Ajouter un Produit"** pour créer une nouvelle fiche produit
- Remplissez les informations (CA, Bénéfice, Unités, ACOS)
- La marge est calculée automatiquement
- Supprimez un produit avec l'icône poubelle

### 4. Graphiques
Visualisez l'évolution de votre business :
- Évolution CA & Bénéfices
- Performance ACOS
- Répartition des revenus
- ROI & Marges

### 5. Fiscalité
Calculs automatiques :
- **Taxes Micro (13,3%)** = Bénéfice × 13,3%
- **Gain Net "Poche"** = Bénéfice - Taxes
- **Marge Net Finale** = (Gain Net / CA) × 100
- **ROI Réel** = (Gain Net / Capital) × 100
- **ROI Global** = (Bénéfice / Capital) × 100

## Formules utilisées

Toutes les formules respectent les calculs micro-entreprise :

| Indicateur | Formule |
|------------|---------|
| Taxes Micro | Bénéfice Net × 13,3% |
| Gain Net "Poche" | Bénéfice Net - Taxes Micro |
| ROI Global | (Bénéfice Net ÷ Capital de départ) × 100 |
| ROI Réel | (Gain Net Poche ÷ Capital de départ) × 100 |
| Marge Nette | (Bénéfice Net ÷ CA) × 100 |
| Marge Net Finale | (Gain Net Poche ÷ CA) × 100 |

## Technologies utilisées

- **HTML5** - Structure
- **Tailwind CSS** (via CDN) - Design moderne et responsive
- **JavaScript Vanilla** - Logique et calculs
- **Chart.js** (via CDN) - Graphiques interactifs
- **Font Awesome** (via CDN) - Icônes
- **localStorage** - Sauvegarde locale des données

## Sauvegarde des données

Vos données sont sauvegardées **localement** dans votre navigateur (localStorage).

**Important :**
- Les données restent sur votre ordinateur uniquement
- Ne pas vider le cache du navigateur si vous voulez conserver vos données
- Pour sauvegarder définitivement, exportez vos données (à venir dans une prochaine version)

## Compatibilité

Compatible avec tous les navigateurs modernes :
- Chrome ✅
- Firefox ✅
- Safari ✅
- Edge ✅

## Support & Contact

Pour toute question ou suggestion d'amélioration, créez une issue sur le repository GitHub.

## Licence

Libre d'utilisation pour usage personnel et commercial.

---

**Développé pour optimiser le pilotage de votre business Amazon FBA** 🚀
