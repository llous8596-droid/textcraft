import crypto from 'crypto';
import { kv } from '@vercel/kv';

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

  if (webhookSecret) {
    try {
      const parts = sig.split(',');
      const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
      const v1 = parts.find(p => p.startsWith('v1=')).split('=')[1];
      const expected = crypto.createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`).digest('hex');
      if (expected !== v1) return res.status(400).json({ error: 'Signature invalide' });
    } catch {
      return res.status(400).json({ error: 'Erreur signature' });
    }
  }

  const event = JSON.parse(rawBody.toString());

  // Paiement réussi → passer en Pro
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.metadata?.email || session.customer_email;

    if (email) {
      const user = await kv.get(`user:${email}`);
      if (user) {
        user.plan = 'pro';
        user.credits = 999999;
        user.stripeCustomerId = session.customer;
        user.stripeSubscriptionId = session.subscription;
        await kv.set(`user:${email}`, user);
        console.log(`✅ ${email} → Pro`);
      }
    }
  }

  // Abonnement annulé → repasser en Free
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    // Cherche l'utilisateur par subscriptionId
    const keys = await kv.keys('user:*');
    for (const key of keys) {
      const user = await kv.get(key);
      if (user?.stripeSubscriptionId === sub.id) {
        user.plan = 'free';
        user.credits = 5;
        await kv.set(key, user);
        console.log(`⚠️ ${user.email} → Free`);
        break;
      }
    }
  }

  return res.status(200).json({ received: true });
}
