// api/generate.js  —  Vercel serverless function (CommonJS)
// Reads one or more ballot screenshots with the Claude API and returns a structured guide.
// Your API key is read from the ANTHROPIC_API_KEY environment variable (set in Vercel settings).

const PROMPT = `You are looking at one or MORE screenshots that together make up a SINGLE voter's official ballot or ballot-lookup results (from Vote411 or a county elections site). The voter may have scrolled and captured different sections, so combine all the images into ONE complete guide. Do not duplicate an office that appears in more than one screenshot.

Read every office and any candidates listed, then produce a nonpartisan "Your Ballot, Explained" guide.

CLEAN UP OFFICE NAMES — translate raw database labels into clean, plain-English office names a normal person would recognize. Strip year prefixes (like "2022"), internal codes (like "PLANE2106"), and jargon ("SMD", "Upper/Lower House District"). Keep the district number in parentheses. Examples:
- "2022 ISD Richardson SMD 4" -> "Richardson ISD School Board (District 4)"
- "2022 City of Dallas District 10" -> "Dallas City Council (District 10)"
- "Dallas County Commissioner Precincts - Precinct 2" -> "Dallas County Commissioner (Precinct 2)"
- "State Upper House District - Senate District 16" -> "Texas State Senator (District 16)"
- "State Lower House District - House District 102" -> "Texas State Representative (District 102)"
- "PLANE2106 - SBOE District 9" -> "State Board of Education (District 9)"
- "US Representative District 32" -> "U.S. Representative (District 32)"

CANDIDATES:
- Transcribe candidate names and parties EXACTLY as shown. Never invent, add, remove, or change a name. If a name is unclear, write "[unclear - verify]".
- If an office is shown but NO candidates are listed yet, return an EMPTY candidates array for it. Do NOT make up names. (It is normal for candidates to be missing months before an election.)

OTHER RULES:
- Only include offices actually visible in the images.
- For each office, write ONE plain-English sentence describing what it actually controls in a person's daily life.
- Give each office a daily-life impact score from 0 to 100, based on: proximity (does it hit your street, taxes, or family), frequency (how often you feel it), and control (one officeholder vs. one vote among many). Local offices like city council and school board usually score highest; federal offices usually score a bit lower.
- NEVER say who to vote for, rank candidates, or characterize any candidate. Only list them.

OUTPUT: Respond with ONLY valid JSON (no markdown fences, no commentary), in exactly this schema:
{"location":"<city or area if visible, else empty string>","offices":[{"office":"<clean plain-English name>","level":"<one of: federal, state, county, local, courts>","whatItControls":"<one sentence>","impact":<number 0-100>,"candidates":[{"name":"<exact name>","party":"<R, D, Ind, Lib, Grn, other, or empty>"}]}]}
If the images are clearly NOT a ballot, respond with: {"error":"That doesn't look like a ballot. Please upload your Vote411 ballot screenshot(s)."}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in your Vercel project settings, then redeploy." }); return; }

  try {
    const body = req.body || {};
    let images = Array.isArray(body.images) ? body.images : null;
    if (!images && body.image) images = [{ data: body.image, mediaType: body.mediaType }];
    if (!images || !images.length) { res.status(400).json({ error: "No images were received." }); return; }
    images = images.slice(0, 8);

    const content = images.map(function (im) {
      return { type: "image", source: { type: "base64", media_type: (im && im.mediaType) || "image/jpeg", data: im.data } };
    });
    content.push({ type: "text", text: PROMPT });

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // If this model name ever errors, get a current one from https://docs.anthropic.com/en/docs/about-claude/models
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: content }],
      }),
    });

    const data = await apiRes.json();
    if (data.error) { res.status(502).json({ error: (data.error && data.error.message) || "The AI service returned an error." }); return; }

    let text = (data.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join("").trim();
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { res.status(200).json({ error: "Couldn't read those ballots clearly. Try sharper, fuller screenshots." }); return; }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || "Something went wrong on the server." });
  }
};
