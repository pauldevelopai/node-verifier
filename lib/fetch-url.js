// Best-effort fetch of a journalist-supplied source URL, reduced to readable
// text so the verifier can reason over the ACTUAL content (not just the link).
// Returns null on any failure — verification still runs without it.

export async function fetchUrlText(url, { timeoutMs = 8000, maxChars = 6000 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ElectionWatch/1.0; +https://grounded.developai.co.za)' },
    });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ctype)) return null;
    const html = await res.text();
    const text = htmlToText(html).slice(0, maxChars);
    return text || null;
  } catch {
    return null; // timeout, DNS, blocked, non-text — degrade gracefully
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
