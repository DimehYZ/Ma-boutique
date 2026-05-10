// functions/stripe-webhook.js
// Cloudflare Pages Function — POST /stripe-webhook
// Écoute les événements Stripe et envoie les emails via Resend (https://resend.com)
//
// Variables d'environnement requises dans Cloudflare Pages Settings :
//   STRIPE_SECRET_KEY       — sk_live_... ou sk_test_...
//   STRIPE_WEBHOOK_SECRET   — whsec_... (depuis Stripe Dashboard > Webhooks)
//   RESEND_API_KEY          — re_... (depuis resend.com)
//   SELLER_EMAIL            — ton email pour recevoir les commandes
//   FROM_EMAIL              — ex: commandes@medahshop.fr (domaine vérifié sur Resend)
//   BRAND_NAME              — ex: Medah Shop
//   SHOP_URL                — ex: https://medahshop.fr

export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await request.text();
  const sig  = request.headers.get("stripe-signature");

  // ── Vérifier la signature Stripe ─────────────────────────────────────────
  let event;
  try {
    event = await verifyStripeWebhook(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature invalide:", err.message);
    return new Response("Signature invalide", { status: 400 });
  }

  // ── Traiter l'événement ──────────────────────────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Vérifier que le paiement est bien capturé
    if (session.payment_status !== "paid") {
      return new Response("OK — paiement non encore capturé", { status: 200 });
    }

    try {
      await handlePaymentSuccess(session, env);
    } catch (err) {
      console.error("Erreur handlePaymentSuccess:", err);
      // On retourne 200 quand même pour éviter que Stripe retry en boucle
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Traitement commande réussie ───────────────────────────────────────────────
async function handlePaymentSuccess(session, env) {
  // Récupérer les détails complets de la session (avec line_items)
  const fullSession = await stripeGet(
    `checkout/sessions/${session.id}?expand[]=line_items&expand[]=customer_details&expand[]=shipping_cost.shipping_rate`,
    env.STRIPE_SECRET_KEY
  );

  // ── Infos client ─────────────────────────────────────────────────────────
  const customer = fullSession.customer_details || {};
  const shipping  = fullSession.shipping_details || {};
  const addr      = shipping.address || customer.address || {};

  const clientName  = customer.name || shipping.name || "Client";
  const clientEmail = customer.email || "";
  const phone       = customer.phone || "—";

  const adresseFormatted = [
    addr.line1,
    addr.line2,
    addr.postal_code && addr.city ? `${addr.postal_code} ${addr.city}` : addr.city,
    addr.country,
  ].filter(Boolean).join(", ");

  // ── Mode de livraison ─────────────────────────────────────────────────────
  const shippingRate = fullSession.shipping_cost?.shipping_rate;
  const shippingName = typeof shippingRate === "object"
    ? shippingRate.display_name
    : "—";
  const shippingMode = shippingName.includes("relais") ? "relay" : "home";

  // ── Produits achetés ──────────────────────────────────────────────────────
  // Récupérer depuis les métadonnées (plus fiable que line_items pour les tailles)
  let products = [];
  try {
    const meta = JSON.parse(fullSession.metadata?.order_items || "[]");
    products = meta;
  } catch {
    // Fallback : utiliser les line_items Stripe
    products = (fullSession.line_items?.data || []).map(item => ({
      name: item.description || item.price?.product?.name || "Produit",
      size: "—",
      qty: item.quantity,
      price: (item.price?.unit_amount || 0) / 100,
    }));
  }

  // ── Total ─────────────────────────────────────────────────────────────────
  const totalCents = fullSession.amount_total || 0;
  const total      = (totalCents / 100).toFixed(2);
  const orderId    = fullSession.id;
  const orderDate  = new Date().toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  // ── Envoyer l'email au vendeur ────────────────────────────────────────────
  await sendEmail(env.RESEND_API_KEY, {
    from: `${env.BRAND_NAME || "Medah Shop"} <${env.FROM_EMAIL}>`,
    to: env.SELLER_EMAIL,
    subject: `🛍️ Nouvelle commande #${orderId.slice(-8).toUpperCase()} — ${total}€`,
    html: buildSellerEmail({
      orderId, orderDate, clientName, clientEmail, phone,
      adresseFormatted, shippingName, shippingMode,
      products, total,
    }),
  });

  // ── Envoyer l'email au client ─────────────────────────────────────────────
  if (clientEmail) {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${env.BRAND_NAME || "Medah Shop"} <${env.FROM_EMAIL}>`,
      to: clientEmail,
      subject: `Merci pour ta commande ! 🎉 #${orderId.slice(-8).toUpperCase()}`,
      html: buildClientEmail({
        orderId, orderDate, clientName,
        adresseFormatted, shippingName, shippingMode,
        products, total,
        shopUrl: env.SHOP_URL || "https://medahshop.fr",
        brandName: env.BRAND_NAME || "Medah Shop",
        sellerEmail: env.SELLER_EMAIL,
      }),
    });
  }
}

// ── Email vendeur ─────────────────────────────────────────────────────────────
function buildSellerEmail({ orderId, orderDate, clientName, clientEmail, phone, adresseFormatted, shippingName, shippingMode, products, total }) {
  const productsRows = products.map(p => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0e8ff;">${p.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0e8ff;text-align:center;">${p.size || "—"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0e8ff;text-align:center;">${p.qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0e8ff;text-align:right;">${((p.price || 0) * (p.qty || 1)).toFixed(2)}€</td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#F8F5FF;font-family:'Nunito',Arial,sans-serif;">
<div style="max-width:620px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(123,47,213,0.12);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#FF0B8C,#7B2FD5,#2B6EFF);padding:32px 40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:1.8rem;font-weight:700;letter-spacing:-0.01em;">🛍️ Nouvelle commande !</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Commande #${orderId.slice(-8).toUpperCase()} · ${orderDate}</p>
  </div>

  <div style="padding:32px 40px;">

    <!-- Infos client -->
    <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:#120B2E;">👤 Infos client</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
      <tr><td style="padding:6px 0;color:#6B7280;width:140px;">Nom</td><td style="padding:6px 0;font-weight:600;color:#120B2E;">${clientName}</td></tr>
      <tr><td style="padding:6px 0;color:#6B7280;">Email</td><td style="padding:6px 0;font-weight:600;color:#120B2E;"><a href="mailto:${clientEmail}" style="color:#7B2FD5;">${clientEmail}</a></td></tr>
      <tr><td style="padding:6px 0;color:#6B7280;">Téléphone</td><td style="padding:6px 0;font-weight:600;color:#120B2E;">${phone}</td></tr>
      <tr><td style="padding:6px 0;color:#6B7280;">Adresse</td><td style="padding:6px 0;font-weight:600;color:#120B2E;">${adresseFormatted || "—"}</td></tr>
      <tr><td style="padding:6px 0;color:#6B7280;">Livraison</td><td style="padding:6px 0;font-weight:600;color:#7B2FD5;">${shippingName}</td></tr>
    </table>

    <!-- Produits -->
    <h2 style="margin:0 0 12px;font-size:1rem;font-weight:700;color:#120B2E;">📦 Articles commandés</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#F8F5FF;border-radius:12px;overflow:hidden;">
      <thead>
        <tr style="background:linear-gradient(135deg,#FFD6F0,#E8D5FF);">
          <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#7B2FD5;">Produit</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#7B2FD5;">Taille</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#7B2FD5;">Qté</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#7B2FD5;">Total</th>
        </tr>
      </thead>
      <tbody>${productsRows}</tbody>
      <tfoot>
        <tr style="background:#E8D5FF;">
          <td colspan="3" style="padding:12px;font-weight:700;font-size:1rem;color:#120B2E;">TOTAL PAYÉ</td>
          <td style="padding:12px;font-weight:700;font-size:1.1rem;color:#7B2FD5;text-align:right;">${total}€</td>
        </tr>
      </tfoot>
    </table>

    <!-- Action -->
    <div style="background:linear-gradient(135deg,#FFD6F0,#E8D5FF);border-radius:14px;padding:20px;text-align:center;margin-top:8px;">
      <p style="margin:0 0 12px;font-weight:700;color:#120B2E;">✅ Commande prête à préparer !</p>
      <p style="margin:0;font-size:13px;color:#6B7280;">Une fois le colis expédié, utilise l'interface admin pour envoyer le lien de suivi au client.</p>
    </div>

  </div>

  <div style="padding:20px 40px;background:#F8F5FF;text-align:center;font-size:12px;color:#6B7280;">
    Medah Shop · Commande reçue automatiquement via Stripe
  </div>
</div>
</body></html>`;
}

// ── Email client ──────────────────────────────────────────────────────────────
function buildClientEmail({ orderId, orderDate, clientName, adresseFormatted, shippingName, shippingMode, products, total, shopUrl, brandName, sellerEmail }) {
  const productsRows = products.map(p => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0e8ff;">
        <strong style="color:#120B2E;">${p.name}</strong><br>
        <span style="font-size:12px;color:#6B7280;">Taille : ${p.size || "—"} · Qté : ${p.qty}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0e8ff;text-align:right;font-weight:700;color:#7B2FD5;">${((p.price || 0) * (p.qty || 1)).toFixed(2)}€</td>
    </tr>
  `).join("");

  const shippingIcon = shippingMode === "relay" ? "📦" : "🚪";

  return `
<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#F8F5FF;font-family:'Nunito',Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(123,47,213,0.12);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#FF0B8C,#7B2FD5,#2B6EFF);padding:40px;text-align:center;">
    <div style="font-size:3rem;margin-bottom:12px;">🎉</div>
    <h1 style="margin:0;color:#fff;font-size:1.8rem;font-weight:700;">Merci ${clientName} !</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,0.9);font-size:15px;">Ta commande a bien été reçue et est en cours de préparation 💜</p>
  </div>

  <div style="padding:36px 40px;">

    <!-- Récap commande -->
    <div style="background:#F8F5FF;border-radius:16px;padding:20px 24px;margin-bottom:28px;">
      <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#6B7280;font-weight:700;">N° de commande</p>
      <p style="margin:0;font-size:1.4rem;font-weight:700;color:#7B2FD5;font-family:'Fredoka',Arial,sans-serif;">#${orderId.slice(-8).toUpperCase()}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#6B7280;">${orderDate}</p>
    </div>

    <!-- Produits -->
    <h2 style="margin:0 0 14px;font-size:1rem;font-weight:700;color:#120B2E;">🛍️ Tes articles</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:28px;background:#F8F5FF;border-radius:14px;overflow:hidden;">
      <tbody>${productsRows}</tbody>
      <tfoot>
        <tr style="background:linear-gradient(135deg,#FFD6F0,#E8D5FF);">
          <td style="padding:14px 12px;font-weight:700;color:#120B2E;font-size:1rem;">Total payé</td>
          <td style="padding:14px 12px;text-align:right;font-weight:700;font-size:1.2rem;color:#7B2FD5;">${total}€</td>
        </tr>
      </tfoot>
    </table>

    <!-- Livraison -->
    <h2 style="margin:0 0 14px;font-size:1rem;font-weight:700;color:#120B2E;">🚚 Livraison</h2>
    <div style="background:linear-gradient(135deg,#FFD6F0,#E8D5FF,#D0E4FF);border-radius:14px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-weight:700;font-size:1rem;color:#120B2E;">${shippingIcon} ${shippingName}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">📍 ${adresseFormatted || "—"}</p>
      <p style="margin:12px 0 0;font-size:13px;color:#7B2FD5;font-weight:700;">⏱️ Délai estimé : 9 à 15 jours ouvrés</p>
    </div>

    <!-- Prochaines étapes -->
    <h2 style="margin:0 0 14px;font-size:1rem;font-weight:700;color:#120B2E;">✅ Et maintenant ?</h2>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px;">
      <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;background:#F8F5FF;border-radius:12px;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FF0B8C,#7B2FD5);color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">1</div>
        <div><strong style="display:block;color:#120B2E;margin-bottom:2px;">Préparation de ton colis</strong><span style="font-size:13px;color:#6B7280;">Notre équipe prépare ta commande avec soin.</span></div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;background:#F8F5FF;border-radius:12px;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FF0B8C,#7B2FD5);color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">2</div>
        <div><strong style="display:block;color:#120B2E;margin-bottom:2px;">Expédition de ton colis</strong><span style="font-size:13px;color:#6B7280;">Tu recevras un email avec ton lien de suivi dès l'expédition.</span></div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;background:#F8F5FF;border-radius:12px;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FF0B8C,#7B2FD5);color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">3</div>
        <div><strong style="display:block;color:#120B2E;margin-bottom:2px;">Réception dans 9 à 15 jours</strong><span style="font-size:13px;color:#6B7280;">Ton colis arrive chez toi ou en point relais !</span></div>
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${shopUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF0B8C,#7B2FD5,#2B6EFF);color:#fff;text-decoration:none;font-weight:700;font-size:1rem;padding:14px 36px;border-radius:14px;box-shadow:0 8px 24px rgba(123,47,213,0.35);">
        🛍️ Continuer mes achats
      </a>
    </div>

    <!-- Contact -->
    <p style="font-size:13px;color:#6B7280;text-align:center;line-height:1.8;">
      Une question ? Contacte-nous à <a href="mailto:${sellerEmail}" style="color:#7B2FD5;font-weight:600;">${sellerEmail}</a><br>
      On est là pour toi 💜
    </p>

  </div>

  <div style="padding:20px 40px;background:#F8F5FF;text-align:center;">
    <p style="margin:0;font-size:12px;color:#6B7280;">${brandName} · Merci pour ta confiance ✨</p>
  </div>
</div>
</body></html>`;
}

// ── Helper : appel API Stripe ─────────────────────────────────────────────────
async function stripeGet(path, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`Stripe GET ${path} failed: ${res.status}`);
  return res.json();
}

// ── Helper : envoi email via Resend ──────────────────────────────────────────
async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return res.json();
}

// ── Vérification signature Stripe (HMAC-SHA256) ────────────────────────────
// Implémentation native sans librairie externe pour Cloudflare Workers
async function verifyStripeWebhook(payload, sigHeader, secret) {
  if (!sigHeader || !secret) throw new Error("Signature ou secret manquant");

  // Extraire timestamp et signatures
  const parts = Object.fromEntries(sigHeader.split(",").map(p => p.split("=")));
  const timestamp = parts.t;
  const signatures = sigHeader.split(",")
    .filter(p => p.startsWith("v1="))
    .map(p => p.slice(3));

  if (!timestamp || signatures.length === 0) throw new Error("Header stripe-signature invalide");

  // Vérifier que le timestamp n'est pas trop ancien (5 min)
  const tolerance = 300;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > tolerance) {
    throw new Error("Timestamp trop ancien — possible replay attack");
  }

  // Calculer HMAC-SHA256
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const valid = signatures.some(sig => {
    // Comparaison en temps constant
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });

  if (!valid) throw new Error("Signature HMAC invalide");

  return JSON.parse(payload);
}
