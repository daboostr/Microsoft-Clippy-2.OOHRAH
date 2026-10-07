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

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Pull the real destination URL out of a DuckDuckGo redirect href (uddg param).
function realUrl(href) {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch (_) {}
  return href.replace(/&amp;/g, '&');
}

export async function run({ query, max }) {
  const q = String(query || '').trim();
  if (!q) return { error: 'Empty query.' };
  const limit = Math.max(1, Math.min(10, Number(max) || 6));
  const url = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q);
  let html;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) return { error: 'Search HTTP ' + res.status };
    html = await res.text();
  } catch (e) {
    return { error: 'Search failed: ' + e.message };
  }

  const results = [];
  // Titles + hrefs
  const linkRe = /<a[^>]*href="([^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/g;
  // Fallback order: snippets appear in document order matching links
  const snippetRe = /<td[^>]*class='result-snippet'[^>]*>([\s\S]*?)<\/td>/g;
  const titles = [], snippets = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) titles.push({ url: realUrl(m[1]), title: decodeEntities(m[2]) });
  while ((m = snippetRe.exec(html)) !== null) snippets.push(decodeEntities(m[1]));
  for (let i = 0; i < titles.length && results.length < limit; i++) {
    results.push({ title: titles[i].title, snippet: snippets[i] || '', url: titles[i].url });
  }
  return { query: q, count: results.length, results };
}
