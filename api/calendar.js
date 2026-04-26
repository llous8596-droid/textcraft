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

const THEMES = [
  'Présentation du produit phare',
  'Coulisses / behind the scenes',
  'Témoignage client imaginé',
  'Conseil utile lié à votre secteur',
  'Promotion ou offre spéciale',
  'Histoire de l\'équipe ou du fondateur',
  'FAQ — question fréquente client',
  'Nouveauté ou actualité',
  'Post saisonnier / événement du mois',
  'Engagement communauté — question aux abonnés',
];

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

  // Calendrier = feature Pro uniquement
  if (user.plan !== 'pro') {
    return res.status(403).json({ error: 'Le calendrier de contenu est réservé aux membres Pro.' });
  }

  const { name, sector, description, tone, month, year, extra } = req.body;
  if (!name || !sector || !description) return res.status(400).json({ error: 'Champs manquants' });

  const toneDesc = {
    chaleureux: 'chaleureux, humain et bienveillant',
    professionnel: 'professionnel, sérieux et fiable',
    fun: 'fun, décontracté et jeune',
    luxe: 'haut de gamme, élégant et raffiné',
    local: 'ancré localement, proche des gens du quartier'
  };

  const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const monthName = monthNames[(month || new Date().getMonth())];
  const currentYear = year || new Date().getFullYear();

  const prompt = `Tu es un expert en marketing pour les petites entreprises françaises.

Génère un calendrier de contenu Instagram pour le mois de ${monthName} ${currentYear} pour ce business :
- Nom : ${name}
- Secteur : ${sector}
- Description : ${description}${extra ? '\n- Infos supplémentaires : ' + extra : ''}
- Ton : ${toneDesc[tone || 'chaleureux']}

Génère exactement 12 posts Instagram pour le mois (environ 3 par semaine).
Pour chaque post, utilise un thème différent parmi : ${THEMES.join(', ')}.

Réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, avec ce format exact :
{
  "posts": [
    {
      "day": 1,
      "theme": "Présentation du produit phare",
      "content": "texte complet du post avec emojis et hashtags"
    }
  ]
}

Les jours doivent être répartis sur tout le mois (ex: 1, 3, 6, 8, 10, 13, 15, 17, 20, 22, 24, 27).
Chaque post doit faire entre 80 et 150 mots avec 3-5 hashtags.`;

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
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Erreur API');
    }

    const data = await response.json();
    let text = data.content?.map(b => b.text || '').join('') || '';

    // Clean JSON
    text = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);

    return res.status(200).json({ posts: parsed.posts, month: monthName, year: currentYear });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
