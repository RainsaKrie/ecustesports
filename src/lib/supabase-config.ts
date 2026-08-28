/**
 * Supabase 控制台可能展示项目根地址，也可能展示带 `/rest/v1` 的 Data API 地址。
 * 运行时统一取 URL origin，避免后续拼接出重复路径。
 */
export function normalizeSupabaseProjectUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}
