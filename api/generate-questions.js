// api/generate-questions.js

const questionBank = require("../shsat_question_bank.json");

function pickExamples(section, subsection, n) {
  const pool = questionBank.questions.filter(q =>
    q.section === section &&
    (!subsection || q.subsection === subsection) &&
    q.choices && q.choices.length === 4
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

function formatExample(q) {
  const choices = q.choices.map(c => c.replace(/^[A-H]\.\s*/, "").trim());
  return `Question: ${q.question}\nChoices: ${choices.map((c, i) => `${["A","B","C","D"][i]}) ${c}`).join(" | ")}\nCorrect answer: ${q.answer}`;
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
    const subject = body.subject || "math";
    const topic = body.topic || "mixed";
    const difficulty = body.difficulty || "medium";
    const count = Math.max(1, Math.min(10, Number(body.count) || 5));
    const generateCount = subject === "math" ? Math.min(count + 3, 13) : count;
    const recentPrompts = Array.isArray(body.recentPrompts) ? body.recentPrompts.slice(0, 20) : [];
    const recentGenres = Array.isArray(body.recentGenres) ? body.recentGenres.slice(0, 6) : [];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
    }

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
- Avoid one-step or "plug in numbers and compute once" problems.
- At most 1 small arithmetic step can be trivial; the rest must involve reasoning (setting proportions, equations, or combining conditions).

Question format:
- 100% must be word problems.
- NO bare "compute" questions like "What is 35 × 12?"
- Use realistic contexts: money, discounts, tax, simple interest, time/distance/rate, averages, mixtures, test scores, geometry in context (perimeter, area, angles, volume), tables, simple charts described in words, ratios and proportions, integer operations, inequalities.
- Use grade 7–8 math vocabulary: "constant rate," "proportional," "scale factor," "linear relationship," "term," "expression," "inequality," etc.
- Hide the math slightly inside the wording so the student has to read carefully.

Topic coverage:
- Topics allowed: fractions, ratios, proportions, percentages (including percent increase/decrease), simple and multi-step equations, inequalities, integer arithmetic, absolute value in context, geometry (described in words), basic probability, averages, and interpreting small data tables in words.
- Use the provided topic preference:
  - If topic === "mixed": mix across common SHSAT math topics.
  - Otherwise, focus primarily on that topic but still allow secondary concepts to appear (for example, a geometry problem that also requires solving an equation).

Difficulty:
- Difficulty: ${difficulty} (easy / medium / hard).
- "Easy": still multi-step, but with cleaner numbers and fewer conditions.
- "Medium": realistic SHSAT average difficulty with 3 to 4 steps and at least one trap (e.g., extra information or a subtle condition).
- "Hard": 4 to 5 steps, layered conditions, or combined topics (e.g., percent + ratio, geometry + algebra). The path to the answer should not be obvious.

Numbers and realism:
- Use mostly non-trivial numbers (e.g., 18, 27, 45, 72, 150, 240) rather than very small or "too clean" ones, unless the difficulty is easy.
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
- Do NOT include phrases like "Correct answer:", "The answer is", or any solution steps.

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

There should be exactly ${generateCount} questions.

Here are real SHSAT math questions from the official NYC DOE sample test. Match their style, complexity, and phrasing exactly:

${pickExamples("math", "multiple_choice", 3).map(formatExample).join("\n\n")}
`;
    } else {
      const readingCount = topic === "editing" ? 0 : Math.min(5, topic === "reading" ? count : Math.max(1, Math.ceil(count * 0.6)));
      const editingCount = count - readingCount;

      userPrompt = `
You are generating ${count} SHSAT-style ELA questions: ${readingCount} reading comprehension and ${editingCount} revising & editing.

Difficulty: ${difficulty}

════════════════════════════════
PART 1 — READING COMPREHENSION (${readingCount} questions)
════════════════════════════════

Step 1: Write ONE passage. All ${readingCount} reading questions must be about this single passage.
- Exactly 5 paragraphs, 350–500 words total.
- Genre: choose one — realistic fiction, literary nonfiction (memoir/historical), or informational/argumentative (science, history, social issues).${recentGenres.length > 0 ? `\n- AVOID these recently used genres/topics: ${recentGenres.join(", ")}. Pick something clearly different.` : ""}
- Also include a "passageGenre" field at the top level of your JSON (e.g. "realistic fiction", "historical nonfiction", "science informational") so the system can track variety.
- Level: strong 7th–8th grade. Complex sentences, varied vocabulary, NOT childish.
- The passage must reward careful reading — include implicit meaning, shifting tone, or layered ideas that support inference questions.

Step 2: Write exactly ${readingCount} questions about that passage. Use a VARIETY of these types (do not repeat the same type):
- Central idea or main argument
- Key detail with supporting evidence
- Inference about character motive, implied meaning, or cause/effect
- Vocabulary in context (meaning of a specific word or phrase AS USED in the passage)
- Author's purpose, tone, or attitude
- Role of a specific paragraph or sentence in the structure

Wrong answer choices must be "attractive wrong answers": plausible misreadings, partially correct, or answers supported by only one part of the passage.

JSON for reading questions:
- Set "topic": "reading" on every reading question.
- Set "passage" to the FULL passage text on the FIRST reading question only.
- Set "passage": "" on all subsequent reading questions (the frontend reuses the last passage seen).

════════════════════════════════
PART 2 — REVISING & EDITING (${editingCount} questions)
════════════════════════════════

Write exactly ${editingCount} standalone grammar/editing questions. Each is self-contained (no shared passage needed).

Focus areas (vary across questions):
- Subject-verb agreement, pronoun agreement, verb tense consistency
- Commas in compound/complex sentences, introductory phrases, appositives, apostrophes
- Run-ons, fragments, misplaced or dangling modifiers
- Redundancy, clarity, word choice
- Logical transitions between ideas

Formats:
- "Which revision of the underlined portion is best?"
- "Which choice correctly completes the sentence?"
- "Which sentence best combines these two sentences?"

Wrong choices: reflect common student errors — comma splices, agreement mismatches, awkward-but-not-wrong phrasing.

JSON for editing questions:
- Set "topic": "editing".
- Omit the "passage" field entirely.

════════════════════════════════
OUTPUT FORMAT
════════════════════════════════

Return ONLY valid JSON — no markdown, no text outside the JSON.

{
  "questions": [
    {
      "prompt": "question text",
      "passage": "full passage (first reading question only) | empty string (subsequent reading) | omit (editing)",
      "choices": ["A text", "B text", "C text", "D text"],
      "correctIndex": 0,
      "topic": "reading | editing",
      "difficulty": "${difficulty}"
    }
  ]
}

Rules:
- Exactly ${count} questions total (${readingCount} reading, then ${editingCount} editing).
- Each question: exactly 4 choices, correctIndex 0–3, topic is "reading" or "editing".
- No trailing commas. Double quotes on all keys and string values.

Here are real SHSAT ELA questions from the official NYC DOE sample test. Match their style exactly:

${editingCount > 0 ? `REVISING & EDITING examples:\n${pickExamples("ela", "revising_editing", 2).map(formatExample).join("\n\n")}` : ""}
${readingCount > 0 ? `READING COMPREHENSION examples:\n${pickExamples("ela", "reading_comprehension", 2).map(formatExample).join("\n\n")}` : ""}
`;
    }

    const contexts = subject === "math"
      ? ["a school fundraiser", "a construction project", "a science experiment", "a sports league", "a bakery", "a road trip", "a garden", "a swimming pool", "a library", "a stock portfolio"]
      : ["environmental science", "ancient history", "modern art", "space exploration", "immigration", "music theory", "economics", "civil rights", "marine biology", "architecture"];
    const pickedContext = contexts[Math.floor(Math.random() * contexts.length)];
    userPrompt += `\nVariety requirement: use a fresh context or scenario not seen recently. Suggested theme to draw from: "${pickedContext}". Vary character names, numbers, and settings across questions.\n`;

    if (recentPrompts.length > 0) {
      userPrompt += `\nDo NOT repeat or closely paraphrase any of these recently seen questions:\n${recentPrompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n`;
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
        max_tokens: 8192,
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
        temperature: subject === "ela" ? 1.0 : 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(500).json({ error: "LLM request failed", details: errText });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      console.error("No content in Anthropic response:", JSON.stringify(data, null, 2));
      return res.status(500).json({ error: "No content from model" });
    }

    let questionsPayload;
    try {
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      questionsPayload = JSON.parse(extractJson(cleaned) ?? cleaned);
    } catch (e) {
      console.error("Failed to parse JSON from model:", content);
      return res.status(500).json({ error: "Failed to parse questions JSON" });
    }

    if (!questionsPayload.questions || !Array.isArray(questionsPayload.questions)) {
      console.error("Invalid questions format:", questionsPayload);
      return res.status(500).json({ error: "Invalid questions format from model" });
    }

    let questions = questionsPayload.questions;

    if (subject === "math") {
      const validQuestions = questions.filter(q => q && Array.isArray(q.choices) && q.choices.length === 4);

      const solveOne = async (q) => {
        const solverPrompt = `Solve this SHSAT math question. Do NOT look at the answer choices — just solve it independently.

Question:
${q.prompt}

YOUR RESPONSE MUST BE ONLY RAW JSON — no prose, no markdown, no explanation outside the JSON.

{
  "finalAnswer": 24,
  "solution": "concise step-by-step explanation (3-5 lines max)"
}

Rules:
- finalAnswer must be a plain number (integer or decimal, no units, no commas)
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
              max_tokens: 2048,
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
          const solverResult = JSON.parse(extractJson(solverCleaned) ?? solverCleaned);

          let finalAnswer;
          if (typeof solverResult.finalAnswer === "number") {
            finalAnswer = solverResult.finalAnswer;
          } else {
            const parsed = parseFloat(String(solverResult.finalAnswer).replace(/,/g, "").trim());
            if (!Number.isNaN(parsed)) finalAnswer = parsed;
          }

          if (typeof finalAnswer !== "number" || Number.isNaN(finalAnswer)) {
            console.error("Solver did not return a usable finalAnswer:", solverResult);
            return null;
          }

          // If all choices are integers but the answer isn't, the question is mathematically
          // broken — discard it rather than injecting a non-integer into integer choices.
          const choiceNums = q.choices.map(c => parseChoiceToNumber(c));
          const allChoicesAreIntegers = choiceNums.every(n => !Number.isNaN(n) && Number.isInteger(n));
          if (allChoicesAreIntegers && !Number.isInteger(finalAnswer)) {
            console.warn("Discarding broken question (integer choices but non-integer answer):", { finalAnswer, prompt: q.prompt });
            return null;
          }

          // Try to match finalAnswer to an existing choice
          const choices = [...q.choices];
          let correctIndex = -1;
          for (let i = 0; i < choices.length; i++) {
            const num = parseChoiceToNumber(choices[i]);
            if (!Number.isNaN(num) && Math.abs(num - finalAnswer) < 1e-6) {
              correctIndex = i;
              break;
            }
          }

          // No matching choice — inject the correct answer at a random position
          if (correctIndex === -1) {
            const answerStr = Number.isInteger(finalAnswer) ? String(finalAnswer) : String(finalAnswer);
            correctIndex = Math.floor(Math.random() * choices.length);
            choices[correctIndex] = answerStr;
            console.warn("Injected correct answer into choices:", { finalAnswer, correctIndex, choices });
          }

          return { ...q, choices, correctIndex, correctAnswer: choices[correctIndex], solution: solverResult.solution || "" };
        } catch (e) {
          console.error("Solver failed for question:", q.prompt, e);
          return null;
        }
      };

      const results = await Promise.all(validQuestions.map(solveOne));
      questions = results.filter(Boolean).slice(0, count);
    } else {
      questions = questions.filter(q => q && Array.isArray(q.choices) && q.choices.length === 4);
    }

    questionsPayload.questions = questions;

    return res.status(200).json(questionsPayload);
  } catch (err) {
    console.error("Function error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
};
