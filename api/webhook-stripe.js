// Webhook Stripe → active premium dans Supabase
// Sans SDK stripe - vérification signature manuelle
const SB_URL = 'https://bltrsrpxrrqcjvbwuxbw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

async function sbUpsert(table, data) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_SERVICE_KEY,
      'Authorization': `Bearer ${SB_SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(data)
  });
  return r.ok;
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Verification de signature Stripe (HMAC-SHA256 sur "<timestamp>.<corps brut>"), obligatoire.
// Tolerance de 5 minutes sur l'horodatage (anti-rejeu), comparaison en temps constant, plusieurs signatures v1 acceptees.
const SIGNATURE_TOLERANCE_SECONDS = 300;
async function verifyStripeSignature(rawBody, signature, secret, nowMs) {
  try {
    if (!rawBody || !signature || !secret) return false;
    const crypto = require('crypto');
    let timestamp = '';
    const sigs = [];
    for (const part of String(signature).split(',')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
      if (k === 't') timestamp = v;
      if (k === 'v1') sigs.push(v);
    }
    if (!/^\d+$/.test(timestamp) || sigs.length === 0) return false;
    const age = Math.abs(((nowMs === undefined ? Date.now() : nowMs) / 1000) - Number(timestamp));
    if (!(age <= SIGNATURE_TOLERANCE_SECONDS)) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
    return sigs.some(function(sig) {
      if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
      return crypto.timingSafeEqual(expected, Buffer.from(sig, 'hex'));
    });
  } catch(e) { return false; }
}

// Activation serveur du droit Premium (seule source fiable : le navigateur ne doit plus s'activer lui-meme).
// Inerte tant que STRIPE_PRODUCT_MAP et SUPABASE_URL ne sont pas definis dans Vercel.
// STRIPE_PRODUCT_MAP = {"plink_XXXX":"premium_training","plink_YYYY":"pack",...} (identifiants des Payment Links Stripe).
const ACTIVATABLE_COLUMNS = ['premium_training', 'premium_nutrition', 'premium_progress', 'pack'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function productMap() {
  try { const m = JSON.parse(process.env.STRIPE_PRODUCT_MAP || '{}'); return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; } catch(e) { return {}; }
}
async function activateProduct(session) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  const userId = session && session.client_reference_id;
  const column = Object.prototype.hasOwnProperty.call(productMap(), session && session.payment_link) ? productMap()[session.payment_link] : null;
  if (!url || !key || !column) return 'skipped';
  if (!ACTIVATABLE_COLUMNS.includes(column) || !UUID_RE.test(String(userId || ''))) return 'skipped';
  const r = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}`, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ [column]: true })
  });
  console.log('Activation', column, 'pour', userId, r.ok ? 'OK' : 'ECHEC ' + r.status);
  return r.ok ? 'ok' : 'failed';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['stripe-signature'];

  // Signature obligatoire : sans secret configure ou sans signature valide, la requete est refusee.
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET manquant : webhook refuse');
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  const valid = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  if (!valid) return res.status(400).json({ error: 'Invalid signature' });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch(e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const obj = event && event.data && event.data.object;
  if (!obj) return res.status(400).json({ error: 'Invalid event' });
  const email = obj.customer_email || obj.customer_details?.email;
  const customerId = obj.customer;

  let activation = 'skipped';
  if (event.type === 'checkout.session.completed') {
    try { activation = await activateProduct(obj); } catch(e) { console.error('Activation error:', e && e.message); activation = 'failed'; }
  }

  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    if (email) {
      const periodEnd = obj.current_period_end
        ? new Date(obj.current_period_end * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Mettre à jour table subscriptions
      await sbUpsert('subscriptions', {
        email: email.toLowerCase(),
        status: 'premium',
        plan: (obj.amount_total === 499 || obj.total === 499) ? 'monthly' : 'yearly',
        stripe_customer_id: customerId,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString()
      });

      // Mettre à jour table profiles
      await sbUpsert('profiles', {
        email: email.toLowerCase(),
        premium: true,
        updated_at: new Date().toISOString()
      });

      console.log('Premium activated for:', email);
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    if (email) {
      await sbUpsert('subscriptions', {
        email: email.toLowerCase(),
        status: 'free',
        updated_at: new Date().toISOString()
      });
      await sbUpsert('profiles', {
        email: email.toLowerCase(),
        premium: false,
        updated_at: new Date().toISOString()
      });
      console.log('Premium revoked for:', email);
    }
  }

  // Echec d'activation : repondre 500 pour que Stripe reessaie (le client a paye).
  if (activation === 'failed') return res.status(500).json({ error: 'Activation failed' });
  res.status(200).json({ received: true });
}

export const config = { api: { bodyParser: false } };
