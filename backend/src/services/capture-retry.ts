// Each model attempt gets its own deadline. Only model reads are repeated.
export const CAPTURE_AI_TIMEOUT_MS = 180_000;
export const CAPTURE_AI_ATTEMPTS = 3;

export function captureConnectionInterrupted(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["TimeoutError", "AbortError"].includes(error.name)) return true;
  const code = (error.cause as { code?: string } | undefined)?.code ?? (error as NodeJS.ErrnoException).code;
  return /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|ERR_STREAM_PREMATURE_CLOSE)$/.test(code || "")
    || (error instanceof TypeError && !code && /fetch failed|terminated|network error/i.test(error.message));
}
