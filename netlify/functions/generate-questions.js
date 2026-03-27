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
    const subject = body.subject || "math";
    const topic = body.topic || "mixed";
    const difficulty = body.difficulty || "medium";
    const count = Math.max(1, Math.min(10, Number(body.count) || 5));
    const recentPrompts = Array.isArray(body.recentPrompts) ? body.recentPrompts.slice(0, 20) : [];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }),
      };
    }

    // Build subject-specific instructions
    let userPrompt;

    if (subject === "math") {
  userPrompt = `Your job:
- Create questions that look, feel, and behave like real NYC SHSAT Math questions.
- Do NOT include the correct answer or any solution. Just write the question and answer choices.

Core style (very important):
- Match the difficulty and flavor of official NYCDOE SHSAT math questions (2024 samples).
- Every question is a compact, information-dense word problem.
- The student should need to translate the story into equations/relationships and reason for several steps.

Reasoning requirements:
- Each question must require at least 3 distinct math reasoning steps (set up, transform, solve, interpret).
- Avoid one-step or “plug in numbers and compute once” problems.
- At most 1 small arithmetic step can be trivial; the rest must involve reasoning (setting proportions, equations, or combining conditions).

Question format:
- 100% must be word problems.
- NO bare “compute” questions like “What is 35 × 12?”
- Use realistic contexts: money, discounts, tax, simple interest, time/distance/rate, averages, mixtures, test scores, geometry in context (perimeter, area, angles, volume), tables, simple charts described in words, ratios and proportions, integer operations, inequalities.
- Use grade 7–8 math vocabulary: “constant rate,” “proportional,” “scale factor,” “linear relationship,” “term,” “expression,” “inequality,” etc.
- Hide the math slightly inside the wording so the student has to read carefully.

Topic coverage:
- Topics allowed: fractions, ratios, proportions, percentages (including percent increase/decrease), simple and multi-step equations, inequalities, integer arithmetic, absolute value in context, geometry (described in words), basic probability, averages, and interpreting small data tables in words.
- Use the provided topic preference:
  - If topic === "mixed": mix across common SHSAT math topics.
  - Otherwise, focus primarily on that topic but still allow secondary concepts to appear (for example, a geometry problem that also requires solving an equation).

Difficulty:
- Difficulty: \${difficulty} (easy / medium / hard).
- "Easy": still multi-step, but with cleaner numbers and fewer conditions.
- "Medium": realistic SHSAT average difficulty with 3 to 4 steps and at least one trap (e.g., extra information or a subtle condition).
- "Hard": 4 to 5 steps, layered conditions, or combined topics (e.g., percent + ratio, geometry + algebra). The path to the answer should not be obvious.

Numbers and realism:
- Use mostly non-trivial numbers (e.g., 18, 27, 45, 72, 150, 240) rather than very small or “too clean” ones, unless the difficulty is easy.
- Allow fractions or decimals in choices when natural (e.g., 1.5, 2.4, 3/5).
- Keep arithmetic within what a strong 8th grader can do without a calculator.

Answer choices:
- Each question must have EXACTLY 4 answer choices (A, B, C, D).
- Choices MUST be numeric (integers, fractions, or decimals).
- Wrong choices must be plausible distractors that come from:
  - common misreads (missing a condition),
  - forgetting to convert a percent or rate correctly,
  - using the wrong total/denominator in a ratio,
  - making a typical order-of-operations or equation setup error.
- Do NOT say or hint which choice is correct.
- Do NOT include phrases like “Correct answer:”, “The answer is”, or any solution steps.

Constraints:
- Only math; NO reading-comprehension-style questions.
- NO diagrams, NO graphs, NO images. If needed, describe any table or situation in words.
- Questions must be solvable without a calculator by a well-prepared SHSAT test-taker within about 1–3 minutes.

Output format (strict JSON only):
Return ONLY valid JSON with this exact shape:

{
  "questions": [
    {
      "prompt": "question text here",
      "choices": ["choice A", "choice B", "choice C", "choice D"],
      "topic": "percent | ratios | algebra | geometry | mixed",
      "difficulty": "easy | medium | hard"
    }
  ]
}

There should be exactly ${count} questions.
`;

    }else {
      // ELA mode: reading + editing SHSAT-style
      userPrompt = `
You are generating SHSAT-style ELA multiple-choice questionms.

Overall requirements:
- ONLY English Language Arts tasks.
- Match the tone, structure, and difficulty of official NYC SHSAT ELA questions.
- Two main types:
  1) READING COMPREHENSION with a short passage (3–6 short paragraphs, about 250–450 words) and questions about meaning, inference, vocabulary-in-context, structure, or author's purpose.
  2) REVISING & EDITING short sentences or very short paragraphs (grammar, punctuation, clarity, word choice, sentence structure, and transitions).

Difficulty and topic control:
- Difficulty: ${difficulty} (easy/medium/hard).
  - "Easy": straightforward main idea, explicit details, basic grammar or punctuation.
  - "Medium": mix of literal and inferential questions, more subtle word choice, multi-clause sentences, common grammar traps.
  - "Hard": nuanced inference, author's attitude/tone, subtle vocabulary in context, and revision questions involving multiple errors or tricky sentence structure.
- Topic preference: ${topic}.
  - If topic === "reading": most or all questions should be reading-comprehension style.
  - If topic === "editing": most or all questions should be revising & editing style.
  - If topic === "mixed": mix both styles across the ${count} questions.

READING COMPREHENSION style (SHSAT-like):
- Use topic: "reading".
- Include a passage field with the full passage text for each reading question.
- Passages should be:
  - 3 to 6 short paragraphs, about 250 to 450 words total.
  - Written at a strong 7th to 8th grade reading level.
  - Clear but not childish; include some complex sentences and varied vocabulary.
- Passage genres:
  - Realistic fiction (scenes with characters, dialogue, internal thoughts).
  - Literary nonfiction (memoir-like scenes, historical moments, personal reflections).
  - Informational or argumentative text (science, history, social topics) with a clear central idea.
- Reading question types (vary across questions):
  - Main idea / central idea.
  - Key detail / supporting evidence.
  - Inference about character, motivation, or implied ideas.
  - Vocabulary in context (choose the best meaning of a word or phrase as used in the passage).
  - Author's purpose, tone, or attitude.
  - Text structure or the role of a particular paragraph or sentence.
- Avoid trivia-type questions; each question should require careful reading and reasoning, not just grabbing a random detail.

REVISING & EDITING style (SHSAT-like):
- Use topic: "editing".
- No passage field is required (but you may include a short 1–3 sentence context if needed).
- Focus on:
  - Grammar: subject-verb agreement, pronoun agreement, verb tense consistency.
  - Punctuation: commas in compound or complex sentences, commas with introductory phrases, apostrophes, and end punctuation.
  - Sentence structure: run-ons, fragments, awkward phrasing, misplaced or dangling modifiers.
  - Clarity and concision: choosing the best word or phrase, removing redundancy.
  - Transitions and logical connections between ideas.
- Typical formats:
  - “Which revision of the underlined portion is best?”
  - “Which sentence best combines these two sentences?”
  - “Which choice correctly completes the sentence?”
  - “Which choice makes the paragraph clearer or more formal?”

Answer choices and correctness:
- Each question must have EXACTLY 4 answer choices: A, B, C, D.
- Exactly ONE choice is correct for each question.
- correctIndex must be an integer 0–3 corresponding to the correct choice in the choices array.
- Wrong answer choices should be plausible:
  - READING: reflect common misreadings, partial understanding, or misinterpretation of the passage.
  - EDITING: reflect common grammar mistakes or almost-correct but slightly off phrasing.
- Do NOT include explanations or reasoning. Do NOT say which letter is correct in the text; only use correctIndex.

JSON format requirements:
- You may reuse the SAME passage text for multiple READING questions; to keep it simple, include the passage text in a passage field on EACH reading question that needs it.
- For READING questions:
  - Use topic: "reading".
  - Include a passage string field with the passage text.
- For EDITING questions:
  - Use topic: "editing".
  - They can be self-contained (no passage field needed) or include a very short context if helpful.
- If topic === "mixed", the "topic" field on each question must correctly reflect that question's type: "reading" or "editing". Do NOT use "mixed" per-question.

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

Rules for JSON:
- Double quotes around all keys and string values.
- No trailing commas.
- The "difficulty" field for each question must match one of: "easy", "medium", "hard".
- The "topic" field should correctly describe the question type as used above.

There should be exactly ${count} questions.
`;
    }

    if (recentPrompts.length > 0) {
      userPrompt += `\nDo NOT repeat or closely paraphrase any of these recently seen questions:\n${recentPrompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n`;
    }

    // Call Anthropic Messages API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: `You are an expert SHSAT test prep tutor. Generate questions at the EXACT difficulty level of the real SHSAT exam administered by the NYC DOE.

SHSAT-specific rules:
- Scrambled Paragraphs: sentences must have subtle logical traps where 2-3 orderings seem plausible
- Logical Reasoning: use multi-step deductions, NOT obvious one-step logic
- Reading Comprehension: base questions on dense, complex passages (science, history, philosophy); ask about implied meaning, author's purpose, tone — never just literal recall
- Math: include 2-3 step word problems, number theory, geometry with algebraic unknowns, and combinatorics
- Wrong answer choices must be "attractive wrong answers" — common misconceptions or off-by-one errors

After generating each question, self-critique: "Would an 8th grader find this trivially easy?" If yes, increase complexity before outputting.

Always return valid JSON only — no markdown, no commentary outside the JSON.`,
        messages: [
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "LLM request failed", details: errText }),
      };
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      console.error("No content in OpenAI response:", JSON.stringify(data, null, 2));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No content from model" }),
      };
    }

    let questionsPayload;
    try {
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      questionsPayload = JSON.parse(cleaned);
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
let questions = questionsPayload.questions;

// If math: run a solver pass to find the correct answer for each question (all in parallel)
if (subject === "math") {
  const validQuestions = questions.filter(q => q && Array.isArray(q.choices) && q.choices.length === 4);

  const solveOne = async (q) => {
    const solverPrompt = `Solve this SHSAT math question and identify the correct answer choice.

Question:
${q.prompt}

Choices:
A) ${q.choices[0]}
B) ${q.choices[1]}
C) ${q.choices[2]}
D) ${q.choices[3]}

YOUR RESPONSE MUST BE ONLY RAW JSON — no prose, no markdown, no explanation outside the JSON.

{
  "correctIndex": 0,
  "solution": "step-by-step explanation here"
}

Rules:
- correctIndex: 0 = A, 1 = B, 2 = C, 3 = D
- solution: concise step-by-step explanation inside the JSON string
- Do NOT write anything before or after the JSON object`;

    try {
      const solverResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: "You are a careful SHSAT math solver. Always return valid JSON.",
          messages: [{ role: "user", content: solverPrompt }],
          temperature: 0.1,
        }),
      });

      if (!solverResponse.ok) {
        console.error("Solver API error:", await solverResponse.text());
        return null;
      }

      const solverData = await solverResponse.json();
      const solverContent = solverData.content?.[0]?.text;
      if (!solverContent) return null;

      const solverCleaned = solverContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const jsonMatch = solverCleaned.match(/\{[\s\S]*\}/);
      const solverResult = JSON.parse(jsonMatch ? jsonMatch[0] : solverCleaned);

      const ci = solverResult.correctIndex;
      if (!Number.isInteger(ci) || ci < 0 || ci >= q.choices.length) return null;

      return { ...q, correctIndex: ci, correctAnswer: q.choices[ci], solution: solverResult.solution || "" };
    } catch (e) {
      console.error("Solver failed for question:", q.prompt, e);
      return null;
    }
  };

  const results = await Promise.all(validQuestions.map(solveOne));
  questions = results.filter(Boolean);
} else {
  // Non-math (ELA) branch: you can keep your existing sanity checks here if you like
  questions = questions.filter(q => q && Array.isArray(q.choices) && q.choices.length === 4);
}

// Replace payload questions with the final list
questionsPayload.questions = questions;

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