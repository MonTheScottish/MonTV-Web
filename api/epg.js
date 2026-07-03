export default async function handler(req, res) {
  // Reconstruct path and query parameters
  const path = req.query.path || "";
  
  // Get all query params except 'path'
  const queryParams = new URLSearchParams(req.query);
  queryParams.delete("path");
  
  const queryString = queryParams.toString();
  const url = `https://vnepg.site/${path}${queryString ? "?" + queryString : ""}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "OkHttp/4.9.2",
        "Referer": "https://vnepg.site",
      },
    });

    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

    // Read as binary buffer to prevent gzip corruption
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return res.status(response.status).send(buffer);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
