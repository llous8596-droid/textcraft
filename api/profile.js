import crypto from 'crypto';
import { kvGet, kvSet } from './_kv.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.JWT_SECRET || 'textcraft-secret-change-me';
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyJWT(token, secret);
  if (!payload) return res.status(401).json({ error: 'Non authentifié' });

  const user = await kvGet(`user:${payload.email}`);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const { action } = req.query;

  // CHANGE PASSWORD
  if (action === 'change-password' && req.method === 'POST') {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Champs manquants' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe trop court' });

    const currentHash = crypto.createHash('sha256').update(currentPassword + secret).digest('hex');
    if (currentHash !== user.hash) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    user.hash = crypto.createHash('sha256').update(newPassword + secret).digest('hex');
    await kvSet(`user:${payload.email}`, user);
    return res.status(200).json({ ok: true });
  }

  // ADD TEAM MEMBER (Pro only)
  if (action === 'add-member' && req.method === 'POST') {
    if (user.plan !== 'pro') return res.status(403).json({ error: 'Fonctionnalité Pro uniquement' });
    const { memberEmail } = req.body;
    if (!memberEmail) return res.status(400).json({ error: 'Email requis' });

    const team = user.team || [];
    if (team.length >= 3) return res.status(400).json({ error: 'Maximum 3 membres d\'équipe' });
    if (team.includes(memberEmail.toLowerCase())) return res.status(400).json({ error: 'Membre déjà ajouté' });

    team.push(memberEmail.toLowerCase().trim());
    user.team = team;
    await kvSet(`user:${payload.email}`, user);

    // Give team member pro access
    const memberUser = await kvGet(`user:${memberEmail.toLowerCase()}`);
    if (memberUser) {
      memberUser.plan = 'pro';
      memberUser.teamOwner = payload.email;
      await kvSet(`user:${memberEmail.toLowerCase()}`, memberUser);
    }

    return res.status(200).json({ team });
  }

  // REMOVE TEAM MEMBER
  if (action === 'remove-member' && req.method === 'POST') {
    const { memberEmail } = req.body;
    const team = user.team || [];
    user.team = team.filter(e => e !== memberEmail?.toLowerCase());
    await kvSet(`user:${payload.email}`, user);

    // Revoke pro access
    const memberUser = await kvGet(`user:${memberEmail?.toLowerCase()}`);
    if (memberUser && memberUser.teamOwner === payload.email) {
      memberUser.plan = 'free';
      memberUser.credits = 5;
      memberUser.teamOwner = null;
      await kvSet(`user:${memberEmail.toLowerCase()}`, memberUser);
    }

    return res.status(200).json({ team: user.team });
  }

  // GET PROFILE INFO
  if (req.method === 'GET') {
    return res.status(200).json({
      email: user.email,
      plan: user.plan,
      credits: user.credits,
      profile: user.profile || null,
      team: user.team || [],
      createdAt: user.createdAt,
      stripeCustomerId: user.stripeCustomerId || null
    });
  }

  return res.status(404).json({ error: 'Action inconnue' });
}
