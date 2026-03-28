import {ApplicationConfig, provideBrowserGlobalErrorListeners} from '@angular/core';
import {provideDeferBlockLoadingInterceptor} from '@angular/core';
import {provideRouter} from '@angular/router';

import {routes} from './app.routes';
import {provideClientHydration, withEventReplay} from '@angular/platform-browser';
import {provideHttpClient, withFetch} from '@angular/common/http';
import {RetryDeferLoadingInterceptor} from './defer-demo/retry-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideClientHydration(withEventReplay()),
    provideDeferBlockLoadingInterceptor(RetryDeferLoadingInterceptor),
  ],
};
