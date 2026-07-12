// Webhook Stripe → active premium dans Supabase
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    // Vérifier signature Stripe
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const session = event.data.object;

  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    const email = session.customer_email || session.customer_details?.email;
    const customerId = session.customer;
    const subscriptionId = session.subscription;
    const periodEnd = session.current_period_end
      ? new Date(session.current_period_end * 1000).toISOString()
      : null;

    if (email) {
      await sbUpsert('subscriptions', {
        email: email.toLowerCase(),
        status: 'premium',
        plan: session.amount_total === 499 ? 'monthly' : 'yearly',
        stripe_customer_id: customerId,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString()
      });
      console.log('Premium activated for:', email);
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    const customerId = session.customer;
    // Récupérer email depuis Stripe
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.email) {
        await sbUpsert('subscriptions', {
          email: customer.email.toLowerCase(),
          status: 'free',
          updated_at: new Date().toISOString()
        });
        console.log('Premium revoked for:', customer.email);
      }
    } catch(e) { console.error(e); }
  }

  res.status(200).json({ received: true });
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export const config = { api: { bodyParser: false } };
