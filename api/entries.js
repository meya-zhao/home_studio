const { createClient } = require('@supabase/supabase-js');

const sb = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  const supabase = sb();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('entries').select('*').order('ts', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const { id, ts, user, note = '', tags = [], img = null, sentiment = null, source = null } = req.body;
    if (!id || !ts || !user) return res.status(400).json({ error: 'id, ts, and user are required' });
    const reactions = sentiment ? { [user]: sentiment } : {};
    const { error } = await supabase.from('entries')
      .insert({ id, ts, user, note, tags, img, sentiment, source, reactions });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'method not allowed' });
};
