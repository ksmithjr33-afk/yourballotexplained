// api/generate.js  —  Vercel serverless function (CommonJS)
// Reads a voter's ballot screenshot with the Claude API and returns a structured guide.
// Your API key is read from the ANTHROPIC_API_KEY environment variable (set in Vercel settings).

const PROMPT = `You are looking at a screenshot of a voter's official ballot or ballot-lookup results (from Vote411 or a county elections site).
Read every office and the candidates listed, then produce a nonpartisan "Your Ballot, Explained" guide.

RULES:
- Transcribe candidate names and parties EXACTLY as shown. Never invent, add, remove, or change a name. If a name is unclear, write "[unclear - verify]".
- Only include offices and candidates that are actually visible in the image.
- For each office, write ONE plain-English sentence describing what it actually controls in a person's daily life.
- Give each office a daily-life impact score from 0 to 100, based on three things: proximity (does it hit your street, taxes, or family), frequency (how often you feel it), and control (one officeholder vs. one vote among many). Local offices like city council and school board usually score highest; federal offices usually score a bit lower.
- NEVER say who to vote for, rank candidates, or characterize any candidate. Only list them.

OUTPUT: Respond with ONLY valid JSON (no markdown fences, no commentary), in exactly this schema:
{"location":"<city or area if visible, else empty string>","offices":[{"office":"<name>","level":"<one of: federal, state, county, local, courts>","whatItControls":"<one sentence>","impact":<number 0-100>,"candidates":[{"name":"<exact name>","party":"<R, D, Ind, Lib, Grn, other, or empty>"}]}]}
If the image is clearly NOT a ballot, respond with: {"error":"That doesn't look like a ballot. Please upload your Vote411 ballot screenshot."}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in your Vercel project settings, then redeploy." }); return; }

  try {
    const body = req.body || {};
    const image = body.image, mediaType = body.mediaType;
    if (!image) { res.status(400).json({ error: "No image was received." }); return; }

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // If this model name ever errors, get a current one from https://docs.anthropic.com/en/docs/about-claude/models
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });

    const data = await apiRes.json();
    if (data.error) { res.status(502).json({ error: (data.error && data.error.message) || "The AI service returned an error." }); return; }

    let text = (data.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join("").trim();
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { res.status(200).json({ error: "Couldn't read that ballot clearly. Try a sharper, fuller screenshot." }); return; }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || "Something went wrong on the server." });
  }
};
