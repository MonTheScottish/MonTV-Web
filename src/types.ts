export interface ChannelUrl {
  url: string;
  provider?: string | null;
}

export interface Channel {
  id: string;
  name: string;
  logoUrl?: string | null;
  groupTitle: string;
  streamUrl: string;
  urls: ChannelUrl[];
  userAgent?: string | null;
  referer?: string | null;
  tvgId: string;
  number: number;
  isHidden: boolean;
  isAudio: boolean;
}

export interface VnepgChannel {
  id: string;
  name: string;
  logo: string;
  hasEpg: boolean;
}

export interface EPGProgram {
  title: string;
  start: string; // ISO String
  stop: string;  // ISO String
  description: string;
}

export interface ResolvedStream {
  url: string;
  headers?: Record<string, string>;
  drmScheme?: string | null;
  drmKeyId?: string | null;
  drmKey?: string | null;
  drmLicenseUrl?: string | null;
  drmCertUrl?: string | null;
  isWebView?: boolean;
}
