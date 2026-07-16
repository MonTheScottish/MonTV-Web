import React, { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { Channel, EPGProgram } from "../types";
import { MonTVRepository } from "../services/repository";
import { ArrowLeft, ArrowRight, Play, Pause, AlertCircle, ChevronDown, Check, RefreshCw, List, X, Search, Tv, Volume2, VolumeX, Sun } from "lucide-react";

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

function translateReason(r: string): string {
  const k = (r || "").toLowerCase();
  if (k.includes("key_load") || k.includes("drm") || k.includes("clearkey") || k.includes("fairplay") || k.includes("widevine")) return "lỗi DRM";
  if (k.includes("manifest")) return "lỗi tải manifest";
  if (k.includes("not.?supported")) return "codec không hỗ trợ";
  if (k.includes("decode")) return "lỗi giải mã";
  if (k.includes("timeout")) return "hết thời gian chờ";
  if (k.includes("network")) return "mất kết nối mạng";
  if (k.includes("media")) return "lỗi media";
  return "nguồn lỗi";
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

  // AirPlay & Google Cast states
  const [airplayAvailable, setAirplayAvailable] = useState(false);
  const [castAvailable, setCastAvailable] = useState(false);



  // Control overlay states
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<any>(null);

  // Channel drawer states
  const [showChannelDrawer, setShowChannelDrawer] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Volume states
  const [volume, setVolume] = useState(repository.getVolume());
  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false);
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const volumeTimeoutRef = useRef<any>(null);
  const isVolumeMounted = useRef(false);
  const lastNonZeroVolumeRef = useRef(repository.getVolume() > 0 ? repository.getVolume() : 1.0);
  const volumeControlTimeoutRef = useRef<any>(null);

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

    // Restrict swipe gestures to the video content region (middle of the screen height)
    // and ignore touches on buttons, inputs, links, or drawers
    const screenHeight = window.innerHeight;
    if (y < screenHeight * 0.12 || y > screenHeight * 0.82) {
      return;
    }

    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("select") ||
      target.closest("a") ||
      target.closest("[role='button']") ||
      target.closest(".channel-drawer") ||
      target.closest(".glass-panel")
    ) {
      return;
    }

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
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
    }
    repository.setVolume(volume);

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

  const toggleMute = () => {
    if (volume > 0) {
      setVolume(0);
    } else {
      setVolume(lastNonZeroVolumeRef.current);
    }
    resetControlsTimeout();
  };

  const updateVolumeFromSlider = (newVal: number) => {
    const clamped = Math.max(0, Math.min(1, newVal));
    setVolume(clamped);
  };

  const handleVolumeMouseEnter = () => {
    if (volumeControlTimeoutRef.current) {
      clearTimeout(volumeControlTimeoutRef.current);
    }
    setShowVolumeControl(true);
  };

  const handleVolumeMouseLeave = () => {
    if (volumeControlTimeoutRef.current) {
      clearTimeout(volumeControlTimeoutRef.current);
    }
    volumeControlTimeoutRef.current = setTimeout(() => {
      setShowVolumeControl(false);
    }, 600);
  };

  const volumeSliderRef = useRef<HTMLDivElement | null>(null);
  const isDraggingVolumeRef = useRef(false);

  const handleVolumeSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingVolumeRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = 1 - ((e.clientY - rect.top) / rect.height);
    updateVolumeFromSlider(ratio);
  };

  const handleVolumeSliderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingVolumeRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = 1 - ((e.clientY - rect.top) / rect.height);
    updateVolumeFromSlider(ratio);
  };

  const handleVolumeSliderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingVolumeRef.current = false;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  };

  const handleVolumeSliderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      setVolume((v) => Math.min(1, v + 0.05));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      setVolume((v) => Math.max(0, v - 0.05));
    } else if (e.key === "Home") {
      e.preventDefault();
      setVolume(1);
    } else if (e.key === "End") {
      e.preventDefault();
      setVolume(0);
    }
  };

  // Platform-sorted URL list — single source of truth for source indexing.
  const platformUrls = useMemo(
    () => repository.getUrlsForChannel(currentChannel),
    [currentChannel, repository]
  );

  // EPG
  const [currentProgram, setCurrentProgram] = useState<EPGProgram | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Detect AirPlay availability
  useEffect(() => {
    if (isWebView) {
      setAirplayAvailable(false);
      return;
    }

    // AirPlay is only available on Apple devices (iOS/macOS)
    const isAppleDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                          (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) ||
                          (/Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent));
    
    if (!isAppleDevice) {
      setAirplayAvailable(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    video.setAttribute("x-webkit-airplay", "allow");
    video.setAttribute("airplay", "allow");

    const handleAvailabilityChanged = (event: any) => {
      setAirplayAvailable(event.availability === "available");
    };

    video.addEventListener("webkitplaybacktargetavailabilitychanged", handleAvailabilityChanged);
    
    if ((window as any).WebKitPlaybackTargetAvailabilityEvent) {
      setAirplayAvailable(true);
    }

    return () => {
      video.removeEventListener("webkitplaybacktargetavailabilitychanged", handleAvailabilityChanged);
    };
  }, [videoRef.current, isWebView, loading]);

  const triggerAirPlay = () => {
    const video = videoRef.current;
    if (video && (video as any).webkitShowPlaybackTargetPicker) {
      (video as any).webkitShowPlaybackTargetPicker();
    }
  };

  // Google Cast SDK Initialization
  useEffect(() => {
    // Check if on iOS/macOS Safari target - if so, do not initialize Chromecast
    const isIOSPlatform = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                          (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);
    if (isIOSPlatform) {
      setCastAvailable(false);
      return;
    }

    const castScriptId = "google-cast-sdk-script";
    const script = document.getElementById(castScriptId) as HTMLScriptElement | null;
    if (!script) {
      const newScript = document.createElement("script");
      newScript.id = castScriptId;
      newScript.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
      newScript.async = true;
      document.body.appendChild(newScript);
    }

    const initializeCast = () => {
      const cast = (window as any).cast;
      const chrome = (window as any).chrome;
      if (cast && cast.framework && chrome && chrome.cast) {
        try {
          const context = cast.framework.CastContext.getInstance();
          context.setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
          });
          setCastAvailable(true);
        } catch (e) {
          console.warn("Cast initialization failed:", e);
        }
      }
    };

    if ((window as any).chrome?.cast && (window as any).cast?.framework) {
      initializeCast();
    } else {
      (window as any).__onGCastApiAvailable = (isAvailable: boolean) => {
        if (isAvailable) {
          initializeCast();
        }
      };
    }
  }, []);

  const handleCastClick = () => {
    const cast = (window as any).cast;
    const chrome = (window as any).chrome;
    if (!cast || !chrome || !streamUrl) return;

    const context = cast.framework.CastContext.getInstance();
    context.requestSession().then(
      (session: any) => {
        const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, 'application/vnd.apple.mpegurl');
        const metadata = new chrome.cast.media.GenericMediaMetadata();
        metadata.title = currentChannel.name;
        if (currentChannel.logoUrl) {
          metadata.images = [{ url: currentChannel.logoUrl }];
        }
        mediaInfo.metadata = metadata;

        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        session.loadMedia(request).then(
          () => console.log("Casting successfully"),
          (err: any) => console.error("Cast media load error:", err)
        );
      },
      (err: any) => {
        console.warn("Cast session error:", err);
      }
    );
  };

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

  // Sync source index with repository setting when channel changes.
  // The index is into the PLATFORM-SORTED URL array (getUrlsForChannel).
  useEffect(() => {
    const savedUrl = repository.getLastWorkingSourceUrl(currentChannel.id);
    let sourceIndex = 0;

    const isIos = repository.detectPlatform() === "ios";
    const hasVtvgo = platformUrls.some((u) => u.provider === "vtvgo");

    if (isIos && hasVtvgo) {
      const idx = platformUrls.findIndex((u) => u.provider === "vtvgo");
      sourceIndex = idx !== -1 ? idx : 0;
    } else if (savedUrl) {
      const idx = platformUrls.findIndex((u) => u.url === savedUrl);
      sourceIndex = idx !== -1 ? idx : 0;
    } else {
      const firstUsable = platformUrls.findIndex(
        (u) => !repository.isSourceBlacklisted(currentChannel.id, u.url)
      );
      sourceIndex = firstUsable !== -1 ? firstUsable : 0;
    }
    setActiveSourceIndex(sourceIndex);
  }, [currentChannel, platformUrls]);

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

  // Track total auto-fallback attempts on this channel to prevent infinite loops.
  const autoAttemptCountRef = useRef(0);

  // Reset attempt counter when the channel changes.
  useEffect(() => {
    autoAttemptCountRef.current = 0;
  }, [currentChannel.id]);

  // Define automatic fallback switching handler with Ref to bypass closures.
  // Uses platform-sorted URLs (getUrlsForChannel) for all index math.
  const handleStreamFailureRef = useRef<(reason: string) => void>(() => {});
  handleStreamFailureRef.current = (reason: string = "generic") => {
    const urlsCount = platformUrls.length || 1;
    const currentUrl = platformUrls[activeSourceIndex]?.url || "";
    const failCount = repository.bumpFailCount(currentChannel.id, activeSourceIndex);

    // Classify: KEY_LOAD / manifest parse / not-supported → blacklist immediately.
    if (
      /key|clearkey|fairplay|widevine|drm|manifest|not.?supported/i.test(reason) &&
      currentUrl
    ) {
      repository.blacklistSource(currentChannel.id, currentUrl);
      console.warn(`Blacklisting source ${activeSourceIndex} (${currentUrl}) — reason: ${reason}, failCount=${failCount}`);
    }

    const MAX_AUTO_ATTEMPTS = urlsCount * 2;
    autoAttemptCountRef.current++;

    if (activeSourceIndex + 1 < urlsCount) {
      const nextIndex = activeSourceIndex + 1;
      console.log(`Stream failed (${reason}). Auto-switching to source ${nextIndex + 1}/${urlsCount}. Attempt ${autoAttemptCountRef.current}/${MAX_AUTO_ATTEMPTS}.`);
      setErrorMsg(`Kênh lỗi (${translateReason(reason)}). Đang tự động đổi sang nguồn dự phòng (${nextIndex + 1}/${urlsCount})...`);
      setTimeout(() => {
        setActiveSourceIndex(nextIndex);
      }, 2500);
    } else if (autoAttemptCountRef.current < MAX_AUTO_ATTEMPTS) {
      // Wrap: find first non-blacklisted in platform-sorted order.
      const candidates = platformUrls.filter(
        (u) => !repository.isSourceBlacklisted(currentChannel.id, u.url)
      );
      if (candidates.length === 0) {
        setErrorMsg("Tất cả các nguồn phát của kênh đều gặp sự cố. Vui lòng kiểm tra lại kết nối mạng hoặc bấm 'Đổi nguồn dự phòng' để chọn nguồn phát khác.");
        return;
      }
      const wrapIndex = platformUrls.findIndex(
        (u) => u.url === candidates[0].url
      );
      if (wrapIndex === -1 || wrapIndex === activeSourceIndex) {
        setErrorMsg("Tất cả các nguồn phát của kênh đều gặp sự cố. Vui lòng kiểm tra lại kết nối mạng hoặc bấm 'Đổi nguồn dự phòng' để chọn nguồn phát khác.");
        return;
      }
      console.log(`All sources exhausted once. Wrapping to platform-preferred source ${wrapIndex + 1}/${urlsCount}.`);
      setErrorMsg(`Đang thử lại với nguồn phù hợp nhất cho thiết bị của bạn (${wrapIndex + 1}/${urlsCount})...`);
      setTimeout(() => {
        setActiveSourceIndex(wrapIndex);
      }, 2500);
    } else {
      setErrorMsg("Đã thử tất cả nguồn phát nhưng không thành công. Bấm 'Đổi nguồn dự phòng' để chọn nguồn phát khác hoặc thử lại sau.");
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
        console.warn("Playback loading timed out after 20s. Trying next source...");
        handleStreamFailureRef.current?.("timeout");
      }, 20000);
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
        if (!data.fatal) return;
        const details = (data.details || "").toString();
        // Skip-once failures (key/license/manifest). No retry — bump immediately.
        if (
          details === Hls.ErrorDetails.KEY_LOAD_ERROR ||
          details === Hls.ErrorDetails.KEY_LOAD_TIMEOUT ||
          details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
          details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
        ) {
          if (loadTimeoutId) clearTimeout(loadTimeoutId);
          handleStreamFailureRef.current?.(details);
          return;
        }
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            // After 1 retry on the same source, give up — switch.
            if (repository.getFailCount(currentChannel.id, activeSourceIndex) >= 1) {
              if (loadTimeoutId) clearTimeout(loadTimeoutId);
              handleStreamFailureRef.current?.(details || "network");
            } else {
              hls.startLoad();
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (repository.getFailCount(currentChannel.id, activeSourceIndex) >= 1) {
              if (loadTimeoutId) clearTimeout(loadTimeoutId);
              handleStreamFailureRef.current?.(details || "media");
            } else {
              hls.recoverMediaError();
            }
            break;
          default:
            if (loadTimeoutId) clearTimeout(loadTimeoutId);
            handleStreamFailureRef.current?.(details || "unknown");
            break;
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
      // Reset attempt counter on successful playback on this channel.
      autoAttemptCountRef.current = 0;
      repository.resetFailCount(currentChannel.id);
      // Lock the successful working source as the default (by URL, not index).
      const playedUrl = platformUrls[activeSourceIndex]?.url;
      if (playedUrl) repository.setLastWorkingSourceUrl(currentChannel.id, playedUrl);
      console.log(`Successfully playing channel ${currentChannel.name} at source index ${activeSourceIndex}`);
    };
    const handleVideoError = () => {
      if (video.error) {
        console.error("HTML5 video error:", video.error);
        if (loadTimeoutId) clearTimeout(loadTimeoutId);
        // video.error.code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED — common for DRM
        // / codec mismatch on iOS. 5 = MEDIA_ERR_DECODE. Both are unrecoverable.
        const reason = video.error.code === 4 ? "not-supported" :
                       video.error.code === 5 ? "decode" :
                       "media";
        handleStreamFailureRef.current?.(reason);
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

  // Listen for videoState, userInteraction and error events from shaka.html iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data) {
        if (e.data.type === "videoState") {
          setIsPlaying(!!e.data.isPlaying);
        } else if (e.data.type === "userInteraction") {
          resetControlsTimeout();
        } else if (e.data.type === "error") {
          console.warn("Received error from Shaka WebView:", e.data.message);
          handleStreamFailureRef.current(`shaka_drm_error: ${e.data.code || "unknown"}`);
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
    const url = platformUrls[index]?.url;
    if (url) repository.setLastWorkingSourceUrl(currentChannel.id, url);
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
    const urlStr = (urlObj.url || "").toLowerCase();
    const provider = (urlObj.provider || "").toLowerCase();

    let name = "";
    if (provider === "vtvgo" || urlStr.includes("vtvgo")) {
      name = "VTVGo";
    } else if (provider === "webview" || urlStr.includes("shaka.html") || urlStr.includes("manifest.mpd")) {
      if (urlStr.includes("vtvprime")) name = "VTVPrime DRM";
      else if (urlStr.includes("sctv")) name = "SCTV DRM";
      else if (urlStr.includes("tv360")) name = "TV360 DRM";
      else if (urlStr.includes("vieon")) name = "VieON DRM";
      else if (urlStr.includes("vtvcab")) name = "VTVcab DRM";
      else name = "Webview DRM";
    } else {
      if (urlStr.includes("fptplay") || urlStr.includes("fpt")) name = "FPT Play";
      else if (urlStr.includes("toiyeuvietnam")) name = "TYVN";
      else if (urlStr.includes("freem3u")) name = "Dự phòng";
      else if (provider === "flow") name = "Luồng chính";
      else if (provider === "backup_public") name = "Công cộng";
      else if (provider === "hls") name = "HLS";
      else name = `Dự phòng ${index + 1}`;
    }

    return `Nguồn ${name}`;
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
          title={`Trình phát toàn màn hình kênh ${currentChannel.name}`}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            backgroundColor: "black",
            display: "block",
          }}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"
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
            <button
              onClick={() => onExit(currentChannel)}
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
              Về trang chủ
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
                color: "white",
                fontSize: isMobile ? "13px" : "15px",
                fontWeight: 600,
                cursor: "pointer",
                padding: isMobile ? "8px 14px" : "10px 18px",
                borderRadius: "24px",
                backgroundColor: "var(--color-control-glass)",
                border: "1px solid var(--color-control-border)",
                backdropFilter: "blur(12px)",
                whiteSpace: "nowrap",
                transition: "background-color 0.2s, border-color 0.2s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                e.currentTarget.style.borderColor = "var(--color-control-border-active)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                e.currentTarget.style.borderColor = "var(--color-control-border)";
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
                color: "white",
                fontSize: isMobile ? "13px" : "15px",
                fontWeight: 600,
                cursor: "pointer",
                padding: isMobile ? "8px 14px" : "10px 18px",
                borderRadius: "24px",
                backgroundColor: "var(--color-control-glass)",
                border: "1px solid var(--color-control-border)",
                backdropFilter: "blur(12px)",
                whiteSpace: "nowrap",
                transition: "background-color 0.2s, border-color 0.2s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                e.currentTarget.style.borderColor = "var(--color-control-border-active)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                e.currentTarget.style.borderColor = "var(--color-control-border)";
              }}
            >
              <List size={isMobile ? 16 : 18} style={{ color: "var(--color-accent-blue-fg)" }} />
              <span>Danh sách kênh</span>
            </button>
          </div>

          {/* Top Right: Cast & AirPlay buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {airplayAvailable && (
              <button
                onClick={triggerAirPlay}
                title="Phát qua AirPlay"
                aria-label="Phát qua AirPlay"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  cursor: "pointer",
                  padding: "10px",
                  borderRadius: "50%",
                  width: "44px",
                  height: "44px",
                  backgroundColor: "var(--color-control-glass)",
                  border: "1px solid var(--color-control-border)",
                  backdropFilter: "blur(12px)",
                  transition: "background-color 0.2s, border-color 0.2s, transform 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                  e.currentTarget.style.borderColor = "var(--color-control-border-active)";
                  e.currentTarget.style.transform = "scale(1.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                  e.currentTarget.style.borderColor = "var(--color-control-border)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
                  <polygon points="12 15 17 21 7 21 12 15" />
                </svg>
              </button>
            )}

            {castAvailable && (
              <button
                onClick={handleCastClick}
                title="Truyền hình ảnh (Cast)"
                aria-label="Truyền hình ảnh (Cast)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  cursor: "pointer",
                  padding: "10px",
                  borderRadius: "50%",
                  width: "44px",
                  height: "44px",
                  backgroundColor: "var(--color-control-glass)",
                  border: "1px solid var(--color-control-border)",
                  backdropFilter: "blur(12px)",
                  transition: "background-color 0.2s, border-color 0.2s, transform 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                  e.currentTarget.style.borderColor = "var(--color-control-border-active)";
                  e.currentTarget.style.transform = "scale(1.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                  e.currentTarget.style.borderColor = "var(--color-control-border)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 12a10 10 0 0 1 10 10M2 17a5 5 0 0 1 5 5M2 8a14 14 0 0 1 14 14" />
                  <path d="M2 20h.01" />
                  <path d="M5 3h15a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6M2 3v2" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Channel Info & Description */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "18px" }}>
            {currentChannel.logoUrl ? (
              <img
                src={currentChannel.logoUrl}
                alt={currentChannel.name}
                style={{
                  width: "64px",
                  height: "64px",
                  objectFit: "contain",
                  borderRadius: "10px",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--color-control-border)",
                  padding: "6px",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                }}
              />
            ) : (
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "10px",
                  backgroundColor: "var(--color-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                  fontWeight: 800,
                  border: "1px solid var(--color-control-border)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                }}
              >
                {currentChannel.name.substring(0, 2).toUpperCase()}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span
                  style={{
                    backgroundColor: "var(--color-primary-action)",
                    color: "white",
                    fontWeight: 800,
                    fontSize: "12px",
                    padding: "3px 8px",
                    borderRadius: "6px",
                    letterSpacing: "0.5px",
                  }}
                >
                  CH {String(currentChannel.number).padStart(2, "0")}
                </span>
                <h2 style={{ fontSize: isMobile ? "20px" : "24px", fontWeight: 700, letterSpacing: "-0.3px" }}>
                  {currentChannel.name}
                </h2>
              </div>

              {currentProgram ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "white", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: "var(--color-primary-action)",
                        boxShadow: "0 0 8px var(--color-primary-action)",
                      }}
                    />
                    ĐANG PHÁT: <span style={{ color: "var(--color-accent-blue-fg)" }}>{currentProgram.title}</span>
                  </span>
                  {currentProgram.description && (
                    <span style={{ fontSize: "12px", color: "var(--color-muted)", paddingLeft: "16px" }}>
                      {currentProgram.description}
                    </span>
                  )}
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
            <div style={{ flex: isMobile ? "1 0 100%" : "1 1 0px", display: "flex", justifyContent: isMobile ? "center" : "flex-start", minWidth: isMobile ? "auto" : "180px" }}>
              {currentChannel.urls.length > 1 && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowSourceSelector(!showSourceSelector)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "white",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "10px 18px",
                      borderRadius: "24px",
                      backgroundColor: "var(--color-control-glass)",
                      border: `1px solid ${showSourceSelector ? "var(--color-control-border-active)" : "var(--color-control-border)"}`,
                      backdropFilter: "blur(12px)",
                      transition: "background-color 0.2s, border-color 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                      e.currentTarget.style.borderColor = "var(--color-control-border-active)";
                    }}
                    onMouseLeave={(e) => {
                      if (!showSourceSelector) {
                        e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                        e.currentTarget.style.borderColor = "var(--color-control-border)";
                      }
                    }}
                  >
                    <span>{getSourceDisplayName(platformUrls[activeSourceIndex] || currentChannel.urls[0], activeSourceIndex)}</span>
                    <ChevronDown size={14} style={{ color: "var(--color-accent-blue-fg)", transform: showSourceSelector ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
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
                      {platformUrls.map((u, i) => (
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
                justifyContent: "center",
                flex: isMobile ? "1 0 100%" : "0 0 auto",
              }}
            >
              {/* Previous Channel Button */}
              {prevChannel && (
                <button
                  onClick={() => switchChannel("prev")}
                  title={`Kênh trước: ${prevChannel.name}`}
                  aria-label={`Kênh trước: ${prevChannel.name}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    color: "white",
                    cursor: "pointer",
                    padding: "8px 16px 8px 12px",
                    borderRadius: "24px",
                    backgroundColor: "var(--color-control-glass)",
                    border: "1px solid var(--color-control-border)",
                    backdropFilter: "blur(12px)",
                    transition: "background-color 0.2s, border-color 0.2s, transform 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                    e.currentTarget.style.borderColor = "var(--color-control-border-active)";
                    e.currentTarget.style.transform = "translateX(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                    e.currentTarget.style.borderColor = "var(--color-control-border)";
                    e.currentTarget.style.transform = "translateX(0)";
                  }}
                >
                  <ArrowLeft size={18} style={{ color: "var(--color-accent-blue-fg)" }} />
                  {prevChannel.logoUrl ? (
                    <img
                      src={prevChannel.logoUrl}
                      alt={prevChannel.name}
                      style={{ width: "28px", height: "28px", objectFit: "contain", borderRadius: "6px", backgroundColor: "rgba(255,255,255,0.06)", padding: "2px" }}
                    />
                  ) : (
                    <Tv size={18} />
                  )}
                </button>
              )}

              {/* Play/Pause Center Button */}
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? "Tạm dừng" : "Phát"}
                style={{
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  border: "none",
                  backgroundColor: "var(--color-primary-action)",
                  boxShadow: "var(--color-primary-action-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
                  transition: "transform 0.2s, background-color 0.2s, box-shadow 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "scale(1.08)";
                  e.currentTarget.style.backgroundColor = "hsl(212, 100%, 72%)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                  e.currentTarget.style.backgroundColor = "var(--color-primary-action)";
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.94)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1.08)";
                }}
              >
                {isPlaying ? <Pause size={28} fill="white" /> : <Play size={28} fill="white" style={{ marginLeft: "4px" }} />}
              </button>

              {/* Next Channel Button */}
              {nextChannel && (
                <button
                  onClick={() => switchChannel("next")}
                  title={`Kênh sau: ${nextChannel.name}`}
                  aria-label={`Kênh sau: ${nextChannel.name}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    color: "white",
                    cursor: "pointer",
                    padding: "8px 12px 8px 16px",
                    borderRadius: "24px",
                    backgroundColor: "var(--color-control-glass)",
                    border: "1px solid var(--color-control-border)",
                    backdropFilter: "blur(12px)",
                    transition: "background-color 0.2s, border-color 0.2s, transform 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                    e.currentTarget.style.borderColor = "var(--color-control-border-active)";
                    e.currentTarget.style.transform = "translateX(2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                    e.currentTarget.style.borderColor = "var(--color-control-border)";
                    e.currentTarget.style.transform = "translateX(0)";
                  }}
                >
                  {nextChannel.logoUrl ? (
                    <img
                      src={nextChannel.logoUrl}
                      alt={nextChannel.name}
                      style={{ width: "28px", height: "28px", objectFit: "contain", borderRadius: "6px", backgroundColor: "rgba(255,255,255,0.06)", padding: "2px" }}
                    />
                  ) : (
                    <Tv size={18} />
                  )}
                  <ArrowRight size={18} style={{ color: "var(--color-accent-blue-fg)" }} />
                </button>
              )}
            </div>

            {/* Right: Volume Control */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isMobile ? "center" : "flex-end",
                gap: "12px",
                flex: isMobile ? "1 0 100%" : "1 1 0px",
                minWidth: isMobile ? "auto" : "180px",
              }}
            >

              {/* Volume Control */}
              <div
                onMouseEnter={handleVolumeMouseEnter}
                onMouseLeave={handleVolumeMouseLeave}
                style={{
                  position: "relative",
                  display: isMobile ? "none" : "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: "0",
                  minWidth: "150px",
                }}
              >
              <button
                onClick={toggleMute}
                aria-label={volume === 0 ? "Bật tiếng" : "Tắt tiếng"}
                title={volume === 0 ? "Bật tiếng" : "Tắt tiếng"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  cursor: "pointer",
                  padding: "10px",
                  borderRadius: "50%",
                  width: "44px",
                  height: "44px",
                  backgroundColor: "var(--color-control-glass)",
                  border: `1px solid ${showVolumeControl || volume === 0 ? "var(--color-control-border-active)" : "var(--color-control-border)"}`,
                  backdropFilter: "blur(12px)",
                  transition: "background-color 0.2s, border-color 0.2s, transform 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-control-glass-hover)";
                  e.currentTarget.style.borderColor = "var(--color-control-border-active)";
                  e.currentTarget.style.transform = "scale(1.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-control-glass)";
                  e.currentTarget.style.borderColor = volume === 0 ? "var(--color-control-border-active)" : "var(--color-control-border)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {volume === 0 ? (
                  <VolumeX size={18} style={{ color: "var(--color-destructive)" }} />
                ) : (
                  <Volume2 size={18} style={{ color: "var(--color-accent-blue-fg)" }} />
                )}
              </button>

              {showVolumeControl && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 12px)",
                    right: 0,
                    backgroundColor: "rgba(10, 15, 30, 0.94)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    padding: "16px 14px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                    zIndex: 35,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <span style={{ fontSize: "10px", color: "var(--color-muted)", fontWeight: 600 }}>ÂM LƯỢNG</span>
                  {/* Vertical slider */}
                  <div
                    ref={volumeSliderRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="Âm lượng"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(volume * 100)}
                    style={{
                      position: "relative",
                      width: "6px",
                      height: "120px",
                      backgroundColor: "rgba(255,255,255,0.15)",
                      borderRadius: "3px",
                      cursor: "pointer",
                      touchAction: "none",
                    }}
                    onPointerDown={handleVolumeSliderPointerDown}
                    onPointerMove={handleVolumeSliderPointerMove}
                    onPointerUp={handleVolumeSliderPointerUp}
                    onKeyDown={handleVolumeSliderKeyDown}
                  >
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        width: "100%",
                        height: `${volume * 100}%`,
                        backgroundColor: volume === 0 ? "var(--color-destructive)" : "var(--color-accent-blue)",
                        borderRadius: "3px",
                        pointerEvents: "none",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        bottom: `calc(${volume * 100}% - 6px)`,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        backgroundColor: "white",
                        border: "2px solid var(--color-accent-blue)",
                        pointerEvents: "none",
                        transition: volume === 0 ? "border-color 0.2s" : "none",
                        ...(volume === 0 && { borderColor: "var(--color-destructive)" }),
                      }}
                    />
                  </div>
                  <Volume2
                    size={14}
                    style={{
                      color: volume === 0 ? "var(--color-destructive)" : "var(--color-accent-blue)",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
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
        className="channel-drawer"
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
              aria-label="Đóng danh sách kênh"
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
