import React, { useEffect, useState, useMemo, useRef } from "react";
import Hls from "hls.js";
import type { Channel } from "../types";
import { MonTVRepository } from "../services/repository";
import { Tv, Heart, Clock, Settings, Search, Play, Star, List, AlertCircle, RefreshCw, Sun, Moon } from "lucide-react";

interface MiniPlayerProps {
  channel: Channel;
  repository: MonTVRepository;
}

const areHeadersEqual = (h1: Record<string, string>, h2: Record<string, string>) => {
  const k1 = Object.keys(h1);
  const k2 = Object.keys(h2);
  if (k1.length !== k2.length) return false;
  return k1.every((k) => h1[k] === h2[k]);
};

const MiniPlayer: React.FC<MiniPlayerProps> = ({ channel, repository }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streamUrl, setStreamUrl] = useState("");
  const [resolvedHeaders, setResolvedHeaders] = useState<Record<string, string>>({});
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [isWebView, setIsWebView] = useState(false);

  // Platform-sorted URL list — single source of truth for source indexing.
  const platformUrls = useMemo(
    () => repository.getUrlsForChannel(channel),
    [channel, repository]
  );

  // Sync source index when channel changes (uses platform-sorted array).
  useEffect(() => {
    const savedUrl = repository.getLastWorkingSourceUrl(channel.id);
    let sourceIndex = 0;
    if (savedUrl) {
      const idx = platformUrls.findIndex((u) => u.url === savedUrl);
      sourceIndex = idx !== -1 ? idx : 0;
    } else {
      const firstUsable = platformUrls.findIndex(
        (u) => !repository.isSourceBlacklisted(channel.id, u.url)
      );
      sourceIndex = firstUsable !== -1 ? firstUsable : 0;
    }
    setActiveSourceIndex(sourceIndex);
  }, [channel.id, platformUrls, repository]);

  // Fetch resolved stream URL when channel or source index changes
  useEffect(() => {
    let active = true;
    setIsWebView(false);
    const resolve = async () => {
      try {
        const resolved = await repository.resolveChannelStreamUrl(channel, activeSourceIndex);
        if (!active) return;
        if (resolved && resolved.url) {
          setStreamUrl(resolved.url);
          const nextHeaders = resolved.headers || {};
          setResolvedHeaders((prev) => areHeadersEqual(prev, nextHeaders) ? prev : nextHeaders);
          setIsWebView(!!resolved.isWebView);
        } else {
          setStreamUrl(channel.streamUrl);
          setResolvedHeaders((prev) => Object.keys(prev).length === 0 ? prev : {});
          setIsWebView(false);
        }
      } catch (e) {
        console.error("MiniPlayer error resolving stream:", e);
        if (active) {
          setStreamUrl(channel.streamUrl);
          setResolvedHeaders((prev) => Object.keys(prev).length === 0 ? prev : {});
          setIsWebView(false);
        }
      }
    };
    resolve();
    return () => {
      active = false;
    };
  }, [channel.id, channel.streamUrl, activeSourceIndex, repository]);

  // Fallback switching reference (single attempt — preview only, no infinite loop)
  const handleStreamFailureRef = useRef<(reason: string) => void>(() => {});
  handleStreamFailureRef.current = (reason: string = "generic") => {
    const urlsCount = platformUrls.length || 1;
    const currentUrl = platformUrls[activeSourceIndex]?.url || "";
    const failCount = repository.bumpFailCount(channel.id, activeSourceIndex);
    if (
      /key|clearkey|fairplay|widevine|drm|manifest|not.?supported/i.test(reason) &&
      currentUrl
    ) {
      repository.blacklistSource(channel.id, currentUrl);
    }
    if (activeSourceIndex + 1 < urlsCount) {
      const nextIndex = activeSourceIndex + 1;
      console.log(`MiniPlayer stream failed (${reason}). Switching to source ${nextIndex}`);
      setActiveSourceIndex(nextIndex);
    } else if (failCount < 2) {
      // Wrap once to the first non-blacklisted in platform-sorted order.
      const candidates = platformUrls.filter(
        (u) => !repository.isSourceBlacklisted(channel.id, u.url)
      );
      if (candidates.length > 0) {
        const wrapIndex = platformUrls.findIndex((u) => u.url === candidates[0].url);
        if (wrapIndex !== -1 && wrapIndex !== activeSourceIndex) {
          console.log(`MiniPlayer wrapping to platform-preferred source ${wrapIndex} (failCount=${failCount})`);
          setActiveSourceIndex(wrapIndex);
        }
      }
    }
  };

  // Setup Hls.js or HTML5 native playback
  useEffect(() => {
    if (isWebView) return; // Skip for webviews

    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const playVideo = () => {
      video.play().catch((e) => {
        console.warn("MiniPlayer auto-play blocked:", e);
      });
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", playVideo);
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        maxMaxBufferLength: 5,
        enableWorker: true,
        lowLatencyMode: true,
        xhrSetup: (xhr, _url) => {
          if (resolvedHeaders) {
            Object.entries(resolvedHeaders).forEach(([k, v]) => {
              try {
                if (k.toLowerCase() !== "user-agent" && k.toLowerCase() !== "referer") {
                  xhr.setRequestHeader(k, v);
                }
              } catch (e) {
                console.warn("Could not set request header", k, e);
              }
            });
          }
        },
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        playVideo();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        const details = (data.details || "").toString();
        if (
          details === Hls.ErrorDetails.KEY_LOAD_ERROR ||
          details === Hls.ErrorDetails.KEY_LOAD_TIMEOUT ||
          details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
          details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
        ) {
          handleStreamFailureRef.current?.(details);
          return;
        }
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (repository.getFailCount(channel.id, activeSourceIndex) >= 1) {
              handleStreamFailureRef.current?.(details || "network");
            } else {
              hls.startLoad();
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (repository.getFailCount(channel.id, activeSourceIndex) >= 1) {
              handleStreamFailureRef.current?.(details || "media");
            } else {
              hls.recoverMediaError();
            }
            break;
          default:
            handleStreamFailureRef.current?.(details || "unknown");
            break;
        }
      });
    }

    const handlePlaying = () => {
      repository.resetFailCount(channel.id);
      const playedUrl = platformUrls[activeSourceIndex]?.url;
      if (playedUrl) repository.setLastWorkingSourceUrl(channel.id, playedUrl);
      console.log(`MiniPlayer successfully playing channel ${channel.name} at index ${activeSourceIndex}`);
    };

    const handleVideoError = () => {
      if (video.error) {
        console.error("MiniPlayer HTML5 video error:", video.error);
        const reason = video.error.code === 4 ? "not-supported" :
                       video.error.code === 5 ? "decode" :
                       "media";
        handleStreamFailureRef.current?.(reason);
      }
    };

    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", handleVideoError);

    return () => {
      if (video) {
        video.removeEventListener("loadedmetadata", playVideo);
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("error", handleVideoError);
        video.src = "";
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, resolvedHeaders, activeSourceIndex, channel.id, channel.name, isWebView]);

  if (isWebView) {
    const previewUrl = streamUrl ? (streamUrl + (streamUrl.includes("?") ? "&muted=true" : "?muted=true")) : "";
    return (
      <iframe
        src={previewUrl}
        title={`Trình phát thu nhỏ kênh ${channel.name}`}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          backgroundColor: "black",
          borderRadius: "12px",
        }}
        allow="autoplay; encrypted-media"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        borderRadius: "12px",
        backgroundColor: "black",
      }}
    />
  );
};

interface LiveTvScreenProps {
  repository: MonTVRepository;
  playlistUrl: string;
  selectedCategory: string;
  onCategorySelected: (category: string) => void;
  lastFocusedChannelId: string | null;
  onFocusedChannelChanged: (id: string | null) => void;
  onPlayChannel: (channel: Channel, list: Channel[]) => void;
  onOpenSettings: () => void;
}

export const LiveTvScreen: React.FC<LiveTvScreenProps> = ({
  repository,
  playlistUrl,
  selectedCategory,
  onCategorySelected,
  lastFocusedChannelId,
  onFocusedChannelChanged,
  onPlayChannel,
  onOpenSettings,
}) => {
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [epgLoaded, setEpgLoaded] = useState(false);

  // Theme state
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("montv-theme");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });

  // Sync theme to <html> data-theme attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("montv-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // Search and Focus states
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedChannel, setFocusedChannel] = useState<Channel | null>(null);
  const [debouncedChannel, setDebouncedChannel] = useState<Channel | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setDebouncedChannel(null);
    if (!focusedChannel) return;

    const timer = setTimeout(() => {
      setDebouncedChannel(focusedChannel);
    }, 1500); // 1.5 seconds debounce

    return () => clearTimeout(timer);
  }, [focusedChannel]);

  // Time state for TopBar
  const [nowMillis, setNowMillis] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMillis(Date.now());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Channels & EPG
  const loadData = async (force = false) => {
    setIsLoading(true);
    setErrorMsg(null);
    setEpgLoaded(false);

    try {
      const list = await repository.fetchChannels(playlistUrl, force);
      setAllChannels(list);
      setFavorites(repository.getFavorites());
      setRecents(repository.getRecentChannelIds());
      setIsLoading(false);

      // Load EPG in background
      repository.loadEPG(force).then(() => {
        setEpgLoaded(true);
        // Force update of current focused channel EPG
        if (focusedChannel) {
          const freshChannel = list.find((c) => c.id === focusedChannel.id);
          if (freshChannel) setFocusedChannel(freshChannel);
        }
      }).catch((e) => {
        console.error("EPG fetch failed:", e);
      });
    } catch (e: any) {
      setIsLoading(false);
      setErrorMsg(e.message || "Tải danh sách kênh thất bại.");
    }
  };

  useEffect(() => {
    loadData();
  }, [playlistUrl]);

  // Extract Categories
  const categories = useMemo(() => {
    const fixed = ["Tất cả kênh", "Yêu thích", "Đang xem"];
    const groups = Array.from(new Set(allChannels.map((c) => c.groupTitle))).filter(
      (g) => g && !fixed.includes(g)
    );
    return [...fixed, ...groups];
  }, [allChannels]);

  // Filter Channels by Category & Search Query
  const displayedChannels = useMemo(() => {
    let filtered = allChannels;

    if (selectedCategory === "Yêu thích") {
      filtered = allChannels.filter((c) => favorites.has(c.id));
    } else if (selectedCategory === "Đang xem") {
      const recentSet = new Set(recents);
      const recentMap = allChannels.filter((c) => recentSet.has(c.id)).reduce<Record<string, Channel>>((acc, c) => {
        acc[c.id] = c;
        return acc;
      }, {});
      filtered = recents.map((id) => recentMap[id]).filter(Boolean);
    } else if (selectedCategory !== "Tất cả kênh") {
      filtered = allChannels.filter((c) => c.groupTitle === selectedCategory);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(query));
    }

    return filtered;
  }, [allChannels, selectedCategory, favorites, recents, searchQuery]);

  // Set initial focused channel only once when allChannels loads
  useEffect(() => {
    if (allChannels.length > 0 && !focusedChannel) {
      if (lastFocusedChannelId) {
        const found = allChannels.find((c) => c.id === lastFocusedChannelId);
        setFocusedChannel(found || allChannels[0]);
      } else {
        setFocusedChannel(allChannels[0]);
      }
    }
  }, [allChannels]);

  const handleChannelFocus = (channel: Channel) => {
    setFocusedChannel(channel);
    onFocusedChannelChanged(channel.id);
  };

  const toggleFavorite = (e: React.MouseEvent, channelId: string) => {
    e.stopPropagation();
    const updated = new Set(favorites);
    if (updated.has(channelId)) {
      repository.removeFavorite(channelId);
      updated.delete(channelId);
    } else {
      repository.addFavorite(channelId);
      updated.add(channelId);
    }
    setFavorites(updated);
  };

  const handlePlay = (channel: Channel) => {
    repository.addRecentChannel(channel.id);
    onPlayChannel(channel, displayedChannels);
  };

  // EPG Calculations
  const epgPrograms = useMemo(() => {
    if (!focusedChannel) return [];
    return repository.getEPGForChannel(focusedChannel.tvgId, focusedChannel.id);
  }, [focusedChannel, epgLoaded]);

  const { activeProgram, futurePrograms } = useMemo(() => {
    const active = epgPrograms.find((p) => {
      try {
        const startMs = new Date(p.start).getTime();
        const stopMs = new Date(p.stop).getTime();
        return nowMillis >= startMs && nowMillis <= stopMs;
      } catch {
        return false;
      }
    });
    const future = epgPrograms.filter((p) => {
      try {
        const startMs = new Date(p.start).getTime();
        return startMs > nowMillis;
      } catch {
        return false;
      }
    });
    return { activeProgram: active || null, futurePrograms: future.slice(0, 5) };
  }, [epgPrograms, nowMillis]);


  const formatTimeRange = (startStr: string, stopStr: string): string => {
    try {
      const st = new Date(startStr);
      const sp = new Date(stopStr);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(st.getHours())}:${pad(st.getMinutes())} - ${pad(sp.getHours())}:${pad(sp.getMinutes())}`;
    } catch {
      return "";
    }
  };

  return (
    <div
      className="fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        backgroundColor: "var(--color-background)",
        color: "var(--color-on-background)",
        overflow: "hidden",
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: isMobile ? "auto" : "64px",
          padding: isMobile ? "8px 12px" : "0 24px",
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Tv size={24} style={{ color: "var(--color-accent-blue)" }} />
          <span style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "0.5px" }}>
            Mon<span style={{ color: "var(--color-accent-blue)" }}>TV</span>
          </span>
        </div>

        {/* Search & Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "10px" : "20px" }}>
          <div style={{ position: "relative" }}>
            <Search
              size={16}
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-muted)",
              }}
            />
            <input
              type="text"
              placeholder="Tìm kênh..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "8px 16px 8px 36px",
                borderRadius: "20px",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-search-bg)",
                color: "var(--color-on-background)",
                fontSize: "13px",
                outline: "none",
                width: isMobile ? "130px" : "220px",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--color-accent-blue)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--color-border)")}
            />
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
            aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              color: "var(--color-on-background)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              backgroundColor: "var(--color-search-bg)",
              transition: "all var(--transition-fast)",
            }}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            onClick={onOpenSettings}
            title="Thiết lập"
            aria-label="Thiết lập"
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              color: "var(--color-on-background)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 500,
              padding: isMobile ? "8px" : "8px 16px",
              borderRadius: "18px",
              backgroundColor: "var(--color-search-bg)",
            }}
          >
            <Settings size={16} />
            {!isMobile && "Thiết lập"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <RefreshCw className="pulse-badge" size={40} style={{ color: "var(--color-accent-blue)", animationDuration: "1.5s" }} />
        </div>
      ) : errorMsg ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "16px" }}>
          <AlertCircle size={40} color="var(--color-destructive)" />
          <p style={{ fontSize: "16px" }}>{errorMsg}</p>
          <button
            onClick={() => loadData(true)}
            style={{
              padding: "10px 24px",
              backgroundColor: "var(--color-secondary)",
              border: "none",
              borderRadius: "6px",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Thử lại
          </button>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          {/* Sidebar Categories (Responsive Layout) */}
          <div
            style={{
              flex: isMobile ? "0 0 auto" : "0 0 240px",
              borderRight: isMobile ? "none" : "1px solid var(--color-border)",
              borderBottom: isMobile ? "1px solid var(--color-border)" : "none",
              backgroundColor: "var(--color-sidebar-bg)",
              display: "flex",
              flexDirection: isMobile ? "row" : "column",
              padding: isMobile ? "8px 12px" : "16px 8px",
              overflowX: isMobile ? "auto" : "hidden",
              overflowY: isMobile ? "hidden" : "auto",
              gap: "6px",
              whiteSpace: isMobile ? "nowrap" : "normal",
            }}
          >
            {categories.map((cat) => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => onCategorySelected(cat)}
                  style={{
                    width: isMobile ? "auto" : "100%",
                    flexShrink: 0,
                    padding: isMobile ? "8px 14px" : "10px 16px",
                    textAlign: "left",
                    border: "none",
                    borderRadius: isMobile ? "0px" : "8px",
                    fontSize: "13px",
                    fontWeight: isActive ? 600 : 500,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    position: "relative",
                    color: isActive ? "var(--color-accent-blue-fg)" : "var(--color-on-background)",
                    backgroundColor: isMobile ? "transparent" : (isActive ? "var(--color-surface-hover)" : "transparent"),
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isMobile && !isActive) e.currentTarget.style.backgroundColor = "var(--color-surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isMobile && !isActive) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  {/* Active vertical line indicator for desktop */}
                  {!isMobile && isActive && (
                    <div
                      style={{
                        position: "absolute",
                        left: "4px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: "3px",
                        height: "16px",
                        borderRadius: "2px",
                        backgroundColor: "var(--color-accent-blue)",
                      }}
                    />
                  )}
                  {/* Active horizontal line indicator for mobile pivots */}
                  {isMobile && isActive && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "0",
                        left: "14px",
                        right: "14px",
                        height: "2.5px",
                        backgroundColor: "var(--color-accent-blue)",
                        borderRadius: "1px",
                      }}
                    />
                  )}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginLeft: (!isMobile && isActive) ? "6px" : "0", transition: "margin 0.15s" }}>
                    {cat === "Tất cả kênh" && <List size={16} />}
                    {cat === "Yêu thích" && <Heart size={16} />}
                    {cat === "Đang xem" && <Clock size={16} />}
                    {cat !== "Tất cả kênh" && cat !== "Yêu thích" && cat !== "Đang xem" && <Tv size={16} />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {cat}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
             {/* Top Preview/EPG Row */}
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                borderBottom: "1px solid var(--color-border)",
                backgroundColor: "rgba(0, 0, 0, 0.05)",
                flex: isMobile ? 1 : "0 0 auto",
                overflow: "hidden",
              }}
            >
              {/* Channel Preview Panel (Left) */}
              <div
                style={{
                  flex: isMobile ? "0 0 auto" : 1,
                  padding: isMobile ? "12px 16px" : "24px",
                  display: "flex",
                  flexDirection: isMobile ? "column" : "row",
                  gap: isMobile ? "12px" : "24px",
                  alignItems: isMobile ? "stretch" : "center",
                  borderRight: isMobile ? "none" : "1px solid var(--color-border)",
                  borderBottom: isMobile ? "1px solid var(--color-border)" : "none",
                }}
              >
                {focusedChannel ? (
                  <>
                    {/* Debounced Preview Video / Fallback logo */}
                    <div
                      onClick={() => handlePlay(focusedChannel)}
                      style={{
                        width: isMobile ? "100%" : "512px",
                        height: isMobile ? "auto" : "288px",
                        aspectRatio: isMobile ? "16/9" : undefined,
                        minWidth: isMobile ? "0" : "512px",
                        borderRadius: "12px",
                        backgroundColor: "black",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        position: "relative",
                        cursor: "pointer",
                      }}
                      title="Bấm để xem toàn màn hình"
                    >
                      {debouncedChannel && debouncedChannel.id === focusedChannel.id ? (
                        <MiniPlayer channel={debouncedChannel} repository={repository} />
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "12px",
                            width: "100%",
                            height: "100%",
                            position: "relative",
                          }}
                        >
                          {focusedChannel.logoUrl && (
                            <div
                              style={{
                                position: "absolute",
                                width: "120px",
                                height: "120px",
                                backgroundImage: `url(${focusedChannel.logoUrl})`,
                                backgroundSize: "contain",
                                backgroundPosition: "center",
                                backgroundRepeat: "no-repeat",
                                filter: "blur(24px) opacity(0.35)",
                                zIndex: 0,
                              }}
                            />
                          )}
                          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                            {focusedChannel.logoUrl ? (
                              <img
                                src={focusedChannel.logoUrl}
                                alt={focusedChannel.name}
                                style={{ width: "48px", height: "48px", objectFit: "contain" }}
                              />
                            ) : (
                              <Tv size={28} style={{ color: "var(--color-muted)" }} />
                            )}
                            <span style={{ fontSize: "11px", color: "var(--color-muted)", animation: "pulse 1.5s infinite" }}>
                              Đang tải bản xem trước...
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span
                          style={{
                            backgroundColor: "var(--color-secondary)",
                            color: "white",
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: "4px",
                          }}
                        >
                          Kênh {String(focusedChannel.number).padStart(2, "0")}
                        </span>
                        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                          {focusedChannel.groupTitle}
                        </span>
                      </div>

                      <h2
                        style={{
                          fontSize: "20px",
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {focusedChannel.name}
                      </h2>

                      {activeProgram ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                          <span
                            style={{
                              fontSize: "13px",
                              color: "var(--color-accent)",
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ĐANG PHÁT: {activeProgram.title}
                          </span>
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--color-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              lineHeight: "1.4",
                            }}
                          >
                            {activeProgram.description || "Không có mô tả chi tiết."}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                          {epgLoaded
                            ? "Không có thông tin lịch phát sóng tại thời điểm này."
                            : "Đang tải lịch phát sóng EPG..."}
                        </span>
                      )}

                      <button
                        onClick={() => handlePlay(focusedChannel)}
                        style={{
                          alignSelf: "flex-start",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "8px 20px",
                          backgroundColor: "var(--color-accent-blue)",
                          color: "white",
                          border: "none",
                          borderRadius: "20px",
                          fontWeight: 600,
                          fontSize: "12px",
                          cursor: "pointer",
                          marginTop: "6px",
                          boxShadow: "0 4px 12px rgba(0, 120, 212, 0.25)",
                          transition: "all 0.2s cubic-bezier(0.1, 0.9, 0.2, 1)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = "scale(1.04)";
                          e.currentTarget.style.boxShadow = "0 6px 16px rgba(0, 120, 212, 0.4)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "scale(1)";
                          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 120, 212, 0.25)";
                        }}
                      >
                        <Play size={12} fill="white" color="white" />
                        XEM NGAY
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ color: "var(--color-muted)", fontSize: "14px" }}>Chọn một kênh bên dưới để hiển thị xem trước</div>
                )}
              </div>

              {/* EPG Schedules Panel (Right) */}
              <div
                style={{
                  width: isMobile ? "100%" : "380px",
                  minWidth: isMobile ? "0" : "380px",
                  borderLeft: isMobile ? "none" : "1px solid var(--color-border)",
                  borderTop: isMobile ? "1px solid var(--color-border)" : "none",
                  padding: isMobile ? "12px 16px" : "24px",
                  display: "flex",
                  flexDirection: "column",
                  flex: isMobile ? 1 : undefined,
                  maxHeight: "none",
                  overflowY: "auto",
                  backgroundColor: "var(--color-epg-container-bg)",
                }}
              >
                <h3
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "var(--color-accent-blue-fg)",
                    marginBottom: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Clock size={16} />
                  Chương trình tiếp theo
                </h3>

                <div style={{ display: "flex", flexDirection: "column", position: "relative", paddingLeft: "12px" }}>
                  {/* Vertical line indicator */}
                  {futurePrograms.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        left: "4px",
                        top: "8px",
                        bottom: "8px",
                        width: "2px",
                        backgroundColor: "var(--color-border)",
                      }}
                    />
                  )}

                  {futurePrograms.length > 0 ? (
                    futurePrograms.map((prog, i) => {
                      const isFirst = i === 0;
                      return (
                        <div
                          key={i}
                          style={{
                            position: "relative",
                            display: "flex",
                            flexDirection: "column",
                            gap: "2px",
                            paddingBottom: i === futurePrograms.length - 1 ? 0 : "16px",
                            paddingLeft: "12px",
                          }}
                        >
                          {/* Timeline dot */}
                          <div
                            style={{
                              position: "absolute",
                              left: isFirst ? "-11px" : "-10px",
                              top: "6px",
                              width: isFirst ? "8px" : "6px",
                              height: isFirst ? "8px" : "6px",
                              borderRadius: "50%",
                              backgroundColor: isFirst ? "var(--color-accent-blue)" : "var(--color-muted)",
                              border: isFirst ? "2px solid var(--color-background)" : "1px solid var(--color-background)",
                              boxShadow: isFirst ? "0 0 6px var(--color-accent-blue)" : "none",
                              zIndex: 1,
                            }}
                          />

                          <span style={{ fontSize: "11px", color: isFirst ? "var(--color-accent-blue)" : "var(--color-muted)", fontWeight: 600 }}>
                            {formatTimeRange(prog.start, prog.stop)}
                          </span>
                          <span style={{ fontSize: "13px", fontWeight: isFirst ? 600 : 500, color: "var(--color-on-background)" }}>
                            {prog.title}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                      Không có thông tin lịch sắp phát sóng.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div
              style={{
                flex: isMobile ? "0 0 auto" : 1,
                padding: isMobile ? "6px 12px 16px 12px" : "16px",
                overflowY: isMobile ? "hidden" : "auto",
                borderTop: isMobile ? "1px solid var(--color-border)" : "none",
                backgroundColor: "var(--color-surface)",
              }}
            >
              {displayedChannels.length > 0 ? (
                isMobile ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      overflowX: "auto",
                      overflowY: "hidden",
                      gap: "10px",
                      padding: "4px 2px 8px 2px",
                      width: "100%",
                      WebkitOverflowScrolling: "touch",
                    }}
                  >
                    {displayedChannels.map((chan) => {
                      const isFav = favorites.has(chan.id);
                      const isFocused = focusedChannel?.id === chan.id;
                      return (
                        <div
                          key={chan.id}
                          onClick={() => handleChannelFocus(chan)}
                          className="glass-card"
                          style={{
                            position: "relative",
                            borderRadius: "8px",
                            padding: "8px 6px",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "4px",
                            border: isFocused ? "2px solid var(--color-accent-blue)" : "1px solid var(--color-border)",
                            boxShadow: isFocused ? "0 0 15px rgba(138, 180, 248, 0.25)" : "none",
                            width: "74px",
                            flexShrink: 0,
                          }}
                        >
                          {/* Favorite Button Overlay */}
                          <button
                            onClick={(e) => toggleFavorite(e, chan.id)}
                            aria-label={isFav ? `Xóa ${chan.name} khỏi danh sách yêu thích` : `Thêm ${chan.name} vào danh sách yêu thích`}
                            style={{
                              position: "absolute",
                              top: "4px",
                              right: "4px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: "2px",
                              borderRadius: "50%",
                              backgroundColor: "rgba(0,0,0,0.45)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              zIndex: 2,
                            }}
                          >
                            <Star
                              size={10}
                              fill={isFav ? "var(--color-accent-blue)" : "none"}
                              color={isFav ? "var(--color-accent-blue)" : "#adadad"}
                            />
                          </button>

                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "6px",
                              backgroundColor: "var(--color-logo-bg)",
                              padding: "2px",
                            }}
                          >
                            {chan.logoUrl ? (
                              <img
                                src={chan.logoUrl}
                                alt={chan.name}
                                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                              />
                            ) : (
                              <Tv size={18} style={{ color: "var(--color-muted)" }} />
                            )}
                          </div>

                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              textAlign: "center",
                              width: "100%",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {chan.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="tv-grid">
                    {displayedChannels.map((chan) => {
                      const isFav = favorites.has(chan.id);
                      const isFocused = focusedChannel?.id === chan.id;
                      return (
                        <div
                          key={chan.id}
                          onClick={() => handleChannelFocus(chan)}
                          onDoubleClick={() => handlePlay(chan)}
                          className="glass-card"
                          style={{
                            position: "relative",
                            borderRadius: "8px",
                            padding: "12px",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "8px",
                            border: isFocused ? "2px solid var(--color-accent-blue)" : "1px solid var(--color-border)",
                            boxShadow: isFocused ? "0 0 15px rgba(138, 180, 248, 0.25)" : "none",
                            transform: isFocused ? "translateY(-4px)" : "none",
                          }}
                        >
                          {/* Favorite Button Overlay */}
                          <button
                            onClick={(e) => toggleFavorite(e, chan.id)}
                            aria-label={isFav ? `Xóa ${chan.name} khỏi danh sách yêu thích` : `Thêm ${chan.name} vào danh sách yêu thích`}
                            style={{
                              position: "absolute",
                              top: "8px",
                              right: "8px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: "4px",
                              borderRadius: "50%",
                              backgroundColor: "rgba(0,0,0,0.4)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Star
                              size={14}
                              fill={isFav ? "var(--color-accent-blue)" : "none"}
                              color={isFav ? "var(--color-accent-blue)" : "#adadad"}
                            />
                          </button>

                          <div
                            style={{
                              width: "60px",
                              height: "60px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "8px",
                              backgroundColor: "var(--color-logo-bg)",
                              padding: "5px",
                            }}
                          >
                            {chan.logoUrl ? (
                              <img
                                src={chan.logoUrl}
                                alt={chan.name}
                                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                              />
                            ) : (
                              <Tv size={24} style={{ color: "var(--color-muted)" }} />
                            )}
                          </div>

                          <span
                            style={{
                              fontSize: "13px",
                              fontWeight: 600,
                              textAlign: "center",
                              width: "100%",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {chan.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100%",
                    color: "var(--color-muted)",
                    fontSize: "14px",
                  }}
                >
                  Không tìm thấy kênh nào phù hợp.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default LiveTvScreen;
