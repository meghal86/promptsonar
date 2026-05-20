import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Define protected dashboard scopes
  const protectedPaths = ['/projects', '/policies', '/settings/billing', '/risk-registry'];
  const isProtected = protectedPaths.some(path => pathname.startsWith(path) || pathname === '/');

  // Supabase standard cookies usually start with 'sb-' or contain 'token' / 'session'
  const cookies = request.cookies.getAll();
  const hasSession = cookies.some(
    cookie => 
      cookie.name.startsWith('sb-') || 
      cookie.name.includes('token') || 
      cookie.name.includes('session')
  );

  // If visiting a protected page without an active session cookie, redirect to /login
  if (isProtected && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    // Remember the original page to redirect back after login
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If visiting /login and already have a session, redirect to /projects
  if (pathname === '/login' && hasSession) {
    return NextResponse.redirect(new URL('/projects', request.url));
  }

  return NextResponse.next();
}

// Ensure middleware runs for dashboard views, excluding static assets, images, and API routes
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon.png|screenshot-cli-fail.png|screenshot-vscode-squiggles.png|promptsonar_cover.png|promptsonar_cover_1.jpg|promptsonar_cover_1.png).*)',
  ],
};
