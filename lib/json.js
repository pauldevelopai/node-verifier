// A base64 screenshot above ~4MB (the model's per-image ceiling is ~5MB) is
// rejected with a clear message instead of erroring deep in the AI call.
const MAX_IMAGE_B64 = 5_400_000;   // ~4MB decoded
export function imageTooLarge(base64) {
  return typeof base64 === 'string' && base64.length > MAX_IMAGE_B64;
}
export const IMAGE_TOO_LARGE_MSG = 'That screenshot is too large (max ~4MB). Crop it to the post, or lower the resolution, and try again.';

// Tolerant parser for AI JSON responses. Models sometimes wrap JSON in a code
// fence or add a stray line; this strips fences, tries a direct parse, then
// falls back to the outermost {...}. Returns { ok, value } | { ok:false, raw }.

export function parseAiJson(response) {
  const raw = typeof response === 'string' ? response : (response?.text ?? response?.content ?? '');
  const s = String(raw).replace(/```json\s*|\s*```/g, '').trim();
  try { return { ok: true, value: JSON.parse(s) }; } catch { /* try slice */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return { ok: true, value: JSON.parse(s.slice(a, b + 1)) }; } catch { /* fall through */ }
  }
  return { ok: false, error: 'parse_failed', raw: String(raw), message: 'AI returned non-JSON. See raw output.' };
}
