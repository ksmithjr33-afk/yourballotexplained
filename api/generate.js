// api/generate.js  —  Vercel serverless function (CommonJS)
// Reads ballot screenshots with the Claude API, uses web search to find who's running,
// and returns a structured "Your Ballot, Explained" guide.
// API key comes from the ANTHROPIC_API_KEY environment variable (set in Vercel settings).

const PROMPT = `You are looking at one or MORE screenshots that together make up a SINGLE voter's official ballot or ballot-lookup results (from Vote411 or a county elections site). The voter may have scrolled and captured different sections, so combine all images into ONE complete guide. Do not duplicate an office that appears in more than one screenshot.

STEP 1 — Read the ballot. Identify every office/district shown and the voter's location (state, county, city, district numbers).

STEP 2 — Find the candidates. The screenshots may NOT list candidates. For each office, USE WEB SEARCH to find the candidates running in the CURRENT UPCOMING election for that exact office and district (e.g. search "2026 general election candidates Texas House District 102" or "Dallas City Council District 10 2026 candidates"). Search for each office as needed.

CLEAN UP OFFICE NAMES — translate raw database labels into clean, plain-English names. Strip year prefixes (like "2022"), internal codes (like "PLANE2106"), and jargon ("SMD", "Upper/Lower House District"). Keep the district number in parentheses. Examples:
- "2022 ISD Richardson SMD 4" -> "Richardson ISD School Board (District 4)"
- "State Upper House District - Senate District 16" -> "Texas State Senator (District 16)"
- "PLANE2106 - SBOE District 9" -> "State Board of Education (District 9)"
- "US Representative District 32" -> "U.S. Representative (District 32)"

CANDIDATE RULES (accuracy is critical):
- Only list candidates you actually found in a reliable web search result (official election sites, Ballotpedia, Vote411, county elections offices, reputable news). 
- Transcribe names and parties exactly as sources report them. Never guess or fabricate.
- If you cannot confidently find candidates for an office, return an EMPTY candidates array for it — do NOT make up names. It is fine to leave some empty.
- NEVER say who to vote for, rank candidates, or characterize any candidate. Only list them.

For each office also write ONE plain-English sentence on what it controls in daily life, and a daily-life impact score 0-100 (proximity + frequency + control; local offices usually highest, federal a bit lower).

FINAL OUTPUT — after any searching, respond with ONLY valid JSON (no markdown, no commentary, no explanation), exactly this schema:
{"location":"<city/area if known, else empty>","offices":[{"office":"<clean name>","level":"<federal|state|county|local|courts>","whatItControls":"<one sentence>","impact":<0-100>,"candidates":[{"name":"<exact>","party":"<R|D|Ind|Lib|Grn|other|empty>"}]}]}
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
        max_tokens: 4500,
        // Let Claude search the web to find who's running.
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
        messages: [{ role: "user", content: content }],
      }),
    });

    const data = await apiRes.json();
    if (data.error) { res.status(502).json({ error: (data.error && data.error.message) || "The AI service returned an error." }); return; }

    // Grab all text blocks (the final JSON is in the text output, after any tool use).
    let text = (data.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join("").trim();
    // Pull out the JSON object even if there's stray text around it.
    var start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) { text = text.slice(start, end + 1); }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { res.status(200).json({ error: "Couldn't read those ballots clearly. Try sharper, fuller screenshots." }); return; }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || "Something went wrong on the server." });
  }
};
