import { Router } from 'express';
import { Firestore } from '@google-cloud/firestore';
import { google } from 'googleapis';

// Minimal auth status route to support frontend checks without full OAuth wiring here
// It reports whether an OAuth token exists for the user in Firestore collection 'oauth_tokens'

export function authRoutes(): Router {
  const router = Router();

  // --- OAuth helpers ---
  const OAUTH_SCOPES = [
    'openid',
    'email',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/presentations',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/tasks'
  ];

  function getOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || '';
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  router.get('/status', async (req, res) => {
    const email = (req.query.email as string) || process.env.DEFAULT_USER_EMAIL || '';
    if (!email) {
      return res.status(200).json({ connected: false, reason: 'no_email' });
    }
    try {
      const db = new Firestore();
      const ref = db.collection('oauth_tokens').doc(email);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(200).json({ connected: false, email });
      }
      const data = snap.data() || {};
      const hasAccess = Boolean(data.refresh_token); // require refresh_token for server-side flows
      return res.status(200).json({ connected: hasAccess, email });
    } catch (e) {
      return res.status(200).json({ connected: false, error: (e as Error).message });
    }
  });

  // Detailed token info (safe subset) for debugging
  router.get('/status/details', async (req, res) => {
    const email = (req.query.email as string) || process.env.DEFAULT_USER_EMAIL || '';
    if (!email) return res.status(200).json({ ok: false, reason: 'no_email' });
    try {
      const db = new Firestore();
      const snap = await db.collection('oauth_tokens').doc(email).get();
      if (!snap.exists) return res.status(200).json({ ok: false, email, exists: false });
      const data = snap.data() || {} as any;
      return res.status(200).json({
        ok: true,
        email,
        has_access_token: Boolean(data.access_token),
        has_refresh_token: Boolean(data.refresh_token),
        scope: data.scope || '',
        token_type: data.token_type || '',
        expiry_date: data.expiry_date || data.expiry || undefined
      });
    } catch (e) {
      return res.status(200).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- OAuth login (browser redirect) ---
  router.get('/login', (req, res) => {
    try {
      const oauth2Client = getOAuthClient();
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: OAUTH_SCOPES,
      });
      res.redirect(url);
    } catch (e) {
      res.status(500).send('OAuth login initialization failed');
    }
  });

  // --- OAuth callback ---
  // Resolve a safe frontend base for redirects
  function resolveFrontendBase(req: any): string {
    const envBase = process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || '';
    const headerOrigin = (req.headers['x-forwarded-origin'] as string) || (req.headers.origin as string) || '';
    const candidates = [envBase, headerOrigin];
    for (const cand of candidates) {
      if (!cand) continue;
      if (cand.includes('*')) continue; // avoid wildcards like "/auth/*"
      if (/^https?:\/\//.test(cand)) {
        return cand.replace(/\/$/, '');
      }
    }
    return '/';
  }

  router.get('/callback', async (req, res) => {
    const code = (req.query.code as string) || '';
    const frontend = resolveFrontendBase(req);
    if (!code) return res.redirect(frontend + '?auth=error&reason=no_code');

    try {
      const db = new Firestore();
      const oauth2Client = getOAuthClient();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // fetch user info
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const me = await oauth2.userinfo.get();
      const email = me.data.email || process.env.DEFAULT_USER_EMAIL || '';
      if (!email) return res.redirect(frontend + '?auth=error&reason=no_email');

      // store tokens
      await db.collection('oauth_tokens').doc(email).set({
        ...tokens,
        updatedAt: Date.now()
      }, { merge: true });

      // Fire-and-forget per-user watch bootstrap
      setImmediate(async () => {
        try {
          const { WatchBootstrapper } = await import('../../services/WatchBootstrapper.js');
          await WatchBootstrapper.setupForUser(email);
        } catch (e) {
          // swallow errors; do not impact redirect
        }
      });

      res.redirect(frontend + `?auth=ok&email=${encodeURIComponent(email)}`);
    } catch (e) {
      res.redirect(frontend + '?auth=error');
    }
  });

  // Convenience proxy routes under /api
  router.get('/api/login', (_req, res) => res.redirect('/auth/login'));
  router.get('/api/callback', (req, res) => {
    const search = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect('/auth/callback' + search);
  });

  return router;
}
