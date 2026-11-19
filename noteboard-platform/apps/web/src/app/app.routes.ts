import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes, type UrlSegment } from '@angular/router';
import { BoardsPage } from './boards.page';
import { ServerApi } from './server/api';

/** Boards need a signed-in account in server mode; in local mode they open straight away. */
const signedIn: CanActivateFn = () => {
  const s = inject(ServerApi);
  const router = inject(Router);
  if (s.mode() === 'local') return true;
  if (s.discovery()?.setupRequired) return router.parseUrl('/setup');
  return s.me() ? true : router.parseUrl('/login');
};

const serverOnly: CanActivateFn = () => (inject(ServerApi).mode() === 'server' ? true : inject(Router).parseUrl('/'));

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
  { path: 'setup', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.SetupPage) },
  { path: 'register', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.InvitePage) },
  { path: 'invite/:token', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.InvitePage) },
  { path: 'reset/:token', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.ResetPage) },
  { path: 'verify/:token', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.VerifyPage) },
  { path: 'forgot', canActivate: [serverOnly], loadComponent: () => import('./server/auth.pages').then((m) => m.ForgotPage) },
  { path: 'account', canActivate: [signedInServer], loadComponent: () => import('./server/account.page').then((m) => m.AccountPage) },
  { matcher: adminMatcher, canActivate: [signedInServer], loadComponent: () => import('./server/admin.page').then((m) => m.AdminPage) },
  { path: '**', redirectTo: '' },
];
