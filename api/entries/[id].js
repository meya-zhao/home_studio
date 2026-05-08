const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../_lib');

const sb = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  const supabase = sb();
  const { id } = req.query;

  if (req.method === 'PUT') {
    const { note = '', tags = [], img = null, sentiment = null, source = null } = req.body;
    const { data: entry, error: fetchErr } = await supabase
      .from('entries').select('user, reactions').eq('id', id).single();
    if (fetchErr || !entry) return res.status(404).json({ error: 'not found' });
    const reactions = { ...(entry.reactions || {}) };
    if (sentiment) reactions[entry.user] = sentiment;
    else delete reactions[entry.user];
    const { error } = await supabase.from('entries')
      .update({ note, tags, img, sentiment, source, reactions }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('entries').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'method not allowed' });
};
