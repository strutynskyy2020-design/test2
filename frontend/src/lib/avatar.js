import { API_BASE } from "@/lib/api";

export const resolveAvatarUrl = (url) => {
  if (!url) return null;
  const value = String(url).trim();
  if (!value) return null;
  if (value.startsWith("http") || value.startsWith("data:") || value.startsWith("blob:")) return value;
  if (value.startsWith("/avatars/")) return value;

  const base = API_BASE.replace(/\/api\/?$/, "").replace(/\/$/, "");
  const path = value.startsWith("/") ? value : `/${value}`;
  return `${base}${path}`;
};
