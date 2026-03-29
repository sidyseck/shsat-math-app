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

function parseChoiceToNumber(raw) {
  if (raw == null) return NaN;
  const cleaned = raw.replace(/,/g, "").trim().toLowerCase();

  let m = cleaned.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (m) {
    const whole = parseInt(m[1], 10);
    const num = parseInt(m[2], 10);
    const den = parseInt(m[3], 10);
    if (den !== 0) return whole + (whole >= 0 ? num / den : -num / den);
  }

  m = cleaned.match(/^(-?\d+)\s*\/\s*(\d+)/);
  if (m) {
    const num = parseInt(m[1], 10);
    const den = parseInt(m[2], 10);
    if (den !== 0) return num / den;
  }

  m = cleaned.match(/-?\d+(\.\d+)?/);
  if (m) {
    const val = parseFloat(m[0]);
    if (!Number.isNaN(val)) return val;
  }

  return NaN;
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

    const { prompt, choices, userIndex, correctIndex: precomputedIndex, correctAnswer, solution: precomputedSolution } = question;

    if (subject === "math" && precomputedSolution) {
      // Re-derive correctIndex by numerically matching correctAnswer against choices.
      // This is immune to any index drift that happened at generation time.
      let correctIndex = -1;
      if (correctAnswer != null) {
        const target = parseChoiceToNumber(String(correctAnswer));
        if (!Number.isNaN(target)) {
          for (let i = 0; i < choices.length; i++) {
            if (Math.abs(parseChoiceToNumber(choices[i]) - target) < 1e-6) {
              correctIndex = i;
              break;
            }
          }
        }
      }
      // Fall back to precomputedIndex if value matching failed
      if (correctIndex === -1 && Number.isInteger(precomputedIndex) && precomputedIndex >= 0 && precomputedIndex < choices.length) {
        correctIndex = precomputedIndex;
      }
      if (correctIndex !== -1) {
        return res.status(200).json({
          correctIndex,
          isCorrect: userIndex === correctIndex,
          solution: precomputedSolution,
        });
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
    }

    let solverPrompt;

    if (subject === "math") {
      solverPrompt = `
You are solving a SHSAT-style MATH question.

Question:
${prompt}

Tasks:
1. Carefully solve the math problem and compute the exact numeric result (call it finalAnswer).
2. DO NOT think in terms of answer choices, letters, or options. Ignore A/B/C/D completely.
3. finalAnswer must be the actual numeric value that correctly solves the problem.
4. In your explanation, you may show intermediate numeric steps, but you must not refer to "option A", "choice C", etc.

Important:
- finalAnswer must be a NUMBER (no units, no commas) that we can compare to the answer choices separately.
- Do NOT put "A", "B", "C", "D", "option", or "choice" into finalAnswer. Only use a pure numeric value.
- If you get a non-integer, return it as a decimal number (e.g., 0.375).

Respond ONLY with JSON of this exact shape:

{
  "finalAnswer": 24,
  "solution": "step-by-step explanation here"
}
`;
    } else {
      solverPrompt = `
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
    }

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

    if (subject === "math") {
      let faRaw = result.finalAnswer;
      let finalAnswer;

      if (typeof faRaw === "number") {
        finalAnswer = faRaw;
      } else {
        const parsed = parseFloat(String(faRaw).replace(/,/g, "").trim());
        if (!Number.isNaN(parsed)) finalAnswer = parsed;
      }

      if (typeof finalAnswer !== "number" || Number.isNaN(finalAnswer)) {
        console.error("Solver did not return a usable numeric finalAnswer:", result);
        return res.status(500).json({ error: "Solver did not return numeric finalAnswer" });
      }

      let correctIndex = -1;
      let closestIndex = -1;
      let closestDiff = Infinity;

      for (let i = 0; i < choices.length; i++) {
        const num = parseChoiceToNumber((choices[i] ?? "").toString());
        if (Number.isNaN(num)) continue;
        const diff = Math.abs(num - finalAnswer);
        if (diff < 1e-6) { correctIndex = i; break; }
        if (diff < closestDiff) { closestDiff = diff; closestIndex = i; }
      }

      if (correctIndex === -1) {
        correctIndex = closestIndex !== -1 ? closestIndex : 0;
        console.warn("Exact match failed, using closest choice:", { finalAnswer, choices, correctIndex });
        result.solution = `Note: computed answer was ${finalAnswer}, matched to closest choice.\n\n${result.solution || ""}`;
      }

      return res.status(200).json({
        correctIndex,
        isCorrect: userIndex === correctIndex,
        solution: result.solution || "",
      });
    } else {
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
    }
  } catch (err) {
    console.error("check-answer function error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
};
