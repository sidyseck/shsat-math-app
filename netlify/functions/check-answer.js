// netlify/functions/check-answer.js

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { subject = "math", question } = body;

    if (!question || !question.prompt || !Array.isArray(question.choices)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing or invalid question data" }),
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set" }),
      };
    }

    const { prompt, choices, userIndex } = question;

    const solverPrompt = `
You are solving a SHSAT-style ${subject.toUpperCase()} multiple-choice question.

Question:
${prompt}

Choices:
A) ${choices[0]}
B) ${choices[1]}
C) ${choices[2]}
D) ${choices[3]}

The student chose: ${["A","B","C","D"][userIndex] ?? "unknown"}.

Tasks:
1. Carefully solve/interpret the question.
2. Decide which ONE option (A, B, C, or D) is correct.
3. Determine whether the student's choice is correct.
4. Explain briefly why.

Respond ONLY with JSON of this exact shape:

{
  "correctIndex": 0,
  "isCorrect": true,
  "solution": "step-by-step explanation here"
}

Where:
- correctIndex is 0 for A, 1 for B, 2 for C, 3 for D.
- isCorrect is true if the student's choice matches correctIndex, otherwise false.
- solution clearly explains the reasoning.
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",          // or "gpt-4o-mini" if you prefer cheaper
        messages: [
          { role: "system", content: "You are a careful SHSAT question solver. Always return valid JSON." },
          { role: "user", content: solverPrompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Solver API error:", errText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "LLM request failed", details: errText }),
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in solver response:", JSON.stringify(data, null, 2));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No content from solver" }),
      };
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse solver JSON:", content);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to parse solver JSON" }),
      };
    }

    const ci = result.correctIndex;
    if (!Number.isInteger(ci) || ci < 0 || ci >= choices.length) {
      console.error("Solver returned invalid correctIndex:", result);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Solver returned invalid correctIndex" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correctIndex: ci,
        isCorrect: !!result.isCorrect,
        solution: result.solution || "",
      }),
    };
  } catch (err) {
    console.error("check-answer function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", details: String(err) }),
    };
  }
};
