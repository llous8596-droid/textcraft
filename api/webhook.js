import crypto from 'crypto';

const users = global._users || (global._users = {});

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Vérification signature Stripe
  if (webhookSecret) {
    try {
      const parts = sig.split(',');
      const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
      const v1 = parts.find(p => p.startsWith('v1=')).split('=')[1];
      const payload = `${timestamp}.${rawBody}`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
      if (expected !== v1) return res.status(400).json({ error: 'Signature invalide' });
    } catch {
      return res.status(400).json({ error: 'Erreur vérification signature' });
    }
  }

  const event = JSON.parse(rawBody.toString());

  // Abonnement activé → passer l'utilisateur en Pro
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.metadata?.email || session.customer_email;

    if (email && users[email]) {
      users[email].plan = 'pro';
      users[email].credits = 999999;
      users[email].stripeCustomerId = session.customer;
      users[email].stripeSubscriptionId = session.subscription;
      console.log(`✅ ${email} passé en Pro`);
    }
  }

  // Abonnement annulé → repasser en Free
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const email = Object.keys(users).find(k => users[k].stripeSubscriptionId === sub.id);
    if (email) {
      users[email].plan = 'free';
      users[email].credits = 5;
      console.log(`⚠️ ${email} repassé en Free`);
    }
  }

  return res.status(200).json({ received: true });
}
