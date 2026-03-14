import { apiFetch } from "./client";
import { UserPublic } from "@shared/types";

export async function getMe(): Promise<{ user: UserPublic }> {
  const res = await apiFetch("/auth/me");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch profile");
  return data;
}
