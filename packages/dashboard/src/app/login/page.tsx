'use strict';
'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/projects';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Simulate login validation
    setTimeout(() => {
      if (!email.includes('@')) {
        setError('Please enter a valid email address.');
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        setLoading(false);
        return;
      }

      // Set a mock supabase cookie to satisfy the session middleware
      document.cookie = "sb-auth-token=mock-auth-token; path=/; max-age=86400; SameSite=Lax";
      
      router.push(redirectTo);
      setLoading(false);
    }, 800);
  };

  const handleMockSSO = (provider: string) => {
    setLoading(true);
    setError('');
    setTimeout(() => {
      document.cookie = "sb-auth-token=mock-sso-token; path=/; max-age=86400; SameSite=Lax";
      router.push(redirectTo);
      setLoading(false);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#1C1917] flex flex-col justify-center items-center px-4 font-sans select-none antialiased">
      {/* Background radial accent */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 via-transparent to-transparent opacity-40 pointer-events-none" />

      <div className="w-full max-w-[400px] bg-white border border-[#E4E3DE] rounded-2xl shadow-xs p-8 relative z-10">
        
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center text-white text-lg font-bold shadow-md tracking-wider mb-3">
            P⚲
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">PromptSonar</h1>
          <p className="text-xs text-[#87827C] mt-1 text-center font-medium">
            LLM Prompt Static Security & Governance
          </p>
        </div>

        {/* Error Callout */}
        {error && (
          <div className="mb-5 bg-red-50 border border-red-200/60 rounded-xl p-3 text-red-700 text-xs font-semibold flex items-center gap-2 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0"></span>
            <span>{error}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="text-[10px] text-[#A8A29E] uppercase tracking-wider font-bold block mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full bg-[#FAF9F6] border border-[#E4E3DE] hover:border-[#87827C]/40 focus:border-slate-900 rounded-lg px-3 py-2 text-xs focus:outline-none transition-colors text-slate-800 placeholder-slate-400 font-medium"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-[#A8A29E] uppercase tracking-wider font-bold block">
                Password
              </label>
              <a href="#" className="text-[10px] text-[#87827C] hover:text-slate-900 transition-colors font-bold">
                Forgot?
              </a>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#FAF9F6] border border-[#E4E3DE] hover:border-[#87827C]/40 focus:border-slate-900 rounded-lg px-3 py-2 text-xs focus:outline-none transition-colors text-slate-800 placeholder-slate-400 font-medium"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-lg text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 shadow-xs mt-2 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        {/* Separator */}
        <div className="relative flex py-5 items-center">
          <div className="flex-grow border-t border-[#E4E3DE]/60"></div>
          <span className="flex-shrink mx-4 text-[9px] text-[#A8A29E] uppercase font-bold tracking-widest">
            or continue with
          </span>
          <div className="flex-grow border-t border-[#E4E3DE]/60"></div>
        </div>

        {/* SSO Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleMockSSO('github')}
            disabled={loading}
            className="border border-[#E4E3DE] hover:bg-slate-50 text-slate-700 font-bold py-2 px-3 rounded-lg text-[10px] tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            GitHub
          </button>

          <button
            onClick={() => handleMockSSO('google')}
            disabled={loading}
            className="border border-[#E4E3DE] hover:bg-slate-50 text-slate-700 font-bold py-2 px-3 rounded-lg text-[10px] tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114-3.41 0-6.191-2.78-6.191-6.19 0-3.41 2.78-6.192 6.191-6.192 1.554 0 2.97.577 4.07 1.536l3.1-3.1C18.966 2.503 15.82 1.2 12.24 1.2c-5.967 0-10.8 4.833-10.8 10.8 0 5.967 4.833 10.8 10.8 10.8 6.277 0 11.238-4.453 11.238-10.8 0-.688-.06-1.353-.162-2.015H12.24z" />
            </svg>
            Google
          </button>
        </div>

        {/* Footer info */}
        <p className="text-[10px] text-[#A8A29E] font-medium text-center mt-6">
          Protected by enterprise SSO gateways. <br/>
          By signing in, you agree to our Terms and Security Policies.
        </p>

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF9F6]" />}>
      <LoginContent />
    </Suspense>
  );
}
