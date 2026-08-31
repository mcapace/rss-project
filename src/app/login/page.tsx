"use client";

import { useState, useTransition, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ArrowRight, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CorporateLogo } from "@/components/ui/CorporateLogo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/admin";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "Invalid password");
        }

        router.push(redirectUrl);
        router.refresh();
      } catch (err: any) {
        setError(err.message || "Failed to authenticate");
      }
    });
  };

  return (
    <main className="flex-1 max-w-md w-full mx-auto px-4 py-20 flex flex-col items-center justify-center space-y-6">
      <div className="text-center space-y-3 flex flex-col items-center">
        <CorporateLogo height={20} onDark />
        <div className="space-y-1">
          <h1 className="font-serif text-2xl text-[#EDEDED] font-normal tracking-tight">
            Digital Editions Access
          </h1>
          <p className="text-xs text-[#9A9AA0]">
            Enter administrative password to manage issues and publishing pipelines.
          </p>
        </div>
      </div>

      <Card elevated padding="lg" className="w-full space-y-6">
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#9A9AA0]">
              Admin Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#9A9AA0]">
                <Lock className="w-4 h-4 text-[#C9A227]" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                autoFocus
                className="w-full pl-10 pr-4 py-2.5 bg-[#0A0A0B] border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-[#EDEDED] placeholder-[#6B6B72] focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.25)] text-[#F87171] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isPending}
            className="w-full justify-center"
          >
            <span>Authenticate</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </form>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-xs text-[#9A9AA0]">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
