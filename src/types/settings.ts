export interface APIKeys {
  openai: string;
  anthropic: string;
  gemini: string;
  semanticScholar: string;
}

export interface ExtractionSettings {
  useLLM: boolean;
  preferredLLM: 'openai' | 'anthropic' | 'gemini';
}

export type ValidationMode = 'api-only' | 'agent-based';

export interface ValidationSettings {
  mode: ValidationMode;
  enableCrossRef: boolean;
  enableSemanticScholar: boolean;
  enableOpenAlex: boolean;
  enableArxiv: boolean;
  rateLimitDelay: number;
  maxRetries: number;
}

export interface AppSettings {
  apiKeys: APIKeys;
  extraction: ExtractionSettings;
  validation: ValidationSettings;
}

export const defaultSettings: AppSettings = {
  apiKeys: {
    openai: '',
    anthropic: '',
    gemini: '',
    semanticScholar: '',
  },
  extraction: {
    useLLM: false,
    preferredLLM: 'openai',
  },
  validation: {
    mode: 'api-only',
    enableCrossRef: true,
    enableSemanticScholar: true,
    enableOpenAlex: true,
    enableArxiv: true,
    rateLimitDelay: 500,
    maxRetries: 2,
  },
};


