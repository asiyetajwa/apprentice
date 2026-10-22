// Tavily web search: real-world wording for the teacher to learn from, so synthetic cases sound like
// people, not like a model. Runs only when TAVILY_API_KEY is set; otherwise the step says it was skipped.

export interface WebSnippet {
  title: string;
  url: string;
  content: string;
}

export interface TavilyResult {
  query: string;
  snippets: WebSnippet[];
  live: boolean;
  latencyMs: number;
}

export async function searchWeb(query: string, env: NodeJS.ProcessEnv = process.env): Promise<TavilyResult | null> {
  const key = env.TAVILY_API_KEY?.trim();
  if (!key) return null;
  const started = Date.now();
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false, chunks_per_source: 2 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Tavily ${String(res.status)}: ${(await res.text()).slice(0, 200)}`);
  const out = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
  return {
    query,
    snippets: (out.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content.slice(0, 600) })),
    live: true,
    latencyMs: Date.now() - started,
  };
}
