import crypto from 'crypto';
import { kvGet, kvSet } from './_kv.js';

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function signJWT(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${header}.${body}.${sig}`;
}
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

  const { action } = req.query;
  const secret = process.env.JWT_SECRET || 'textcraft-secret-change-me';

  // REGISTER
  if (action === 'register' && req.method === 'POST') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });
    const id = email.toLowerCase().trim();
    const existing = await kvGet(`user:${id}`);
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });
    const hash = crypto.createHash('sha256').update(password + secret).digest('hex');
    const user = { email: id, hash, plan: 'free', credits: 5, createdAt: Date.now(), profile: null };
    await kvSet(`user:${id}`, user);
    const token = signJWT({ email: id, plan: 'free' }, secret);
    return res.status(200).json({ token, user: { email: id, plan: 'free', credits: 5, profile: null } });
  }

  // LOGIN
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const id = email.toLowerCase().trim();
    const user = await kvGet(`user:${id}`);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const hash = crypto.createHash('sha256').update(password + secret).digest('hex');
    if (hash !== user.hash) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = signJWT({ email: id, plan: user.plan }, secret);
    return res.status(200).json({ token, user: { email: id, plan: user.plan, credits: user.credits, profile: user.profile || null } });
  }

  // ME
  if (action === 'me' && req.method === 'GET') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const payload = verifyJWT(token, secret);
    if (!payload) return res.status(401).json({ error: 'Token invalide' });
    const user = await kvGet(`user:${payload.email}`);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.status(200).json({ email: user.email, plan: user.plan, credits: user.credits, profile: user.profile || null });
  }

  // SAVE PROFILE
  if (action === 'save-profile' && req.method === 'POST') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const payload = verifyJWT(token, secret);
    if (!payload) return res.status(401).json({ error: 'Non authentifié' });
    const user = await kvGet(`user:${payload.email}`);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { name, sector, description, tone, extra } = req.body;
    if (!name || !sector || !description) return res.status(400).json({ error: 'Champs manquants' });
    user.profile = { name, sector, description, tone: tone || 'chaleureux', extra: extra || '', updatedAt: Date.now() };
    await kvSet(`user:${payload.email}`, user);
    return res.status(200).json({ profile: user.profile });
  }

  return res.status(404).json({ error: 'Action inconnue' });
}
