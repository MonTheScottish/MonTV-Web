import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { Channel, EPGProgram } from "../types";
import { MonTVRepository } from "../services/repository";
import { ArrowLeft, Play, Pause, AlertCircle, ChevronDown, Check, RefreshCw } from "lucide-react";

interface PlayerScreenProps {
  initialChannel: Channel;
  channelList: Channel[];
  repository: MonTVRepository;
  onExit: (finalChannel: Channel) => void;
}

export const PlayerScreen: React.FC<PlayerScreenProps> = ({
  initialChannel,
  channelList,
  repository,
  onExit,
}) => {
  const [currentChannel, setCurrentChannel] = useState<Channel>(initialChannel);
  const [streamUrl, setStreamUrl] = useState<string>("");
  const [resolvedHeaders, setResolvedHeaders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  // Source selector state
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [showSourceSelector, setShowSourceSelector] = useState(false);

  // Control overlay states
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<any>(null);

  // EPG
  const [currentProgram, setCurrentProgram] = useState<EPGProgram | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Reset controls timer
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
      setShowSourceSelector(false);
    }, 4000);
  };

  // Sync source index with repository setting when channel changes
  useEffect(() => {
    const savedSrcIdx = repository.getLastWorkingSourceIndex(currentChannel.id);
    const sourceIndex = savedSrcIdx < currentChannel.urls.length ? savedSrcIdx : 0;
    setActiveSourceIndex(sourceIndex);
  }, [currentChannel]);

  // Fetch resolved stream URL when channel or source index changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);

    const resolveStream = async () => {
      try {
        const resolved = await repository.resolveChannelStreamUrl(currentChannel, activeSourceIndex);
        if (!active) return;

        if (resolved && resolved.url) {
          setStreamUrl(resolved.url);
          setResolvedHeaders(resolved.headers || {});
        } else {
          // Fallback to direct streamUrl
          setStreamUrl(currentChannel.streamUrl);
          setResolvedHeaders({});
        }
      } catch (e) {
        console.error("Error resolving stream:", e);
        if (active) {
          setStreamUrl(currentChannel.streamUrl);
          setResolvedHeaders({});
        }
      }
    };

    resolveStream();

    // Fetch EPG Now Playing
    const updateEpg = () => {
      const epg = repository.getEPGForChannel(currentChannel.tvgId, currentChannel.id);
      if (epg && epg.length > 0) {
        const now = new Date().toISOString();
        const activeProg = epg.find((p) => now >= p.start && now <= p.stop);
        setCurrentProgram(activeProg || epg[0] || null);
      } else {
        setCurrentProgram(null);
      }
    };

    updateEpg();
    const interval = setInterval(updateEpg, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentChannel, activeSourceIndex, repository]);

  // Define automatic fallback switching handler with Ref to bypass closures
  const handleStreamFailureRef = useRef<() => void>(() => {});
  handleStreamFailureRef.current = () => {
    const urlsCount = currentChannel.urls.length > 0 ? currentChannel.urls.length : 1;
    if (activeSourceIndex + 1 < urlsCount) {
      const nextIndex = activeSourceIndex + 1;
      console.log(`Stream failed. Automatically switching to source index ${nextIndex}`);
      setErrorMsg(`Kênh lỗi. Đang tự động đổi sang nguồn dự phòng (${nextIndex + 1}/${urlsCount})...`);
      
      // Save last working source index
      repository.setLastWorkingSourceIndex(currentChannel.id, nextIndex);
      
      // Update state to trigger reload
      setTimeout(() => {
        setActiveSourceIndex(nextIndex);
      }, 2500); // 2.5 seconds timeout to notify the user
    } else {
      setErrorMsg("Tất cả các nguồn phát của kênh đều gặp sự cố. Vui lòng thử lại sau.");
    }
  };

  // Handle streamUrl playback with hls.js
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    setLoading(true);
    setErrorMsg(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const playVideo = async () => {
      try {
        await video.play();
        setIsPlaying(true);
      } catch (e) {
        console.warn("Autoplay block or playback interrupted:", e);
      }
    };

    // If safari / iOS native HLS is supported
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", playVideo);
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        maxMaxBufferLength: 10,
        enableWorker: true,
        lowLatencyMode: true,
        xhrSetup: (xhr, _url) => {
          if (resolvedHeaders) {
            Object.entries(resolvedHeaders).forEach(([k, v]) => {
              try {
                // Browser might block Referer / User-Agent, but set them if allowed
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
        setLoading(false);
        playVideo();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error("HLS.js error:", data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              handleStreamFailureRef.current?.();
              break;
          }
        }
      });
    } else {
      setErrorMsg("Trình duyệt không hỗ trợ phát luồng HLS.");
      setLoading(false);
    }

    const handleLoadedData = () => setLoading(false);
    const handleWaiting = () => setLoading(true);
    const handlePlaying = () => {
      setLoading(false);
      setErrorMsg(null);
    };
    const handleVideoError = () => {
      if (video.error) {
        console.error("HTML5 video error:", video.error);
        handleStreamFailureRef.current?.();
      }
    };

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", handleVideoError);

    return () => {
      if (video) {
        video.removeEventListener("loadeddata", handleLoadedData);
        video.removeEventListener("waiting", handleWaiting);
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("error", handleVideoError);
        video.removeEventListener("loadedmetadata", playVideo);
        video.src = "";
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, resolvedHeaders]);

  // Channel switching functions
  const switchChannel = (direction: "next" | "prev") => {
    const currentIndex = channelList.findIndex((c) => c.id === currentChannel.id);
    if (currentIndex === -1) return;

    let newIndex = currentIndex;
    if (direction === "next") {
      newIndex = (currentIndex + 1) % channelList.length;
    } else {
      newIndex = (currentIndex - 1 + channelList.length) % channelList.length;
    }

    const newChannel = channelList[newIndex];
    setCurrentChannel(newChannel);
    repository.addRecentChannel(newChannel.id);
    resetControlsTimeout();
  };

  // Keyboard navigation & remote control simulation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resetControlsTimeout();

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          switchChannel("prev");
          break;
        case "ArrowDown":
          e.preventDefault();
          switchChannel("next");
          break;
        case "Escape":
        case "Backspace":
          e.preventDefault();
          onExit(currentChannel);
          break;
        case " ":
          e.preventDefault();
          togglePlay();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    resetControlsTimeout(); // Show controls initially

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [currentChannel, channelList]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().then(() => setIsPlaying(true));
    }
    resetControlsTimeout();
  };

  const handleSourceSelect = (index: number) => {
    setActiveSourceIndex(index);
    repository.setLastWorkingSourceIndex(currentChannel.id, index);
    setShowSourceSelector(false);
    
    // Trigger reload
    setLoading(true);
    setErrorMsg(null);
    repository.resolveChannelStreamUrl(currentChannel, index).then((resolved) => {
      if (resolved && resolved.url) {
        setStreamUrl(resolved.url);
        setResolvedHeaders(resolved.headers || {});
      } else {
        setStreamUrl(currentChannel.streamUrl);
        setResolvedHeaders({});
      }
    });
    resetControlsTimeout();
  };

  const getSourceDisplayName = (urlObj: any, index: number) => {
    if (urlObj.provider === "backup_public") return `Nguồn công cộng ${index + 1}`;
    if (urlObj.provider === "flow") return `Nguồn luồng chính ${index + 1}`;
    if (urlObj.provider === "webview") return `Nguồn webview ${index + 1}`;
    return `Nguồn mặc định ${index + 1}`;
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        backgroundColor: "black",
        overflow: "hidden",
      }}
      onMouseMove={resetControlsTimeout}
      onClick={resetControlsTimeout}
    >
      <video
        ref={videoRef}
        playsInline
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      {/* Loading Overlay */}
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 10,
          }}
        >
          <RefreshCw className="pulse-badge" size={48} color="var(--color-accent-blue)" style={{ animationDuration: "1.5s" }} />
          <span style={{ marginTop: "16px", fontSize: "14px", color: "#e2e8f0" }}>Đang tải luồng...</span>
        </div>
      )}

      {/* Error Overlay */}
      {errorMsg && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.85)",
            zIndex: 20,
            color: "white",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <AlertCircle size={48} color="var(--color-destructive)" />
          <h2 style={{ fontSize: "20px", fontWeight: 700, marginTop: "16px" }}>Lỗi tải kênh</h2>
          <p style={{ fontSize: "14px", color: "var(--color-muted)", marginTop: "8px", maxWidth: "450px" }}>{errorMsg}</p>
          <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
            <button
              onClick={() => handleSourceSelect((activeSourceIndex + 1) % currentChannel.urls.length)}
              style={{
                padding: "10px 20px",
                backgroundColor: "var(--color-secondary)",
                border: "none",
                borderRadius: "6px",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Đổi nguồn dự phòng
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 20px",
                backgroundColor: "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: "6px",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Tải lại trang
            </button>
          </div>
        </div>
      )}

      {/* UI Player Controls Overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "32px",
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.7) 100%)",
          zIndex: 5,
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      >
        {/* Top Control Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={() => onExit(currentChannel)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "none",
              border: "none",
              color: "white",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              padding: "8px 16px",
              borderRadius: "20px",
              backgroundColor: "rgba(255,255,255,0.08)",
            }}
          >
            <ArrowLeft size={18} />
            Quay lại
          </button>

          <div
            style={{
              fontSize: "13px",
              color: "var(--color-muted)",
              backgroundColor: "rgba(0,0,0,0.4)",
              padding: "6px 12px",
              borderRadius: "4px",
              border: "1px solid var(--color-border)",
            }}
          >
            Đang phát ở định dạng HLS
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Channel Info & Description */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "20px" }}>
            {currentChannel.logoUrl ? (
              <img
                src={currentChannel.logoUrl}
                alt={currentChannel.name}
                style={{
                  width: "56px",
                  height: "56px",
                  objectFit: "contain",
                  borderRadius: "8px",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--color-border)",
                  padding: "4px",
                }}
              />
            ) : (
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "8px",
                  backgroundColor: "var(--color-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  fontWeight: 800,
                  border: "1px solid var(--color-border)",
                }}
              >
                {currentChannel.name.substring(0, 2).toUpperCase()}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    backgroundColor: "var(--color-accent-blue)",
                    color: "black",
                    fontWeight: 800,
                    fontSize: "11px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                  }}
                >
                  CH {String(currentChannel.number).padStart(2, "0")}
                </span>
                <h2 style={{ fontSize: "20px", fontWeight: 700 }}>{currentChannel.name}</h2>
              </div>

              {currentProgram ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "14px", color: "var(--color-accent)", fontWeight: 500 }}>
                    ĐANG PHÁT: {currentProgram.title}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    {currentProgram.description || "Không có thông tin chương trình chi tiết."}
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: "14px", color: "var(--color-muted)" }}>
                  Không có lịch phát sóng EPG cho kênh này.
                </span>
              )}
            </div>
          </div>

          {/* Controls Buttons */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <button
                onClick={togglePlay}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(255,255,255,0.1)",
                }}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>

              {/* Source Selector Trigger */}
              {currentChannel.urls.length > 1 && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowSourceSelector(!showSourceSelector)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "none",
                      color: "white",
                      fontSize: "13px",
                      cursor: "pointer",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      backgroundColor: "rgba(255,255,255,0.08)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <span>{getSourceDisplayName(currentChannel.urls[activeSourceIndex], activeSourceIndex)}</span>
                    <ChevronDown size={14} />
                  </button>

                  {showSourceSelector && (
                    <div
                      className="glass-panel"
                      style={{
                        position: "absolute",
                        bottom: "100%",
                        left: 0,
                        marginBottom: "8px",
                        borderRadius: "8px",
                        padding: "6px",
                        width: "220px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      {currentChannel.urls.map((u, i) => (
                        <button
                          key={i}
                          onClick={() => handleSourceSelect(i)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            textAlign: "left",
                            background: "none",
                            border: "none",
                            borderRadius: "4px",
                            color: "white",
                            fontSize: "12px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            backgroundColor: i === activeSourceIndex ? "var(--color-secondary)" : "transparent",
                          }}
                          onMouseEnter={(e) => {
                            if (i !== activeSourceIndex) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
                          }}
                          onMouseLeave={(e) => {
                            if (i !== activeSourceIndex) e.currentTarget.style.backgroundColor = "transparent";
                          }}
                        >
                          <span>{getSourceDisplayName(u, i)}</span>
                          {i === activeSourceIndex && <Check size={12} color="var(--color-accent)" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "16px" }}>
              <button
                onClick={() => switchChannel("prev")}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  fontSize: "13px",
                  cursor: "pointer",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(255,255,255,0.05)",
                }}
              >
                Kênh trước (Up)
              </button>
              <button
                onClick={() => switchChannel("next")}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  fontSize: "13px",
                  cursor: "pointer",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(255,255,255,0.05)",
                }}
              >
                Kênh sau (Down)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default PlayerScreen;
