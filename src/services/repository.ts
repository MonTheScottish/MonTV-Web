import type { Channel, ChannelUrl, EPGProgram, ResolvedStream, VnepgChannel } from "../types";
import { parseM3U, parseJSON } from "./playlistParser";


export const DEFAULT_PLAYLIST_URL = "https://freem3u.xyz/api/channels/x_1.0.1/app.json";
export const VNEPG_EPG_URL = "https://vnepg.site/api";
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
  private KEY_VOLUME = "montv_volume";

  constructor() {
    this.cachedUrl = localStorage.getItem(this.KEY_PLAYLIST_URL) || DEFAULT_PLAYLIST_URL;
  }

  // Proxies URLs to bypass CORS and Cloudflare restrictions
  private getProxyUrl(url: string): string {
    if (url.startsWith("https://freem3u.xyz")) {
      return url.replace("https://freem3u.xyz", "/api-playlist");
    }
    // vnepg.site API accessible directly from browser (no Cloudflare block)
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

  // Stores the URL string of the last working source (not an index, since
  // platform-sorted order can change across sessions).
  getLastWorkingSourceUrl(channelId: string): string | null {
    const val = localStorage.getItem(this.KEY_WORKING_SRC + channelId);
    if (!val) return null;
    // Old format was a number (index). If it parses as a number, discard it —
    // it's stale and points to the wrong array after platform reordering.
    if (/^\d+$/.test(val)) return null;
    return val;
  }

  setLastWorkingSourceUrl(channelId: string, url: string): void {
    localStorage.setItem(this.KEY_WORKING_SRC + channelId, url);
  }

  getVolume(): number {
    const val = parseFloat(localStorage.getItem(this.KEY_VOLUME) || "1");
    return isNaN(val) ? 1 : Math.max(0, Math.min(1, val));
  }

  setVolume(volume: number): void {
    localStorage.setItem(this.KEY_VOLUME, volume.toString());
  }

  private normalizeChannelName(name: string): string {
    return name
      .toLowerCase()
      // Strip (1080p), (720p), (240p), [not 24/7], parentheticals and brackets
      .replace(/\(([^)]*)\)/g, "")
      .replace(/\[[^\]]*\]/g, "")
      // Strip common resolution / quality tokens that confuse exact match
      .replace(/\b(1080p|720p|480p|360p|240p|144p|4k|2k|uhd|hdr|hevc|h264|h265|av1)\b/g, "")
      // Strip quality / status tags
      .replace(/\b(not\s*\d+\s*\/\s*\d+|geo\s*-?\s*blocked|premium)\b/g, "")
      // Strip prefix/suffix common in IPTV sources: "IPTV.", "|DE", "|EN"
      .replace(/\s*[|·|].*$/g, "")
      .replace(/\s+/g, "")
      // Strip redundant quality/codec words (case-insensitive multi-occurrence)
      .replace(/hd/g, "")
      .replace(/sd/g, "")
      .replace(/fhd/g, "")
      .replace(/uhd/g, "")
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
      .replace("hd", "")
      .replace("sd", "")
      .replace("fhd", "")
      .trim();
  }

  isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      // iPad on iOS 13+ reports as Mac with touch points
      (/(Macintosh)/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }

  private cachedPlatform: string | null = null;

  detectPlatform(): "ios" | "android" | "macos" | "windows" | "linux" | "tizen" | "webos" | "androidtv" | "unknown" {
    if (this.cachedPlatform) return this.cachedPlatform as any;
    if (typeof navigator === "undefined") return "unknown";
    const ua = navigator.userAgent || "";
    let p: string = "unknown";
    if (/Tizen/i.test(ua)) p = "tizen";
    else if (/Web0S|webOS/i.test(ua)) p = "webos";
    else if (/SMART-TV|SmartTV|HBBTV|VIERA/i.test(ua)) p = "tizen";
    else if (/Android/i.test(ua)) {
      // Android TV boxes report Android+TV or "AFT" in UA
      p = /Android TV|Aft[0-9]+|BRAVIA|AFTM[A-Z]+/i.test(ua) ? "androidtv" : "android";
    } else if (this.isIOS()) p = "ios";
    else if (/Macintosh/i.test(ua)) p = "macos";
    else if (/Windows/i.test(ua)) p = "windows";
    else if (/Linux/i.test(ua)) p = "linux";
    this.cachedPlatform = p;
    return p as any;
  }

  private KEY_FAIL_PREFIX = "montv_fail_";
  private KEY_BLACKLIST_PREFIX = "montv_blacklist_";
  private BLACKLIST_TTL_MS = 24 * 60 * 60 * 1000;

  // Returns fail count for (channelId, urlIndex), or 0.
  getFailCount(channelId: string, urlIndex: number): number {
    if (typeof localStorage === "undefined") return 0;
    const raw = localStorage.getItem(this.KEY_FAIL_PREFIX + channelId);
    if (!raw) return 0;
    try {
      const map = JSON.parse(raw) as Record<string, number>;
      return map[urlIndex] || 0;
    } catch { return 0; }
  }

  // Bump fail count for a specific (channelId, urlIndex). Returns the new count.
  bumpFailCount(channelId: string, urlIndex: number): number {
    if (typeof localStorage === "undefined") return 0;
    const key = this.KEY_FAIL_PREFIX + channelId;
    let map: Record<string, number> = {};
    try { map = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { map = {}; }
    map[urlIndex] = (map[urlIndex] || 0) + 1;
    localStorage.setItem(key, JSON.stringify(map));
    return map[urlIndex];
  }

  // Reset fail counts when source successfully plays.
  resetFailCount(channelId: string): void {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(this.KEY_FAIL_PREFIX + channelId);
  }

  // Returns true if the source URL has been blacklisted (>= 3 fails) within TTL.
  isSourceBlacklisted(channelId: string, url: string): boolean {
    if (typeof localStorage === "undefined") return false;
    const key = this.KEY_BLACKLIST_PREFIX + channelId;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
      const entry = JSON.parse(raw) as { urls: string[]; ts: number };
      if (Date.now() - entry.ts > this.BLACKLIST_TTL_MS) {
        localStorage.removeItem(key);
        return false;
      }
      return entry.urls.includes(url);
    } catch { return false; }
  }

  blacklistSource(channelId: string, url: string): void {
    if (typeof localStorage === "undefined") return;
    const key = this.KEY_BLACKLIST_PREFIX + channelId;
    let entry: { urls: string[]; ts: number } = { urls: [], ts: Date.now() };
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < this.BLACKLIST_TTL_MS) entry = parsed;
      }
    } catch { /* keep default */ }
    if (!entry.urls.includes(url)) entry.urls.push(url);
    if (entry.urls.length > 10) entry.urls = entry.urls.slice(-10);
    localStorage.setItem(key, JSON.stringify(entry));
  }

  clearBlacklist(channelId: string): void {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(this.KEY_BLACKLIST_PREFIX + channelId);
  }

  // Re-orders channel.urls based on detected platform compatibility.
  // iOS: prefer flow (JSON-resolved m3u8 → Safari native HLS) > hls > webview
  //       (Shaka iframe Widevine DRM fails on Safari for most encrypted channels).
  // Desktop/Android/Smart TV: prefer webview (Shaka handles DRM) first.
  // Blacklisted URLs are demoted to the very end.
  orderUrlsByPlatform(channel: Channel): ChannelUrl[] {
    const urls = [...channel.urls];
    const platform = this.detectPlatform();
    const score = (u: ChannelUrl): number => {
      const blacklisted = this.isSourceBlacklisted(channel.id, u.url) ? -1000 : 0;
      const prov = (u.provider || "hls").toLowerCase();
      let s = 0;
      if (prov === "vtvgo") {
        s = 10;
      } else if (prov === "webview") {
        if (platform === "ios") {
          // iOS Safari: Shaka iframe (Widevine/ClearKey) fails for most DRM
          // channels (VTV, SCTV, HBO…). Shaka can try FairPlay but depends on
          // upstream manifest. Low score — user confirmed flow sources work.
          s = 1;
        } else if (platform === "androidtv" || platform === "tizen" || platform === "webos") {
          s = 5; // Smart TV: Shaka handles DRM well
        } else if (platform === "android") {
          s = 5; // Android: Shaka Widevine works
        } else {
          s = 4; // Desktop: Shaka works
        }
      } else if (prov === "flow") {
        // flow → resolves to m3u8 via JSON endpoint. Safari native HLS plays
        // FairPlay-protected m3u8 natively. On iOS this is the best source.
        s = platform === "ios" ? 6 : 3;
      } else if (prov === "backup_public") {
        s = platform === "ios" ? 2 : 1; // iptv-org public m3u8 — works on iOS
      } else {
        // hls / video: plain m3u8. On iOS Safari, canPlayType for native HLS
        // is true so these play fine when not DRM-encrypted.
        s = platform === "ios" ? 5 : 2;
      }
      return s + blacklisted;
    };
    urls.sort((a, b) => score(b) - score(a));
    return urls;
  }

  // Some playlist entries carry `?key=<kid>:<key>` inline; surface that
  // for shaka.html to consume as ClearKey.
  private parseInlineKey(url: string): { keyId: string; key: string } | null {
    try {
      const u = new URL(url, "http://x");
      const raw = u.searchParams.get("key") || u.searchParams.get("keys");
      if (!raw) return null;
      const firstPair = raw.split(",")[0];
      const parts = firstPair.split(":");
      if (parts.length !== 2) return null;
      return { keyId: parts[0].trim(), key: parts[1].trim() };
    } catch {
      return null;
    }
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
      if (ch.id === "vtv2" || ch.id.startsWith("vtv2_")) {
        const filteredUrls = ch.urls.filter((u) => 
          u.provider !== "flow" && 
          !u.url.includes("toiyeuvietnam.dpdns.org") &&
          !u.url.includes("fptplay53.net") &&
          !u.url.includes("play.m3u8?vid=")
        );
        filteredUrls.unshift({ url: "2", provider: "vtvgo" });
        let webviewUrl = filteredUrls.find((u) => u.provider === "webview")?.url;
        if (!webviewUrl) {
          webviewUrl = "https://freem3u.xyz/shaka.html?videoUrl=https://livesct.vtvprime.vn/mean/VTV2_HD/manifest.mpd&keys=d8099c6c4ebc4ab88ce6f694f912e26d:ec57977de110995b8fc5d42e4ffdbcc9";
          filteredUrls.push({ url: webviewUrl, provider: "webview" });
        }
        return {
          ...ch,
          streamUrl: "2",
          urls: filteredUrls,
        };
      }
      if (ch.id === "vtv3" || ch.id.startsWith("vtv3_")) {
        let filteredUrls = ch.urls.filter((u) => 
          u.provider !== "flow" && 
          !u.url.includes("toiyeuvietnam.dpdns.org") &&
          !u.url.includes("fptplay53.net") &&
          !u.url.includes("play.m3u8?vid=")
        );
        filteredUrls.unshift({ url: "3", provider: "vtvgo" });
        let foundWebview = false;
        filteredUrls = filteredUrls.map((u) => {
          if (u.provider === "webview") {
            foundWebview = true;
            let fixedUrl = u.url;
            if (!fixedUrl.includes("2c00d6f2992141b99bee7abc5a9cc687")) {
              fixedUrl = fixedUrl + ",2c00d6f2992141b99bee7abc5a9cc687:ec57977de110995b8fc5d42e4ffdbcc9";
            }
            return { ...u, url: fixedUrl };
          }
          return u;
        });
        if (!foundWebview) {
          const webviewUrl = "https://freem3u.xyz/shaka.html?videoUrl=https://livesct.vtvprime.vn/mean/VTV3_HD/manifest.mpd&keys=d8099c6c4ebc4ab88ce6f694f912e26d:ec57977de110995b8fc5d42e4ffdbcc9,2c00d6f2992141b99bee7abc5a9cc687:ec57977de110995b8fc5d42e4ffdbcc9";
          filteredUrls.push({ url: webviewUrl, provider: "webview" });
        }
        return {
          ...ch,
          streamUrl: "3",
          urls: filteredUrls,
        };
      }
      if (ch.id === "vtv1" || ch.id.startsWith("vtv1_")) {
        const filteredUrls = ch.urls.filter((u) => 
          u.provider !== "flow" && 
          !u.url.includes("toiyeuvietnam.dpdns.org") &&
          !u.url.includes("fptplay53.net") &&
          !u.url.includes("play.m3u8?vid=")
        );
        filteredUrls.unshift({ url: "1", provider: "vtvgo" });
        let webviewUrl = filteredUrls.find((u) => u.provider === "webview")?.url;
        if (!webviewUrl) {
          webviewUrl = "https://freem3u.xyz/shaka.html?videoUrl=https://livesct.vtvprime.vn/mean/VTV1_HD/manifest.mpd&keys=d8099c6c4ebc4ab88ce6f694f912e26d:ec57977de110995b8fc5d42e4ffdbcc9";
          filteredUrls.push({ url: webviewUrl, provider: "webview" });
        }
        return {
          ...ch,
          streamUrl: "1",
          urls: filteredUrls,
        };
      }
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
          // Index backups under both `name-norm` and `tvgId-base` so we can
          // match freem3u channels even when the names diverge (iptv-org uses
          // `VTV3 HD (1080p)`, freem3u uses `VTV3`, freem3u tvgId = `VTV3.VN`).
          const backupMap: Record<string, ChannelUrl[]> = {};
          const normBackupTvg = (t: string | null | undefined): string => {
            if (!t) return "";
            // Strip trailing country code, quality suffix, and codec markers
            return t
              .toLowerCase()
              .replace(/\.vn(@.*)?$/i, "")
              .replace(/@.*$/g, "")
              .replace(/\b(hd|sd|fhd|uhd|4k)\b/g, "")
              .replace(/[\s\-_]/g, "")
              .trim();
          };
          backupChannels.forEach((bc) => {
            const normName = this.normalizeChannelName(bc.name);
            const normTvg = normBackupTvg(bc.tvgId);
            const entry: ChannelUrl = { url: bc.streamUrl, provider: "backup_public" };
            for (const key of [normName, normTvg]) {
              if (!key) continue;
              if (!backupMap[key]) backupMap[key] = [];
              // Avoid duplicate URL within same key bucket.
              if (!backupMap[key].some((x) => x.url === entry.url)) {
                backupMap[key].push(entry);
              }
            }
          });

          channels = rawChannels.map((mc) => {
            const normMainName = this.normalizeChannelName(mc.name);
            const normMainTvg = (mc.tvgId || "")
              .toLowerCase()
              .replace(/\.vn(@.*)?$/i, "")
              .replace(/@.*$/g, "")
              .replace(/\b(hd|sd|fhd|uhd|4k)\b/g, "")
              .replace(/[\s\-_]/g, "")
              .trim();
            const merged = new Map<string, ChannelUrl>();
            for (const key of [normMainName, normMainTvg]) {
              const list = key ? backupMap[key] || [] : [];
              for (const bu of list) {
                if (!merged.has(bu.url)) merged.set(bu.url, bu);
              }
            }
            const backups = Array.from(merged.values());
            if (backups.length > 0) {
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
      const channelsRes = await fetch(this.getProxyUrl(`${VNEPG_EPG_URL}/channels`));
      if (!channelsRes.ok) throw new Error(`Fetch channels failed: ${channelsRes.status}`);
      const channelsJson = await channelsRes.json();
      const apiChannels: VnepgChannel[] = channelsJson.channels || [];

      for (const ch of apiChannels) {
        this.vnepgChannels[ch.id] = ch;
      }

      if (onProgress) onProgress(0.2);

      this.buildTvgIdToVnepgIdMap();

      if (onProgress) onProgress(0.3);

      const allVnepgIds = new Set<string>();
      for (const tvgId of Object.values(this.tvgIdToVnepgId)) {
        allVnepgIds.add(tvgId);
      }
      for (const vnepgId of Object.values(this.channelNameToVnepgId)) {
        allVnepgIds.add(vnepgId);
      }

      const matchedIds = Array.from(allVnepgIds);
      if (matchedIds.length === 0) {
        if (onProgress) onProgress(1.0);
        this.lastEpgLoadTime = Date.now();
        return;
      }

      let loaded = 0;
      const total = matchedIds.length;

      const fetchSchedule = async (id: string): Promise<void> => {
        try {
          const schedRes = await fetch(this.getProxyUrl(`${VNEPG_EPG_URL}/schedule/${id}`));
          if (!schedRes.ok) return;
          const schedJson = await schedRes.json();
          const items = schedJson.items || [];
          this.epgData[id] = items.map((item: { startMs: number; stopMs: number; title: string; desc?: string }) => ({
            title: item.title || "",
            start: new Date(item.startMs).toISOString(),
            stop: new Date(item.stopMs).toISOString(),
            description: item.desc || "",
          }));
        } catch (e) {
          console.warn(`EPG fetch failed for channel ${id}`, e);
        }
        loaded++;
        if (onProgress) onProgress(0.3 + (loaded / total) * 0.6);
      };

      const BATCH_SIZE = 10;
      for (let i = 0; i < matchedIds.length; i += BATCH_SIZE) {
        const batch = matchedIds.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(fetchSchedule));
      }

      this.overrideChannelMetadataFromVnepg();
      if (onProgress) onProgress(1.0);
      this.lastEpgLoadTime = Date.now();
    } catch (e) {
      console.error("Error loading EPG from vnepg.site", e);
      if (onProgress) onProgress(1.0);
    }
  }

  private buildTvgIdToVnepgIdMap(): void {
    const vnepgKeys = new Set(Object.keys(this.vnepgChannels));
    const vnepgNames: Record<string, string> = {};
    for (const key in this.vnepgChannels) {
      const rawName = this.vnepgChannels[key].name;
      const cleanName = rawName.replace(/^VN\s*-\s*/i, "").toLowerCase();
      vnepgNames[cleanName] = key;
      vnepgNames[rawName.toLowerCase()] = key;
    }

    const resolved: Record<string, string> = {};
    const resolvedByName: Record<string, string> = {};

    for (const channel of this.cachedChannels) {
      const tvgId = channel.tvgId;
      let matchedVnepgId: string | null = null;

      if (tvgId) {
        const candidates: string[] = [];
        candidates.push(tvgId.toLowerCase());
        candidates.push(tvgId.replace(/\.VN$/i, "").toLowerCase());
        candidates.push(tvgId.replace(/\.vn$/i, "").toLowerCase());

        const stripped = tvgId.replace(/\.VN$/i, "").replace(/\.vn$/i, "").replace(/hd$|sd$|fhd$/i, "").toLowerCase();
        if (stripped !== tvgId.replace(/\.VN$/i, "").replace(/\.vn$/i, "").toLowerCase()) {
          candidates.push(stripped);
          candidates.push(stripped + ".vn");
        }

        const aliases = TVG_ID_ALIASES[tvgId];
        if (aliases) {
          aliases.forEach((a) => candidates.push(a.toLowerCase()));
        }

        const hit = candidates.find((c) => vnepgKeys.has(c));
        if (hit) {
          matchedVnepgId = hit;
          resolved[tvgId] = hit;
        }
      }

      // Fallback: match by normalized name if tvgId matching yielded no results
      if (!matchedVnepgId) {
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

      const cleanedMetaName = meta.name.replace(/^VN\s*-\s*/i, "").trim();
      const newName =
        !channel.name || cleanedMetaName.length > channel.name.length
          ? cleanedMetaName || channel.name
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

  // Reorder URLs by platform and return them. This is the single source of
  // truth for "which URL to try first" — components should use this order
  // when bumping activeSourceIndex, and resolveChannelStreamUrl uses it too.
  getUrlsForChannel(channel: Channel): ChannelUrl[] {
    return this.orderUrlsByPlatform(channel);
  }

  async resolveChannelStreamUrl(channel: Channel, urlIndex = 0): Promise<ResolvedStream | null> {
    // Always resolve against platform-sorted URLs so the caller's urlIndex
    // maps to the correct provider regardless of the original array order.
    const urlsToTry = channel.urls.length === 0
      ? [{ url: channel.streamUrl, provider: "hls" }]
      : this.orderUrlsByPlatform(channel);

    if (urlIndex < 0 || urlIndex >= urlsToTry.length) return null;

    const channelUrl = urlsToTry[urlIndex];
    const provider = channelUrl.provider;
    let url = channelUrl.url;
    if (!url) return null;

    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
      url = url.replace("http://", "https://");
    }

    if (!provider || provider === "hls" || provider === "video" || provider === "backup_public") {
      const headers: Record<string, string> = {};
      if (channel.userAgent) headers["User-Agent"] = channel.userAgent;
      if (channel.referer) headers["Referer"] = channel.referer;
      return { url, headers };
    }

    if (provider === "webview") {
      let resolvedUrl = url;
      if (url.startsWith("https://freem3u.xyz/shaka.html")) {
        resolvedUrl = url.replace("https://freem3u.xyz/shaka.html", "/shaka.html");
      }

      // Surface DRM config from a paired flow source (if any) so the iframe
      // can license FairPlay/ClearKey content. Mark of pairing is: same channel
      // has a flow URL whose stream URL matches the webview's stream URL prefix.
      const pairedFlow = channel.urls.find(
        (u) => u.provider === "flow" && u.url && u.url.includes("play.m3u8")
      );

      let drmKey: string | null = null;
      let drmKeyId: string | null = null;
      let drmCertUrl: string | null = null;
      let drmLicenseUrl: string | null = null;
      let drmScheme: string | null = null;

      const inlineKey = this.parseInlineKey(url);
      if (inlineKey) {
        drmKeyId = inlineKey.keyId;
        drmKey = inlineKey.key;
        drmScheme = "clearkey";
      }

      const urlObj = (() => {
        try { return new URL(resolvedUrl, window.location.origin); } catch { return null; }
      })();
      if (urlObj) {
        const ks = urlObj.searchParams.get("keyserver");
        const cu = urlObj.searchParams.get("certUrl");
        if (ks) {
          drmLicenseUrl = ks;
          drmScheme = this.isIOS() ? "fairplay" : "widevine";
        }
        if (cu) drmCertUrl = cu;
      }

      void pairedFlow; // pair-resolution deferred to flow resolver below on demand

      // Append ClearKey params so the iframe Shaka config picks them up.
      if (drmKeyId && drmKey) {
        try {
          const u = new URL(resolvedUrl, window.location.origin);
          if (!u.searchParams.has("keyId")) u.searchParams.set("keyId", drmKeyId);
          if (!u.searchParams.has("key")) u.searchParams.set("key", drmKey);
          resolvedUrl = u.pathname + (u.search || "") + (u.hash || "");
        } catch { /* ignore malformed URL */ }
      }

      return {
        url: resolvedUrl,
        headers: undefined,
        drmScheme,
        drmKeyId,
        drmKey,
        drmCertUrl,
        drmLicenseUrl,
        isWebView: true,
      };
    }

    if (provider === "vtvgo") {
      return this.resolveVtvgoStream(url);
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

  private async resolveVtvgoStream(channelId: string): Promise<ResolvedStream | null> {
    try {
      await loadVtvgoWasm();
      const w = window as any;

      let deviceId = localStorage.getItem("vtvgo_device_id");
      if (!deviceId) {
        deviceId = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : "1a25bdd1-b7de-4b29-a428-9d3deed9be46";
        localStorage.setItem("vtvgo_device_id", deviceId);
      }

      const deviceName = "Chrome/Windows";
      const versionCode = 20260603;
      const platform = 6;
      const secret = "";

      const apiBase = "https://web-api-vtvgo.vtvdigital.vn";
      const keyStr = "kLPiBsNsZc3cz1hlf2ALgBpziNnQW23v";

      const ptr = w.OnModule.ccall(
        "allocOn",
        "number",
        ["number", "string"],
        [0, JSON.stringify({ deviceId })]
      );

      let token = localStorage.getItem("vtvgo_guest_token");

      if (!token) {
        const qPayload = {
          deviceId,
          deviceName,
          versionCode,
          platform,
          secret
        };
        const qStr = Object.values(qPayload).join("&&");

        const guestSignature = w.OnModule.ccall(
          "signatureA",
          "string",
          ["number", "string", "string"],
          [ptr, qStr, w.a_req]
        );

        const guestBodyPayload = {
          deviceId,
          deviceName,
          dtId: 1,
          spId: "1",
          platform,
          clientId: "null",
          signature: guestSignature,
          versionCode
        };

        const guestRes = await fetch(`${apiBase}/user/nt/api/v1/auth/enter-guest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(guestBodyPayload)
        });

        if (!guestRes.ok) {
          throw new Error(`Guest registration failed with status ${guestRes.status}`);
        }

        const guestResJson = await guestRes.json();
        if (guestResJson.data && guestResJson.data.accessToken) {
          token = guestResJson.data.accessToken;
          localStorage.setItem("vtvgo_guest_token", token!);
        } else {
          throw new Error("No token returned in guest registration response");
        }
      }

      const sourcePayload = { channelId };
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let sourceIv = "";
      for (let i = 0; i < 16; i++) {
        sourceIv += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const encryptedSourcePayload = await encryptAes256Cbc(JSON.stringify(sourcePayload), sourceIv, keyStr);
      const sourceBody = JSON.stringify({ e: encryptedSourcePayload });

      const sourceSignature = w.OnModule.ccall(
        "signatureA",
        "string",
        ["number", "string", "string"],
        [ptr, JSON.stringify(sourcePayload), w.a_req]
      );

      const fetchSource = async (t: string) => {
        return fetch(`${apiBase}/livechannelsec/api/v2/s-channels/source`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${t}`,
            "x-encrypt-id": sourceIv,
            "x-signature": sourceSignature
          },
          body: sourceBody
        });
      };

      let res = await fetchSource(token!);

      if (res.status === 401) {
        localStorage.removeItem("vtvgo_guest_token");
        return this.resolveVtvgoStream(channelId);
      }

      if (!res.ok) {
        throw new Error(`Source request failed with status ${res.status}`);
      }

      const resIv = res.headers.get("x-encrypt-id");
      if (!resIv) {
        throw new Error("Missing x-encrypt-id header in source response");
      }

      const responseJson = await res.json();
      const ciphertext = responseJson.e;

      const decrypted = await decryptAes256Cbc(ciphertext, resIv, keyStr);
      const decryptedData = JSON.parse(decrypted);

      if (decryptedData.status !== 0 || !decryptedData.data) {
        throw new Error(`VTVgo API returned error: ${decryptedData.message}`);
      }

      const sourceModes = decryptedData.data.sourceModes || [];
      const defaultMode = sourceModes.find((m: any) => m.id === "default");
      if (!defaultMode || !defaultMode.multiSource) {
        throw new Error("Default source mode not found in decrypted stream data");
      }

      const nonDrmSource = defaultMode.multiSource.find(
        (s: any) => s.drmInfo && s.drmInfo.drmType === "none"
      ) || defaultMode.multiSource.find(
        (s: any) => !s.drmInfo || s.drmInfo.drmType === "none"
      );

      if (!nonDrmSource || !nonDrmSource.sources || nonDrmSource.sources.length === 0) {
        throw new Error("No non-DRM sources found in stream data");
      }

      const streamUrl = nonDrmSource.sources[0].url;
      return {
        url: streamUrl,
        headers: undefined
      };
    } catch (e) {
      console.error("Error in resolveVtvgoStream:", e);
      return null;
    }
  }
}

let wasmLoadPromise: Promise<void> | null = null;

async function loadVtvgoWasm(): Promise<void> {
  if (wasmLoadPromise) return wasmLoadPromise;

  wasmLoadPromise = new Promise<void>((resolve, reject) => {
    const w = window as any;
    if (w.OnModule && w.OnModule.readyToPlay) {
      resolve();
      return;
    }

    const scriptUrl = "https://web-cache-aws.vtvdigital.vn/assets/file/secret/38PPszYQ_20250527.js";
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.onload = () => {
      if (typeof w.loadFunction === "function") {
        w.loadFunction("https://web-cache-aws.vtvdigital.vn/assets/file/secret/")
          .then(() => {
            const checkReady = setInterval(() => {
              if (w.OnModule && w.OnModule.readyToPlay) {
                clearInterval(checkReady);
                resolve();
              }
            }, 100);
          })
          .catch((err: any) => {
            wasmLoadPromise = null;
            reject(err);
          });
      } else {
        wasmLoadPromise = null;
        reject(new Error("loadFunction is not defined on window"));
      }
    };
    script.onerror = (err) => {
      wasmLoadPromise = null;
      reject(err);
    };
    const container = document.head || document.documentElement || document.body;
    container.appendChild(script);
  });

  return wasmLoadPromise;
}

async function encryptAes256Cbc(plaintext: string, ivStr: string, keyStr: string): Promise<string> {
  const keyBuf = new TextEncoder().encode(keyStr);
  const ivBuf = new TextEncoder().encode(ivStr.substring(0, 16));
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );

  const plainBytes = new TextEncoder().encode(plaintext);
  const encryptedBuf = await window.crypto.subtle.encrypt(
    { name: "AES-CBC", iv: ivBuf },
    cryptoKey,
    plainBytes
  );

  const encryptedBytes = new Uint8Array(encryptedBuf);
  let binary = "";
  for (let i = 0; i < encryptedBytes.byteLength; i++) {
    binary += String.fromCharCode(encryptedBytes[i]);
  }
  return btoa(binary);
}

async function decryptAes256Cbc(ciphertextBase64: string, ivStr: string, keyStr: string): Promise<string> {
  const keyBuf = new TextEncoder().encode(keyStr);
  const ivBuf = new TextEncoder().encode(ivStr.substring(0, 16));
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );

  const cipherBytes = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
  const decryptedBuf = await window.crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBuf },
    cryptoKey,
    cipherBytes
  );

  return new TextDecoder().decode(decryptedBuf);
}

