const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { username, password } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: user, error } = await supabase
    .from('users').select('username, password_hash').eq('username', username).single();

  if (error || !user) return res.status(401).json({ error: 'invalid username' });

  // status check — no password supplied yet
  if (!password) {
    if (!user.password_hash) return res.json({ firstTime: true });
    return res.json({ needsPassword: true });
  }

  if (!user.password_hash) return res.status(400).json({ error: 'no password set yet' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'incorrect password' });

  const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token, username: user.username });
};
