import { kvGet, kvKeys } from './_kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // Admin secret check
  const adminSecret = req.headers['x-admin-secret'];
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

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
          hasProfile: !!user.profile,
          stripeCustomerId: user.stripeCustomerId || null
        });
      }
    }

    const total = users.length;
    const verified = users.filter(u => u.verified).length;
    const pro = users.filter(u => u.plan === 'pro').length;
    const free = users.filter(u => u.plan === 'free').length;
    const mrr = pro * 9;

    // New users last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newThisWeek = users.filter(u => u.createdAt > sevenDaysAgo).length;

    // Sort by creation date
    users.sort((a, b) => b.createdAt - a.createdAt);

    return res.status(200).json({
      stats: { total, verified, pro, free, mrr, newThisWeek },
      users: users.slice(0, 100)
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
