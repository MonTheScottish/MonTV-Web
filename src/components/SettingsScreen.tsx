import React, { useState } from "react";
import { MonTVRepository } from "../services/repository";
import { ArrowLeft, Save, Trash2, RefreshCw, Settings, Info } from "lucide-react";

interface SettingsScreenProps {
  repository: MonTVRepository;
  onBack: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  repository,
  onBack,
}) => {
  const [playlistUrl, setPlaylistUrl] = useState(repository.getPlaylistUrl());
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleSave = () => {
    if (!playlistUrl.trim()) {
      setStatusMsg("Vui lòng nhập đường dẫn playlist hợp lệ.");
      return;
    }
    repository.setPlaylistUrl(playlistUrl.trim());
    setStatusMsg("Đã lưu cấu hình playlist thành công!");
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleClearRecents = () => {
    repository.clearRecentChannels();
    setStatusMsg("Đã xóa danh sách kênh xem gần đây.");
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleRefreshEPG = async () => {
    setIsRefreshing(true);
    setStatusMsg("Đang làm mới lịch EPG...");
    try {
      await repository.loadEPG(true);
      setStatusMsg("Đã làm mới dữ liệu EPG thành công!");
    } catch (e) {
      setStatusMsg("Làm mới EPG thất bại. Vui lòng thử lại.");
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setStatusMsg(null), 3000);
    }
  };

  return (
    <div
      className="fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100vh",
        width: "100vw",
        backgroundColor: "var(--color-background)",
        color: "white",
        padding: isMobile ? "24px 16px" : "40px",
        overflowY: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: "1000px", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              color: "white",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px",
              borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.05)",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.15)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)")}
          >
            <ArrowLeft size={24} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Settings size={28} style={{ color: "var(--color-accent-blue)" }} />
            <h1 style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 700 }}>Thiết lập hệ thống</h1>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gap: isMobile ? "24px" : "40px",
            width: "100%",
          }}
        >
        {/* Left Panel - Configurations */}
        <div
          className="glass-panel"
          style={{
            padding: "28px",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 600, borderBottom: "1px solid var(--color-border)", paddingBottom: "10px", color: "var(--color-accent-blue)" }}>
            Cấu hình nguồn kênh
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "13px", color: "var(--color-muted)" }}>Đường dẫn Playlist (M3U hoặc JSON)</label>
            <input
              type="text"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 16px",
                backgroundColor: "rgba(0,0,0,0.3)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                color: "white",
                fontSize: "14px",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent-blue)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
            <button
              onClick={handleSave}
              style={{
                flex: 1,
                padding: "12px",
                backgroundColor: "var(--color-secondary)",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                transition: "filter 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.filter = "brightness(1)")}
            >
              <Save size={16} />
              Lưu thiết lập
            </button>

            <button
              onClick={handleRefreshEPG}
              disabled={isRefreshing}
              style={{
                padding: "12px 20px",
                backgroundColor: "rgba(255,255,255,0.05)",
                color: "white",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "14px",
                cursor: isRefreshing ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                opacity: isRefreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw size={16} className={isRefreshing ? "pulse-badge" : ""} />
              Tải lại EPG
            </button>
          </div>

          <h2 style={{ fontSize: "18px", fontWeight: 600, borderBottom: "1px solid var(--color-border)", paddingBottom: "10px", marginTop: "12px", color: "var(--color-destructive)" }}>
            Quản trị dữ liệu
          </h2>

          <button
            onClick={handleClearRecents}
            style={{
              padding: "12px",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "var(--color-destructive)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.2)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.1)")}
          >
            <Trash2 size={16} />
            Xóa danh sách kênh xem gần đây
          </button>

          {statusMsg && (
            <div
              style={{
                padding: "12px 16px",
                backgroundColor: statusMsg.includes("thành công") ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                border: statusMsg.includes("thành công") ? "1px solid rgba(34, 197, 94, 0.2)" : "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: "8px",
                color: statusMsg.includes("thành công") ? "var(--color-accent)" : "var(--color-destructive)",
                fontSize: "13px",
                fontWeight: 500,
                marginTop: "8px",
                textAlign: "center",
              }}
            >
              {statusMsg}
            </div>
          )}
        </div>

        {/* Right Panel - Info */}
        <div
          className="glass-panel"
          style={{
            padding: "28px",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 600, borderBottom: "1px solid var(--color-border)", paddingBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Info size={20} style={{ color: "var(--color-accent-blue)" }} />
            Thông tin ứng dụng
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.03)", paddingBottom: "10px" }}>
              <span style={{ color: "var(--color-muted)" }}>Tên ứng dụng</span>
              <span style={{ fontWeight: 600 }}>MonTV Web Player</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.03)", paddingBottom: "10px" }}>
              <span style={{ color: "var(--color-muted)" }}>Phiên bản</span>
              <span style={{ fontWeight: 600 }}>1.0.0 (React WebApp)</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.03)", paddingBottom: "10px" }}>
              <span style={{ color: "var(--color-muted)" }}>Môi trường</span>
              <span style={{ fontWeight: 600 }}>HTML5 / hls.js Browser</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "10px" }}>
              <span style={{ color: "var(--color-muted)" }}>Hỗ trợ</span>
              <span style={{ fontWeight: 600, color: "var(--color-accent-blue)" }}>Phím bấm điều khiển từ xa (TV Remote)</span>
            </div>
          </div>

          <div
            style={{
              marginTop: "auto",
              padding: "16px",
              backgroundColor: "rgba(255,255,255,0.02)",
              borderRadius: "8px",
              border: "1px dashed var(--color-border)",
              fontSize: "13px",
              lineHeight: "1.6",
              color: "var(--color-muted)",
            }}
          >
            <strong>Mẹo:</strong> Phím lên/xuống (Up/Down) trong chế độ phát video sẽ giúp chuyển kênh nhanh chóng. Nhấn và giữ một kênh ở màn hình chính để thêm vào mục Yêu thích.
          </div>
        </div>
      </div>
    </div>
  </div>
);
};
export default SettingsScreen;
