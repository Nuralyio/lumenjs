/**
 * Minimal type declarations for @anthropic-ai/claude-agent-sdk.
 * The SDK is an optional peer dependency — only needed when AI_BACKEND=claude-code.
 */
declare module '@anthropic-ai/claude-agent-sdk' {
  interface QueryOptions {
    prompt: string;
    options?: {
      cwd?: string;
      systemPrompt?: string;
      allowedTools?: string[];
      maxTurns?: number;
      resume?: string;
      [key: string]: any;
    };
  }

  interface ContentBlock {
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
  }

  interface SDKMessage {
    type: 'system' | 'assistant' | 'user' | 'result' | 'error';
    session_id?: string;
    message?: {
      role: 'user' | 'assistant';
      content: ContentBlock[];
    };
    result?: any;
  }

  export function query(options: QueryOptions): AsyncIterable<SDKMessage>;
}
