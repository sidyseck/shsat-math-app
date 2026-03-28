// api/get-stats.js

module.exports = async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not set" });
  }

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
  };

  const userId = req.query.userId || null;
  const sessionFilter = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : "";

  try {
    const sessionsRes = await fetch(
      `${supabaseUrl}/rest/v1/sessions?select=*&order=created_at.asc${sessionFilter}`,
      { headers }
    );
    const sessions = await sessionsRes.json();

    if (!Array.isArray(sessions)) {
      return res.status(500).json({ error: "Unexpected response from Supabase" });
    }

    let answers = [];
    if (sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id).join(",");
      const answersRes = await fetch(
        `${supabaseUrl}/rest/v1/answers?select=*&session_id=in.(${sessionIds})&order=created_at.asc`,
        { headers }
      );
      answers = await answersRes.json();
      if (!Array.isArray(answers)) answers = [];
    }

    const total = answers.length;
    const correct = answers.filter(a => a.is_correct).length;

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

    return res.status(200).json({ total, correct, byTopic, bySubject, overTime });
  } catch (err) {
    console.error("get-stats error:", err);
    return res.status(500).json({ error: String(err) });
  }
};
