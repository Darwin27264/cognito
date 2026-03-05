import { NextRequest, NextResponse } from "next/server";

export const revalidate = 3600;

interface NewsApiArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

export async function GET(req: NextRequest) {
  const apiKey =
    process.env.NEWSAPI_KEY ?? req.headers.get("x-user-newsapi-key")?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { articles: [], timestamp: new Date().toISOString(), error: "NEWSAPI_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const keywords = "war OR conflict OR military OR geopolitical OR sanctions";
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keywords)}&sortBy=publishedAt&pageSize=40&language=en&apiKey=${apiKey}`;

    const res = await fetch(url, {
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`NewsAPI ${res.status}: ${body}`);
    }

    const json: NewsApiResponse = await res.json();

    const articles = (json.articles ?? [])
      .filter((a) => a.title && a.title !== "[Removed]")
      .map((a) => ({
        title: a.title.trim(),
        url: a.url,
        date: a.publishedAt,
        source: a.source?.name ?? "UNKNOWN",
        country: "N/A",
        image: a.urlToImage || null,
        description: a.description?.slice(0, 200) || null,
      }));

    return NextResponse.json(
      { articles, timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Intel feed unavailable";
    return NextResponse.json(
      { articles: [], timestamp: new Date().toISOString(), error: msg },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, must-revalidate",
        },
      }
    );
  }
}
