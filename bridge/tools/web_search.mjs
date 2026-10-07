export const spec = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the live web and return titles, snippets, and URLs of the top results. Use this for anything you are unsure about or that needs current information — news, trends, recent events, market/banking topics, prices, people, or the user asking your opinion on something you may not have up-to-date knowledge of.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        max: { type: 'number', description: 'Max results (default 6).' }
      },
      required: ['query'],
      additionalProperties: false
    }
  }
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Fetch with a timeout and a couple of retries for transient resets/timeouts.
async function fetchText(url, { timeout = 9000, attempts = 3 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }
      });
      clearTimeout(t);
      if (!res.ok) { last = new Error('HTTP ' + res.status); continue; }
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last || new Error('fetch failed');
}

// Bing wraps result links in a redirect: .../ck/a?...&u=a1<base64url>&...
// Decode back to the real destination URL.
function decodeBingUrl(href) {
  const clean = href.replace(/&amp;/g, '&');
  try {
    const m = clean.match(/[?&]u=a1([^&]+)/);
    if (m) {
      let b = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const decoded = Buffer.from(b, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch (_) {}
  return clean;
}

function parseBing(html, limit) {
  const results = [];
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
  const linkRe = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const snipRe = /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>|<p[^>]*>([\s\S]*?)<\/p>/i;
  for (const b of blocks) {
    const lm = b.match(linkRe);
    if (!lm) continue;
    const title = decodeEntities(lm[2]);
    const url = decodeBingUrl(lm[1]);
    const sm = b.match(snipRe);
    const snippet = sm ? decodeEntities(sm[1] || sm[2] || '') : '';
    if (title && url) results.push({ title, snippet, url });
    if (results.length >= limit) break;
  }
  return results;
}

// Last-ditch fallback if Bing is unavailable: DuckDuckGo Lite.
function realDdgUrl(href) {
  try { const m = href.match(/[?&]uddg=([^&]+)/); if (m) return decodeURIComponent(m[1]); } catch (_) {}
  return href.replace(/&amp;/g, '&');
}
function parseDdgLite(html, limit) {
  const results = [];
  const linkRe = /<a[^>]*href="([^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td[^>]*class='result-snippet'[^>]*>([\s\S]*?)<\/td>/g;
  const titles = [], snippets = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) titles.push({ url: realDdgUrl(m[1]), title: decodeEntities(m[2]) });
  while ((m = snippetRe.exec(html)) !== null) snippets.push(decodeEntities(m[1]));
  for (let i = 0; i < titles.length && results.length < limit; i++) {
    results.push({ title: titles[i].title, snippet: snippets[i] || '', url: titles[i].url });
  }
  return results;
}

function parseBingNews(html, limit) {
  const results = [];
  const linkRe = /class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /class="snippet"[^>]*>([\s\S]*?)<\/(?:div|span|a)>/g;
  const snips = [];
  let s;
  while ((s = snipRe.exec(html)) !== null) snips.push(decodeEntities(s[1]));
  let m, i = 0;
  while ((m = linkRe.exec(html)) !== null && results.length < limit) {
    const url = m[1].replace(/&amp;/g, '&');
    const title = decodeEntities(m[2]);
    if (title && /^https?:\/\//i.test(url)) results.push({ title, snippet: snips[i] || '', url });
    i++;
  }
  return results;
}

export async function run({ query, max }) {
  const q = String(query || '').trim();
  if (!q) return { error: 'Empty query.' };
  const limit = Math.max(1, Math.min(10, Number(max) || 6));
  const newsIntent = /\b(news|latest|recent|headline|today|update|announce|breaking|this week|this month)\b/i.test(q);

  // News-intent queries: Bing News first (real dated articles, direct URLs).
  if (newsIntent) {
    try {
      const cleaned = q.replace(/\b(latest|recent|breaking|news|headlines?|updates?|today|on)\b/gi, ' ').replace(/\s+/g, ' ').trim() || q;
      const html = await fetchText('https://www.bing.com/news/search?q=' + encodeURIComponent(cleaned) + '&setlang=en-US&cc=US');
      const results = parseBingNews(html, limit);
      if (results.length) return { query: q, source: 'bing-news', count: results.length, results };
    } catch (_) { /* fall through */ }
  }

  // General web: Bing (reliable, Microsoft-native).
  try {
    const html = await fetchText('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=en-US&cc=US');
    const results = parseBing(html, limit);
    if (results.length) return { query: q, source: 'bing', count: results.length, results };
  } catch (_) { /* fall through to fallback */ }

  // Fallback: DuckDuckGo Lite.
  try {
    const html = await fetchText('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q));
    const results = parseDdgLite(html, limit);
    if (results.length) return { query: q, source: 'duckduckgo', count: results.length, results };
  } catch (e) {
    return { error: 'Search failed: ' + e.message };
  }

  return { query: q, count: 0, results: [], note: 'No results parsed.' };
}
