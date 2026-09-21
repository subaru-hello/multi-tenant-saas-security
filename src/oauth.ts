import type { GithubProfile } from "./types.js";

type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

type GithubUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type GithubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export class GithubOAuth {
  constructor(private readonly config: GithubOAuthConfig) {}

  authorizationUrl(state: string): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.callbackUrl);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchange(code: string): Promise<GithubProfile> {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.callbackUrl,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error(`GitHub token exchange failed (${tokenResponse.status})`);
    const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenBody.access_token) throw new Error(`GitHub token exchange failed: ${tokenBody.error ?? "missing token"}`);

    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenBody.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tenant-invariant-saas",
    };
    const [userResponse, emailsResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(10_000) }),
      fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(10_000) }),
    ]);
    if (!userResponse.ok) throw new Error(`GitHub user lookup failed (${userResponse.status})`);
    const user = (await userResponse.json()) as GithubUser;
    let email = user.email ?? undefined;
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as GithubEmail[];
      email = emails.find((candidate) => candidate.primary && candidate.verified)?.email ?? email;
    }
    return {
      githubId: String(user.id),
      login: user.login,
      displayName: user.name?.trim() || user.login,
      ...(email ? { email } : {}),
      ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
    };
  }
}
