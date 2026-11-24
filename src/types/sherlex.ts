export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'blocked';

export interface UserPublic {
  id: string;
  name: string;
  login: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface GroundingSource {
  title: string;
  url: string;
}

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ChatMessageImage {
  mimeType: SupportedImageMime;
  dataUrl: string;
  fileName?: string;
}

export interface ChatImagePayload {
  mimeType: SupportedImageMime;
  data: string;
  fileName?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  image?: ChatMessageImage;
  sources?: GroundingSource[];
  referencedPdfs?: string[];
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatSession extends ChatSessionSummary {
  userId: string;
  messages: ChatMessage[];
}

export interface LegalDocumentMeta {
  id: string;
  title: string;
  category: string;
  note: string;
  originalFileName: string;
  sizeBytes: number;
  pageCount: number;
  extractedChars: number;
  indexed: boolean;
  createdAt: string;
  uploadedBy: string;
}

export interface AuthStatusResponse {
  adminConfigured: boolean;
  envAdminActive: boolean;
  documentCount: number;
  supabaseError?: string;
}

export interface PdfExcerptPayload {
  docId: string;
  title: string;
  category: string;
  note: string;
  pageNumber: number;
  excerpt: string;
}

export interface ChatApiRequest {
  userPrompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  image?: ChatImagePayload;
  pdfContext?: {
    catalogSummary: string;
    matches: PdfExcerptPayload[];
  };
  stream?: boolean;
}

export interface ChatApiResponse {
  text: string;
  sources: GroundingSource[];
  referencedPdfs: string[];
}
