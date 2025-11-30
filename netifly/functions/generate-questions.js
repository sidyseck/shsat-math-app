// netlify/functions/generate-questions.js
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const { topic = "mixed", difficulty = "medium", count = 5 } = JSON.parse(event.body || "{}");

    const prompt = `
You are generating SHSAT-style MATH multiple-choice questions for a 7th-grade student.

Constraints:
- Only math, NO reading or word-play questions.
- NO diagrams, NO graphs, NO images. All information must be in text.
- Question types: fractions, ratios, proportions, percentages, basic algebra, integer arithmetic, simple geometry described in words.
- Difficulty: ${difficulty} (easy/medium/hard).
- Topic preference: ${topic}. If "mixed", mix across common SHSAT math topics.
- Each question must have EXACTLY 4 answer choices, labeled implicitly as A, B, C, D.
- Exactly ONE choice is correct.
- Provide a correctIndex (0 for A, 1 for B, 2 for C, 3 for D).
- The questions should be solvable without a calculator.

Return ONLY valid JSON with this shape:

{
  "questions": [
    {
      "prompt": "question text here",
      "choices": ["choice A", "choice B", "choice C", "choice D"],
      "correctIndex": 0,
      "topic": "percent | ratios | algebra | geometry | mixed",
      "difficulty": "easy | medium | hard"
    },
    ...
  ]
}

There should be exactly ${count} questions.
`;

    // Call your LLM API here.
    // Example using OpenAI's chat completions endpoint with a JSON-style response:
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing OPENAI_API_KEY" })
      };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // or any suitable model
        messages: [
          { role: "system", content: "You are a careful SHSAT-style math question generator." },
          { role: "user", content: prompt }
        ],
        temperature: 0.6
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("LLM error:", text);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "LLM request failed" })
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Try to parse JSON from the model's output
    let questionsPayload;
    try {
      questionsPayload = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse JSON from model:", content);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to parse questions JSON" })
      };
    }

    // Basic sanity checks
    if (!questionsPayload.questions || !Array.isArray(questionsPayload.questions)) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Invalid questions format from model" })
      };
    }

    // Optionally, clamp or clean up questions here

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(questionsPayload)
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" })
    };
  }
};

