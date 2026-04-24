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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.JWT_SECRET || 'textcraft-secret-change-me';
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = token ? verifyJWT(token, secret) : null;
  if (!payload) return res.status(401).json({ error: 'Non authentifié' });

  const user = await kvGet(`user:${payload.email}`);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
  if (user.plan !== 'pro' && user.credits <= 0) {
    return res.status(403).json({ error: 'Plus de crédits. Passez en Pro pour continuer.' });
  }

  const { name, sector, description, format, tone, topic } = req.body;
  if (!name || !sector || !description || !format || !tone) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  const formatInstructions = {
    post_instagram: 'un post Instagram engageant avec emojis et 3-5 hashtags pertinents, environ 150 mots',
    email_client: 'un email client professionnel avec objet, corps et signature, environ 200 mots',
    fiche_produit: 'une fiche produit attractive avec titre accrocheur, description et points forts en bullet points',
    bio_instagram: 'une bio Instagram percutante en 150 caractères maximum avec emojis et call-to-action',
    sms_promo: 'un SMS promotionnel court et percutant, maximum 160 caractères, avec une offre claire',
    google_avis: 'une réponse professionnelle et chaleureuse à un avis Google client, environ 80 mots'
  };

  const toneDesc = {
    chaleureux: 'chaleureux, humain et bienveillant',
    professionnel: 'professionnel, sérieux et fiable',
    fun: 'fun, décontracté et jeune',
    luxe: 'haut de gamme, élégant et raffiné',
    local: 'ancré localement, proche des gens du quartier'
  };

  const prompt = `Tu es un expert en marketing pour les petites entreprises françaises.

Génère ${formatInstructions[format]} pour ce business :
- Nom : ${name}
- Secteur : ${sector}
- Description : ${description}${topic ? '\n- Sujet/occasion : ' + topic : ''}
- Ton : ${toneDesc[tone]}

Réponds UNIQUEMENT avec le texte final prêt à l'emploi. Aucun commentaire, aucune introduction.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Erreur API');
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';

    if (user.plan !== 'pro') {
      user.credits = Math.max(0, (user.credits || 0) - 1);
      await kvSet(`user:${user.email}`, user);
    }

    return res.status(200).json({ text, credits: user.credits, plan: user.plan });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
