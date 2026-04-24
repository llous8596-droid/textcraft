import crypto from 'crypto';

function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64')
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(body, 'base64').toString());
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.JWT_SECRET || 'textcraft-secret-change-me';
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyJWT(token, secret);
  if (!payload) return res.status(401).json({ error: 'Non authentifié' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe non configuré' });

  const siteUrl = process.env.SITE_URL || 'https://textcraft-sigma.vercel.app';

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'line_items[0][price]': process.env.STRIPE_PRICE_ID,
        'line_items[0][quantity]': '1',
        'customer_email': payload.email,
        'success_url': `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${siteUrl}/`,
        'metadata[email]': payload.email
      })
    });

    const session = await response.json();
    if (session.error) throw new Error(session.error.message);
    return res.status(200).json({ url: session.url });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
