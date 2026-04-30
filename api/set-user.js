import { kvGet, kvSet } from './_kv.js';

export default async function handler(req, res) {
  // Only allow with admin secret
  const adminSecret = req.headers['x-admin-secret'];
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { email, credits, plan } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const user = await kvGet(`user:${email.toLowerCase()}`);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (credits !== undefined) user.credits = parseInt(credits);
  if (plan) user.plan = plan;

  await kvSet(`user:${email.toLowerCase()}`, user);
  return res.status(200).json({ ok: true, user: { email: user.email, plan: user.plan, credits: user.credits } });
}
