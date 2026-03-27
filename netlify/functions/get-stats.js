// netlify/functions/get-stats.js

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase env vars not set" }) };
  }

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
  };

  try {
    // Fetch all answers with session created_at for time series
    const [answersRes, sessionsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/answers?select=*&order=created_at.asc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/sessions?select=*&order=created_at.asc`, { headers }),
    ]);

    const answers = await answersRes.json();
    const sessions = await sessionsRes.json();

    if (!Array.isArray(answers) || !Array.isArray(sessions)) {
      return { statusCode: 500, body: JSON.stringify({ error: "Unexpected response from Supabase" }) };
    }

    // --- Overall stats ---
    const total = answers.length;
    const correct = answers.filter(a => a.is_correct).length;

    // --- By topic ---
    const topicMap = {};
    for (const a of answers) {
      const t = a.topic || "unknown";
      if (!topicMap[t]) topicMap[t] = { total: 0, correct: 0 };
      topicMap[t].total++;
      if (a.is_correct) topicMap[t].correct++;
    }
    const byTopic = Object.entries(topicMap)
      .map(([topic, s]) => ({ topic, total: s.total, correct: s.correct, accuracy: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => a.accuracy - b.accuracy);

    // --- By subject ---
    const subjectMap = {};
    for (const a of answers) {
      const s = a.subject || "unknown";
      if (!subjectMap[s]) subjectMap[s] = { total: 0, correct: 0 };
      subjectMap[s].total++;
      if (a.is_correct) subjectMap[s].correct++;
    }
    const bySubject = Object.entries(subjectMap).map(([subject, s]) => ({
      subject, total: s.total, correct: s.correct, accuracy: Math.round((s.correct / s.total) * 100)
    }));

    // --- Over time: group answers by session, compute accuracy per session ---
    const sessionIndex = {};
    for (const s of sessions) sessionIndex[s.id] = s;

    const sessionStats = {};
    for (const a of answers) {
      const sid = a.session_id;
      if (!sessionStats[sid]) {
        const sess = sessionIndex[sid] || {};
        sessionStats[sid] = {
          session_id: sid,
          date: (sess.created_at || a.created_at).slice(0, 10),
          subject: sess.subject || a.subject,
          total: 0,
          correct: 0,
        };
      }
      sessionStats[sid].total++;
      if (a.is_correct) sessionStats[sid].correct++;
    }
    const overTime = Object.values(sessionStats)
      .map(s => ({ ...s, accuracy: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total, correct, byTopic, bySubject, overTime }),
    };
  } catch (err) {
    console.error("get-stats error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
