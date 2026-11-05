export interface StudioError extends Error {
  rejected?: boolean;
  providerCode?: string;
  providerRejection?: {
    status?: string;
    error?: string;
    failedCode?: string;
    errorDisplayCode?: string;
  };
  code?: string | number;
  status?: number;
  statusCode?: number;
  providerErrorCode?: string;
  retryable?: boolean;
  uncertain?: boolean;
}

/** Keep native errors intact while giving non-Error rejections a useful message. */
export function toError(value: unknown): StudioError {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object') {
    const message =
      'message' in value && typeof value.message === 'string' ? value.message : String(value);
    return Object.assign(new Error(message), value);
  }
  return new Error(String(value));
}
