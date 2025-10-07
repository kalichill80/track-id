import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pkg from 'pg';
import { v4 as uuid } from 'uuid';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// sanity check
app.get('/', (_, res) => res.send('OK: click-tracker live'));

// --------- admin helpers (protected by ADMIN_KEY) ----------
function requireAdmin(req, res, next) {
  const key = req.header('X-Admin-Key');
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// create single token
app.post('/api/create-token', requireAdmin, async (req, res) => {
  try {
    const { email, target_url, campaign, expires_at, token } = req.body;
    if (!email || !target_url) return res.status(400).json({ error: 'email and target_url required' });
    const t = token || uuid();
    await pool.query(
      `INSERT INTO tokens(token, recipient_email, target_url, campaign, expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (token) DO NOTHING`,
      [t, email, target_url, campaign || null, expires_at || null]
    );
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    return res.json({ token: t, tracking_link: `${base}/r/${t}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// create tokens in bulk
// body: { campaign, target_url (optional per row), rows: [{email, target_url?, token?}] }
app.post('/api/create-batch', requireAdmin, async (req, res) => {
  try {
    const { rows, campaign, default_target_url } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows[] required' });

    const client = await pool.connect();
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const out = [];
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        const email = r.email;
        const dest = r.target_url || default_target_url;
        if (!email || !dest) throw new Error('email and target_url required per row');
        const t = r.token || uuid();
        await client.query(
          `INSERT INTO tokens(token, recipient_email, target_url, campaign)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (token) DO NOTHING`,
          [t, email, dest, campaign || null]
        );
        out.push({ email, token: t, tracking_link: `${base}/r/${t}` });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally {
      client.release();
    }
    res.json({ count: out.length, items: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// list clicks (paginate)
app.get('/api/clicks', requireAdmin, async (req, res) => {
  const { campaign, email, limit = 200, offset = 0 } = req.query;
  const params = [];
  const where = [];
  if (campaign) { params.push(campaign); where.push(`campaign = $${params.length}`); }
  if (email)    { params.push(email);    where.push(`recipient_email = $${params.length}`); }
  const sql = `
    SELECT c.id, c.token, c.recipient_email, c.clicked_at, c.ip, c.user_agent, c.referer, c.is_prefetch,
           t.campaign, t.target_url
    FROM clicks c
    JOIN tokens t ON t.token = c.token
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.clicked_at DESC
    LIMIT ${Number(limit)} OFFSET ${Number(offset)}
  `;
  try {
    const { rows } = await pool.query(sql, params);
    res.json({ rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// --------- redirect route ----------
const PREFETCH_SIGNATURES = [
  'googleimageproxy', 'xmicrosoft', 'frontdoor', 'linkpreview',
  'facebookexternalhit', 'slackbot', 'whatsapp', 'twitterbot',
  'SkypeUriPreview', 'google-structured-data-testing-tool',
  'HeadlessChrome', 'Prerender', 'curl', 'wget'
];

app.get('/r/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { rows } = await pool.query(
      'SELECT token, recipient_email, target_url, expires_at FROM tokens WHERE token = $1',
      [token]
    );
    if (rows.length === 0) return res.status(404).send('Link not found');

    const t = rows[0];
    if (t.expires_at && new Date(t.expires_at) < new Date()) {
      return res.status(410).send('Link expired');
    }

    const ua = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';
    const ip  = (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '';
    const isPrefetch = PREFETCH_SIGNATURES.some(sig => ua.toLowerCase().includes(sig.toLowerCase()));

    await pool.query(
      `INSERT INTO clicks (token, recipient_email, ip, user_agent, referer, is_prefetch)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [t.token, t.recipient_email, ip, ua, ref, isPrefetch]
    );

    // Optional: If you want to avoid counting prefetch, you could show an interstitial.
    return res.redirect(302, t.target_url);
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log('Listening on', port));
