const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../../_lib');

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;
  const supabase = sb();
  const { id } = req.query;
  const { user, text } = req.body;
  if (!user) return res.status(400).json({ error: 'user is required' });

  const { data: entry, error: fetchErr } = await supabase
    .from('entries').select('comments, seen, user').eq('id', id).single();
  if (fetchErr || !entry) return res.status(404).json({ error: 'not found' });

  const comments = { ...(entry.comments || {}) };
  const isAdding = text && text.trim();
  if (!isAdding) delete comments[user];
  else comments[user] = text.trim();

  const update = { comments };
  if (isAdding) {
    const seen = { ...(entry.seen || {}) };
    delete seen[entry.user];
    update.seen = seen;
  }

  const { error } = await supabase.from('entries').update(update).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, comments, ...(update.seen !== undefined && { seen: update.seen }) });
};
