import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { Channel, EPGProgram } from "../types";
import { MonTVRepository } from "../services/repository";
import { ArrowLeft, ArrowRight, Play, Pause, AlertCircle, ChevronDown, Check, RefreshCw, List, X, Search, Tv, Volume2, Sun } from "lucide-react";

const areHeadersEqual = (h1: Record<string, string>, h2: Record<string, string>) => {
  const k1 = Object.keys(h1);
  const k2 = Object.keys(h2);
  if (k1.length !== k2.length) return false;
  return k1.every((k) => h1[k] === h2[k]);
};

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
  
  const currentIndex = channelList.findIndex((c) => c.id === currentChannel.id);
  const prevIndex = currentIndex !== -1 ? (currentIndex - 1 + channelList.length) % channelList.length : 0;
  const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % channelList.length : 0;
  const prevChannel = channelList[prevIndex];
  const nextChannel = channelList[nextIndex];

  const [streamUrl, setStreamUrl] = useState<string>("");
  const [resolvedHeaders, setResolvedHeaders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isWebView, setIsWebView] = useState(false);

  // Source selector state
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [showSourceSelector, setShowSourceSelector] = useState(false);

  // Control overlay states
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<any>(null);

  // Channel drawer states
  const [showChannelDrawer, setShowChannelDrawer] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Volume states
  const [volume, setVolume] = useState(1.0);
  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false);
  const volumeTimeoutRef = useRef<any>(null);
  const isVolumeMounted = useRef(false);

  // Brightness and Touch Gesture states
  const [brightness, setBrightness] = useState(1.0);
  const [showBrightnessIndicator, setShowBrightnessIndicator] = useState(false);
  const brightnessTimeoutRef = useRef<any>(null);
  const touchStartRef = useRef<{ x: number; y: number; side: "left" | "right"; startVal: number } | null>(null);

  const triggerBrightnessIndicator = () => {
    setShowBrightnessIndicator(true);
    if (brightnessTimeoutRef.current) {
      clearTimeout(brightnessTimeoutRef.current);
    }
    brightnessTimeoutRef.current = setTimeout(() => {
      setShowBrightnessIndicator(false);
    }, 1200);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    const side = x < window.innerWidth / 2 ? "left" : "right";
    const startVal = side === "left" ? brightness : volume;
    touchStartRef.current = { x, y, side, startVal };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current) return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaY = touchStartRef.current.y - touch.clientY; // swipe up is positive

    // Swipe 150px vertically to go from 0 to 100%
    const change = deltaY / 150;
    let newVal = Math.max(0, Math.min(1, touchStartRef.current.startVal + change));

    if (touchStartRef.current.side === "left") {
      newVal = Math.max(0.1, newVal);
      setBrightness(newVal);
      triggerBrightnessIndicator();
    } else {
      setVolume(newVal);
      triggerVolumeIndicator();

      const video = videoRef.current;
      if (video) {
        video.volume = newVal;
        video.muted = newVal === 0;
      }

      if (isWebView && iframeRef.current) {
        iframeRef.current.contentWindow?.postMessage(
          { type: "setVolume", volume: newVal },
          "*"
        );
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  const triggerVolumeIndicator = () => {
    setShowVolumeIndicator(true);
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current);
    }
    volumeTimeoutRef.current = setTimeout(() => {
      setShowVolumeIndicator(false);
    }, 1200);
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Sync volume changes to standard video elements and shaka iframe
  useEffect(() => {
    if (isWebView) {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: "control", action: "setVolume", value: volume }, "*");
      }
    } else {
      const video = videoRef.current;
      if (video) {
        video.volume = volume;
        if (volume > 0) {
          video.muted = false;
        }
      }
    }

    if (isVolumeMounted.current) {
      triggerVolumeIndicator();
    } else {
      isVolumeMounted.current = true;
    }
  }, [volume, isWebView]);

  // EPG
  const [currentProgram, setCurrentProgram] = useState<EPGProgram | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Reset controls timer
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    // Do not hide controls if source selector or channel list drawer is open
    if (showSourceSelector || showChannelDrawer) return;

    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
      setShowSourceSelector(false);
    }, 2500);
  };

  // Sync controls display when drawer visibility changes
  useEffect(() => {
    resetControlsTimeout();
  }, [showChannelDrawer, showSourceSelector]);

  const filteredChannels = channelList.filter((chan) => {
    if (!drawerSearch.trim()) return true;
    const term = drawerSearch.toLowerCase();
    return (
      chan.name.toLowerCase().includes(term) ||
      chan.groupTitle.toLowerCase().includes(term) ||
      String(chan.number).includes(term)
    );
  });

  // Sync source index with repository setting when channel changes
  useEffect(() => {
    const savedSrcIdx = repository.getLastWorkingSourceIndex(currentChannel.id);
    let sourceIndex = 0;
    if (savedSrcIdx !== -1) {
      sourceIndex = savedSrcIdx < currentChannel.urls.length ? savedSrcIdx : 0;
    } else {
      // Prioritize standard HLS streams on iOS to avoid Widevine DRM blocks
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        const nonWebviewIdx = currentChannel.urls.findIndex((u) => u.provider !== "webview");
        sourceIndex = nonWebviewIdx !== -1 ? nonWebviewIdx : 0;
      } else {
        const webviewIdx = currentChannel.urls.findIndex((u) => u.provider === "webview");
        sourceIndex = webviewIdx !== -1 ? webviewIdx : 0;
      }
    }
    setActiveSourceIndex(sourceIndex);
  }, [currentChannel]);

  // Fetch resolved stream URL when channel or source index changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    setIsWebView(false); // Reset to default

    const resolveStream = async () => {
      try {
        const resolved = await repository.resolveChannelStreamUrl(currentChannel, activeSourceIndex);
        if (!active) return;

        if (resolved && resolved.url) {
          setStreamUrl(resolved.url);
          const nextHeaders = resolved.headers || {};
          setResolvedHeaders((prev) => areHeadersEqual(prev, nextHeaders) ? prev : nextHeaders);
          setIsWebView(!!resolved.isWebView);
        } else {
          // Fallback to direct streamUrl
          setStreamUrl(currentChannel.streamUrl);
          setResolvedHeaders((prev) => Object.keys(prev).length === 0 ? prev : {});
          setIsWebView(false);
        }
      } catch (e) {
        console.error("Error resolving stream:", e);
        if (active) {
          setStreamUrl(currentChannel.streamUrl);
          setResolvedHeaders((prev) => Object.keys(prev).length === 0 ? prev : {});
          setIsWebView(false);
        }
      }
    };

    resolveStream();

    // Fetch EPG Now Playing
    const updateEpg = () => {
      const epg = repository.getEPGForChannel(currentChannel.tvgId, currentChannel.id);
      if (epg && epg.length > 0) {
        const nowMs = Date.now();
        const current = epg.find((p) => {
          const startMs = new Date(p.start).getTime();
          const stopMs = new Date(p.stop).getTime();
          return nowMs >= startMs && nowMs <= stopMs;
        });
        setCurrentProgram(current || null);
      } else {
        setCurrentProgram(null);
      }
    };

    updateEpg();
    const interval = setInterval(updateEpg, 30000); // Check EPG every 30s

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentChannel.id, currentChannel.streamUrl, activeSourceIndex, repository]);

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
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS && isWebView) {
        setErrorMsg("Thiết bị iOS không hỗ trợ định dạng giải mã DRM Widevine của nguồn phát này. Vui lòng bấm 'Đổi nguồn dự phòng' bên dưới để chọn nguồn m3u8 tiêu chuẩn.");
      } else {
        setErrorMsg("Tất cả các nguồn phát của kênh đều gặp sự cố. Vui lòng kiểm tra lại kết nối mạng hoặc bấm 'Đổi nguồn dự phòng' để chọn nguồn phát khác.");
      }
    }
  };

  // Handle streamUrl playback with hls.js
  useEffect(() => {
    if (isWebView) {
      // In webview mode, the iframe handles its own playback
      return;
    }
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    setLoading(true);
    setErrorMsg(null);

    let loadTimeoutId: any = null;

    const startLoadingTimeout = () => {
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
      loadTimeoutId = setTimeout(() => {
        const currentVideo = videoRef.current;
        if (currentVideo && currentVideo.readyState >= 1 && currentVideo.paused) {
          console.log("Video metadata loaded but paused (likely autoplay blocked on mobile). Not skipping.");
          setLoading(false);
          setShowControls(true);
          return;
        }
        console.warn("Playback loading timed out after 10s. Trying next source...");
        handleStreamFailureRef.current?.();
      }, 10000);
    };

    startLoadingTimeout();

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
        setIsPlaying(false);
        setShowControls(true);
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
        if (loadTimeoutId) clearTimeout(loadTimeoutId);
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
              if (loadTimeoutId) clearTimeout(loadTimeoutId);
              handleStreamFailureRef.current?.();
              break;
          }
        }
      });
    } else {
      setErrorMsg("Trình duyệt không hỗ trợ phát luồng HLS.");
      setLoading(false);
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
    }

    const handleLoadedData = () => {
      setLoading(false);
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
    };
    const handleWaiting = () => {
      setLoading(true);
      startLoadingTimeout();
    };
    const handlePlaying = () => {
      setLoading(false);
      setErrorMsg(null);
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
      // Lock the successful working source index as the default
      repository.setLastWorkingSourceIndex(currentChannel.id, activeSourceIndex);
      console.log(`Successfully playing channel ${currentChannel.name} at source index ${activeSourceIndex}`);
    };
    const handleVideoError = () => {
      if (video.error) {
        console.error("HTML5 video error:", video.error);
        if (loadTimeoutId) clearTimeout(loadTimeoutId);
        handleStreamFailureRef.current?.();
      }
    };

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", handleVideoError);

    return () => {
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
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
        case "ArrowLeft":
          e.preventDefault();
          switchChannel("prev");
          break;
        case "ArrowRight":
          e.preventDefault();
          switchChannel("next");
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((prev) => Math.min(prev + 0.05, 1.0));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((prev) => Math.max(prev - 0.05, 0.0));
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

  // Listen for videoState and userInteraction events from shaka.html iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data) {
        if (e.data.type === "videoState") {
          setIsPlaying(!!e.data.isPlaying);
        } else if (e.data.type === "userInteraction") {
          resetControlsTimeout();
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const togglePlay = () => {
    if (isWebView) {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: "control", action: "togglePlay" }, "*");
      }
      resetControlsTimeout();
      return;
    }
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
    setIsWebView(false);
    repository.resolveChannelStreamUrl(currentChannel, index).then((resolved) => {
      if (resolved && resolved.url) {
        setStreamUrl(resolved.url);
        setResolvedHeaders(resolved.headers || {});
        setIsWebView(!!resolved.isWebView);
      } else {
        setStreamUrl(currentChannel.streamUrl);
        setResolvedHeaders({});
        setIsWebView(false);
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
        height: "100dvh",
        backgroundColor: "black",
        overflow: "hidden",
      }}
      onMouseMove={resetControlsTimeout}
      onClick={resetControlsTimeout}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {isWebView ? (
        <iframe
          ref={iframeRef}
          src={streamUrl}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            backgroundColor: "black",
            display: "block",
          }}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={() => setLoading(false)}
        />
      ) : (
        <video
          ref={videoRef}
          playsInline
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      )}

      {/* Brightness Dimming Overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "black",
          opacity: 1 - brightness,
          pointerEvents: "none",
          zIndex: 5,
        }}
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
            pointerEvents: "none", // Let clicks pass through to controls
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
          background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0.45) 100%)",
          zIndex: 15, // Sit above the loading overlay (10)
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      >
        {/* Top Control Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => onExit(currentChannel)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "none",
                border: "none",
                color: "white",
                fontSize: isMobile ? "12px" : "14px",
                fontWeight: 600,
                cursor: "pointer",
                padding: isMobile ? "6px 12px" : "8px 16px",
                borderRadius: "20px",
                backgroundColor: "rgba(255,255,255,0.08)",
                whiteSpace: "nowrap",
              }}
            >
              <ArrowLeft size={isMobile ? 16 : 18} />
              Quay lại
            </button>

            <button
              onClick={() => setShowChannelDrawer(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "none",
                color: "white",
                fontSize: isMobile ? "12px" : "14px",
                fontWeight: 600,
                cursor: "pointer",
                padding: isMobile ? "6px 12px" : "8px 16px",
                borderRadius: "20px",
                backgroundColor: "rgba(138, 180, 248, 0.15)",
                border: "1px solid rgba(138, 180, 248, 0.3)",
                whiteSpace: "nowrap",
              }}
            >
              <List size={isMobile ? 16 : 18} style={{ color: "var(--color-accent-blue)" }} />
              Danh sách kênh
            </button>
          </div>

          <div
            style={{
              fontSize: isMobile ? "11px" : "13px",
              color: "var(--color-muted)",
              backgroundColor: "rgba(0,0,0,0.4)",
              padding: "6px 12px",
              borderRadius: "4px",
              border: "1px solid var(--color-border)",
              display: isMobile ? "none" : "block",
              whiteSpace: "nowrap",
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              paddingTop: "16px",
              flexWrap: isMobile ? "wrap" : "nowrap",
              gap: isMobile ? "12px" : "0",
            }}
          >
            {/* Left: Source Selector */}
            <div style={{ minWidth: isMobile ? "100%" : "150px", display: "flex", justifyContent: isMobile ? "center" : "flex-start" }}>
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
                        left: isMobile ? "50%" : 0,
                        transform: isMobile ? "translateX(-50%)" : "none",
                        marginBottom: "8px",
                        borderRadius: "8px",
                        padding: "6px",
                        width: "220px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        zIndex: 30,
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

            {/* Center: Play/Pause & Channel Navigation */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: isMobile ? "10px" : "20px",
                flex: 1,
                justifyContent: "center",
              }}
            >
              {/* Previous Channel Button */}
              {prevChannel && (
                <button
                  onClick={() => switchChannel("prev")}
                  title={`Kênh trước: ${prevChannel.name}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "none",
                    border: "1px solid var(--color-border)",
                    color: "white",
                    cursor: "pointer",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.1)"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)"}
                >
                  <ArrowLeft size={16} />
                  {prevChannel.logoUrl ? (
                    <img
                      src={prevChannel.logoUrl}
                      alt={prevChannel.name}
                      style={{ width: "24px", height: "24px", objectFit: "contain", borderRadius: "4px" }}
                    />
                  ) : (
                    <Tv size={16} />
                  )}
                </button>
              )}

              {/* Play/Pause Center Button */}
              <button
                onClick={togglePlay}
                style={{
                  background: "none",
                  border: "none",
                  color: "black",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  backgroundColor: "var(--color-accent-blue)",
                  boxShadow: "0 0 15px rgba(138, 180, 248, 0.4)",
                  transition: "transform 0.2s, background-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "scale(1.1)";
                  e.currentTarget.style.backgroundColor = "#a8c7fa";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                  e.currentTarget.style.backgroundColor = "var(--color-accent-blue)";
                }}
              >
                {isPlaying ? <Pause size={24} fill="black" /> : <Play size={24} fill="black" style={{ marginLeft: "4px" }} />}
              </button>

              {/* Next Channel Button */}
              {nextChannel && (
                <button
                  onClick={() => switchChannel("next")}
                  title={`Kênh sau: ${nextChannel.name}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "none",
                    border: "1px solid var(--color-border)",
                    color: "white",
                    cursor: "pointer",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.1)"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)"}
                >
                  {nextChannel.logoUrl ? (
                    <img
                      src={nextChannel.logoUrl}
                      alt={nextChannel.name}
                      style={{ width: "24px", height: "24px", objectFit: "contain", borderRadius: "4px" }}
                    />
                  ) : (
                    <Tv size={16} />
                  )}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>

            {/* Right spacer to balance the layout */}
            {!isMobile && <div style={{ minWidth: "150px" }} />}
          </div>
        </div>
      </div>

      {/* Drawer Backdrop */}
      {showChannelDrawer && (
        <div
          onClick={() => setShowChannelDrawer(false)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.3)",
            zIndex: 90,
          }}
        />
      )}

      {/* Channel List Drawer */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: isMobile ? "280px" : "340px",
          backgroundColor: "rgba(10, 15, 30, 0.94)",
          backdropFilter: "blur(12px)",
          borderLeft: "1px solid var(--color-border)",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          transform: showChannelDrawer ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: "-10px 0 25px rgba(0,0,0,0.5)",
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: "20px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
              <List size={16} style={{ color: "var(--color-accent-blue)" }} />
              Danh sách kênh
            </span>
            <button
              onClick={() => setShowChannelDrawer(false)}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-muted)",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "50%",
                backgroundColor: "rgba(255,255,255,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Drawer Search */}
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-muted)",
              }}
            />
            <input
              type="text"
              placeholder="Tìm nhanh kênh..."
              value={drawerSearch}
              onChange={(e) => setDrawerSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px 8px 30px",
                borderRadius: "16px",
                border: "1px solid var(--color-border)",
                backgroundColor: "rgba(0, 0, 0, 0.3)",
                color: "white",
                fontSize: "12px",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Drawer Channel List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {filteredChannels.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {filteredChannels.map((chan) => {
                const isCurrent = chan.id === currentChannel.id;
                return (
                  <div
                    key={chan.id}
                    onClick={() => {
                      setCurrentChannel(chan);
                      repository.addRecentChannel(chan.id);
                      setActiveSourceIndex(0);
                      // Close drawer on mobile automatically
                      if (isMobile) {
                        setShowChannelDrawer(false);
                      }
                      resetControlsTimeout();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor: isCurrent ? "rgba(138, 180, 248, 0.15)" : "rgba(255, 255, 255, 0.02)",
                      border: isCurrent ? "1px solid var(--color-accent-blue)" : "1px solid transparent",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrent) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrent) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)";
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: isCurrent ? "var(--color-accent-blue)" : "var(--color-muted)",
                        minWidth: "24px",
                      }}
                    >
                      {String(chan.number).padStart(2, "0")}
                    </span>

                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "4px",
                        backgroundColor: "rgba(255,255,255,0.04)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "3px",
                      }}
                    >
                      {chan.logoUrl ? (
                        <img
                          src={chan.logoUrl}
                          alt={chan.name}
                          style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                      ) : (
                        <Tv size={16} style={{ color: "var(--color-muted)" }} />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: isCurrent ? "var(--color-accent-blue)" : "white",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {chan.name}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {chan.groupTitle}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "var(--color-muted)", fontSize: "12px", marginTop: "20px" }}>
              Không tìm thấy kênh.
            </div>
          )}
        </div>
      </div>

      {/* VLC-style Side Indicators for Mobile Gestures */}
      {isMobile && showBrightnessIndicator && (
        <div
          style={{
            position: "absolute",
            left: "24px",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            padding: "14px 10px",
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "20px",
            zIndex: 35,
            width: "42px",
            pointerEvents: "none",
            backdropFilter: "blur(10px)",
          }}
        >
          <Sun size={16} color="white" />
          <div
            style={{
              width: "4px",
              height: "100px",
              backgroundColor: "rgba(255,255,255,0.2)",
              borderRadius: "2px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                width: "100%",
                height: `${brightness * 100}%`,
                backgroundColor: "var(--color-accent-blue)",
              }}
            />
          </div>
          <span style={{ fontSize: "9px", color: "white", fontWeight: 600 }}>
            {Math.round(brightness * 100)}%
          </span>
        </div>
      )}

      {isMobile && showVolumeIndicator && (
        <div
          style={{
            position: "absolute",
            right: "24px",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            padding: "14px 10px",
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "20px",
            zIndex: 35,
            width: "42px",
            pointerEvents: "none",
            backdropFilter: "blur(10px)",
          }}
        >
          <Volume2 size={16} color="white" />
          <div
            style={{
              width: "4px",
              height: "100px",
              backgroundColor: "rgba(255,255,255,0.2)",
              borderRadius: "2px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                width: "100%",
                height: `${volume * 100}%`,
                backgroundColor: "var(--color-accent-blue)",
              }}
            />
          </div>
          <span style={{ fontSize: "9px", color: "white", fontWeight: 600 }}>
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}

      {/* Volume Indicator Overlay (Desktop Only) */}
      {!isMobile && showVolumeIndicator && (
        <div
          style={{
            position: "absolute",
            top: "80px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            color: "white",
            padding: "10px 20px",
            borderRadius: "20px",
            fontSize: "14px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            zIndex: 40,
            pointerEvents: "none",
            animation: "fadeIn 0.2s",
            border: "1px solid var(--color-border)",
            backdropFilter: "blur(8px)",
          }}
        >
          <Volume2 size={16} style={{ color: "var(--color-accent-blue)" }} />
          <span>Âm lượng: {Math.round(volume * 100)}%</span>
        </div>
      )}
    </div>
  );
};
export default PlayerScreen;
