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
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.JWT_SECRET || 'textcraft-secret-change-me';
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyJWT(token, secret);
  if (!payload) return res.status(401).json({ error: 'Non authentifié' });

  const email = payload.email;

  // GET history
  if (req.method === 'GET') {
    const history = await kvGet(`history:${email}`) || [];
    return res.status(200).json({ history });
  }

  // POST - save new entry
  if (req.method === 'POST') {
    const { format, text, bizName, topic } = req.body;
    if (!format || !text) return res.status(400).json({ error: 'Champs manquants' });

    const history = await kvGet(`history:${email}`) || [];
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      format, text, bizName: bizName || '',
      topic: topic || '', createdAt: Date.now()
    };

    // Keep last 50 entries
    history.unshift(entry);
    if (history.length > 50) history.splice(50);
    await kvSet(`history:${email}`, history);

    return res.status(200).json({ entry });
  }

  // DELETE - remove one entry
  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID manquant' });
    const history = await kvGet(`history:${email}`) || [];
    const filtered = history.filter(e => e.id !== id);
    await kvSet(`history:${email}`, filtered);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
