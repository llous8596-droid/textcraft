import crypto from 'crypto';
import { kvGet, kvSet } from './_kv.js';

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function signJWT(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${header}.${body}.${sig}`;
}
function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64')
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(body, 'base64').toString());
  } catch { return null; }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendVerificationEmail(email, token) {
  const appUrl = process.env.APP_URL || 'https://textcraft-sigma.vercel.app';
  const verifyUrl = `${appUrl}/api/auth?action=verify&token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:sans-serif">
  <div style="max-width:480px;margin:40px auto;padding:0 20px">
    <div style="background:#13131A;border:1px solid #2A2A3A;border-radius:16px;padding:40px;text-align:center">
      <div style="font-size:28px;font-weight:800;background:linear-gradient(135deg,#7C6EFA,#FA6E9A);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px">TextCraft ✦</div>
      <h1 style="color:#F0F0F8;font-size:22px;font-weight:700;margin:20px 0 10px">Confirmez votre email</h1>
      <p style="color:#8888A8;font-size:15px;line-height:1.7;margin-bottom:32px">Cliquez sur le bouton ci-dessous pour activer votre compte TextCraft et accéder à vos 5 générations gratuites.</p>
      <a href="${verifyUrl}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#7C6EFA,#FA6E9A);border-radius:10px;color:#fff;font-weight:700;font-size:16px;text-decoration:none">Confirmer mon email →</a>
      <p style="color:#8888A8;font-size:12px;margin-top:24px">Ce lien expire dans 24h. Si vous n'avez pas créé de compte, ignorez cet email.</p>
    </div>
    <p style="color:#2A2A3A;font-size:11px;text-align:center;margin-top:16px">TextCraft — ${appUrl}</p>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'TextCraft', email: 'elmehdifares50@gmail.com' },
      to: [{ email }],
      subject: 'Confirmez votre email TextCraft ✦',
      htmlContent: html
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Erreur envoi email : ' + (err.message || res.status));
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const secret = process.env.JWT_SECRET || 'textcraft-secret-change-me';

  // REGISTER
  if (action === 'register' && req.method === 'POST') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Adresse email invalide' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });

    const id = email.toLowerCase().trim();
    const existing = await kvGet(`user:${id}`);
    if (existing && existing.verified) return res.status(409).json({ error: 'Email déjà utilisé' });

    const hash = crypto.createHash('sha256').update(password + secret).digest('hex');
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = Date.now() + 24 * 60 * 60 * 1000; // 24h

    const user = {
      email: id, hash, plan: 'free', credits: 5,
      createdAt: Date.now(), profile: null,
      verified: false, verifyToken, verifyExpires
    };
    await kvSet(`user:${id}`, user);
    await kvSet(`verify:${verifyToken}`, id);

    try {
      await sendVerificationEmail(id, verifyToken);
    } catch(e) {
      console.error('Email error:', e.message);
      // On continue même si l'email échoue — on log mais on ne bloque pas
    }

    return res.status(200).json({
      pending: true,
      message: 'Un email de confirmation a été envoyé à ' + id + '. Vérifiez votre boîte mail.'
    });
  }

  // VERIFY EMAIL
  if (action === 'verify' && req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).send(errorPage('Token manquant'));

    // Cherche l'utilisateur avec ce token
    const appUrl = process.env.APP_URL || 'https://textcraft-sigma.vercel.app';

    // On cherche dans KV — on doit scanner les clés
    // On stocke aussi un index token→email pour la rapidité
    const emailFromIndex = await kvGet(`verify:${token}`);
    if (!emailFromIndex) return res.status(400).send(errorPage('Lien invalide ou expiré'));

    const user = await kvGet(`user:${emailFromIndex}`);
    if (!user) return res.status(400).send(errorPage('Utilisateur introuvable'));
    if (user.verified) {
      return res.redirect(302, `${appUrl}?verified=already`);
    }
    if (user.verifyToken !== token) return res.status(400).send(errorPage('Token invalide'));
    if (Date.now() > user.verifyExpires) return res.status(400).send(errorPage('Lien expiré. Créez un nouveau compte.'));

    user.verified = true;
    user.verifyToken = null;
    user.verifyExpires = null;
    await kvSet(`user:${emailFromIndex}`, user);

    return res.redirect(302, `${appUrl}?verified=true`);
  }

  // LOGIN
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Adresse email invalide' });

    const id = email.toLowerCase().trim();
    const user = await kvGet(`user:${id}`);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    if (!user.verified) {
      return res.status(403).json({
        error: 'Email non confirmé. Vérifiez votre boîte mail.',
        pending: true
      });
    }

    const hash = crypto.createHash('sha256').update(password + secret).digest('hex');
    if (hash !== user.hash) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const token = signJWT({ email: id, plan: user.plan }, secret);
    return res.status(200).json({ token, user: { email: id, plan: user.plan, credits: user.credits, profile: user.profile || null } });
  }

  // ME
  if (action === 'me' && req.method === 'GET') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const payload = verifyJWT(token, secret);
    if (!payload) return res.status(401).json({ error: 'Token invalide' });
    const user = await kvGet(`user:${payload.email}`);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.status(200).json({ email: user.email, plan: user.plan, credits: user.credits, profile: user.profile || null });
  }

  // SAVE PROFILE
  if (action === 'save-profile' && req.method === 'POST') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const payload = verifyJWT(token, secret);
    if (!payload) return res.status(401).json({ error: 'Non authentifié' });
    const user = await kvGet(`user:${payload.email}`);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { name, sector, description, tone, extra } = req.body;
    if (!name || !sector || !description) return res.status(400).json({ error: 'Champs manquants' });
    user.profile = { name, sector, description, tone: tone || 'chaleureux', extra: extra || '', updatedAt: Date.now() };
    await kvSet(`user:${payload.email}`, user);
    return res.status(200).json({ profile: user.profile });
  }

  // RESEND VERIFICATION
  if (action === 'resend-verify' && req.method === 'POST') {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });
    const id = email.toLowerCase().trim();
    const user = await kvGet(`user:${id}`);
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });
    if (user.verified) return res.status(400).json({ error: 'Email déjà vérifié' });

    const verifyToken = crypto.randomBytes(32).toString('hex');
    user.verifyToken = verifyToken;
    user.verifyExpires = Date.now() + 24 * 60 * 60 * 1000;
    await kvSet(`user:${id}`, user);
    await kvSet(`verify:${verifyToken}`, id);

    try {
      await sendVerificationEmail(id, verifyToken);
      return res.status(200).json({ message: 'Email renvoyé !' });
    } catch(e) {
      return res.status(500).json({ error: 'Erreur envoi email' });
    }
  }


  // FORGOT PASSWORD
  if (action === 'forgot-password' && req.method === 'POST') {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });

    const id = email.toLowerCase().trim();
    const user = await kvGet(`user:${id}`);
    if (!user) return res.status(200).json({ message: 'Si cet email existe, un lien a été envoyé.' }); // Don't reveal if user exists

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 60 * 60 * 1000; // 1h

    user.resetToken = resetToken;
    user.resetExpires = resetExpires;
    await kvSet(`user:${id}`, user);
    await kvSet(`reset:${resetToken}`, id);

    const appUrl = process.env.APP_URL || 'https://textcraft-sigma.vercel.app';
    const resetUrl = `${appUrl}?reset_token=${resetToken}`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:sans-serif">
  <div style="max-width:480px;margin:40px auto;padding:0 20px">
    <div style="background:#13131A;border:1px solid #2A2A3A;border-radius:16px;padding:40px;text-align:center">
      <div style="font-size:28px;font-weight:800;background:linear-gradient(135deg,#7C6EFA,#FA6E9A);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px">TextCraft ✦</div>
      <h1 style="color:#F0F0F8;font-size:22px;font-weight:700;margin:20px 0 10px">Réinitialiser votre mot de passe</h1>
      <p style="color:#8888A8;font-size:15px;line-height:1.7;margin-bottom:32px">Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien expire dans 1 heure.</p>
      <a href="${resetUrl}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#7C6EFA,#FA6E9A);border-radius:10px;color:#fff;font-weight:700;font-size:16px;text-decoration:none">Réinitialiser mon mot de passe →</a>
      <p style="color:#8888A8;font-size:12px;margin-top:24px">Si vous n'avez pas demandé cela, ignorez cet email.</p>
    </div>
  </div>
</body>
</html>`;

    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'TextCraft', email: 'elmehdifares50@gmail.com' },
          to: [{ email: id }],
          subject: 'Réinitialisation de votre mot de passe TextCraft',
          htmlContent: html
        })
      });
    } catch(e) { console.error('Reset email error:', e); }

    return res.status(200).json({ message: 'Si cet email existe, un lien a été envoyé.' });
  }

  // RESET PASSWORD
  if (action === 'reset-password' && req.method === 'POST') {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Champs manquants' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });

    const emailFromIndex = await kvGet(`reset:${token}`);
    if (!emailFromIndex) return res.status(400).json({ error: 'Lien invalide ou expiré' });

    const user = await kvGet(`user:${emailFromIndex}`);
    if (!user) return res.status(400).json({ error: 'Utilisateur introuvable' });
    if (user.resetToken !== token) return res.status(400).json({ error: 'Token invalide' });
    if (Date.now() > user.resetExpires) return res.status(400).json({ error: 'Lien expiré. Recommencez.' });

    user.hash = crypto.createHash('sha256').update(newPassword + secret).digest('hex');
    user.resetToken = null;
    user.resetExpires = null;
    await kvSet(`user:${emailFromIndex}`, user);
    await kvSet(`reset:${token}`, null); // Invalidate token

    return res.status(200).json({ ok: true, message: 'Mot de passe mis à jour. Connectez-vous !' });
  }

  return res.status(404).json({ error: 'Action inconnue' });
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Erreur</title></head><body style="background:#0A0A0F;color:#F0F0F8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center"><div><div style="font-size:40px;margin-bottom:16px">⚠️</div><h2>${msg}</h2><a href="/" style="color:#7C6EFA;margin-top:16px;display:block">Retour à l'accueil</a></div></body></html>`;
}
