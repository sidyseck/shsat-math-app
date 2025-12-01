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

    const { prompt, choices, userIndex } = question;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set" }),
      };
    }

    // Build subject-specific solver prompt
    let solverPrompt;

    if (subject === "math") {
      // Math: ask for a numeric finalAnswer, we'll map it to choices ourselves
      solverPrompt = `
You are solving a SHSAT-style MATH multiple-choice question.

Question:
${prompt}

Choices:
A) ${choices[0]}
B) ${choices[1]}
C) ${choices[2]}
D) ${choices[3]}

Tasks:
1. Carefully solve the math problem and compute the exact numeric result (call it finalAnswer).
2. DO NOT think in terms of A/B/C/D when computing finalAnswer. Just focus on the math.
3. finalAnswer must be the actual numeric value that correctly solves the problem.
4. At the end, you MAY mention which option corresponds to finalAnswer in the explanation, but NOT in the finalAnswer value itself.

Important:
- finalAnswer must be a NUMBER (no units, no commas) that we can compare to the choices.
- Do NOT put "A", "B", "C", "D" into finalAnswer. Only use a pure numeric value.
- If you get a non-integer, return it as a decimal number (e.g., 3.5).

Respond ONLY with JSON of this exact shape:

{
  "finalAnswer": 24,
  "solution": "step-by-step explanation here"
}
`;
    } else {
      // ELA: we still let the model pick the correctIndex
      solverPrompt = `
You are solving a SHSAT-style ELA multiple-choice question.

Question:
${prompt}

Choices:
A) ${choices[0]}
B) ${choices[1]}
C) ${choices[2]}
D) ${choices[3]}

The student chose: ${["A", "B", "C", "D"][userIndex] ?? "unknown"}.

Tasks:
1. Carefully analyze the question and the choices.
2. Decide which ONE option (A, B, C, or D) is correct.
3. Determine whether the student's choice is correct.
4. Explain briefly why.

Respond ONLY with JSON of this exact shape:

{
  "correctIndex": 0,
  "isCorrect": true,
  "solution": "short explanation here"
}
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
        model: "gpt-4o", // you can switch to gpt-4o-mini if you want cheaper, but 4o is more reliable
        messages: [
          {
            role: "system",
            content:
              "You are a careful SHSAT question solver. Always return valid JSON and follow the requested schema exactly.",
          },
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

    // Branch based on subject
    if (subject === "math") {
      // Expect { finalAnswer: number, solution: string }
      let faRaw = result.finalAnswer;
      let finalAnswer;

      if (typeof faRaw === "number") {
        finalAnswer = faRaw;
      } else {
        // Try to parse if it's a string like "24" or "24.0"
        const parsed = parseFloat(String(faRaw).replace(/,/g, "").trim());
        if (!Number.isNaN(parsed)) {
          finalAnswer = parsed;
        }
      }

      if (typeof finalAnswer !== "number" || Number.isNaN(finalAnswer)) {
        console.error("Solver did not return a usable numeric finalAnswer:", result);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Solver did not return numeric finalAnswer" }),
        };
      }

      // Map finalAnswer to one of the 4 choices
      let correctIndex = -1;
      for (let i = 0; i < choices.length; i++) {
        const raw = (choices[i] ?? "").toString().trim();

        // Try numeric comparison
        const num = parseFloat(raw.replace(/,/g, ""));
        if (!Number.isNaN(num) && Math.abs(num - finalAnswer) < 1e-6) {
          correctIndex = i;
          break;
        }
      }

      if (correctIndex === -1) {
        console.error("Could not match finalAnswer to any choice:", {
          finalAnswer,
          choices,
        });
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Could not match finalAnswer to any choice" }),
        };
      }

      const isCorrect = userIndex === correctIndex;

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correctIndex,
          isCorrect,
          solution: result.solution || "",
        }),
      };
    } else {
      // ELA branch – trust correctIndex/isCorrect from model (with validation)
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
    }
  } catch (err) {
    console.error("check-answer function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", details: String(err) }),
    };
  }
};
