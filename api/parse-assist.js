/**
 * Vercel serverless function — the ONLY place that ever reads ANTHROPIC_API_KEY.
 * This is a Node function that runs on Vercel's infrastructure, never shipped to
 * the browser, so the key stays server-side. Never move this logic into client
 * code (src/ or portal/*.html) — those ship as plain-text JS to every visitor of
 * this public repo's deployment, and an embedded key there is stolen the moment
 * anyone opens dev tools.
 *
 * Purpose: when the deterministic Estimates→Quotes/Cost Planner bridge
 * (src/lib/estimateImport.js, portal/cost-planner.html's importPublishedEstimates)
 * can't confidently match a takeoff line to a catalog product, this endpoint asks
 * an LLM to SUGGEST the best candidate. It only ever returns a suggestion — the
 * caller decides whether to show/apply it. This preserves the app's existing
 * "flag rather than silently guess" rule (see CLAUDE.md): a wrong AI suggestion
 * applied without review would be exactly the kind of silent-wrong-number bug
 * that rule exists to prevent.
 *
 * Setup required (not done by this file): add ANTHROPIC_API_KEY as a server-side
 * environment variable in the Vercel project (Project → Settings → Environment
 * Variables). Do NOT prefix it with VITE_ — that prefix tells Vite to bundle a
 * variable into client code, which would defeat the whole point.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "AI-assisted matching isn't configured yet — set ANTHROPIC_API_KEY in this Vercel project's Environment Variables (server-side only, no VITE_ prefix).",
    });
    return;
  }

  const { line, candidates } = req.body || {};
  if (!line || !Array.isArray(candidates) || candidates.length === 0) {
    res.status(400).json({ error: "Request body must be { line: {...}, candidates: [{...}, ...] }" });
    return;
  }
  if (candidates.length > 50) {
    res.status(400).json({ error: "Too many candidates (max 50) — narrow the list before calling this endpoint." });
    return;
  }

  const prompt = `A concrete/reinforcement/formwork takeoff line from a construction estimate could not be confidently matched to a catalog product by exact-name rules. Pick the single best match from the numbered candidate list below, or say none genuinely fit — do not force a match that isn't a real fit.

Takeoff line:
${JSON.stringify(line, null, 2)}

Candidate catalog products:
${candidates.map((c, i) => `${i}: ${JSON.stringify(c)}`).join("\n")}

Reply with ONLY a JSON object and nothing else — no markdown fences, no extra text:
{"index": <candidate number, or -1 if none genuinely fit>, "confidence": "high" | "medium" | "low", "reason": "<one short sentence>"}`;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      res.status(502).json({ error: "Anthropic API request failed", detail: detail.slice(0, 500) });
      return;
    }

    const data = await upstream.json();
    const text = data?.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let suggestion;
    try {
      suggestion = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      res.status(502).json({ error: "Could not parse the AI response as JSON", raw: text.slice(0, 500) });
      return;
    }

    if (typeof suggestion.index !== "number" || suggestion.index < -1 || suggestion.index >= candidates.length) {
      res.status(502).json({ error: "AI response had an out-of-range candidate index", raw: suggestion });
      return;
    }

    res.status(200).json({
      index: suggestion.index,
      confidence: suggestion.confidence || "low",
      reason: suggestion.reason || "",
      candidate: suggestion.index >= 0 ? candidates[suggestion.index] : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Request to the AI service failed", detail: String(err) });
  }
}
