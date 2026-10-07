export const spec = {
  type: 'function',
  function: {
    name: 'get_stock',
    description: 'Get the current/latest stock price and day change for a publicly traded company. Use this whenever the user asks for a stock price, quote, share price, or how a stock/ticker is doing today. Do NOT use web_search for stock prices — use this.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'The ticker symbol, e.g. MSFT, AAPL, NVDA. If the user gives a company name, use its common ticker (Microsoft=MSFT, Apple=AAPL, Nvidia=NVDA, Amazon=AMZN, Google/Alphabet=GOOGL, Tesla=TSLA, Meta=META).' }
      },
      required: ['symbol'],
      additionalProperties: false
    }
  }
};

async function fetchQuote(symbol) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastErr;
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      clearTimeout(t);
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      const j = await res.json();
      const r = j && j.chart && j.chart.result && j.chart.result[0];
      const m = r && r.meta;
      if (m && typeof m.regularMarketPrice === 'number') return m;
      lastErr = new Error('no quote data');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('quote failed');
}

export async function run({ symbol }) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { error: 'No symbol.' };
  try {
    const m = await fetchQuote(sym);
    const price = m.regularMarketPrice;
    const prev = m.chartPreviousClose ?? m.previousClose;
    const cur = m.currency || 'USD';
    const name = m.longName || m.shortName || sym;
    let change = null, changePct = null;
    if (typeof prev === 'number' && prev) {
      change = +(price - prev).toFixed(2);
      changePct = +(((price - prev) / prev) * 100).toFixed(2);
    }
    const dir = change == null ? '' : (change >= 0 ? 'up' : 'down');
    return {
      symbol: sym,
      name,
      price: +price.toFixed(2),
      currency: cur,
      previousClose: typeof prev === 'number' ? +prev.toFixed(2) : null,
      change,
      changePercent: changePct,
      direction: dir,
      exchange: m.exchangeName || m.fullExchangeName || null,
      asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
      marketState: m.marketState || null
    };
  } catch (e) {
    return { error: 'Stock lookup failed: ' + e.message };
  }
}
