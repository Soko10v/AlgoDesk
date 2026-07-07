import { api } from "../api/client";

const ANON_ID_KEY = "algodesk_anon_id";

// One id per browser, kept across logins, so the funnel can connect an
// anonymous landing-page visit to the signup that follows it.
function anonId(): string {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

/** Fire-and-forget in-house event log — no third-party account, no cookies. */
export function track(name: string, properties?: Record<string, unknown>): void {
  api
    .post("/analytics/event", {
      name,
      anon_id: anonId(),
      path: window.location.pathname,
      properties: properties ?? {},
    })
    .catch(() => {
      // Analytics must never break the app or surface an error to the user.
    });
}
