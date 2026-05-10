// functions/create-checkout-session.js
// Cloudflare Pages Function — POST /create-checkout-session
// Gère : panier → Stripe Checkout avec adresse livraison, mode livraison, session_id en retour

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = await request.json();
    const produits = body.produits || body.products || body;

    if (!produits || !Array.isArray(produits) || produits.length === 0) {
      return new Response(JSON.stringify({ error: "Panier vide ou invalide" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // ── Construire les line_items ─────────────────────────────────────────
    const line_items = produits.map((produit) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: produit.nom || produit.name || "Produit",
          // On stocke la taille dans la description pour la retrouver dans le webhook
          description: produit.taille || produit.size
            ? `Taille : ${produit.taille || produit.size}`
            : undefined,
        },
        unit_amount: Math.round((produit.prix || produit.price || 0) * 100),
      },
      quantity: produit.qty || produit.quantity || 1,
    }));

    // ── Métadonnées de commande (produits + tailles sérialisés) ──────────
    // On passe les infos complètes en metadata pour le webhook
    const orderMeta = produits.map(p => ({
      name: p.nom || p.name || "Produit",
      size: p.taille || p.size || "—",
      qty: p.qty || p.quantity || 1,
      price: p.prix || p.price || 0,
    }));

    const origin = new URL(request.url).origin;

    // ── Options de livraison Stripe ───────────────────────────────────────
    // Stripe Checkout supporte les shipping_options nativement
    const shipping_options = [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 0, currency: "eur" },
          display_name: "🚪 Livraison à domicile",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 9 },
            maximum: { unit: "business_day", value: 15 },
          },
          metadata: { mode: "home" },
        },
      },
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 0, currency: "eur" },
          display_name: "📦 Livraison en point relais",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 9 },
            maximum: { unit: "business_day", value: 15 },
          },
          metadata: { mode: "relay" },
        },
      },
    ];

    // ── Créer la session Stripe ───────────────────────────────────────────
    const sessionParams = {
      payment_method_types: ["card"],
      mode: "payment",

      // Collecte adresse de livraison complète
      shipping_address_collection: {
        allowed_countries: [
          "FR", "BE", "LU", "CH", "MC", "DE", "ES", "IT", "NL", "PT",
          "AT", "DK", "FI", "SE", "NO", "IE", "GB", "PL", "CZ", "RO",
          "MA", "TN", "DZ", "SN", "CI", "CM", "RE", "GP", "MQ", "GF",
          "NC", "PF", "US", "CA",
        ],
      },

      // Options de livraison (domicile ou point relais)
      shipping_options,

      // Collecte téléphone client
      phone_number_collection: { enabled: true },

      line_items,

      // URLs de retour — session_id injecté par Stripe automatiquement
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,

      // Métadonnées pour le webhook
      metadata: {
        order_items: JSON.stringify(orderMeta).slice(0, 500), // Stripe limite à 500 chars par valeur
        order_items_full: JSON.stringify(orderMeta).slice(0, 500),
      },
    };

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeStripeBody(sessionParams),
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      throw new Error(session.error?.message || "Erreur Stripe");
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error) {
    console.error("Stripe error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ── Encodeur form-urlencoded récursif pour l'API Stripe ──────────────────────
function encodeStripeBody(obj, prefix = "") {
  const parts = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(encodeStripeBody(item, `${fullKey}[${i}]`));
        } else {
          parts.push(`${enc(fullKey + "[" + i + "]")}=${enc(item)}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(encodeStripeBody(value, fullKey));
    } else {
      parts.push(`${enc(fullKey)}=${enc(value)}`);
    }
  }

  return parts.filter(Boolean).join("&");
}

function enc(v) {
  return encodeURIComponent(String(v));
}
