const DEFAULT_API_BASE_URL = "";

export const recallApiBaseUrl =
  import.meta.env.VITE_RECALL_API_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_API_BASE_URL;

export async function recallFetch<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${recallApiBaseUrl}${path}`, init);

  if (!response.ok) {
    throw new Error(`Recall API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<TResponse>;
}

