import type { Channel, ChannelUrl, EPGProgram, ResolvedStream, VnepgChannel } from "../types";
import { parseM3U, parseJSON } from "./playlistParser";
import { parseEPGXml } from "./epgParser";

export const DEFAULT_PLAYLIST_URL = "https://freem3u.xyz/api/channels/x_1.0.1/app.json";
export const VNEPG_EPG_URL = "https://vnepg.site/epg.xml.gz";
export const BACKUP_M3U_URLS = [
  "https://iptv-org.github.io/iptv/countries/vn.m3u",
  "https://iptv-org.github.io/iptv/languages/vie.m3u",
];

const BLOCKED_CHANNEL_NAMES = new Set([
  "inthobox channel",
  "happy kids",
  "happykidshd",
  "man",
  "dr.fit",
  "drfit",
  "planet earth",
  "planetaearth",
]);

const TVG_ID_ALIASES: Record<string, string[]> = {
  "tv360Plus1.VN": ["tv360plus1"],
  "tv360Plus2.VN": ["tv360plus2"],
  "tv360Plus3.VN": ["tv360plus3"],
  "tv360Plus4.VN": ["tv360plus4"],
  "tv360Plus5.VN": ["tv360plus5"],
  "tv360Plus6.VN": ["tv360plus6"],
  "tv360Plus7.VN": ["tv360plus7"],
  "tv360Plus8.VN": ["tv360plus8"],
  "tv360Plus9.VN": ["tv360plus9"],
  "vovgtHN.VN": ["vovgthn"],
  "vovgtHCM.VN": ["vovgthcm"],
  "vovgtMeKong.VN": ["vovgtmekong"],
  "voh.FM99_9.VN": ["voh999"],
  "voh.FM95_6.VN": ["voh956"],
  "voh.FM87_7.VN": ["voh877"],
  "voh.AM610.VN": ["voh610"],
  "hanoi.FM90.VN": ["hanoi90"],
  "hanoi.FM96.VN": ["hanoi96"],
  "haiphong.FM93_7.VN": ["haiphong937"],
  "haiphong.FM102_2.VN": ["haiphong1022"],
  "ninhbinh.FM98_1.VN": ["ninhbinhradio"],
  "nghean.FM99_6.VN": ["ngheanradio"],
  "hatinh.FM97_8.VN": ["hatinhradio"],
  "quangngai.FM102_9.VN": ["quangngai"],
  "quangtri.FM96_1.VN": ["quangtriradio"],
  "daklak.FM92_4.VN": ["daklakradio"],
  "lamdong.FM97.VN": ["lamdongradio1"],
  "vinhlong.FM90_2.VN": ["vinhlongradio"],
  "dongthap.FM98_4.VN": ["dongthapradio"],
  "angiang.FM99_4.VN": ["angiangradio1"],
  "angiang.FM93_1.VN": ["angiang2"],
  "camau.FM94_6.VN": ["camauradio"],
  "sonla.FM96.VN": ["sonlaradio"],
  "quangninh.FM97_8.VN": ["quangninhradio1"],
  "quangninh.FM91_7.VN": ["quangninhradio2"],
  "hungyen.FM92_7.VN": ["hungyenradio"],
  "bbc.cbeebies.VN": ["cbeebies"],
  "bbc.earth.VN": ["bbcearth"],
  "bbc.lifestyle.VN": ["bbclifestyle"],
  "bbc.news.VN": ["bbcworldnews"],
  "abc.australia.VN": ["abcaustralia"],
  "htvcthuanviethd.VN": ["htvcthuanviet"],
  "htvkey.VN": ["htv4", "htv5"],
  "boxmusic.VN": ["musicbox", "inthebox"],
  "sctv10hd": ["sctv4k"],
  "sctv5hd.VN": ["sctv4hd"],
  "vtvcantho.VN": ["vtv10hd"],
  "thvl1hd.VN": ["thvl1"],
  "thvl2hd.VN": ["thvl2"],
  "thvl3hd.VN": ["thvl3"],
  "thvl4hd.VN": ["thvl4"],
  "thvl5hd.VN": ["thvl5"],
  "dongthap.VN": ["dongthap1"],
  "haiphongplus.VN": ["haiphong"],
  "anvienhd.VN": ["antvhd"],
  "lamdong3.VN": ["lamdong1"],
};

export class MonTVRepository {
  private cachedChannels: Channel[] = [];
  private cachedUrl: string | null = null;

  // EPG Cache
  private epgData: Record<string, EPGProgram[]> = {};
  private vnepgChannels: Record<string, VnepgChannel> = {};
  private tvgIdToVnepgId: Record<string, string> = {};
  private channelNameToVnepgId: Record<string, string> = {};

  private lastEpgLoadTime = 0;
  private EPG_STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

  // Local storage keys
  private KEY_PLAYLIST_URL = "montv_playlist_url";
  private KEY_FAVORITES = "montv_favorites";
  private KEY_RECENTS = "montv_recents";
  private KEY_WORKING_SRC = "montv_working_src_";

  constructor() {
    this.cachedUrl = localStorage.getItem(this.KEY_PLAYLIST_URL) || DEFAULT_PLAYLIST_URL;
  }

  // Proxies URLs for development if running on localhost to bypass CORS
  private getProxyUrl(url: string): string {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      if (url.startsWith("https://freem3u.xyz")) {
        return url.replace("https://freem3u.xyz", "/api-playlist");
      }
      if (url.startsWith("https://vnepg.site")) {
        return url.replace("https://vnepg.site", "/api-epg");
      }
    }
    return url;
  }

  getPlaylistUrl(): string {
    return localStorage.getItem(this.KEY_PLAYLIST_URL) || DEFAULT_PLAYLIST_URL;
  }

  setPlaylistUrl(url: string): void {
    localStorage.setItem(this.KEY_PLAYLIST_URL, url);
    this.cachedUrl = url;
  }

  getFavorites(): Set<string> {
    const raw = localStorage.getItem(this.KEY_FAVORITES);
    if (!raw) return new Set();
    try {
      return new Set(JSON.parse(raw));
    } catch {
      return new Set();
    }
  }

  addFavorite(channelId: string): void {
    const favorites = this.getFavorites();
    favorites.add(channelId);
    localStorage.setItem(this.KEY_FAVORITES, JSON.stringify(Array.from(favorites)));
  }

  removeFavorite(channelId: string): void {
    const favorites = this.getFavorites();
    favorites.delete(channelId);
    localStorage.setItem(this.KEY_FAVORITES, JSON.stringify(Array.from(favorites)));
  }

  getRecentChannelIds(): string[] {
    const raw = localStorage.getItem(this.KEY_RECENTS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  addRecentChannel(channelId: string): void {
    let recents = this.getRecentChannelIds();
    recents = recents.filter((id) => id !== channelId);
    recents.unshift(channelId);
    const limited = recents.slice(0, 20); // Keep max 20
    localStorage.setItem(this.KEY_RECENTS, JSON.stringify(limited));
  }

  clearRecentChannels(): void {
    localStorage.setItem(this.KEY_RECENTS, JSON.stringify([]));
  }

  getLastWorkingSourceIndex(channelId: string): number {
    const val = localStorage.getItem(this.KEY_WORKING_SRC + channelId);
    return val ? parseInt(val, 10) : 0;
  }

  setLastWorkingSourceIndex(channelId: string, index: number): void {
    localStorage.setItem(this.KEY_WORKING_SRC + channelId, index.toString());
  }

  private normalizeChannelName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace("hd", "")
      .replace("sd", "")
      .replace("fhd", "")
      .replace(/[\[\]\(\)\-_]/g, "")
      .trim();
  }

  private normalizeEPGName(name: string): string {
    // Strip Vietnamese diacritics
    const stripped = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return stripped
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  private async fetchBackupChannels(): Promise<Channel[]> {
    const allBackups: Channel[] = [];
    for (const urlStr of BACKUP_M3U_URLS) {
      try {
        const res = await fetch(urlStr);
        if (!res.ok) continue;
        const text = await res.text();
        allBackups.push(...parseM3U(text));
      } catch (e) {
        console.warn("Failed to fetch backup playlist", urlStr, e);
      }
    }
    return allBackups;
  }

  private postProcessChannels(channels: Channel[]): Channel[] {
    const processed = channels.map((ch) => {
      if (ch.id.startsWith("boxmovie_")) {
        const workingUrl: ChannelUrl = {
          url: "https://toiyeuvietnam.dpdns.org/OnliveTV/box-movie-1-hd/Free.m3u8",
          provider: "hls",
        };
        const updatedUrls = [workingUrl, ...ch.urls.filter((u) => u.url !== workingUrl.url && u.provider !== "flow")];
        return {
          ...ch,
          streamUrl: workingUrl.url,
          urls: updatedUrls,
        };
      }
      if (ch.id.startsWith("boxmusic") && ch.isHidden) {
        return { ...ch, isHidden: false };
      }
      return ch;
    });

    const filtered = processed.filter((ch) => {
      const nameLower = ch.name.toLowerCase();
      return !Array.from(BLOCKED_CHANNEL_NAMES).some((blocked) => nameLower.includes(blocked));
    });

    // Reorder boxmovie and boxhits right after hollywoodclassic
    const finalChannels = [...filtered];
    const boxMovieIdx = finalChannels.findIndex((c) => c.id.startsWith("boxmovie_"));
    let boxMovieChan: Channel | null = null;
    if (boxMovieIdx !== -1) {
      boxMovieChan = finalChannels.splice(boxMovieIdx, 1)[0];
    }
    const boxHitsIdx = finalChannels.findIndex((c) => c.id.startsWith("boxhits_"));
    let boxHitsChan: Channel | null = null;
    if (boxHitsIdx !== -1) {
      boxHitsChan = finalChannels.splice(boxHitsIdx, 1)[0];
    }

    if (boxMovieChan || boxHitsChan) {
      const hollywoodIdx = finalChannels.findIndex((c) => c.id.startsWith("hollywoodclassic_"));
      if (hollywoodIdx !== -1) {
        let insertIdx = hollywoodIdx + 1;
        if (boxMovieChan) {
          finalChannels.splice(insertIdx, 0, boxMovieChan);
          insertIdx++;
        }
        if (boxHitsChan) {
          finalChannels.splice(insertIdx, 0, boxHitsChan);
        }
      } else {
        if (boxMovieChan) finalChannels.push(boxMovieChan);
        if (boxHitsChan) finalChannels.push(boxHitsChan);
      }
    }

    return finalChannels;
  }

  async fetchChannels(url: string, forceRefresh = false): Promise<Channel[]> {
    if (!forceRefresh && this.cachedUrl === url && this.cachedChannels.length > 0) {
      return this.cachedChannels;
    }

    if (forceRefresh) {
      this.epgData = {};
      this.vnepgChannels = {};
      this.tvgIdToVnepgId = {};
      this.channelNameToVnepgId = {};
    }

    const proxyUrl = this.getProxyUrl(url);
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    const content = await response.text();
    const trimmed = content.trim();

    const rawChannels = trimmed.startsWith("#EXTM3U") ? parseM3U(trimmed) : parseJSON(trimmed);

    let channels = rawChannels;
    if (rawChannels.length > 0) {
      try {
        const backupChannels = await this.fetchBackupChannels();
        if (backupChannels.length > 0) {
          const backupMap: Record<string, ChannelUrl[]> = {};
          backupChannels.forEach((bc) => {
            const normName = this.normalizeChannelName(bc.name);
            if (normName) {
              if (!backupMap[normName]) backupMap[normName] = [];
              backupMap[normName].push({ url: bc.streamUrl, provider: "backup_public" });
            }
          });

          channels = rawChannels.map((mc) => {
            const normMainName = this.normalizeChannelName(mc.name);
            const backups = backupMap[normMainName];
            if (backups && backups.length > 0) {
              const uniqueBackups = backups.filter(
                (bu) => mc.streamUrl !== bu.url && !mc.urls.some((mu) => mu.url === bu.url)
              );
              if (uniqueBackups.length > 0) {
                return { ...mc, urls: [...mc.urls, ...uniqueBackups] };
              }
            }
            return mc;
          });
        }
      } catch (e) {
        console.error("Error integrating backup sources", e);
      }
    }

    const processed = this.postProcessChannels(channels).filter((c) => !c.isHidden);
    if (processed.length > 0) {
      this.cachedChannels = processed;
      this.cachedUrl = url;
    }
    return processed;
  }

  isEPGStale(): boolean {
    if (Object.keys(this.epgData).length === 0) return true;
    if (Date.now() - this.lastEpgLoadTime > this.EPG_STALE_THRESHOLD_MS) return true;

    // Check if latest EPG stop time covers today
    const tzOffset = 7 * 60 * 60 * 1000; // GMT+7
    const nowLocal = new Date(Date.now() + tzOffset);
    const todayStr = nowLocal.toISOString().substring(0, 10); // YYYY-MM-DD

    let maxStop = "";
    for (const chan in this.epgData) {
      const programs = this.epgData[chan];
      if (programs.length > 0) {
        const last = programs[programs.length - 1].stop;
        if (last > maxStop) maxStop = last;
      }
    }

    if (!maxStop) return true;
    const latestDateStr = maxStop.substring(0, 10);
    return latestDateStr < todayStr;
  }

  async loadEPG(forceRefresh = false, onProgress?: (progress: number) => void): Promise<void> {
    if (!forceRefresh && Object.keys(this.epgData).length > 0 && !this.isEPGStale()) {
      if (onProgress) onProgress(1.0);
      return;
    }

    this.epgData = {};
    this.vnepgChannels = {};
    this.tvgIdToVnepgId = {};
    this.channelNameToVnepgId = {};

    if (onProgress) onProgress(0.05);

    try {
      const proxyUrl = this.getProxyUrl(VNEPG_EPG_URL);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Fetch XML.gz failed: ${res.status}`);

      if (onProgress) onProgress(0.2);

      // Decompress gzip body stream
      let xmlText = "";
      if (res.body) {
        try {
          const ds = new DecompressionStream("gzip");
          const decompressedStream = res.body.pipeThrough(ds);
          xmlText = await new Response(decompressedStream).text();
        } catch (e) {
          console.warn("DecompressionStream failed or unsupported, reading as raw text", e);
          xmlText = await res.text();
        }
      } else {
        xmlText = await res.text();
      }

      if (onProgress) onProgress(0.5);

      const parsed = parseEPGXml(xmlText);
      this.epgData = parsed.epgData;
      this.vnepgChannels = parsed.vnepgChannels;

      if (onProgress) onProgress(0.7);

      this.buildTvgIdToVnepgIdMap();
      if (onProgress) onProgress(0.85);

      this.overrideChannelMetadataFromVnepg();
      if (onProgress) onProgress(1.0);

      this.lastEpgLoadTime = Date.now();
    } catch (e) {
      console.error("Error loading XML EPG", e);
      if (onProgress) onProgress(1.0);
    }
  }

  private buildTvgIdToVnepgIdMap(): void {
    const vnepgKeys = new Set(Object.keys(this.vnepgChannels));
    const vnepgNames: Record<string, string> = {};
    for (const key in this.vnepgChannels) {
      vnepgNames[this.vnepgChannels[key].name.toLowerCase()] = key;
    }

    const resolved: Record<string, string> = {};
    const resolvedByName: Record<string, string> = {};

    for (const channel of this.cachedChannels) {
      const tvgId = channel.tvgId;
      if (tvgId) {
        const candidates: string[] = [];
        candidates.push(tvgId.toLowerCase());
        candidates.push(tvgId.replace(/\.VN$/i, "").toLowerCase());
        candidates.push(tvgId.replace(/\.vn$/i, "").toLowerCase());

        const aliases = TVG_ID_ALIASES[tvgId];
        if (aliases) {
          aliases.forEach((a) => candidates.push(a.toLowerCase()));
        }

        const hit = candidates.find((c) => vnepgKeys.has(c));
        if (hit) {
          resolved[tvgId] = hit;
        }
      } else {
        const channelNameNorm = this.normalizeEPGName(channel.name);
        let vnepgHit: string | null = null;
        for (const vnepgName in vnepgNames) {
          if (this.normalizeEPGName(vnepgName) === channelNameNorm) {
            vnepgHit = vnepgNames[vnepgName];
            break;
          }
        }
        if (vnepgHit) {
          resolvedByName[channel.id] = vnepgHit;
        }
      }
    }

    this.tvgIdToVnepgId = resolved;
    this.channelNameToVnepgId = resolvedByName;
  }

  private overrideChannelMetadataFromVnepg(): void {
    const updates: Record<string, Partial<Channel>> = {};
    for (const channel of this.cachedChannels) {
      const vnepgId = this.tvgIdToVnepgId[channel.tvgId] || this.channelNameToVnepgId[channel.id];
      if (!vnepgId) continue;

      const meta = this.vnepgChannels[vnepgId];
      if (!meta) continue;

      const newName =
        !channel.name || channel.name.length < meta.name.length
          ? meta.name || channel.name
          : channel.name;

      const newLogo = !channel.logoUrl && meta.logo ? meta.logo : channel.logoUrl;

      if (newName !== channel.name || newLogo !== channel.logoUrl) {
        updates[channel.id] = { name: newName, logoUrl: newLogo };
      }
    }

    if (Object.keys(updates).length > 0) {
      this.cachedChannels = this.cachedChannels.map((ch) => {
        const upd = updates[ch.id];
        return upd ? { ...ch, ...upd } : ch;
      });
    }
  }

  getEPGForChannel(tvgId?: string, channelId = ""): EPGProgram[] {
    if (tvgId) {
      const vnepgId = this.tvgIdToVnepgId[tvgId];
      if (vnepgId) return this.epgData[vnepgId] || [];
    }
    if (channelId) {
      const vnepgId = this.channelNameToVnepgId[channelId];
      if (vnepgId) return this.epgData[vnepgId] || [];
    }
    return [];
  }

  async resolveChannelStreamUrl(channel: Channel, urlIndex = 0): Promise<ResolvedStream | null> {
    const urlsToTry = channel.urls.length === 0 ? [{ url: channel.streamUrl, provider: "hls" }] : channel.urls;

    if (urlIndex < 0 || urlIndex >= urlsToTry.length) return null;

    const channelUrl = urlsToTry[urlIndex];
    const provider = channelUrl.provider;
    let url = channelUrl.url;
    if (!url) return null;

    if (!provider || provider === "hls" || provider === "video" || provider === "backup_public") {
      const headers: Record<string, string> = {};
      if (channel.userAgent) headers["User-Agent"] = channel.userAgent;
      if (channel.referer) headers["Referer"] = channel.referer;
      return { url, headers };
    }

    if (provider === "webview") {
      if (url.includes("shaka.html")) {
        try {
          const parsedUrl = new URL(url);
          const videoUrl = parsedUrl.searchParams.get("videoUrl");
          if (videoUrl) {
            const keyId = parsedUrl.searchParams.get("keyId");
            const key = parsedUrl.searchParams.get("key");
            const keysParam = parsedUrl.searchParams.get("keys");

            let resolvedKeyId = keyId;
            let resolvedKey = key;

            if (keysParam && keysParam.includes(":")) {
              const parts = keysParam.split(":");
              resolvedKeyId = parts[0];
              resolvedKey = parts[1];
            }

            const headers: Record<string, string> = {};
            if (channel.userAgent) headers["User-Agent"] = channel.userAgent;
            if (channel.referer) headers["Referer"] = channel.referer;

            return {
              url: videoUrl,
              headers,
              drmScheme: "clearkey",
              drmKeyId: resolvedKeyId,
              drmKey: resolvedKey,
              isWebView: false,
            };
          }
        } catch (e) {
          console.error("Error parsing webview shaka URL:", url, e);
        }
      }
      return {
        url,
        isWebView: true,
      };
    }

    if (provider === "flow") {
      try {
        const proxyUrl = this.getProxyUrl(url);
        const res = await fetch(proxyUrl, {
          headers: { "User-Agent": "OkHttp/4.9.2" },
        });
        if (!res.ok) return null;
        const flowObj = await res.json();
        if (flowObj.code === 200 && flowObj.data) {
          const dataObj = flowObj.data;
          const nestedProvider = dataObj.provider;
          const nestedUrl = dataObj.url;
          const jsonPath = dataObj.jsonPath;

          if (!nestedProvider && nestedUrl) {
            const playHeaders: Record<string, string> = dataObj.headers || {};
            return { url: nestedUrl, headers: playHeaders };
          } else if (nestedProvider === "json") {
            const httpConfig = dataObj.httpConfig || {};
            const method = httpConfig.method || "GET";
            const httpHeaders: Record<string, string> = httpConfig.headers || {};
            const body = httpConfig.body || "";

            const fetchOptions: RequestInit = {
              method,
              headers: {
                "User-Agent": "OkHttp/4.9.2",
                ...httpHeaders,
              },
            };
            if (method.toUpperCase() === "POST") {
              fetchOptions.body = body;
            }

            const resolvedProxy = this.getProxyUrl(nestedUrl);
            const nestedRes = await fetch(resolvedProxy, fetchOptions);
            if (nestedRes.ok) {
              const responseJson = await nestedRes.json();
              // Evaluate jsonPath simple extraction (e.g. data.stream)
              let resolvedUrl = "";
              if (jsonPath) {
                const keys = jsonPath.split(".");
                let curr = responseJson;
                for (const k of keys) {
                  if (curr) curr = curr[k];
                }
                if (typeof curr === "string") resolvedUrl = curr;
              }

              if (resolvedUrl) {
                const playHeaders = { ...httpHeaders, ...(dataObj.headers || {}) };
                return { url: resolvedUrl, headers: playHeaders };
              }
            }
          }
        }
      } catch (e) {
        console.error("Error resolving flow provider:", url, e);
      }
      return null;
    }

    return null;
  }
}
