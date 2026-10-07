export const spec = {
  type: 'function',
  function: {
    name: 'fetch_page',
    description: 'Fetch a web page by URL and return its readable text (stripped of markup). Use after web_search when you need more depth from a specific article to answer or form an opinion.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch.' },
        max_chars: { type: 'number', description: 'Max characters of text to return (default 2500).' }
      },
      required: ['url'],
      additionalProperties: false
    }
  }
};

export async function run({ url, max_chars }) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { error: 'Invalid URL.' };
  const cap = Math.max(500, Math.min(8000, Number(max_chars) || 2500));
  let html;
  try {
    const res = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
    if (!res.ok) return { error: 'HTTP ' + res.status };
    html = await res.text();
  } catch (e) {
    return { error: 'Fetch failed: ' + e.message };
  }
  // Strip scripts/styles/markup to readable text.
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = text.length > cap;
  return { url: u, text: text.slice(0, cap), truncated };
}
