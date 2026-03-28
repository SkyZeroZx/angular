/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {DOCUMENT} from '@angular/common';
import {HttpClient, HttpTransferCacheOptions, provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {
  ApplicationRef,
  Component,
  Injectable,
  PLATFORM_ID,
  ɵIS_INCREMENTAL_HYDRATION_ENABLED as IS_INCREMENTAL_HYDRATION_ENABLED,
  ɵSSR_CONTENT_INTEGRITY_MARKER as SSR_CONTENT_INTEGRITY_MARKER,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {withBody} from '@angular/private/testing';
import {BehaviorSubject} from 'rxjs';

import {provideClientHydration, withNoHttpTransferCache} from '../public_api';
import {
  withHttpTransferCacheOptions,
  withIncrementalHydration,
  withNoIncrementalHydration,
} from '../src/hydration';

describe('provideClientHydration', () => {
  @Component({
    selector: 'test-hydrate-app',
    template: '',
    standalone: false,
  })
  class SomeComponent {}

  function makeRequestAndExpectOne(
    url: string,
    body: string,
    options: HttpTransferCacheOptions | boolean = true,
  ): void {
    TestBed.inject(HttpClient).get(url, {transferCache: options}).subscribe();
    TestBed.inject(HttpTestingController).expectOne(url).flush(body);
  }

  function makeRequestAndExpectNone(
    url: string,
    options: HttpTransferCacheOptions | boolean = true,
  ): void {
    TestBed.inject(HttpClient).get(url, {transferCache: options}).subscribe();
    TestBed.inject(HttpTestingController).expectNone(url);
  }

  @Injectable()
  class ApplicationRefPatched extends ApplicationRef {
    override get isStable() {
      return new BehaviorSubject(false);
    }
  }

  beforeEach(() => {
    globalThis['ngServerMode'] = true;
  });

  afterEach(() => {
    globalThis['ngServerMode'] = undefined;
  });

  describe('default', () => {
    beforeEach(
      withBody(
        `<!--${SSR_CONTENT_INTEGRITY_MARKER}--><test-hydrate-app></test-hydrate-app>`,
        () => {
          TestBed.resetTestingModule();

          TestBed.configureTestingModule({
            declarations: [SomeComponent],
            providers: [
              {provide: PLATFORM_ID, useValue: 'server'},
              {provide: DOCUMENT, useFactory: () => document},
              {provide: ApplicationRef, useClass: ApplicationRefPatched},
              provideClientHydration(),
              provideHttpClient(),
              provideHttpClientTesting(),
            ],
          });

          const appRef = TestBed.inject(ApplicationRef);
          appRef.bootstrap(SomeComponent);
        },
      ),
    );

    it(`should use cached HTTP calls`, () => {
      makeRequestAndExpectOne('/test-1', 'foo');
      // Do the same call, this time it should served from cache.
      makeRequestAndExpectNone('/test-1');
    });
  });

  describe('withNoHttpTransferCache', () => {
    beforeEach(
      withBody(
        `<!--${SSR_CONTENT_INTEGRITY_MARKER}--><test-hydrate-app></test-hydrate-app>`,
        () => {
          TestBed.resetTestingModule();

          TestBed.configureTestingModule({
            declarations: [SomeComponent],
            providers: [
              {provide: PLATFORM_ID, useValue: 'server'},
              {provide: DOCUMENT, useFactory: () => document},
              {provide: ApplicationRef, useClass: ApplicationRefPatched},
              provideClientHydration(withNoHttpTransferCache()),
              provideHttpClient(),
              provideHttpClientTesting(),
            ],
          });

          const appRef = TestBed.inject(ApplicationRef);
          appRef.bootstrap(SomeComponent);
        },
      ),
    );

    it(`should not cache HTTP calls`, () => {
      makeRequestAndExpectOne('/test-1', 'foo', false);
      // Do the same call, this time should pass through as cache is disabled.
      makeRequestAndExpectOne('/test-1', 'foo');
    });
  });

  describe('withHttpTransferCacheOptions', () => {
    beforeEach(
      withBody(
        `<!--${SSR_CONTENT_INTEGRITY_MARKER}--><test-hydrate-app></test-hydrate-app>`,
        () => {
          TestBed.resetTestingModule();

          TestBed.configureTestingModule({
            declarations: [SomeComponent],
            providers: [
              {provide: PLATFORM_ID, useValue: 'server'},
              {provide: DOCUMENT, useFactory: () => document},
              {provide: ApplicationRef, useClass: ApplicationRefPatched},
              provideClientHydration(
                withHttpTransferCacheOptions({includePostRequests: true, includeHeaders: ['foo']}),
              ),
              provideHttpClient(),
              provideHttpClientTesting(),
            ],
          });

          const appRef = TestBed.inject(ApplicationRef);
          appRef.bootstrap(SomeComponent);
        },
      ),
    );

    it(`should cache HTTP POST calls`, () => {
      const url = '/test-1';
      const body = 'foo';
      TestBed.inject(HttpClient).post(url, body).subscribe();
      TestBed.inject(HttpTestingController).expectOne(url).flush(body);

      TestBed.inject(HttpClient).post(url, body).subscribe();
      TestBed.inject(HttpTestingController).expectNone(url);
    });
  });

  describe('incremental hydration default', () => {
    beforeEach(
      withBody(
        `<!--${SSR_CONTENT_INTEGRITY_MARKER}--><test-hydrate-app></test-hydrate-app>`,
        () => {
          TestBed.resetTestingModule();

          TestBed.configureTestingModule({
            declarations: [SomeComponent],
            providers: [
              {provide: PLATFORM_ID, useValue: 'server'},
              {provide: DOCUMENT, useFactory: () => document},
              {provide: ApplicationRef, useClass: ApplicationRefPatched},
              provideClientHydration(),
              provideHttpClient(),
              provideHttpClientTesting(),
            ],
          });

          const appRef = TestBed.inject(ApplicationRef);
          appRef.bootstrap(SomeComponent);
        },
      ),
    );

    it('should enable incremental hydration by default', () => {
      expect(TestBed.inject(IS_INCREMENTAL_HYDRATION_ENABLED)).toBe(true);
    });
  });

  describe('withNoIncrementalHydration', () => {
    beforeEach(
      withBody(
        `<!--${SSR_CONTENT_INTEGRITY_MARKER}--><test-hydrate-app></test-hydrate-app>`,
        () => {
          TestBed.resetTestingModule();

          TestBed.configureTestingModule({
            declarations: [SomeComponent],
            providers: [
              {provide: PLATFORM_ID, useValue: 'server'},
              {provide: DOCUMENT, useFactory: () => document},
              {provide: ApplicationRef, useClass: ApplicationRefPatched},
              provideClientHydration(withNoIncrementalHydration()),
              provideHttpClient(),
              provideHttpClientTesting(),
            ],
          });

          const appRef = TestBed.inject(ApplicationRef);
          appRef.bootstrap(SomeComponent);
        },
      ),
    );

    it('should disable incremental hydration when withNoIncrementalHydration is used', () => {
      // IS_INCREMENTAL_HYDRATION_ENABLED is not provided when incremental hydration is disabled,
      // so it should not be found in the injector.
      const isEnabled = TestBed.inject(IS_INCREMENTAL_HYDRATION_ENABLED, false, {optional: true});
      expect(isEnabled).toBe(false);
    });
  });

  describe('withIncrementalHydration and withNoIncrementalHydration conflict', () => {
    it('should throw when both withIncrementalHydration and withNoIncrementalHydration are used', () => {
      expect(() => {
        provideClientHydration(withIncrementalHydration(), withNoIncrementalHydration());
      }).toThrowError(/found both withIncrementalHydration\(\) and withNoIncrementalHydration\(\)/);
    });
  });
});
