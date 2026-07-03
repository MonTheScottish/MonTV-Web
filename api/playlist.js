export const config = {
  runtime: "edge",
};

export default async function handler(request) {
  const urlObj = new URL(request.url);
  
  // Reconstruct path and query parameters
  let path = urlObj.searchParams.get("path") || "";
  if (!path) {
    if (urlObj.pathname.startsWith("/api-playlist/")) {
      path = urlObj.pathname.substring("/api-playlist/".length);
    } else if (urlObj.pathname.startsWith("/api/playlist/")) {
      path = urlObj.pathname.substring("/api/playlist/".length);
    }
  }
  
  // Copy search params and delete "path"
  const queryParams = new URLSearchParams(urlObj.searchParams);
  queryParams.delete("path");
  
  const queryString = queryParams.toString();
  const targetUrl = `https://freem3u.xyz/${path}${queryString ? "?" + queryString : ""}`;

  const userAgent = request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": userAgent,
      },
    });

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    
    // Enable CORS
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
