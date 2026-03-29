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
    // Request extra for math so discards don't leave the user short
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
- Do NOT include answer choices — only write the question text. Choices will be generated separately.

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
  - Otherwise, focus primarily on that topic but still allow secondary concepts to appear.

Difficulty:
- Difficulty: ${difficulty} (easy / medium / hard).
- "Easy": still multi-step, but with cleaner numbers and fewer conditions.
- "Medium": realistic SHSAT average difficulty with 3 to 4 steps and at least one trap.
- "Hard": 4 to 5 steps, layered conditions, or combined topics. The path to the answer should not be obvious.

Numbers and realism:
- Use numbers that yield clean integer or simple decimal answers (e.g. 0.5, 1.5, 2.5, 0.25).
- Keep arithmetic within what a strong 8th grader can do without a calculator.

Constraints:
- Only math; NO reading-comprehension-style questions.
- NO diagrams, NO graphs, NO images. Describe any table or situation in words.
- Questions must be solvable without a calculator by a well-prepared SHSAT test-taker.

Output format (strict JSON only):
Return ONLY valid JSON with this exact shape:

{
  "questions": [
    {
      "prompt": "question text here",
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
- Reading Comprehension: base questions on dense, complex passages; ask about implied meaning, author's purpose, tone — never just literal recall
- Math: include 2-3 step word problems, number theory, geometry with algebraic unknowns, and combinatorics
- Always return valid JSON only — no markdown, no commentary outside the JSON.`,
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
      const validQuestions = questions.filter(q => q && q.prompt);

      // For each question: solve independently, generate distractors, shuffle all 4.
      const solveOne = async (q) => {
        try {
          // ── Step 1: Solve ─────────────────────────────────────────────────
          const solverPrompt = `Solve this SHSAT math question step by step.

Question:
${q.prompt}

Return ONLY valid JSON — no prose, no markdown, nothing outside the JSON:

{
  "finalAnswer": 24,
  "solution": "concise step-by-step explanation (3-5 lines max)"
}

Rules:
- finalAnswer must be a plain number (integer or decimal, no units, no commas)
- Do NOT write anything before or after the JSON`;

          const solverRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 1024,
              system: "You are a careful SHSAT math solver. Always return valid JSON.",
              messages: [{ role: "user", content: solverPrompt }],
              temperature: 0.1,
            }),
          });

          if (!solverRes.ok) { console.error("Solver error:", await solverRes.text()); return null; }
          const solverData = await solverRes.json();
          const solverText = solverData.content?.[0]?.text;
          if (!solverText) return null;

          const solverCleaned = solverText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
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
          const solution = solverResult.solution || "";

          // ── Step 2: Generate 3 distractors ────────────────────────────────
          const distractorPrompt = `A student is solving this math question. The correct answer is ${finalAnswer}.

Question: ${q.prompt}

Generate exactly 3 wrong answer choices a student might arrive at from common errors such as:
- Skipping a step or misreading a condition in the problem
- Using the wrong formula or operation
- Making a percent, ratio, or fraction conversion error
- Arithmetic error in the middle of multi-step work

Return ONLY valid JSON — no prose, no markdown, nothing outside the JSON:

{
  "distractors": [wrong1, wrong2, wrong3]
}

Rules:
- All values must be numbers (integers or decimals matching the format of ${finalAnswer})
- None may equal ${finalAnswer}
- Make them close and believable — not obviously wrong`;

          const distRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 256,
              system: "You are a math educator generating plausible wrong answers. Always return valid JSON.",
              messages: [{ role: "user", content: distractorPrompt }],
              temperature: 0.7,
            }),
          });

          if (!distRes.ok) { console.error("Distractor error:", await distRes.text()); return null; }
          const distData = await distRes.json();
          const distText = distData.content?.[0]?.text;
          if (!distText) return null;

          const distCleaned = distText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
          const distResult = JSON.parse(extractJson(distCleaned) ?? distCleaned);

          if (!Array.isArray(distResult.distractors) || distResult.distractors.length < 3) {
            console.error("Distractor call returned invalid result:", distResult);
            return null;
          }
          const distractors = distResult.distractors
            .slice(0, 3)
            .map(Number)
            .filter(n => !Number.isNaN(n) && Math.abs(n - finalAnswer) > 1e-6);
          if (distractors.length < 3) {
            console.error("Not enough valid distractors:", distResult);
            return null;
          }

          // ── Step 3: Shuffle all 4 answers ─────────────────────────────────
          const pool = [
            { val: finalAnswer, isCorrect: true },
            ...distractors.map(d => ({ val: d, isCorrect: false })),
          ];
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          const correctIndex = pool.findIndex(x => x.isCorrect);
          const choices = pool.map(x => String(x.val));

          // Sanity check: correctIndex must point to a choice that parses back to finalAnswer.
          const verifyNum = parseFloat(choices[correctIndex]);
          if (Math.abs(verifyNum - finalAnswer) > 1e-6) {
            console.error("Quality check failed: finalAnswer not found in choices", { finalAnswer, choices, correctIndex });
            return null;
          }

          // Discard if the solver showed signs of confusion — these indicate a broken question.
          const confusionPhrases = [
            "let me redo", "let me recheck", "let me recalculate", "let me re-",
            "wait,", "wait.", "hmm", "not integer", "doesn't work", "that's not",
            "let me try", "try again", "re-examine", "actually,", "actually.",
          ];
          const solutionLower = solution.toLowerCase();
          if (confusionPhrases.some(p => solutionLower.includes(p))) {
            console.warn("Discarding question: solver showed confusion in solution", { prompt: q.prompt, solution });
            return null;
          }

          return { ...q, choices, correctIndex, correctAnswer: String(finalAnswer), solution };
        } catch (e) {
          console.error("solveOne failed:", q.prompt, e);
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
