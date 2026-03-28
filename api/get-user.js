// api/get-user.js

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not set" });
  }

  const { uid } = req.body || {};

  if (!uid || typeof uid !== "string" || uid.trim().length === 0) {
    return res.status(400).json({ error: "Missing uid" });
  }

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
  };

  const supabaseRes = await fetch(
    `${supabaseUrl}/rest/v1/users?uid=eq.${encodeURIComponent(uid.trim().toUpperCase())}&select=uid,name&limit=1`,
    { headers }
  );

  const rows = await supabaseRes.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(404).json({ error: "Invalid code" });
  }

  return res.status(200).json({ uid: rows[0].uid, name: rows[0].name });
};
