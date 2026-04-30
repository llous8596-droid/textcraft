import { kvGet, kvSet, kvKeys } from './_kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminSecret = req.headers['x-admin-secret'];
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorise' });
  }

  // POST — modifier un utilisateur
  if (req.method === 'POST') {
    const { email, credits, plan } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });
    const user = await kvGet(`user:${email.toLowerCase()}`);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (credits !== undefined) user.credits = parseInt(credits);
    if (plan) user.plan = plan;
    await kvSet(`user:${email.toLowerCase()}`, user);
    return res.status(200).json({ ok: true, user: { email: user.email, plan: user.plan, credits: user.credits } });
  }

  // GET — dashboard stats
  if (req.method === 'GET') {
    try {
      const keys = await kvKeys('user:*');
      const users = [];
      for (const key of keys) {
        const user = await kvGet(key);
        if (user) {
          users.push({
            email: user.email,
            plan: user.plan,
            credits: user.credits,
            verified: user.verified || false,
            createdAt: user.createdAt,
            hasProfile: !!user.profile
          });
        }
      }
      const total = users.length;
      const verified = users.filter(u => u.verified).length;
      const pro = users.filter(u => u.plan === 'pro').length;
      const free = users.filter(u => u.plan === 'free').length;
      const mrr = pro * 9;
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const newThisWeek = users.filter(u => u.createdAt > sevenDaysAgo).length;
      users.sort((a, b) => b.createdAt - a.createdAt);
      return res.status(200).json({
        stats: { total, verified, pro, free, mrr, newThisWeek },
        users: users.slice(0, 100)
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
