export type TelegramAuthPayload = {
  id: number;
  first_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
};

export function fromTelegramWidget(data: Record<string, unknown>): TelegramAuthPayload {
  return {
    id: Number(data.id ?? 0),
    first_name: String(data.first_name ?? ""),
    username: String(data.username ?? ""),
    photo_url: String(data.photo_url ?? ""),
    auth_date: String(data.auth_date ?? ""),
    hash: String(data.hash ?? ""),
  };
}
