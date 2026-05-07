const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'notes.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id        TEXT    PRIMARY KEY,
    ts        INTEGER NOT NULL,
    user      TEXT    NOT NULL,
    note      TEXT    NOT NULL DEFAULT '',
    tags      TEXT    NOT NULL DEFAULT '[]',
    img       TEXT,
    sentiment TEXT,
    source    TEXT
  )
`);

// migrate: add reactions column and seed from existing sentiment data
try {
  db.exec("ALTER TABLE entries ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'");
  db.exec("UPDATE entries SET reactions = json_object(user, sentiment) WHERE sentiment IS NOT NULL AND reactions = '{}'");
} catch {} // column already exists on subsequent starts

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const stmts = {
  list: db.prepare('SELECT * FROM entries ORDER BY ts DESC'),
  ins: db.prepare(
    'INSERT INTO entries (id,ts,user,note,tags,img,sentiment,source,reactions) VALUES (@id,@ts,@user,@note,@tags,@img,@sentiment,@source,@reactions)'
  ),
  del: db.prepare('DELETE FROM entries WHERE id = ?'),
  getReactions: db.prepare('SELECT reactions FROM entries WHERE id = @id'),
  setReactions: db.prepare('UPDATE entries SET reactions = @reactions WHERE id = @id'),
  getOwner:     db.prepare('SELECT user, reactions FROM entries WHERE id = @id'),
  upd:          db.prepare('UPDATE entries SET note=@note,tags=@tags,img=@img,sentiment=@sentiment,source=@source,reactions=@reactions WHERE id=@id'),
};

app.get('/api/entries', (_req, res) => {
  const rows = stmts.list.all().map(r => ({ ...r, tags: JSON.parse(r.tags) }));
  res.json(rows);
});

app.post('/api/entries', (req, res) => {
  const { id, ts, user, note = '', tags = [], img = null, sentiment = null, source = null } = req.body;
  if (!id || !ts || !user) return res.status(400).json({ error: 'id, ts, and user are required' });
  const reactions = sentiment ? JSON.stringify({ [user]: sentiment }) : '{}';
  try {
    stmts.ins.run({ id, ts, user, note, tags: JSON.stringify(tags), img, sentiment, source, reactions });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/entries/:id/react', (req, res) => {
  const { user, sentiment } = req.body;
  if (!user) return res.status(400).json({ error: 'user is required' });
  const row = stmts.getReactions.get({id: req.params.id});
  if (!row) return res.status(404).json({ error: 'not found' });
  const reactions = JSON.parse(row.reactions || '{}');
  if (!sentiment) delete reactions[user];
  else reactions[user] = sentiment;
  stmts.setReactions.run({reactions: JSON.stringify(reactions), id: req.params.id});
  res.json({ ok: true, reactions });
});

app.put('/api/entries/:id', (req, res) => {
  const { note='', tags=[], img=null, sentiment=null, source=null } = req.body;
  const row = stmts.getOwner.get({id: req.params.id});
  if (!row) return res.status(404).json({ error: 'not found' });
  const reactions = JSON.parse(row.reactions || '{}');
  if (sentiment) reactions[row.user] = sentiment;
  else delete reactions[row.user];
  try {
    stmts.upd.run({note, tags:JSON.stringify(tags), img, sentiment, source, reactions:JSON.stringify(reactions), id:req.params.id});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries/:id', (req, res) => {
  stmts.del.run(req.params.id);
  res.json({ ok: true });
});

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

  // fs.watch is unreliable on macOS — poll mtimes instead
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
