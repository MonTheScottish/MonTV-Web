import React, { useEffect, useState } from "react";
import { MonTVRepository } from "../services/repository";
import { AlertTriangle } from "lucide-react";

interface SplashScreenProps {
  repository: MonTVRepository;
  playlistUrl: string;
  onReady: () => void;
  onError: (msg: string) => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  repository,
  playlistUrl,
  onReady,
  onError,
}) => {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Đang khởi động...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      try {
        if (!active) return;
        setStatusText("Đang tải danh sách kênh...");
        setProgress(0.1);

        const channels = await repository.fetchChannels(playlistUrl, false);
        if (!active) return;

        if (channels.length === 0) {
          throw new Error("Không tìm thấy kênh nào trong danh sách.");
        }

        setProgress(0.4);
        setStatusText("Đang tải lịch phát sóng EPG...");

        await repository.loadEPG(false, (p) => {
          if (active) {
            setProgress(0.4 + p * 0.6);
            if (p < 0.5) {
              setStatusText("Đang phân tích XML EPG...");
            } else if (p < 0.85) {
              setStatusText("Đang đồng bộ mã kênh...");
            } else {
              setStatusText("Đang tối ưu dữ liệu...");
            }
          }
        });

        if (!active) return;
        setProgress(1.0);
        setStatusText("Sẵn sàng!");
        
        // Brief delay for transition
        setTimeout(() => {
          if (active) onReady();
        }, 600);
      } catch (err: any) {
        console.error("Initialization error:", err);
        if (active) {
          const msg = err.message || "Tải danh sách kênh thất bại.";
          setError(msg);
          onError(msg);
        }
      }
    };

    initialize();

    return () => {
      active = false;
    };
  }, [repository, playlistUrl, onReady, onError]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        width: "100vw",
        backgroundColor: "var(--color-background)",
        color: "var(--color-on-background)",
        gap: "24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <img src="/logo.png" alt="MonTV Logo" className="pulse-badge" style={{ width: "64px", height: "64px", objectFit: "contain", borderRadius: "14px" }} />
        <h1 style={{ fontSize: "36px", fontWeight: 700, letterSpacing: "1px" }}>
          Mon<span style={{ color: "var(--color-accent-blue)" }}>TV</span>
        </h1>
      </div>

      {error ? (
        <div
          className="glass-panel"
          style={{
            padding: "24px",
            borderRadius: "12px",
            maxWidth: "400px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <AlertTriangle size={36} color="var(--color-destructive)" />
          <p style={{ fontSize: "15px", color: "var(--color-on-background)" }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 24px",
              backgroundColor: "var(--color-destructive)",
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            width: "300px",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "4px",
              backgroundColor: "var(--color-border)",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress * 100}%`,
                height: "100%",
                backgroundColor: "var(--color-accent-blue)",
                transition: "width 0.3s ease-out",
              }}
            />
          </div>
          <span style={{ fontSize: "14px", color: "var(--color-muted)" }}>{statusText}</span>
        </div>
      )}
    </div>
  );
};
export default SplashScreen;
