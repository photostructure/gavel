export function resolveEventSourceUrl(path: string): string {
  const apiUrl = import.meta.env.VITE_GAVEL_API_URL?.trim();
  if (!apiUrl) {
    return path;
  }

  try {
    return new URL(path, apiUrl).toString();
  } catch {
    return path;
  }
}
