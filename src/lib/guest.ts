const KEY = "ams-anon-id";

export function getAnonId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `a${Date.now()}${Math.random()}`).replace(/-/g, "");
    localStorage.setItem(KEY, id);
  }
  return id;
}

const CHOICE = "ams-auth-choice";

export function getAuthChoice(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CHOICE);
}

export function setAuthChoice(value: "guest" | "google") {
  if (typeof window !== "undefined") localStorage.setItem(CHOICE, value);
}
