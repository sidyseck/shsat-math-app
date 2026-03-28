// api/save-result.js

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not set" });
  }

  const headers = {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Prefer": "resolution=merge-duplicates",
  };

  try {
    const body = req.body || {};
    const { sessionId, subject, difficulty, topic, isCorrect, action, userId } = body;

    // Create or upsert a session row
    if (action === "create_session") {
      if (!sessionId || !subject || !difficulty) {
        return res.status(400).json({ error: "Missing sessionId, subject, or difficulty" });
      }

      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: sessionId, subject, difficulty, user_id: userId || null }),
      });

      if (!supabaseRes.ok) {
        const err = await supabaseRes.text();
        console.error("Supabase session insert error:", err);
        return res.status(500).json({ error: "Failed to create session" });
      }

      return res.status(200).json({ ok: true });
    }

    // Save an answer
    if (action === "save_answer") {
      if (!sessionId || !subject || !topic || !difficulty || isCorrect === undefined) {
        return res.status(400).json({ error: "Missing required answer fields" });
      }

      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/answers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session_id: sessionId, subject, topic, difficulty, is_correct: isCorrect }),
      });

      if (!supabaseRes.ok) {
        const err = await supabaseRes.text();
        console.error("Supabase answer insert error:", err);
        return res.status(500).json({ error: "Failed to save answer" });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("save-result error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
};
