export class ApiHtmlFallbackError extends Error {
  constructor(message = 'Backend API returned HTML/SPA fallback instead of JSON.') {
    super(message);
    this.name = 'ApiHtmlFallbackError';
  }
}

export async function safeParseJsonResponse<T = Record<string, unknown>>(res: Response): Promise<T> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  const trimmed = text.trimStart();

  if (
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html')
  ) {
    throw new ApiHtmlFallbackError();
  }

  if (!trimmed) {
    if (res.status === 404 || res.status === 405 || res.status === 502 || res.status === 503) {
      throw new ApiHtmlFallbackError();
    }
    throw new Error(`استجابة فارغة من الخادم (HTTP ${res.status}).`);
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`تعذر قراءة استجابة الخادم (HTTP ${res.status}).`);
  }
}
