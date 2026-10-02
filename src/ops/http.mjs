export async function requestJson(url, options = {}) {
  const response = await options.fetchImplementation(url, {
    method: options.method || "GET",
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 30_000),
    headers: options.headers,
    body: options.body,
  });
  const text = await response.text();
  const parsed = text ? tryParseJson(text) : { ok: true, value: {} };

  const acceptedStatus = options.acceptedStatuses?.includes(response.status);
  if (!response.ok && !acceptedStatus) {
    const payload = parsed.ok ? parsed.value : {};
    throw new Error(
      options.errorMessage?.(response, payload) || `Request failed with HTTP ${response.status}.`,
    );
  }
  if (!parsed.ok) {
    throw new Error("Provider returned a response that was not valid JSON.");
  }

  return parsed.value;
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
