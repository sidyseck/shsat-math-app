// netlify/functions/test-db.js
// Temporary endpoint to verify Supabase connectivity — remove after confirming it works

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "SUPABASE_URL or SUPABASE_ANON_KEY env vars are not set" }),
    };
  }

  const headers = {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
  };

  const results = {};

  // 1. Check sessions table exists and is readable
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/sessions?limit=1`, { headers });
    results.sessions = res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, error: await res.text() };
  } catch (e) {
    results.sessions = { ok: false, error: String(e) };
  }

  // 2. Check answers table exists and is readable
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/answers?limit=1`, { headers });
    results.answers = res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, error: await res.text() };
  } catch (e) {
    results.answers = { ok: false, error: String(e) };
  }

  // 3. Try inserting and deleting a test session row
  try {
    const testId = "00000000-0000-0000-0000-000000000001";

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/sessions`, {
      method: "POST",
      headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ id: testId, subject: "test", difficulty: "test" }),
    });

    if (!insertRes.ok) {
      results.write_test = { ok: false, error: await insertRes.text() };
    } else {
      // Clean up the test row
      const deleteRes = await fetch(`${supabaseUrl}/rest/v1/sessions?id=eq.${testId}`, {
        method: "DELETE",
        headers,
      });
      results.write_test = { ok: true, cleanup: deleteRes.ok };
    }
  } catch (e) {
    results.write_test = { ok: false, error: String(e) };
  }

  const allOk = Object.values(results).every(r => r.ok);

  return {
    statusCode: allOk ? 200 : 500,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: allOk, results }, null, 2),
  };
};
