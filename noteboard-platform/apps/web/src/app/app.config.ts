import { type ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { ServerApi } from './server/api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Find out whether a Noteboard server is behind this page, and who is signed in, before routing.
    provideAppInitializer(async () => {
      const s = inject(ServerApi);
      await s.init();
      (window as { __nbAdminPath?: string }).__nbAdminPath = s.discovery()?.adminPath ?? '/admin';
    }),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
