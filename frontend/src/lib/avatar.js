import { API_BASE } from "@/lib/api";

export const resolveAvatarUrl = (url) => {
  if (!url) return null;
  if (url.startsWith("http") || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const base = API_BASE.replace(/\/api\/?$/, "");
  return `${base}${url}`;
};
