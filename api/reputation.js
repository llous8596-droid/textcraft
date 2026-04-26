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

  const { type, review, rating, platform, bizName, bizSector, tone } = req.body;
  if (!type || !review || !bizName) return res.status(400).json({ error: 'Champs manquants' });

  const toneDesc = {
    chaleureux: 'chaleureux, humain et bienveillant',
    professionnel: 'professionnel, sérieux et sobre',
    fun: 'fun, décontracté et jeune',
    luxe: 'haut de gamme, élégant et raffiné',
    local: 'ancré localement, proche des gens du quartier'
  };

  const ratingStars = rating ? `${rating}/5 étoiles` : '';
  const platformName = platform === 'google' ? 'Google' : platform === 'instagram' ? 'Instagram' : platform;

  let prompt = '';

  if (type === 'positive') {
    prompt = `Tu es un expert en gestion de réputation pour les petites entreprises françaises.

Un client a laissé un avis POSITIF ${ratingStars} sur ${platformName} pour "${bizName}" (${bizSector || 'commerce'}).

Avis du client : "${review}"

Écris une réponse ${toneDesc[tone || 'chaleureux']} qui :
- Remercie sincèrement le client en personnalisant selon son avis
- Rebondit sur un détail spécifique qu'il a mentionné
- Invite subtilement à revenir ou à partager
- Fait entre 50 et 80 mots maximum
- Ne commence PAS par "Merci pour votre avis"

Réponds UNIQUEMENT avec le texte de la réponse, prêt à copier-coller.`;
  }

  else if (type === 'negative') {
    prompt = `Tu es un expert en gestion de réputation pour les petites entreprises françaises.

Un client a laissé un avis NÉGATIF ${ratingStars} sur ${platformName} pour "${bizName}" (${bizSector || 'commerce'}).

Avis du client : "${review}"

Écris une réponse professionnelle et apaisante qui :
- Reconnaît le problème sans se défendre agressivement
- S'excuse sincèrement pour l'expérience négative
- Propose une solution concrète ou invite à reprendre contact
- Montre que vous prenez les retours au sérieux
- Reste entre 60 et 100 mots
- Ton : ${toneDesc[tone || 'professionnel']}

Réponds UNIQUEMENT avec le texte de la réponse, prêt à copier-coller.`;
  }

  else if (type === 'neutral') {
    prompt = `Tu es un expert en gestion de réputation pour les petites entreprises françaises.

Un client a laissé un avis NEUTRE/MITIGÉ ${ratingStars} sur ${platformName} pour "${bizName}" (${bizSector || 'commerce'}).

Avis du client : "${review}"

Écris une réponse ${toneDesc[tone || 'chaleureux']} qui :
- Remercie pour le retour honnête
- Reconnaît les points à améliorer sans être défensif
- Met en valeur les points positifs mentionnés
- Invite à revenir pour une meilleure expérience
- Reste entre 60 et 90 mots

Réponds UNIQUEMENT avec le texte de la réponse, prêt à copier-coller.`;
  }

  else if (type === 'comment_instagram') {
    prompt = `Tu es un expert en gestion de communauté Instagram pour les petites entreprises françaises.

Un utilisateur a commenté sur le compte Instagram de "${bizName}" (${bizSector || 'commerce'}).

Commentaire : "${review}"

Écris une réponse Instagram ${toneDesc[tone || 'chaleureux']} qui :
- Est courte et naturelle (20-40 mots max)
- Utilise 1-2 emojis pertinents
- Est engageante et donne envie de continuer la conversation
- Correspond au ton d'une vraie marque humaine

Réponds UNIQUEMENT avec le texte de la réponse, prêt à copier-coller.`;
  }

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
        max_tokens: 500,
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
