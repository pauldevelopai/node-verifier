// Origin analysis — the AI logic for the listener.
//
// Three editorial workflows, three prompts:
//
//   analyzeOrigin(post, pageTransparency)  → Origin Risk Profile
//     Given a single post + its page transparency snapshot, produce a
//     descriptive risk profile with a WHY-chain of reasoning. NOT a
//     numeric score — descriptive flags only, to keep the liability
//     surface small and the editorial judgement intact.
//
//   compareOrigins(posts)                  → Coordination Profile
//     Given two or more posts (typically from different pages), look
//     for content overlap, timing patterns, shared linguistic
//     fingerprint, copied images, narrative synchrony.
//
//   generateBrief(posts, pages)            → Weekly Editorial Brief
//     Given recent analysed posts + the watchlist, write a short
//     editorial brief identifying pattern shifts, behavioural changes,
//     new pages of concern, story leads.
//
// Editorial premise running through all three: we are NOT tracking what
// posts mention — we are tracking where they come from. Origin-based
// filtering. The prompts enforce that focus.

import { formatPageForPrompt } from './pages.js';

// ─── 1. Single-post origin analysis ─────────────────────────────────

const ANALYZE_SYSTEM = `You are an editorial origin-analysis assistant for Capital FM, a Zambian newsroom, working on the August 2026 Zambian election cycle. Your job is to help senior staff assess where political content on Facebook is coming from — not what it says.

Your focus is origin, not topic. You are looking for content that may have been manufactured outside Zambia, by coordinated networks, or by pages misrepresenting their identity. The same political claim from a transparent local page and from a foreign-administered page with a recent name change are two completely different editorial situations.

You reason from:
  (a) the post itself (text and the journalist's own observations)
  (b) the Facebook Page Transparency data senior staff have collected for the page that posted it
  (c) general knowledge of information-operations tradecraft, the Zambian political context, and patterns common to foreign influence operations in Sub-Saharan elections

You do NOT have live web access. You cannot fetch the page or the post.

You never declare a post foreign-manufactured on your own authority. You give the newsroom a descriptive risk profile — flags, reasoning, suggested checks — and let the editor decide. Avoid numeric scores. Use the confidence labels exactly as listed.`;

const ANALYZE_USER = ({ postText, pageBlock, journalistNotes, postUrl }) => `
Post text (paste from senior staff):
"""
${postText || '(no text provided)'}
"""

${postUrl ? `Post URL (provided, not fetched): ${postUrl}` : ''}

Page Transparency snapshot for the page that posted this:
${pageBlock}

${journalistNotes ? `Journalist notes / what triggered the concern:\n${journalistNotes}\n` : ''}

Produce an Origin Risk Profile in this exact JSON shape (and nothing else outside the JSON):

{
  "post_restated": "<one-sentence neutral restatement of what the post is saying>",
  "confidence": "<LOW CONCERN | WORTH WATCHING | STRONG SIGNALS | HIGHLY COORDINATED>",
  "confidence_reason": "<one or two sentences explaining the confidence label>",
  "flags": [
    {
      "category": "<one of: transparency_mismatch | linguistic_tells | talking_point_lift | timing_pattern | identity_history | platform_artefact | other>",
      "observation": "<the specific thing you noticed>",
      "weight": "<minor | notable | significant>"
    }
  ],
  "why_chain": [
    "<step 1 of the reasoning — start from the observable evidence, not the conclusion>",
    "<step 2>",
    "<step 3>",
    "..."
  ],
  "further_checks": [
    "<a specific action senior staff should take, e.g. 'Check Meta Ad Library for spend by this page in the last 30 days'>",
    "<another>"
  ],
  "what_NOT_to_publish": "<one or two sentences: things the newsroom must NOT do based on this analysis alone — e.g. name the page as foreign-run, attribute to a specific country, claim coordination without further evidence>",
  "editorial_lead": "<one sentence: if this is worth a story, what's the angle? Empty string if not.>"
}

Confidence labels (use exactly):
  LOW CONCERN — page looks normal; no meaningful origin signals
  WORTH WATCHING — one or two soft signals; track but don't act
  STRONG SIGNALS — multiple converging indicators; the newsroom should investigate
  HIGHLY COORDINATED — pattern strong enough that further checks are urgent

Return ONLY the JSON. No preamble, no markdown fence.
`;

export async function analyzeOrigin(host, { postText, postUrl, page, journalistNotes }) {
  const pageBlock = formatPageForPrompt(page);
  const userPrompt = ANALYZE_USER({ postText, pageBlock, journalistNotes, postUrl });

  const response = await host.ai.chat(
    [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
    { system: ANALYZE_SYSTEM, maxTokens: 2500 }
  );

  const parsed = parseJsonResponse(response);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    profile: parsed.value,
    timestamp: new Date().toISOString(),
  };
}

// ─── 2. Multi-post comparison ───────────────────────────────────────

const COMPARE_SYSTEM = `You are an editorial coordination-analysis assistant for Capital FM. Senior staff have given you two or more posts from different (or potentially the same) Facebook pages, and want to know whether the posts show signs of common origin — coordination, shared authorship, copy-paste behaviour, or synchronised release.

You are looking for evidence patterns, not making declarations. Coordination is a serious accusation. You give the newsroom what you observed; the editor decides what to publish.

You reason from the posts themselves, the page transparency snapshots, and general knowledge of coordinated information-operations tradecraft. You do not have live web access.`;

const COMPARE_USER = ({ postsBlock }) => `
The newsroom has given you these posts to compare:

${postsBlock}

Produce a Coordination Profile in this exact JSON shape (and nothing else):

{
  "summary": "<one or two sentence top-line for an editor scanning at speed>",
  "verdict": "<INDEPENDENT | WEAK OVERLAP | LIKELY COORDINATED | NEARLY IDENTICAL>",
  "verdict_reason": "<one or two sentences>",
  "overlap_findings": [
    {
      "type": "<one of: text_overlap | image_reuse | timing | shared_phrasing | structural_template | narrative_arc | other>",
      "evidence": "<specific phrase, structure, or pattern>",
      "posts_affected": ["<post id or label>", "..."]
    }
  ],
  "divergences": [
    "<observations that argue AGAINST coordination — to keep the analysis honest>"
  ],
  "further_checks": [
    "<specific action senior staff should take next>"
  ],
  "publishable_now": "<one sentence: what (if anything) the newsroom could responsibly say in public based on this alone. Empty string if nothing.>"
}

Verdict labels (use exactly):
  INDEPENDENT — posts read as separately produced
  WEAK OVERLAP — some shared elements but plausibly coincidental
  LIKELY COORDINATED — multiple converging indicators of shared origin
  NEARLY IDENTICAL — copy-paste or template-driven; near-certain shared origin

Return ONLY the JSON. No preamble, no markdown fence.
`;

export async function comparePosts(host, posts) {
  if (!posts || posts.length < 2) {
    return { ok: false, error: 'need_at_least_two', message: 'Comparison needs at least two posts.' };
  }

  const postsBlock = posts
    .map((p, i) => {
      const lines = [
        `─── Post ${i + 1} (id: ${p.id || `post-${i + 1}`}) ───`,
        `Page URL: ${p.page_url || 'unknown'}`,
        `Post URL: ${p.post_url || 'unknown'}`,
        `Posted/analysed at: ${p.analyzed_at || p.timestamp || 'unknown'}`,
        `Text:`,
        p.post_text || '(no text)',
      ];
      if (p.risk_profile?.confidence) {
        lines.push(`Prior origin assessment: ${p.risk_profile.confidence}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  const response = await host.ai.chat(
    [{ role: 'user', content: [{ type: 'text', text: COMPARE_USER({ postsBlock }) }] }],
    { system: COMPARE_SYSTEM, maxTokens: 2500 }
  );

  const parsed = parseJsonResponse(response);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    comparison: parsed.value,
    post_ids: posts.map((p) => p.id),
    timestamp: new Date().toISOString(),
  };
}

// ─── 3. Weekly editorial brief ──────────────────────────────────────

const BRIEF_SYSTEM = `You are an editorial intelligence analyst for Capital FM. You have access to a week's worth of posts that senior staff have flagged and run through origin analysis. Your job is to write a short editorial brief that helps the newsroom see patterns they could not see one post at a time.

Audience: the head of news. Tone: terse, declarative, editorially useful. No filler, no caveats beyond those that materially change the picture. Write in clear English suitable for a 4 a.m. read.

You are NOT writing for publication. This is an internal brief. It can name specific pages, name observed patterns, and recommend story angles.`;

const BRIEF_USER = ({ periodStart, periodEnd, postsBlock, watchlistBlock }) => `
Period covered: ${periodStart} to ${periodEnd}

Watchlist (pages senior staff are monitoring):
${watchlistBlock}

Posts analysed in this period (most recent first):
${postsBlock}

Write the brief in this exact JSON shape (and nothing else):

{
  "headline": "<one-sentence top line — the single most important observation of the week>",
  "patterns_observed": [
    "<a concrete pattern across multiple posts or pages — not a general statement>"
  ],
  "shifts_from_previous": [
    "<changes in behaviour you can see in the data — pages that went quiet, new pages appearing, tone changes, language changes. Empty array if nothing to report.>"
  ],
  "pages_of_concern": [
    {
      "page": "<page name or URL>",
      "why": "<one sentence>"
    }
  ],
  "story_leads": [
    {
      "angle": "<a publishable story angle the newsroom could chase>",
      "what_to_do_next": "<a specific reporting action>"
    }
  ],
  "what_NOT_to_publish_yet": "<things the newsroom must keep internal until further reporting confirms them. Empty string if nothing.>",
  "stats": {
    "posts_analysed": <number>,
    "highly_coordinated_count": <number>,
    "strong_signals_count": <number>,
    "new_pages_added_to_watchlist": <number, may be 0 if not derivable>
  }
}

Return ONLY the JSON. No preamble, no markdown fence.
`;

export async function generateBrief(host, { posts, pages, periodStart, periodEnd }) {
  const watchlistBlock = pages.length
    ? pages.map((p) => `• ${p.name} (${p.url}) — admin country: ${p.admin_country || 'unknown'}`).join('\n')
    : '(Watchlist is empty.)';

  const postsBlock = posts.length
    ? posts
        .map((p, i) => {
          const lines = [
            `─── Post ${i + 1} (${p.analyzed_at}) ───`,
            `Page URL: ${p.page_url || 'unknown'}`,
            `Confidence: ${p.risk_profile?.confidence || 'unknown'}`,
            `Restated: ${p.risk_profile?.post_restated || '(no restatement)'}`,
          ];
          if (p.risk_profile?.flags?.length) {
            lines.push(`Flags: ${p.risk_profile.flags.map((f) => f.category).join(', ')}`);
          }
          return lines.join('\n');
        })
        .join('\n\n')
    : '(No posts analysed in this period.)';

  const response = await host.ai.chat(
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: BRIEF_USER({ periodStart, periodEnd, postsBlock, watchlistBlock }),
          },
        ],
      },
    ],
    { system: BRIEF_SYSTEM, maxTokens: 2500 }
  );

  const parsed = parseJsonResponse(response);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    brief: parsed.value,
    period_start: periodStart,
    period_end: periodEnd,
    posts_count: posts.length,
    timestamp: new Date().toISOString(),
  };
}

// ─── helper ─────────────────────────────────────────────────────────

function parseJsonResponse(response) {
  const rawText = typeof response === 'string' ? response : (response.text || response.content);
  try {
    const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (err) {
    return {
      ok: false,
      error: 'parse_failed',
      raw: rawText,
      message: 'AI returned non-JSON. See raw output.',
    };
  }
}
