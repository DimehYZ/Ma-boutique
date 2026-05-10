// functions/send-shipping-notification.js
// Cloudflare Pages Function — POST /send-shipping-notification
// Appelé depuis l'interface admin quand le colis est expédié
// Envoie l'email de suivi au client
//
// Variables d'environnement requises :
//   STRIPE_SECRET_KEY  — pour récupérer les infos de la commande
//   RESEND_API_KEY     — re_...
//   SELLER_EMAIL       — pour vérifier que la requête vient du vendeur
//   FROM_EMAIL         — ex: commandes@medahshop.fr
//   BRAND_NAME         — ex: Medah Shop
//   ADMIN_SECRET       — un mot de passe secret pour sécuriser l'interface admin
//   SHOP_URL           — ex: https://medahshop.fr

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = await request.json();
    const { adminSecret, sessionId, trackingUrl, trackingCarrier, clientEmail, clientName, orderId } = body;

    // ── Vérification sécurité admin ──────────────────────────────────────────
    if (!adminSecret || adminSecret !== env.ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401, headers: corsHeaders,
      });
    }

    if (!clientEmail || !trackingUrl) {
      return new Response(JSON.stringify({ error: "Email client et lien de suivi requis" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // ── Envoyer l'email de suivi ─────────────────────────────────────────────
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${env.BRAND_NAME || "Medah Shop"} <${env.FROM_EMAIL}>`,
        to: clientEmail,
        subject: `📦 Ton colis est en route ! ${orderId ? `· #${orderId.slice(-8).toUpperCase()}` : ""}`,
        html: buildShippingEmail({
          clientName: clientName || "toi",
          orderId: orderId || "",
          trackingUrl,
          trackingCarrier: trackingCarrier || "Transporteur",
          shopUrl: env.SHOP_URL || "https://medahshop.fr",
          brandName: env.BRAND_NAME || "Medah Shop",
          sellerEmail: env.SELLER_EMAIL,
        }),
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend error: ${errText}`);
    }

    return new Response(JSON.stringify({ success: true, message: "Email de suivi envoyé !" }), {
      status: 200, headers: corsHeaders,
    });

  } catch (err) {
    console.error("send-shipping-notification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
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

// ── Template email de suivi ───────────────────────────────────────────────────
function buildShippingEmail({ clientName, orderId, trackingUrl, trackingCarrier, shopUrl, brandName, sellerEmail }) {
  return `
<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#F8F5FF;font-family:'Nunito',Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(123,47,213,0.12);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#FF0B8C,#7B2FD5,#2B6EFF);padding:40px;text-align:center;">
    <div style="font-size:3.5rem;margin-bottom:14px;">📦</div>
    <h1 style="margin:0;color:#fff;font-size:1.8rem;font-weight:700;">Ton colis est en route !</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,0.9);font-size:15px;">Hey ${clientName}, bonne nouvelle — ça arrive 🚀</p>
  </div>

  <div style="padding:36px 40px;">

    <!-- Message principal -->
    <div style="background:linear-gradient(135deg,#FFD6F0,#E8D5FF,#D0E4FF);border-radius:16px;padding:24px;margin-bottom:28px;text-align:center;">
      <p style="margin:0 0 6px;font-size:1rem;font-weight:700;color:#120B2E;">Ton colis vient d'être expédié !</p>
      ${orderId ? `<p style="margin:4px 0;font-size:13px;color:#6B7280;">Commande #${orderId.slice(-8).toUpperCase()}</p>` : ""}
      <p style="margin:8px 0 0;font-size:13px;color:#7B2FD5;font-weight:600;">Transporteur : ${trackingCarrier}</p>
    </div>

    <!-- CTA Suivi -->
    <div style="text-align:center;margin-bottom:32px;">
      <p style="margin:0 0 16px;font-size:14px;color:#6B7280;">Clique ci-dessous pour suivre ton colis en temps réel :</p>
      <a href="${trackingUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF0B8C,#7B2FD5,#2B6EFF);color:#fff;text-decoration:none;font-weight:700;font-size:1.05rem;padding:16px 40px;border-radius:14px;box-shadow:0 8px 24px rgba(123,47,213,0.35);">
        🔍 Suivre mon colis
      </a>
      <p style="margin:12px 0 0;font-size:12px;color:#6B7280;">Ou copie ce lien : <a href="${trackingUrl}" style="color:#7B2FD5;word-break:break-all;">${trackingUrl}</a></p>
    </div>

    <!-- Infos livraison -->
    <div style="background:#F8F5FF;border-radius:14px;padding:20px 24px;margin-bottom:28px;">
      <h3 style="margin:0 0 12px;font-size:0.95rem;font-weight:700;color:#120B2E;">📍 Informations de livraison</h3>
      <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">• Délai restant estimé : <strong style="color:#120B2E;">quelques jours</strong></p>
      <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">• Transporteur : <strong style="color:#120B2E;">${trackingCarrier}</strong></p>
      <p style="margin:0;font-size:13px;color:#6B7280;">• Le suivi se met à jour en temps réel sur le site du transporteur</p>
    </div>

    <!-- Conseils -->
    <div style="border-left:3px solid #7B2FD5;padding-left:16px;margin-bottom:28px;">
      <p style="margin:0 0 6px;font-size:13px;color:#6B7280;"><strong style="color:#120B2E;">💡 Conseil :</strong> Si tu as choisi la livraison en point relais, pense à te munir d'une pièce d'identité et de ce numéro de commande.</p>
    </div>

    <!-- CTA boutique -->
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${shopUrl}" style="display:inline-block;background:#F8F5FF;border:1.5px solid rgba(123,47,213,0.25);color:#7B2FD5;text-decoration:none;font-weight:700;font-size:0.95rem;padding:12px 28px;border-radius:12px;">
        🛍️ Retour à la boutique
      </a>
    </div>

    <!-- Contact -->
    <p style="font-size:13px;color:#6B7280;text-align:center;line-height:1.8;">
      Une question sur ta livraison ?<br>
      <a href="mailto:${sellerEmail}" style="color:#7B2FD5;font-weight:600;">${sellerEmail}</a> · On répond vite 💜
    </p>

  </div>

  <div style="padding:20px 40px;background:#F8F5FF;text-align:center;">
    <p style="margin:0;font-size:12px;color:#6B7280;">${brandName} · Merci pour ta confiance ✨</p>
  </div>
</div>
</body></html>`;
}
