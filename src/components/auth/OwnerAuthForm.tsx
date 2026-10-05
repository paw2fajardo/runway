"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, LockKeyhole, RefreshCw } from "lucide-react";

type AuthMode = "setup" | "login";
type SetupStatus = "checking" | "ready" | "configured" | "unavailable";

interface OwnerAuthFormProps {
  mode: AuthMode;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function RunwayMark() {
  return (
    <svg viewBox="0 0 88 276" fill="none" className="h-32 w-11 shrink-0 sm:h-44 sm:w-14" aria-hidden="true">
      <path d="M44 9V267" stroke="rgba(187,237,215,.38)" strokeWidth="2" strokeDasharray="3 8" />
      <path d="M24 42H44M44 137H65M24 231H44" stroke="rgba(187,237,215,.46)" strokeWidth="2" />
      <circle cx="44" cy="42" r="8" fill="#bbedd7" />
      <circle cx="44" cy="137" r="11" fill="#e6ac59" />
      <circle cx="44" cy="231" r="8" fill="#bbedd7" />
      <circle cx="44" cy="137" r="4" fill="#072821" />
    </svg>
  );
}

export function OwnerAuthForm({ mode }: OwnerAuthFormProps) {
  const router = useRouter();
  const [setupStatus, setSetupStatus] = useState<SetupStatus>("checking");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");

  const checkSetup = useCallback(async () => {
    setChecking(true);
    setError("");
    setSetupStatus("checking");
    try {
      const response = await fetch("/api/auth/setup", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Runway could not check owner setup."));
      const body = await response.json() as { configured?: unknown };
      if (typeof body.configured !== "boolean") throw new Error("Runway returned an unexpected setup response.");
      setSetupStatus(body.configured ? "configured" : "ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Runway could not check owner setup.");
      setSetupStatus("unavailable");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkSetup();
  }, [checkSetup]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setConfirmationError("");

    if (mode === "setup" && password !== confirmation) {
      setConfirmationError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const message = await readError(
          response,
          mode === "setup" ? "Runway could not finish owner setup." : "Runway could not sign you in.",
        );
        if (mode === "setup" && response.status === 409) {
          setSetupStatus("configured");
          setUsername("");
          setPassword("");
          setConfirmation("");
        } else {
          setError(message);
        }
        return;
      }

      // Credentials remain only in this component's memory and are cleared before navigation.
      setPassword("");
      setConfirmation("");
      setUsername("");
      router.replace(mode === "setup" ? "/login" : "/");
    } catch {
      setError(mode === "setup" ? "Runway could not reach the setup service. Try again." : "Runway could not reach the sign-in service. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const checkingSetup = setupStatus === "checking" || checking;
  const setupClosed = mode === "setup" && setupStatus === "configured";
  const setupUnavailable = setupStatus === "unavailable";

  return (
    <main className="min-h-dvh px-4 py-5 sm:px-8 sm:py-8 lg:grid lg:place-items-center">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/45 shadow-[0_28px_90px_-44px_rgba(7,40,33,.34)] backdrop-blur-xl lg:min-h-[630px] lg:grid-cols-[1.02fr_.98fr]">
        <section className="forest-panel relative flex min-h-[230px] flex-col justify-between overflow-hidden rounded-none border-0 p-6 sm:min-h-[270px] sm:p-9 lg:min-h-0 lg:p-11" aria-label="Runway introduction">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -right-5 -top-12 h-52 w-52 rounded-full border border-white/10" />
          <div className="relative flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/10 text-sm font-bold tracking-tight text-secondary-fixed">R</div>
            <div>
              <p className="text-sm font-bold tracking-[.16em] text-white">RUNWAY</p>
              <p className="text-[11px] font-medium tracking-wide text-white/55">PERSONAL FINANCE</p>
            </div>
          </div>

          <div className="relative mt-8 flex items-center gap-5 lg:mt-0 lg:gap-8">
            <RunwayMark />
            <div className="max-w-sm">
              <p className="mb-3 font-mono text-[10px] font-semibold tracking-[.2em] text-secondary-fixed">MONEY HAS DATES</p>
              <h1 className="max-w-xs text-3xl font-semibold leading-[1.08] tracking-[-.045em] text-white sm:text-4xl lg:text-[3.25rem]">
                See what your balance can carry.
              </h1>
              <p className="mt-4 max-w-xs text-sm leading-6 text-white/65 sm:text-base">
                A private view of what comes in, what goes out, and what remains.
              </p>
            </div>
          </div>

          <div className="relative mt-7 hidden items-center justify-between border-t border-white/15 pt-4 font-mono text-[9px] font-medium tracking-[.16em] text-white/50 lg:flex">
            <span>INCOME</span><span className="h-px flex-1 bg-white/15 mx-3" /><span>RUNWAY</span><span className="h-px flex-1 bg-white/15 mx-3" /><span>DECISIONS</span>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-10 sm:py-10 lg:px-14" aria-label={mode === "setup" ? "Create owner account" : "Owner sign in"}>
          <div className="w-full max-w-[390px]">
            <div className="mb-8 flex items-center gap-2 text-xs font-semibold tracking-[.12em] text-secondary">
              <LockKeyhole size={15} aria-hidden="true" />
              <span>PRIVATE TO YOUR HOME SERVER</span>
            </div>

            {checkingSetup ? (
              <div className="py-10" role="status" aria-live="polite">
                <p className="text-sm font-medium text-secondary">Checking owner setup…</p>
              </div>
            ) : setupUnavailable ? (
              <div className="rounded-2xl border border-outline-variant/70 bg-white/70 p-5" role="alert">
                <div className="flex gap-3">
                  <CircleAlert className="mt-0.5 shrink-0 text-error" size={19} aria-hidden="true" />
                  <div>
                    <h2 className="font-semibold text-on-surface">Setup status is unavailable</h2>
                    <p className="mt-1 text-sm leading-5 text-on-surface-variant">{error}</p>
                  </div>
                </div>
                <button type="button" onClick={() => void checkSetup()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-secondary focus-visible:outline-offset-2">
                  <RefreshCw size={15} aria-hidden="true" /> Try again
                </button>
              </div>
            ) : setupClosed ? (
              <div>
                <p className="font-mono text-[11px] font-semibold tracking-[.15em] text-secondary">OWNER ACCESS</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-on-surface">Setup is complete.</h2>
                <p className="mt-3 text-sm leading-6 text-on-surface-variant">This Runway already has an owner account. Sign in to continue.</p>
                <Link href="/login" className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-on-primary shadow-md shadow-primary/15 transition hover:bg-secondary">
                  Go to sign in <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
            ) : mode === "login" && setupStatus === "ready" ? (
              <div>
                <p className="font-mono text-[11px] font-semibold tracking-[.15em] text-secondary">FIRST VISIT</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-on-surface">Set up your owner account.</h2>
                <p className="mt-3 text-sm leading-6 text-on-surface-variant">Create the one account that protects this private Runway instance.</p>
                <Link href="/setup" className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-on-primary shadow-md shadow-primary/15 transition hover:bg-secondary">
                  Set up Runway <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <>
                <p className="font-mono text-[11px] font-semibold tracking-[.15em] text-secondary">{mode === "setup" ? "FIRST VISIT" : "OWNER ACCESS"}</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-on-surface sm:text-[2.1rem]">
                  {mode === "setup" ? "Set up your Runway." : "Welcome back."}
                </h2>
                <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                  {mode === "setup" ? "Create the owner sign-in for this private instance." : "Sign in to see where your money is headed."}
                </p>

                <form className="mt-8 space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
                  <div>
                    <label htmlFor="owner-username" className="mb-2 block text-sm font-semibold text-on-surface">Username</label>
                    <input
                      id="owner-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      minLength={3}
                      maxLength={80}
                      pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="e.g. alex"
                      className="min-h-12 w-full rounded-xl border border-outline-variant bg-white/80 px-4 text-base text-on-surface placeholder:text-outline focus:border-secondary focus:bg-white focus:outline-none focus:ring-2 focus:ring-secondary/20"
                    />
                    {mode === "setup" ? <p className="mt-2 text-xs leading-5 text-on-surface-variant">3–80 characters; letters, numbers, dots, underscores, and hyphens.</p> : null}
                  </div>

                  <div>
                    <label htmlFor="owner-password" className="mb-2 block text-sm font-semibold text-on-surface">Password</label>
                    <input
                      id="owner-password"
                      name="password"
                      type="password"
                      autoComplete={mode === "setup" ? "new-password" : "current-password"}
                      required
                      minLength={mode === "setup" ? 12 : undefined}
                      maxLength={1024}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="min-h-12 w-full rounded-xl border border-outline-variant bg-white/80 px-4 text-base text-on-surface placeholder:text-outline focus:border-secondary focus:bg-white focus:outline-none focus:ring-2 focus:ring-secondary/20"
                    />
                    {mode === "setup" ? <p className="mt-2 text-xs leading-5 text-on-surface-variant">Use at least 12 characters. Longer passphrases work well.</p> : null}
                  </div>

                  {mode === "setup" ? (
                    <div>
                      <label htmlFor="owner-confirm-password" className="mb-2 block text-sm font-semibold text-on-surface">Confirm password</label>
                      <input
                        id="owner-confirm-password"
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={1024}
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        aria-invalid={Boolean(confirmationError)}
                        aria-describedby={confirmationError ? "owner-confirm-error" : undefined}
                        className="min-h-12 w-full rounded-xl border border-outline-variant bg-white/80 px-4 text-base text-on-surface focus:border-secondary focus:bg-white focus:outline-none focus:ring-2 focus:ring-secondary/20"
                      />
                      {confirmationError ? <p id="owner-confirm-error" className="mt-2 text-sm font-medium text-error" role="alert">{confirmationError}</p> : null}
                    </div>
                  ) : null}

                  {error ? (
                    <div className="flex gap-2.5 rounded-xl border border-error/20 bg-error-container/60 p-3 text-sm leading-5 text-on-error-container" role="alert">
                      <CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{error}</span>
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-on-primary shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 hover:bg-secondary focus-visible:outline-offset-4 disabled:cursor-wait disabled:opacity-65"
                  >
                    {submitting ? (mode === "setup" ? "Creating account…" : "Signing in…") : (mode === "setup" ? "Create owner account" : "Sign in")}
                    {!submitting ? <ArrowRight size={17} aria-hidden="true" /> : null}
                  </button>
                </form>

                {mode === "setup" ? (
                  <p className="mt-7 border-t border-outline-variant/70 pt-5 text-center text-sm text-on-surface-variant">
                    Already set up? <Link href="/login" className="font-bold text-secondary underline decoration-secondary/35 underline-offset-4 hover:decoration-secondary">Sign in</Link>
                  </p>
                ) : null}
              </>
            )}

            <p className="mt-8 font-mono text-[10px] tracking-wide text-outline">YOUR DATA STAYS ON YOUR RUNWAY SERVER</p>
          </div>
        </section>
      </div>
    </main>
  );
}
