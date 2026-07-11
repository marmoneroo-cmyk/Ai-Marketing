"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setToken } from "@/lib/api";
import { mockLogin } from "@/lib/mock";
import { API_BASE, DEMO_MODE } from "@/lib/env";

/** Standard 4-color Google "G" mark. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1809l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2822-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z"
      />
    </svg>
  );
}

/**
 * "Continue with Google" entry point shared by the signup and login pages
 * (rendered directly above the email form + an "or" divider).
 *
 * In DEMO_MODE there is no real API to redirect to, so a click mints the SAME
 * demo session the password fallback uses (mirrors `login()`'s DEMO_MODE
 * branch in `lib/api.ts`, which signs in with `mockLogin.accessToken` on a
 * connectivity failure) and sends the user straight to the dashboard — the
 * button always "works" in a demo build.
 *
 * Outside demo mode this is a top-level browser navigation
 * (`window.location.href`), not a `fetch`: the API's `/auth/google` route
 * responds with a 302 to Google's consent screen, which only a real
 * navigation can follow. There is no `api.ts` helper for this on purpose —
 * the whole point of the OAuth flow is that the browser itself must leave the
 * page.
 */
export function GoogleAuthButton() {
  const router = useRouter();

  function handleClick(): void {
    if (DEMO_MODE) {
      setToken(mockLogin.accessToken);
      router.push("/dashboard");
      return;
    }
    window.location.href = `${API_BASE}/auth/google`;
  }

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={handleClick}
      >
        <GoogleIcon />
        Continue with Google
      </Button>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium uppercase tracking-wide text-subtle">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
