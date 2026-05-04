# 🚀 Migration vers Cloudflare Pages

## Structure de tes fichiers

```
ton-projet/
├── index.html                          ← ton site
├── success.html                        ← page après paiement
├── wrangler.toml                       ← config Cloudflare
└── functions/
    └── create-checkout-session.js      ← ta fonction Stripe
```

---

## Étape 1 — Mettre tes fichiers sur GitHub

1. Va sur https://github.com et crée un compte (gratuit)
2. Clique "New repository" → nomme-le (ex: `ma-boutique`)
3. Upload tous tes fichiers en respectant la structure ci-dessus
   - `index.html` à la racine
   - `success.html` à la racine
   - `wrangler.toml` à la racine
   - `create-checkout-session.js` dans un dossier nommé `functions/`

---

## Étape 2 — Créer ton projet sur Cloudflare Pages

1. Va sur https://pages.cloudflare.com
2. Crée un compte gratuit (ou connecte-toi)
3. Clique **"Create a project"** → **"Connect to Git"**
4. Connecte ton compte GitHub et sélectionne ton repository
5. Dans les paramètres de build :
   - **Framework preset** : None
   - **Build command** : (laisser vide)
   - **Build output directory** : `.`
6. Clique **"Save and Deploy"**

---

## Étape 3 — Ajouter ta clé Stripe (IMPORTANT)

Sans ça, les paiements ne fonctionneront pas.

1. Dans Cloudflare Pages → ton projet → onglet **"Settings"**
2. Clique **"Environment variables"**
3. Clique **"Add variable"** :
   - **Variable name** : `STRIPE_SECRET_KEY`
   - **Value** : ta clé secrète Stripe (commence par `sk_test_...`)
4. Clique **"Save"**
5. **Redéploie** ton site (onglet Deployments → "Retry deployment")

Ta clé Stripe se trouve sur : https://dashboard.stripe.com/apikeys

---

## Étape 4 — Tester

1. Ouvre ton URL Cloudflare (ex: `ma-boutique.pages.dev`)
2. Ajoute un produit au panier et clique "Commander"
3. Utilise la carte de test Stripe : `4242 4242 4242 4242`
   - Date : n'importe quelle date future
   - CVV : n'importe quoi (ex: 123)

---

## ✅ Différences avec Netlify

| | Netlify | Cloudflare Pages |
|---|---|---|
| URL des fonctions | `/.netlify/functions/nom` | `/functions/nom` |
| Format de la fonction | `exports.handler` | `export async function onRequestPost` |
| Variable d'env | Netlify dashboard | Cloudflare dashboard |

Ces changements sont déjà appliqués dans les fichiers fournis.
