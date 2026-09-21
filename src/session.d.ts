import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    activeTenantId?: string;
    oauthState?: string;
    csrfToken?: string;
    pendingInviteToken?: string;
    flash?: string;
    inviteUrl?: string;
  }
}
