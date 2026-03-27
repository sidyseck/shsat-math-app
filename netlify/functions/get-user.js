// netlify/functions/get-user.js

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase env vars not set" }) };
  }

  const { uid } = JSON.parse(event.body || "{}");

  if (!uid || typeof uid !== "string" || uid.trim().length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing uid" }) };
  }

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
  };

  const res = await fetch(
    `${supabaseUrl}/rest/v1/users?uid=eq.${encodeURIComponent(uid.trim().toUpperCase())}&select=uid,name&limit=1`,
    { headers }
  );

  const rows = await res.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: "Invalid code" }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: rows[0].uid, name: rows[0].name }),
  };
};
