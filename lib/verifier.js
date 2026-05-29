// Claim verification — the AI logic.
//
// Given a claim (text and/or image), the corpus of past examples, optional
// source-URL context (fetched and reduced to text), and LIVE WEB SEARCH, produce
// a structured verification report with confidence tier, reasoning chain, cited
// sources, and suggested next actions. The whole prompt is built here so it's
// auditable in one place.

import { loadCorpus, formatCorpusForPrompt } from './corpus.js';
import { fetchUrlText } from './fetch-url.js';
import { parseAiJson } from './json.js';

const SYSTEM_PROMPT = `You are an editorial verification assistant for a Zambian newsroom. Your job is to help journalists check suspect claims circulating on social media, WhatsApp, and other channels — especially in the run-up to the August 2026 Zambian elections.

You CAN search the web. Use it. Check the claim against current, credible reporting and official sources — the Electoral Commission of Zambia (ECZ), reputable Zambian and international outlets, and established fact-checkers (e.g. Africa Check). Prefer primary and well-established sources; be wary of partisan blogs and anonymous pages. You also reason from:
  (a) the claim the journalist is checking
  (b) any fetched source-page content provided below
  (c) past examples of Zambian misinformation the newsroom has collected
  (d) general knowledge of misinformation patterns, journalistic verification practice, and Zambian political context

Your output is a structured report a journalist can act on in 90 seconds. You never declare something verified or false on your own authority — you give the journalist a confidence tier, the reasoning, the sources you relied on, the past examples that look similar, and the specific further checks they should run.

Tiers (use exactly these labels):
  VERIFIED — the claim is well-established and consistent with credible current sources
  CONTESTED — credible sources disagree; the journalist must adjudicate
  LIKELY FALSE — strong signals of fabrication or manipulation; treat with high suspicion
  INSUFFICIENT EVIDENCE — not enough information to judge; specific further checks needed

Be specific. Be brief. No hedging beyond what the tier already conveys. Name the web sources you used and, where you cite a past example, name it by filename so the journalist can find it.`;

const USER_PROMPT_TEMPLATE = ({ claimText, hasImage, sourceUrl, fetchedText, corpus }) => `
Claim to verify:
"""
${claimText || '(no text provided — see attached image)'}
"""

${hasImage ? 'An image was attached with this claim. Read it carefully — extract any visible text, identify the platform if visible (Facebook UI, WhatsApp UI, etc.), and incorporate what you see into your analysis.' : ''}

${sourceUrl ? `Source URL (provided by journalist): ${sourceUrl}` : ''}
${fetchedText ? `\nContent fetched from that URL (may be truncated):\n"""\n${fetchedText}\n"""\n` : ''}

Past examples in the corpus:
${corpus}

Search the web to check this claim, then produce your verification report in this exact JSON shape (and nothing else outside the JSON):

{
  "claim_restated": "<one-sentence neutral restatement of the claim>",
  "tier": "<VERIFIED | CONTESTED | LIKELY FALSE | INSUFFICIENT EVIDENCE>",
  "tier_reason": "<one or two sentences explaining the tier choice>",
  "key_sources": [
    { "title": "<source name/outlet>", "url": "<url if known>", "what_it_says": "<one sentence>" }
  ],
  "matching_examples": [
    { "filename": "<corpus filename>", "why_it_matches": "<one sentence>" }
  ],
  "reasoning_chain": [
    "<step 1>",
    "<step 2>",
    "..."
  ],
  "further_checks": [
    "<specific action the journalist should take, e.g. 'Call the named ECZ spokesperson to confirm'>",
    "<another>"
  ],
  "draft_response": "<if appropriate: a short draft correction, follow-up question, or audience-facing post the newsroom could use. Empty string if not appropriate yet.>"
}

Return ONLY the JSON. No preamble, no markdown fence.
`;

export async function verifyClaim(host, { claimText, imageBase64, imageMimeType, sourceUrl }) {
  const examples = await loadCorpus(host);
  const corpus = formatCorpusForPrompt(examples);

  // Fetch the journalist-supplied URL (best-effort) so the model reasons over
  // the actual page content, not just the link.
  const fetchedText = sourceUrl ? await fetchUrlText(sourceUrl) : null;

  const userPrompt = USER_PROMPT_TEMPLATE({
    claimText,
    hasImage: !!imageBase64,
    sourceUrl,
    fetchedText,
    corpus,
  });

  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: imageMimeType || 'image/jpeg', data: imageBase64 },
    });
  }
  content.push({ type: 'text', text: userPrompt });

  const response = await host.ai.chat(
    [{ role: 'user', content }],
    { system: SYSTEM_PROMPT, maxTokens: 2500, webSearch: { maxUses: 5 } }
  );

  const parsed = parseAiJson(response);
  if (!parsed.ok) {
    return { ok: false, error: 'parse_failed', raw: parsed.raw, message: parsed.message };
  }

  // Citations harvested by the runtime from the web_search tool results.
  const citations = Array.isArray(response?.citations) ? response.citations : [];

  return {
    ok: true,
    report: parsed.value,
    citations,
    source_fetched: !!fetchedText,
    corpus_size: examples.length,
    timestamp: new Date().toISOString(),
  };
}
