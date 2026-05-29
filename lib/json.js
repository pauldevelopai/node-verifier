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
