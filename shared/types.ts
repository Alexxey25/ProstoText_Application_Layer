export interface SessionInfo { sessionId: string; name: string }
export interface TextFile { name: string; mimeType: 'text/plain'; base64: string }
export interface RequestMessage {
  sender: string;
  sentAt: string;
  requestId: string;
  complexText: string;
  file?: TextFile;
}
export interface ResultMessage {
  sender: string;
  sentAt: string;
  requestId: string;
  error: boolean;
  isLast: boolean;
  partNumber?: number;
  simplifiedText?: string;
  partCount?: number;
}
export interface ChatMessage extends RequestMessage {
  parts: { number: number; text: string }[];
  error: boolean;
  done: boolean;
  receivedAt?: string;
}
export interface ChatState {
  user: SessionInfo | null;
  connected: boolean;
  messages: ChatMessage[];
  pending: boolean;
}
