const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── auth middleware ────────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.authUser = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

// ── auth routes ───────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });

  const { data: user, error } = await supabase
    .from('users').select('username, password_hash').eq('username', username).single();
  if (error || !user) return res.status(401).json({ error: 'invalid username' });

  if (!password) {
    if (!user.password_hash) return res.json({ firstTime: true });
    return res.json({ needsPassword: true });
  }

  if (!user.password_hash) return res.status(400).json({ error: 'no password set yet' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'incorrect password' });

  const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token, username: user.username });
});

app.post('/api/auth/setup', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'at least 6 characters' });

  const { data: user, error } = await supabase
    .from('users').select('username, password_hash').eq('username', username).single();
  if (error || !user) return res.status(401).json({ error: 'invalid username' });
  if (user.password_hash) return res.status(403).json({ error: 'password already set' });

  const hash = await bcrypt.hash(password, 12);
  const { error: updateErr } = await supabase
    .from('users').update({ password_hash: hash }).eq('username', username);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token, username });
});

// ── entries routes (protected) ────────────────────────────────────────────────

app.get('/api/entries', authMiddleware, async (_req, res) => {
  const { data, error } = await supabase
    .from('entries').select('*').order('ts', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/entries', authMiddleware, async (req, res) => {
  const { id, ts, user, note = '', tags = [], img = null, sentiment = null, source = null } = req.body;
  if (!id || !ts || !user) return res.status(400).json({ error: 'id, ts, and user are required' });
  const reactions = sentiment ? { [user]: sentiment } : {};
  const { error } = await supabase.from('entries')
    .insert({ id, ts, user, note, tags, img, sentiment, source, reactions });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.put('/api/entries/:id', authMiddleware, async (req, res) => {
  const { note = '', tags = [], img = null, sentiment = null, source = null } = req.body;
  const { data: entry, error: fetchErr } = await supabase
    .from('entries').select('user, reactions').eq('id', req.params.id).single();
  if (fetchErr || !entry) return res.status(404).json({ error: 'not found' });
  const reactions = { ...(entry.reactions || {}) };
  if (sentiment) reactions[entry.user] = sentiment;
  else delete reactions[entry.user];
  const { error } = await supabase.from('entries')
    .update({ note, tags, img, sentiment, source, reactions }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.patch('/api/entries/:id/react', authMiddleware, async (req, res) => {
  const { user, sentiment } = req.body;
  if (!user) return res.status(400).json({ error: 'user is required' });
  const { data: entry, error: fetchErr } = await supabase
    .from('entries').select('reactions').eq('id', req.params.id).single();
  if (fetchErr || !entry) return res.status(404).json({ error: 'not found' });
  const reactions = { ...(entry.reactions || {}) };
  if (!sentiment) delete reactions[user];
  else reactions[user] = sentiment;
  const { error } = await supabase.from('entries').update({ reactions }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, reactions });
});

app.delete('/api/entries/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase.from('entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── dev: live reload via mtime polling ───────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  const clients = new Set();
  let reloadTimer = null;

  app.get('/api/__reload', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write('data: connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  const publicDir = path.join(__dirname, 'public');
  const mtimes = new Map();
  const scan = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, f.name);
      f.isDirectory() ? scan(fp) : mtimes.set(fp, fs.statSync(fp).mtimeMs);
    }
  };
  try { scan(publicDir); } catch {}

  setInterval(() => {
    try {
      let changed = false;
      const check = dir => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, f.name);
          if (f.isDirectory()) { check(fp); continue; }
          const mtime = fs.statSync(fp).mtimeMs;
          if (mtimes.get(fp) !== mtime) { mtimes.set(fp, mtime); changed = true; }
        }
      };
      check(publicDir);
      if (changed) {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          for (const res of clients) res.write('data: reload\n\n');
        }, 50);
      }
    } catch {}
  }, 300);
}

app.listen(PORT, () => console.log(`家 studio → http://localhost:${PORT}`));
