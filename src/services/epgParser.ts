import type { EPGProgram, VnepgChannel } from "../types";

function parseEPGDate(dateStr: string): string {
  const match = dateStr.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s+([+-]\d{4})$/);
  if (match) {
    const [, y, m, d, h, min, s, tz] = match;
    const tzFormatted = tz.substring(0, 3) + ":" + tz.substring(3);
    return `${y}-${m}-${d}T${h}:${min}:${s}${tzFormatted}`;
  }
  return dateStr;
}

export interface ParsedEPG {
  epgData: Record<string, EPGProgram[]>;
  vnepgChannels: Record<string, VnepgChannel>;
}

export function parseEPGXml(xmlText: string): ParsedEPG {
  const epgData: Record<string, EPGProgram[]> = {};
  const vnepgChannels: Record<string, VnepgChannel> = {};

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  // Parse channels metadata
  const channelNodes = xmlDoc.getElementsByTagName("channel");
  for (let i = 0; i < channelNodes.length; i++) {
    const node = channelNodes[i];
    const id = node.getAttribute("id") || "";
    if (!id) continue;

    const displayNameNode = node.getElementsByTagName("display-name")[0];
    const displayName = displayNameNode ? displayNameNode.textContent || "" : "";

    const iconNode = node.getElementsByTagName("icon")[0];
    const logo = iconNode ? iconNode.getAttribute("src") || "" : "";

    vnepgChannels[id] = {
      id,
      name: displayName,
      logo,
      hasEpg: true,
    };
  }

  // Parse programs
  const programmeNodes = xmlDoc.getElementsByTagName("programme");
  for (let i = 0; i < programmeNodes.length; i++) {
    const node = programmeNodes[i];
    const channelId = node.getAttribute("channel");
    if (!channelId) continue;

    const startRaw = node.getAttribute("start") || "";
    const stopRaw = node.getAttribute("stop") || "";

    const start = parseEPGDate(startRaw);
    const stop = parseEPGDate(stopRaw);

    const titleNode = node.getElementsByTagName("title")[0];
    const title = titleNode ? titleNode.textContent || "" : "";

    const descNode = node.getElementsByTagName("desc")[0];
    const description = descNode ? descNode.textContent || "" : "";

    if (!epgData[channelId]) {
      epgData[channelId] = [];
    }

    epgData[channelId].push({
      title,
      start,
      stop,
      description,
    });
  }

  // Sort programs for each channel by start time and deduplicate
  for (const channelId in epgData) {
    epgData[channelId] = epgData[channelId]
      .filter((p, index, self) => self.findIndex((o) => o.start === p.start) === index)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  return { epgData, vnepgChannels };
}
