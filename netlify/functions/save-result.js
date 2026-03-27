// netlify/functions/save-result.js

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase env vars not set" }) };
  }

  const headers = {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Prefer": "resolution=merge-duplicates",
  };

  try {
    const body = JSON.parse(event.body || "{}");
    const { sessionId, subject, difficulty, topic, isCorrect, action, userId } = body;

    // Create or upsert a session row
    if (action === "create_session") {
      if (!sessionId || !subject || !difficulty) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing sessionId, subject, or difficulty" }) };
      }

      const res = await fetch(`${supabaseUrl}/rest/v1/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: sessionId, subject, difficulty, user_id: userId || null }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Supabase session insert error:", err);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to create session" }) };
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // Save an answer
    if (action === "save_answer") {
      if (!sessionId || !subject || !topic || !difficulty || isCorrect === undefined) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing required answer fields" }) };
      }

      const res = await fetch(`${supabaseUrl}/rest/v1/answers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session_id: sessionId, subject, topic, difficulty, is_correct: isCorrect }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Supabase answer insert error:", err);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to save answer" }) };
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    console.error("save-result error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(err) }) };
  }
};
