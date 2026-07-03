export default async function handler(req, res) {
  // Reconstruct path and query parameters
  const path = req.query.path || "";
  
  // Get all query params except 'path'
  const queryParams = new URLSearchParams(req.query);
  queryParams.delete("path");
  
  const queryString = queryParams.toString();
  const url = `https://freem3u.xyz/${path}${queryString ? "?" + queryString : ""}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "OkHttp/4.9.2",
        "Referer": "https://freem3u.xyz",
      },
    });

    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

    const data = await response.text();
    return res.status(response.status).send(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
