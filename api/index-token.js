import { kvSet, kvGet } from './_kv.js';

// This endpoint stores the verify token → email mapping
// Called internally after register
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const { token, email } = req.body;
  if (!token || !email) return res.status(400).json({ error: 'Missing params' });

  await kvSet(`verify:${token}`, email);
  return res.status(200).json({ ok: true });
}
