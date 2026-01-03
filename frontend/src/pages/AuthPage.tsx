import { useState } from "react"
import { AlertCircle } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

export function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({
          email,
          password,
          name,
        })
        if (result.error) {
          setError(result.error.message || "Sign up failed")
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
        })
        if (result.error) {
          setError(result.error.message || "Sign in failed")
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

  return (
    <div className="min-h-screen flex flex-col p-6 px-5 bg-background">
      <div className="flex items-center gap-2 text-base font-medium text-muted-foreground">
        Academic Reader
      </div>

      <main className="flex flex-col items-center justify-center flex-1 pb-16">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              {isSignUp ? "Create an account" : "Welcome back"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isSignUp
                ? "Sign up to start converting documents"
                : "Sign in to your account"}
            </p>
          </div>

          <Button
            variant="outline"
            className="w-full h-11 gap-2"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="size-4" viewBox="0 0 24 24" aria-label="Google logo" role="img">
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

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {isSignUp && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required={isSignUp}
                  className="h-10"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                className="h-10"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 py-2.5 px-3 bg-destructive/10 rounded-md text-destructive text-sm">
                <AlertCircle
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.5}
                />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 mt-1"
            >
              {loading
                ? "Loading..."
                : isSignUp
                  ? "Create account"
                  : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError("")
              }}
              className="text-foreground underline underline-offset-2 hover:text-foreground/80"
            >
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
