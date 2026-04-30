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
  const isTestAccount = user.email.includes('+test') || user.email === 'elmehdifares50@gmail.com';
  if (user.plan !== 'pro' && user.credits <= 0) {
    return res.status(403).json({ error: 'Plus de crédits.' });
  }

  const { handle, bizName, sector, description, followers, postsPerWeek } = req.body;
  if (!handle || !sector) return res.status(400).json({ error: 'Champs manquants' });

  const prompt = `Tu es un expert en stratégie Instagram pour les petites entreprises françaises. Tu analyses des comptes et donnes des conseils ultra-concrets et actionnables.

Voici les infos du compte à analyser :
- Compte Instagram : @${handle.replace('@','')}
- Nom du business : ${bizName || handle}
- Secteur : ${sector}
- Description : ${description || 'Non renseignée'}
- Nombre d'abonnés estimé : ${followers || 'Non renseigné'}
- Fréquence de publication : ${postsPerWeek ? postsPerWeek + ' fois par semaine' : 'Non renseignée'}

Génère une analyse stratégique Instagram complète et personnalisée. Réponds UNIQUEMENT en JSON valide sans markdown ni backticks :

{
  "score": 72,
  "score_label": "Bon potentiel",
  "score_color": "orange",
  "summary": "Résumé en 2 phrases de la situation actuelle du compte",
  "strengths": [
    {"title": "Point fort 1", "detail": "Explication concrète"}
  ],
  "improvements": [
    {"title": "Amélioration prioritaire 1", "detail": "Conseil concret et actionnable", "impact": "Fort"}
  ],
  "content_strategy": {
    "best_days": ["Mardi", "Jeudi", "Samedi"],
    "best_times": "19h-21h",
    "frequency": "4-5 posts par semaine",
    "formats": ["Reels courts 15-30s", "Carrousels tutoriels", "Stories quotidiennes"]
  },
  "hashtag_strategy": {
    "recommended": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
    "tip": "Conseil sur la stratégie hashtag pour ce secteur"
  },
  "quick_wins": [
    "Action immédiate 1 à faire aujourd'hui",
    "Action immédiate 2 à faire cette semaine",
    "Action immédiate 3 à faire ce mois"
  ],
  "content_ideas": [
    {"theme": "Idée de contenu 1", "format": "Reel", "why": "Pourquoi ça marche dans ce secteur"},
    {"theme": "Idée de contenu 2", "format": "Carrousel", "why": "Pourquoi ça marche dans ce secteur"},
    {"theme": "Idée de contenu 3", "format": "Post", "why": "Pourquoi ça marche dans ce secteur"}
  ]
}

Le score doit être entre 0 et 100. score_color doit être "green" (80+), "orange" (50-79), ou "red" (0-49).
Génère exactement 3 strengths, 4 improvements, 3 quick_wins et 3 content_ideas.
Tout doit être hyper spécifique au secteur "${sector}", pas des conseils génériques.`;

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Erreur API');
    }

    const data = await response.json();
    let text = data.content?.map(b => b.text || '').join('') || '';

    // Robust JSON extraction
    text = text.replace(/```json|```/g, '').trim();
    // Find the JSON object boundaries
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('Réponse JSON invalide');
    text = text.slice(jsonStart, jsonEnd + 1);

    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch(parseErr) {
      // Try to fix common issues: unescaped apostrophes in strings
      const fixed = text
        .replace(/([^\\])'([^,:{}\[\]"\n])/g, "$1\'$2")
        .replace(/
/g, '\n');
      try {
        analysis = JSON.parse(fixed);
      } catch(e2) {
        throw new Error('Impossible de parser la réponse : ' + parseErr.message);
      }
    }

    if (user.plan !== 'pro' && !isTestAccount) {
      user.credits = Math.max(0, (user.credits || 0) - 1);
      await kvSet(`user:${user.email}`, user);
    }

    return res.status(200).json({ analysis, credits: user.credits, plan: user.plan });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
