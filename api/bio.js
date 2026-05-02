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
  if (!payload) return res.status(401).json({ error: 'Non authentifie' });

  const user = await kvGet(`user:${payload.email}`);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });

  const isTestAccount = user.email.includes('+test') || user.email === 'elmehdifares50@gmail.com';
  if (!isTestAccount && user.plan !== 'pro' && user.credits <= 0) {
    return res.status(403).json({ error: 'Plus de credits.' });
  }

  const { name, sector, description, handle, city, tone, extra } = req.body;
  if (!name || !sector) return res.status(400).json({ error: 'Champs manquants' });

  const toneDesc = {
    chaleureux: 'chaleureux et humain',
    professionnel: 'professionnel et serieux',
    fun: 'fun et decontracte',
    luxe: 'haut de gamme et elegant',
    local: 'ancre localement'
  };

  const prompt = `Tu es un expert en marketing Instagram pour les petites entreprises francaises.

Cree un profil Instagram complet et optimise pour ce business :
- Nom : ${name}
- Secteur : ${sector}
- Description : ${description || 'Non renseignee'}
- Handle Instagram : ${handle ? '@'+handle : 'Non renseigne'}
- Ville : ${city || 'France'}
- Ton : ${toneDesc[tone || 'chaleureux']}
${extra ? '- Details supplementaires : ' + extra : ''}

Reponds UNIQUEMENT en JSON valide sans markdown :
{
  "handle_suggestion": "@suggestion_handle",
  "nom_page": "Nom optimal pour la page Instagram",
  "bio": "Bio Instagram complete (150 caracteres max, avec emojis)",
  "bio_extended": "Version longue de la bio (si on a plus de place, 300 caracteres)",
  "accroche": "Phrase d'accroche pour mettre en avant (ex: dans le nom ou la bio)",
  "hashtags_bio": ["#tag1", "#tag2", "#tag3"],
  "call_to_action": "Texte du lien en bio (ex: Reservez maintenant, Decouvrez notre menu...)",
  "story_highlights": ["Titre highlight 1", "Titre highlight 2", "Titre highlight 3", "Titre highlight 4", "Titre highlight 5"],
  "post_pinne": "Idee pour le premier post epingle du compte",
  "tips": ["Conseil 1 specifique au secteur", "Conseil 2", "Conseil 3"]
}`;

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
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Erreur API');
    }

    const data = await response.json();
    let text = data.content?.map(b => b.text || '').join('') || '';
    text = text.replace(/```json|```/g, '').trim();
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('JSON invalide');
    const bio = JSON.parse(text.slice(start, end + 1));

    if (!isTestAccount && user.plan !== 'pro') {
      user.credits = Math.max(0, (user.credits || 0) - 1);
      await kvSet(`user:${user.email}`, user);
    }

    return res.status(200).json({ bio, credits: user.credits, plan: user.plan });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
