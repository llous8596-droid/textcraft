import crypto from 'crypto';
import { kvGet } from './_kv.js';

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
  if (user.plan !== 'pro' && !isTestAccount) {
    return res.status(403).json({ error: 'Le calendrier est reserve aux membres Pro.' });
  }

  const { name, sector, description, tone, month, year, extra, count } = req.body;
  if (!name || !sector || !description) return res.status(400).json({ error: 'Champs manquants' });

  const toneDesc = {
    chaleureux: 'chaleureux, humain et bienveillant',
    professionnel: 'professionnel, serieux et fiable',
    fun: 'fun, decontracte et jeune',
    luxe: 'haut de gamme, elegant et raffine',
    local: 'ancre localement, proche des gens du quartier'
  };

  const monthNames = ['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];
  const monthName = monthNames[month || new Date().getMonth()];
  const currentYear = year || new Date().getFullYear();
  const postsCount = Math.min(parseInt(count) || 12, 20);

  // Calculate evenly spread days
  const daysInMonth = new Date(currentYear, (month||new Date().getMonth()) + 1, 0).getDate();
  const interval = Math.floor(daysInMonth / postsCount);
  const days = Array.from({length: postsCount}, (_, i) => Math.min(1 + i * interval, daysInMonth));

  const themes = [
    'Presentation produit phare',
    'Coulisses / behind the scenes',
    'Temoignage client',
    'Conseil utile du secteur',
    'Promotion ou offre speciale',
    'Histoire du fondateur',
    'FAQ client frequente',
    'Nouveaute ou actualite',
    'Post saisonnier',
    'Question engageante aux abonnes',
    'Comparaison avant/apres',
    'Top 3 conseils',
    'Presentation equipe',
    'Valeurs de la marque',
    'Recette / tutoriel',
    'Inspiration / citation',
    'Collaboration / partenariat',
    'Concours ou jeu',
    'Bilan et resultats',
    'Teaser nouveaute'
  ];

  const prompt = `Tu es un expert en marketing Instagram pour les petites entreprises francaises.

Cree un calendrier de ${postsCount} posts Instagram pour ${monthName} ${currentYear} :
- Business : ${name}
- Secteur : ${sector}
- Description : ${description}${extra ? '\n- Details : ' + extra : ''}
- Ton : ${toneDesc[tone || 'chaleureux']}

Jours de publication : ${days.join(', ')}
Themes a utiliser (varies) : ${themes.slice(0, postsCount).join(', ')}

Reponds UNIQUEMENT en JSON sans markdown :
{"posts":[{"day":1,"theme":"Nom du theme","content":"Texte complet du post avec emojis et hashtags (100-150 mots)"}]}

IMPORTANT : 
- Chaque post doit etre COMPLET et pret a publier
- Varier les themes et les formats
- Inclure 3-5 hashtags pertinents par post
- Adapter au secteur ${sector} specifiquement`;

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
    text = text.replace(/```json|```/g, '').trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('JSON invalide');
    text = text.slice(jsonStart, jsonEnd + 1);

    let parsed;
    try { parsed = JSON.parse(text); }
    catch(e) { parsed = JSON.parse(text.replace(/\n/g, ' ')); }

    return res.status(200).json({ posts: parsed.posts, month: monthName, year: currentYear });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
