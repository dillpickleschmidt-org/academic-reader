import { useState } from "react"
import { AlertCircle } from "lucide-react"
import { z } from "zod"
import { authClient } from "@repo/convex/auth-client"
import { useAppConfig } from "@/hooks/use-app-config"
import { Button } from "@repo/core/ui/primitives/button"
import { Input } from "@repo/core/ui/primitives/input"
import { Label } from "@repo/core/ui/primitives/label"
import { Separator } from "@repo/core/ui/primitives/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@repo/core/ui/primitives/dialog"

// Password schema matching better-auth defaults
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be less than 128 characters")

export function AuthDialog() {
  const { authProviders, isLoading } = useAppConfig()
  const [open, setOpen] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [passwordError, setPasswordError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setPasswordError("")

    // Normalize inputs
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedName = name.trim()
    const normalizedPassword = password.trim()

    // Validate password on sign-up (before loading state)
    if (isSignUp) {
      const result = passwordSchema.safeParse(normalizedPassword)
      if (!result.success) {
        setPasswordError(result.error.issues[0].message)
        return
      }
    }

    setLoading(true)
    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({
          email: normalizedEmail,
          password: normalizedPassword,
          name: normalizedName,
        })
        if (result.error) {
          setError(result.error.message || "Sign up failed")
        } else {
          setOpen(false)
        }
      } else {
        const result = await authClient.signIn.email({
          email: normalizedEmail,
          password: normalizedPassword,
        })
        if (result.error) {
          setError(result.error.message || "Sign in failed")
        } else {
          setOpen(false)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed")
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError("")
    setLoading(true)
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign in failed")
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setEmail("")
    setPassword("")
    setName("")
    setError("")
    setPasswordError("")
    setIsSignUp(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen)
        if (!newOpen) resetForm()
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Login
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isSignUp ? "Create an account" : "Welcome back"}
          </DialogTitle>
          <DialogDescription>
            {isSignUp
              ? "Sign up to start converting documents"
              : "Sign in to your account"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {isLoading ? (
            <>
              <div className="h-11 animate-pulse bg-muted rounded-md" />
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">OR</span>
                <Separator className="flex-1" />
              </div>
            </>
          ) : authProviders.google ? (
            <>
              <Button
                variant="outline"
                className="w-full h-11 gap-2"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  aria-label="Google logo"
                  role="img"
                >
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </Button>

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">OR</span>
                <Separator className="flex-1" />
              </div>
            </>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {isSignUp && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-name">Name</Label>
                <Input
                  id="auth-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required={isSignUp}
                  disabled={loading}
                  className="h-10"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (passwordError) setPasswordError("")
                }}
                placeholder="Enter your password"
                required
                disabled={loading}
                aria-invalid={!!passwordError}
                className="h-10"
              />
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 py-2.5 px-3 bg-destructive/10 rounded-md text-destructive text-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 mt-1"
            >
              {loading ? "Loading..." : isSignUp ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError("")
                setPasswordError("")
              }}
              className="text-foreground underline underline-offset-2 hover:text-foreground/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
