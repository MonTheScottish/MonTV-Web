import { useState, useMemo } from "react";
import { MonTVRepository } from "./services/repository";
import type { Channel } from "./types";
import SplashScreen from "./components/SplashScreen";
import LiveTvScreen from "./components/LiveTvScreen";
import PlayerScreen from "./components/PlayerScreen";
import SettingsScreen from "./components/SettingsScreen";

function App() {
  const repository = useMemo(() => new MonTVRepository(), []);

  const [screen, setScreen] = useState<"splash" | "livetv" | "player" | "settings">("splash");
  const [playlistUrl, setPlaylistUrl] = useState(() => repository.getPlaylistUrl());
  const [selectedCategory, setSelectedCategory] = useState("Tất cả kênh");
  const [lastFocusedChannelId, setLastFocusedChannelId] = useState<string | null>(null);
  
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<Channel[]>([]);

  const handleSplashReady = () => {
    setScreen("livetv");
  };

  const handleSplashError = (msg: string) => {
    console.error("Splash initialization failed:", msg);
    // Move to livetv anyway to let user access settings and fix playlist URL
    setScreen("livetv");
  };

  const handlePlayChannel = (channel: Channel, list: Channel[]) => {
    setActiveChannel(channel);
    setActivePlaylist(list);
    setScreen("player");
  };

  const handlePlayerExit = (finalChannel: Channel) => {
    setLastFocusedChannelId(finalChannel.id);
    setScreen("livetv");
  };

  const handleSettingsBack = () => {
    const savedUrl = repository.getPlaylistUrl();
    if (savedUrl !== playlistUrl) {
      // Playlist URL changed, reload channels and EPG
      setPlaylistUrl(savedUrl);
      setSelectedCategory("Tất cả kênh");
      setLastFocusedChannelId(null);
      setScreen("splash");
    } else {
      setScreen("livetv");
    }
  };

  return (
    <>
      {screen === "splash" && (
        <SplashScreen
          repository={repository}
          playlistUrl={playlistUrl}
          onReady={handleSplashReady}
          onError={handleSplashError}
        />
      )}

      {screen === "livetv" && (
        <LiveTvScreen
          repository={repository}
          playlistUrl={playlistUrl}
          selectedCategory={selectedCategory}
          onCategorySelected={setSelectedCategory}
          lastFocusedChannelId={lastFocusedChannelId}
          onFocusedChannelChanged={setLastFocusedChannelId}
          onPlayChannel={handlePlayChannel}
          onOpenSettings={() => setScreen("settings")}
        />
      )}

      {screen === "player" && activeChannel && (
        <PlayerScreen
          initialChannel={activeChannel}
          channelList={activePlaylist}
          repository={repository}
          onExit={handlePlayerExit}
        />
      )}

      {screen === "settings" && (
        <SettingsScreen
          repository={repository}
          onBack={handleSettingsBack}
        />
      )}
    </>
  );
}

export default App;
