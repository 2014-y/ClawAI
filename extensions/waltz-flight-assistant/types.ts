export type PluginConfig = {
  baseUrl?: string;
  authToken?: string;
  openclawId?: string;
  userId?: string;
  requestTimeoutMs?: number;
};

export type ArtifactPart = {
  text?: string;
  data?: Record<string, any>;
};

export type TaskArtifact = {
  parts?: ArtifactPart[];
};

export type A2ATask = {
  contextId?: string;
  artifacts?: TaskArtifact[];
  status?: {
    state?: string;
    message?: {
      parts?: Array<{ text?: string }>;
    };
  };
};

export type ActiveFlightSession = {
  sessionKey: string;
  contextId: string;
  updatedAt: number;
  expiresAt: number;
  channelId?: string;
  conversationId?: string;
  accountId?: string;
  awaitingPaymentSetup?: boolean;
};

export type SessionStateLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};
