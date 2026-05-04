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

    const line_items = produits.map((produit) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: produit.nom || produit.name || "Produit",
        },
        unit_amount: Math.round((produit.prix || produit.price || 0) * 100),
      },
      quantity: produit.qty || produit.quantity || 1,
    }));

    const origin = new URL(request.url).origin;

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeStripeBody({
        payment_method_types: ["card"],
        mode: "payment",
        success_url: `${origin}/success.html`,
        cancel_url: `${origin}/`,
        line_items,
      }),
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      throw new Error(session.error?.message || "Erreur Stripe");
    }

    return new Response(JSON.stringify({ url: session.url }), {
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

function encodeStripeBody(obj, prefix = "") {
  return Object.entries(obj)
    .flatMap(([key, value]) => {
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      if (Array.isArray(value)) {
        return value.flatMap((item, i) =>
          typeof item === "object"
            ? encodeStripeBody(item, `${fullKey}[${i}]`).split("&")
            : [`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(item)}`]
        );
      } else if (typeof value === "object" && value !== null) {
        return encodeStripeBody(value, fullKey).split("&");
      } else {
        return [`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`];
      }
    })
    .join("&");
}
