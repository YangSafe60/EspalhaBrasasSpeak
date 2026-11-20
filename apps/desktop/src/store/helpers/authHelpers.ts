import { setTokens } from "../../api/client";
import type { AuthResponse } from "../../types";

/** Apply tokens + user payload after login/register. */
export function applyAuth(
  set: (p: Record<string, unknown>) => void,
  data: AuthResponse,
) {
  void setTokens(data.access_token, data.refresh_token);
  set({
    user: { ...data.user, email: "" },
    error: null,
  });
}
