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

async function verifyStripeSignature(rawBody, signature, secret) {
  try {
    const crypto = require('crypto');
    const parts = signature.split(',');
    let timestamp = '';
    let sig = '';
    for (const part of parts) {
      if (part.startsWith('t=')) timestamp = part.slice(2);
      if (part.startsWith('v1=')) sig = part.slice(3);
    }
    const payload = `${timestamp}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return expected === sig;
  } catch(e) { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['stripe-signature'];

  // Vérifier signature si secret disponible
  if (STRIPE_WEBHOOK_SECRET && signature) {
    const valid = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch(e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const obj = event.data.object;
  const email = obj.customer_email || obj.customer_details?.email;
  const customerId = obj.customer;

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

  res.status(200).json({ received: true });
}

export const config = { api: { bodyParser: false } };
