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

  const { handle, bizName, sector, description, followers, postsPerWeek } = req.body;
  if (!handle || !sector) return res.status(400).json({ error: 'Champs manquants' });

  const prompt = `Tu es un expert en strategie Instagram pour les petites entreprises francaises.

Compte a analyser :
- Instagram : @${handle.replace('@','')}
- Business : ${bizName || handle}
- Secteur : ${sector}
- Description : ${description || 'Non renseignee'}
- Abonnes : ${followers || 'Non renseigne'}
- Frequence : ${postsPerWeek ? postsPerWeek + ' fois/semaine' : 'Non renseignee'}

Reponds UNIQUEMENT en JSON valide sans markdown :
{"score":72,"score_label":"Bon potentiel","score_color":"orange","summary":"Resume en 2 phrases","strengths":[{"title":"Point fort","detail":"Detail"}],"improvements":[{"title":"Amelioration","detail":"Conseil actionnable","impact":"Fort"}],"content_strategy":{"best_days":["Mardi","Jeudi"],"best_times":"19h-21h","frequency":"4 posts/semaine","formats":["Reels","Carrousels"]},"hashtag_strategy":{"recommended":["#tag1","#tag2","#tag3"],"tip":"Conseil hashtags"},"quick_wins":["Action 1","Action 2","Action 3"],"content_ideas":[{"theme":"Idee 1","format":"Reel","why":"Pourquoi"},{"theme":"Idee 2","format":"Post","why":"Pourquoi"},{"theme":"Idee 3","format":"Carrousel","why":"Pourquoi"}]}

score_color : "green" (80+), "orange" (50-79), "red" (0-49).
3 strengths, 4 improvements, 3 quick_wins, 3 content_ideas. Specifique au secteur ${sector}.`;

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
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('JSON invalide');
    text = text.slice(jsonStart, jsonEnd + 1);

    let analysis;
    try { analysis = JSON.parse(text); }
    catch(e) { analysis = JSON.parse(text.replace(/\n/g, ' ')); }

    if (!isTestAccount && user.plan !== 'pro') {
      user.credits = Math.max(0, (user.credits || 0) - 1);
      await kvSet(`user:${user.email}`, user);
    }

    return res.status(200).json({ analysis, credits: user.credits, plan: user.plan });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
