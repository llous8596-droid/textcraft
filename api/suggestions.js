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
  if (!payload) return res.status(401).json({ error: 'Non authentifié' });

  const user = await kvGet(`user:${payload.email}`);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });

  const { sector, bizName, description } = req.body;
  if (!sector) return res.status(400).json({ error: 'Secteur manquant' });

  const now = new Date();
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const currentMonth = months[now.getMonth()];
  const currentYear = now.getFullYear();

  const prompt = `Tu es un expert en stratégie de contenu Instagram pour les petites entreprises françaises.

Business :
- Nom : ${bizName || 'Non renseigné'}
- Secteur : ${sector}
- Description : ${description || 'Non renseignée'}
- Mois actuel : ${currentMonth} ${currentYear}

Génère 12 idées de posts Instagram ultra-créatives et pertinentes pour ce business ce mois-ci.
Tiens compte des événements saisonniers, fêtes, tendances et actualités de ${currentMonth}.

Réponds UNIQUEMENT en JSON valide sans markdown :
{
  "suggestions": [
    {
      "id": "1",
      "title": "Titre accrocheur de l'idée",
      "description": "Description courte de ce qu'on pourrait poster (2 phrases max)",
      "format": "Reel",
      "category": "Saisonnier",
      "emoji": "🌸",
      "urgency": "Cette semaine"
    }
  ]
}

Les formats possibles : "Reel", "Carrousel", "Post", "Story", "Live".
Les catégories possibles : "Saisonnier", "Tendance", "Coulisses", "Promo", "Éducatif", "Engagement", "Produit".
Les urgences possibles : "Aujourd'hui", "Cette semaine", "Ce mois".
Génère exactement 12 suggestions variées, spécifiques au secteur "${sector}", pas génériques.`;

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
    text = text.replace(/```json|```/g, '').trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('Réponse JSON invalide');
    text = text.slice(jsonStart, jsonEnd + 1);
    let parsed;
    try { parsed = JSON.parse(text); }
    catch(e) {
      const fixed = text.replace(/\n/g, ' ');
      parsed = JSON.parse(fixed);
    }

    return res.status(200).json({ suggestions: parsed.suggestions, month: currentMonth, year: currentYear });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
