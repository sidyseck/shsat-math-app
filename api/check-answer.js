// api/check-answer.js

function extractJson(text) {
  let depth = 0, start = -1, inString = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') { if (start === -1) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start !== -1) return text.slice(start, i + 1); }
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const { subject = "math", question } = body;

    if (!question || !question.prompt || !Array.isArray(question.choices)) {
      return res.status(400).json({ error: "Missing or invalid question data" });
    }

    const { choices, userIndex, correctIndex, solution } = question;

    // Math: correctIndex and solution are always precomputed at generation time.
    // No need to call Claude again — just return the cached result.
    if (subject === "math") {
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
        return res.status(500).json({ error: "Missing or invalid correctIndex for math question" });
      }
      return res.status(200).json({
        correctIndex,
        isCorrect: userIndex === correctIndex,
        solution: solution || "",
      });
    }

    // ELA: call Claude to determine the correct answer.
    const { prompt } = question;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
    }

    const solverPrompt = `
You are solving a SHSAT-style ELA multiple-choice question.

Question:
${prompt}

Choices:
A) ${choices[0]}
B) ${choices[1]}
C) ${choices[2]}
D) ${choices[3]}

Tasks:
1. Carefully analyze the question and the choices.
2. Decide which ONE option (A, B, C, or D) is correct.
3. Explain briefly why that option is correct.

Respond ONLY with JSON of this exact shape:

{
  "correctIndex": 0,
  "solution": "short explanation here"
}
`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: "You are a careful SHSAT question solver. Always return valid JSON and follow the requested schema exactly.",
        messages: [{ role: "user", content: solverPrompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Solver API error:", errText);
      return res.status(500).json({ error: "LLM request failed", details: errText });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      console.error("No content in solver response:", JSON.stringify(data, null, 2));
      return res.status(500).json({ error: "No content from solver" });
    }

    let result;
    try {
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      result = JSON.parse(extractJson(cleaned) ?? cleaned);
    } catch (e) {
      console.error("Failed to parse solver JSON:", content);
      return res.status(500).json({ error: "Failed to parse solver JSON" });
    }

    const ci = result.correctIndex;
    if (!Number.isInteger(ci) || ci < 0 || ci >= choices.length) {
      console.error("Solver returned invalid correctIndex:", result);
      return res.status(500).json({ error: "Solver returned invalid correctIndex" });
    }

    return res.status(200).json({
      correctIndex: ci,
      isCorrect: userIndex === ci,
      solution: result.solution || "",
    });

  } catch (err) {
    console.error("check-answer function error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
};
