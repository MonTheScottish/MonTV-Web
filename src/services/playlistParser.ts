import type { Channel, ChannelUrl } from "../types";

export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

export function parseM3U(content: string): Channel[] {
  const channels: Channel[] = [];
  const lines = content.split(/\r?\n/);

  let currentChannelName = "";
  let currentGroupTitle = "Kênh khác";
  let currentLogoUrl: string | null = null;
  let currentUserAgent: string | null = null;
  let currentReferer: string | null = null;
  let currentTvgId: string | null = null;

  const attrRegex = /([\w-]+)="([^"]*)"/g;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (trimmedLine.startsWith("#EXTM3U")) {
      continue;
    }

    if (trimmedLine.startsWith("#EXTINF:")) {
      const extInfLine = trimmedLine.replace("#EXTINF:", "");
      const commaIndex = extInfLine.lastIndexOf(",");

      const attributesPart = commaIndex !== -1 ? extInfLine.substring(0, commaIndex) : extInfLine;
      currentChannelName = commaIndex !== -1 ? extInfLine.substring(commaIndex + 1).trim() : "Kênh không tên";

      const attributes: Record<string, string> = {};
      let match;
      // Reset regex index
      attrRegex.lastIndex = 0;
      while ((match = attrRegex.exec(attributesPart)) !== null) {
        attributes[match[1]] = match[2];
      }

      currentGroupTitle = attributes["group-title"]?.trim() || "Kênh khác";
      currentLogoUrl = attributes["tvg-logo"]?.trim() || null;
      currentTvgId = attributes["tvg-id"]?.trim() || null;

      if (attributes["tvg-name"] && !currentChannelName) {
        currentChannelName = attributes["tvg-name"].trim();
      }
      continue;
    }

    if (trimmedLine.startsWith("#EXTVLCOPT:")) {
      const option = trimmedLine.replace("#EXTVLCOPT:", "").trim();
      const parts = option.split("=");
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        const value = parts.slice(1).join("=").trim();
        if (key === "http-user-agent" || key === "user-agent") {
          currentUserAgent = value;
        } else if (key === "http-referrer" || key === "referer") {
          currentReferer = value;
        }
      }
      continue;
    }

    if (!trimmedLine.startsWith("#")) {
      let streamUrl = trimmedLine;
      let userAgent = currentUserAgent;
      let referer = currentReferer;

      if (streamUrl.includes("|")) {
        const parts = streamUrl.split("|");
        streamUrl = parts[0].trim();
        const headersStr = parts[1].trim();

        const headersMap: Record<string, string> = {};
        headersStr.split("&").forEach((param) => {
          const hParts = param.split("=");
          if (hParts.length >= 2) {
            headersMap[hParts[0].trim().toLowerCase()] = hParts.slice(1).join("=").replace(/['"]/g, "").trim();
          } else {
            headersMap[hParts[0].trim().toLowerCase()] = "";
          }
        });
        if (headersMap["user-agent"]) userAgent = headersMap["user-agent"];
        if (headersMap["referer"]) referer = headersMap["referer"];
      }

      if (streamUrl) {
        const hashVal = hashCode(streamUrl);
        const id = currentTvgId ? `${currentTvgId}_${hashVal}` : `chan_${hashVal}`;
        let groupTitle = currentGroupTitle || "Kênh khác";
        if (
          /sự kiện/i.test(groupTitle) ||
          /sự kiện/i.test(currentChannelName) ||
          /Sß╗▒/i.test(groupTitle) ||
          /tv360/i.test(currentChannelName)
        ) {
          groupTitle = "TV360";
        }

        channels.push({
          id,
          name: currentChannelName || "Kênh không tên",
          logoUrl: currentLogoUrl,
          groupTitle,
          streamUrl,
          urls: [{ url: streamUrl, provider: "hls" }],
          userAgent,
          referer,
          tvgId: currentTvgId || "",
          number: channels.length + 1,
          isHidden: false,
          isAudio: false,
        });
      }

      // Reset
      currentChannelName = "";
      currentGroupTitle = "Kênh khác";
      currentLogoUrl = null;
      currentUserAgent = null;
      currentReferer = null;
      currentTvgId = null;
    }
  }

  return channels;
}

export function parseJSON(content: string): Channel[] {
  const list: Channel[] = [];
  try {
    const root = JSON.parse(content);
    const channelsArray = root.channels || [];

    for (let i = 0; i < channelsArray.length; i++) {
      const channelObj = channelsArray[i];
      const title = channelObj.title || "";
      const tvgId = channelObj.tvgId || "";
      const thumbnail = channelObj.thumbnail || "";

      const groups = channelObj.group || [];
      let groupTitle = groups[0] || "Khác";
      if (
        /sự kiện/i.test(groupTitle) ||
        /Sß╗▒/i.test(groupTitle) ||
        /tv360/i.test(title)
      ) {
        groupTitle = "TV360";
      }

      const urlsArray = channelObj.urls || [];
      const urls: ChannelUrl[] = [];
      let firstDirectUrl = "";

      for (let j = 0; j < urlsArray.length; j++) {
        const urlObj = urlsArray[j];
        const rawUrl = urlObj.url || "";
        const rawProvider = urlObj.provider || "";

        let url = rawUrl;
        let provider = rawProvider;

        if (rawUrl.includes("api/live/play.m3u8?")) {
          url = rawUrl.replace("api/live/play.m3u8?", "api/live/play.json?");
          provider = "flow";
        }

        urls.push({ url, provider });

        if (!firstDirectUrl && (!provider || provider === "hls" || provider === "video")) {
          firstDirectUrl = url;
        }
      }

      const streamUrl = firstDirectUrl || (urls[0]?.url || "");
      const idVal = channelObj.id || "";
      const hashVal = hashCode(streamUrl);
      const id = idVal ? `${idVal}_${hashVal}` : `chan_${hashVal}`;
      const isHidden = !!channelObj.isHidden;
      const isAudio = !!channelObj.isAudio;

      list.push({
        id,
        name: title,
        logoUrl: thumbnail || null,
        groupTitle,
        streamUrl,
        urls,
        tvgId,
        number: list.length + 1,
        isHidden,
        isAudio,
      });
    }
  } catch (e) {
    console.error("Error parsing JSON playlist", e);
  }
  return list;
}
