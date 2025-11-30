// netlify/functions/generate-questions.js

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const subject = body.subject || "math"; // "math" or "ela"
    const topic = body.topic || "mixed";
    const difficulty = body.difficulty || "medium";
    const count = Math.max(1, Math.min(10, Number(body.count) || 5));

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set" }),
      };
    }

    // Build subject-specific instructions
    let userPrompt;

    if (subject === "math") {
  userPrompt = `
You are generating SHSAT-style MATH multiple-choice questions for a 7th-grade student.

Goals:
- Create questions that look and feel like real SHSAT math.
- Make sure each question is CORRECT and has exactly ONE correct answer.

Constraints:
- Only math, NO reading comprehension.
- NO diagrams, NO graphs, NO images. Everything must be in text.
- Topics: fractions, ratios, proportions, percentages, basic algebra, integer arithmetic, and geometry described in words only.
- Difficulty: ${difficulty} (easy/medium/hard).
- Topic preference: ${topic}. If topic === "mixed", mix across common SHSAT math topics.
- Each question must have EXACTLY 4 answer choices (A, B, C, D).
- Exactly ONE choice is correct.
- Questions should be solvable without a calculator.

For each question:
1. First, carefully THINK THROUGH and SOLVE the question.
2. Decide which choice is correct.
3. Set:
   - correctIndex = 0 for A, 1 for B, 2 for C, 3 for D.
   - correctAnswer = the FULL TEXT of the correct choice.
4. In the "solution" field, show the step-by-step reasoning you used to compute the correct answer.

Very important:
- Check that plugging the correct answer back into the question actually works.
- Make sure there is no other choice that also satisfies the conditions.
- If you notice any mismatch between your reasoning and correctIndex, FIX your correctIndex and correctAnswer before returning the JSON.

Return ONLY valid JSON with this exact shape:

{
  "questions": [
    {
      "prompt": "question text here",
      "choices": ["choice A", "choice B", "choice C", "choice D"],
      "correctIndex": 0,
      "correctAnswer": "choice A",
      "topic": "percent | ratios | algebra | geometry | mixed",
      "difficulty": "easy | medium | hard",
      "solution": "step-by-step explanation of how to solve the question"
    }
  ]
}

There should be exactly ${count} questions.
`;

    }else {
      // ELA mode: reading + editing SHSAT-style
      userPrompt = `
You are generating SHSAT-style ELA multiple-choice questions for a 7th-grade student.

Overall requirements:
- ONLY English Language Arts tasks.
- Two main types:
  1) READING COMPREHENSION with a short passage (3–6 short paragraphs) and questions about meaning, inference, vocabulary-in-context, structure, or author's purpose.
  2) REVISING & EDITING short sentences or very short paragraphs (grammar, punctuation, clarity, word choice).
- Difficulty: ${difficulty} (easy/medium/hard).
- Topic preference: ${topic}.
  - If topic === "reading": prefer reading-comprehension style questions.
  - If topic === "editing": prefer revising & editing style questions.
  - If topic === "mixed": mix both styles.

JSON format requirements:
- You may reuse the SAME passage text for multiple reading questions; to make it simple, include the passage text in a \`passage\` field on EACH reading question that needs it.
- Each question must have EXACTLY 4 answer choices (A, B, C, D).
- Exactly ONE choice is correct.
- For READING questions:
  - Use topic: "reading"
  - Include a \`passage\` string field with the passage text.
- For EDITING questions:
  - Use topic: "editing"
  - They can be self-contained (no \`passage\` field needed), or include a short context sentence if needed.

Return ONLY valid JSON with this shape:

{
  "questions": [
    {
      "prompt": "question text here",
      "passage": "passage text here (only for reading questions, otherwise omit this field)",
      "choices": ["choice A", "choice B", "choice C", "choice D"],
      "correctIndex": 0,
      "topic": "reading | editing | mixed",
      "difficulty": "easy | medium | hard"
    }
  ]
}

There should be exactly ${count} questions.
`;
    }

    // Call OpenAI Chat Completions API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o", // or another suitable model
        messages: [
          { role: "system", content: "You are a careful SHSAT-style question generator. Always return valid JSON." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", errText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "LLM request failed", details: errText }),
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in OpenAI response:", JSON.stringify(data, null, 2));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No content from model" }),
      };
    }

    let questionsPayload;
    try {
      questionsPayload = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse JSON from model:", content);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to parse questions JSON" }),
      };
    }

    if (!questionsPayload.questions || !Array.isArray(questionsPayload.questions)) {
      console.error("Invalid questions format:", questionsPayload);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Invalid questions format from model" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(questionsPayload),
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", details: String(err) }),
    };
  }
};