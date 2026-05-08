const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'at least 6 characters' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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
};
