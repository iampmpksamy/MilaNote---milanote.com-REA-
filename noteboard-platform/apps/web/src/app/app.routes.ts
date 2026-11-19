import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes, type UrlSegment } from '@angular/router';
import { BoardsPage } from './boards.page';
import { ServerApi } from './server/api';

/** Boards need a signed-in account in server mode; in local mode they open straight away. */
const signedIn: CanActivateFn = () => {
  const s = inject(ServerApi);
  const router = inject(Router);
  if (s.mode() === 'local') return true;
  // Native apps: choose a server first; an unreachable or unusable server is explained there.
  if (s.native && (s.needsServer() || s.unavailable())) return router.parseUrl('/connect');
  if (s.discovery()?.setupRequired) return router.parseUrl(s.native ? '/connect' : '/setup');
  return s.me() ? true : router.parseUrl('/login');
};

const serverOnly: CanActivateFn = () => {
  const s = inject(ServerApi);
  if (s.native && (s.needsServer() || s.unavailable())) return inject(Router).parseUrl('/connect');
  return s.mode() === 'server' ? true : inject(Router).parseUrl('/');
};

const nativeOnly: CanActivateFn = () => (inject(ServerApi).native ? true : inject(Router).parseUrl('/'));

/** First-run setup needs the token from the server log: done in a browser, not in the apps. */
const browserOnly: CanActivateFn = () => (inject(ServerApi).native ? inject(Router).parseUrl('/connect') : true);

const signedInServer: CanActivateFn = () => {
  const s = inject(ServerApi);
  if (s.mode() !== 'server') return inject(Router).parseUrl('/');
  return s.me() ? true : inject(Router).parseUrl('/login');
};

/** The admin panel lives at the path the server announces (ADMIN_PATH, /admin by default). */
const adminMatcher = (segments: UrlSegment[]) => {
  const path = (window as { __nbAdminPath?: string }).__nbAdminPath ?? '/admin';
  return segments.length === 1 && `/${segments[0].path}` === path ? { consumed: segments } : null;
};

export const routes: Routes = [
  { path: '', component: BoardsPage, canActivate: [signedIn] },
  { path: 'login', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.LoginPage) },
  { path: 'connect', canActivate: [nativeOnly], loadComponent: () => import('./native/connect.page').then((m) => m.ConnectPage) },
  { path: 'setup', canActivate: [serverOnly, browserOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.SetupPage) },
  { path: 'register', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.InvitePage) },
  { path: 'invite/:token', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.InvitePage) },
  { path: 'reset/:token', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.ResetPage) },
  { path: 'verify/:token', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.VerifyPage) },
  { path: 'forgot', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.ForgotPage) },
  { path: 'account', canActivate: [signedInServer], loadComponent: () => import('./server/account.page').then((m) => m.AccountPage) },
  { matcher: adminMatcher, canActivate: [signedInServer, browserOnly], loadComponent: () => import('./server/admin.page').then((m) => m.AdminPage) },
  { path: '**', redirectTo: '' },
];
