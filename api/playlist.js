export const config = {
  runtime: "edge",
};

export default async function handler(request) {
  const urlObj = new URL(request.url);
  
  // Reconstruct path and query parameters
  const path = urlObj.searchParams.get("path") || "";
  
  // Copy search params and delete "path"
  const queryParams = new URLSearchParams(urlObj.searchParams);
  queryParams.delete("path");
  
  const queryString = queryParams.toString();
  const targetUrl = `https://freem3u.xyz/${path}${queryString ? "?" + queryString : ""}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "OkHttp/4.9.2",
        "Referer": "https://freem3u.xyz",
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
