/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import ts from 'typescript';

import {ErrorCode, ExtendedTemplateDiagnosticName, ngErrorCode} from '../../../../../diagnostics';
import {absoluteFrom, getSourceFileOrError} from '../../../../../file_system';
import {runInEachFileSystem} from '../../../../../file_system/testing';
import {getSourceCodeForDiagnostic} from '../../../../../testing';
import {getClass, setup} from '../../../../testing';
import {factory as platformCheckInControlFlowFactory} from '../../../checks/platform_check_in_control_flow';
import {ExtendedTemplateCheckerImpl} from '../../../src/extended_template_checker';

const COMMON_DTS = `
  export declare function isPlatformBrowser(platformId: object): boolean;
  export declare function isPlatformServer(platformId: object): boolean;
`;

const DEFAULT_SOURCE = `
  import {inject, PLATFORM_ID} from '@angular/core';
  import {isPlatformBrowser, isPlatformServer} from '@angular/common';

  export class TestCmp {
    platformId = inject(PLATFORM_ID);
    isPlatformBrowser = isPlatformBrowser;
    isPlatformServer = isPlatformServer;
    enabled = true;
    items = [1, 2, 3];
  }
`;

runInEachFileSystem(() => {
  describe('PlatformCheckInControlFlowCheck', () => {
    it('binds the error code to its extended template diagnostic name', () => {
      expect(platformCheckInControlFlowFactory.code).toBe(ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW);
      expect(platformCheckInControlFlowFactory.name).toBe(
        ExtendedTemplateDiagnosticName.PLATFORM_CHECK_IN_CONTROL_FLOW,
      );
    });

    it('produces a warning for isPlatformBrowser in an @if condition', () => {
      const diags = setupTestComponent(`@if (isPlatformBrowser(platformId)) { Browser }`);

      expect(diags.length).toBe(1);
      expect(diags[0].category).toBe(ts.DiagnosticCategory.Warning);
      expect(diags[0].code).toBe(ngErrorCode(ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW));
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isPlatformBrowser');
      expect(diags[0].messageText).toContain('Using isPlatformBrowser');
    });

    it('produces a warning for nested platform checks in an @if condition', () => {
      const diags = setupTestComponent(
        `@if (enabled && isPlatformBrowser(platformId)) { Browser }`,
      );

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isPlatformBrowser');
    });

    it('produces a warning for isPlatformServer in an @switch expression', () => {
      const diags = setupTestComponent(`
        @switch (isPlatformServer(platformId) ? 'server' : 'browser') {
          @case ('server') { Server }
        }
      `);

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isPlatformServer');
      expect(diags[0].messageText).toContain('Using isPlatformServer');
    });

    it('produces a warning for platform checks in an @switch case expression', () => {
      const diags = setupTestComponent(`
        @switch ('browser') {
          @case (isPlatformBrowser(platformId) ? 'browser' : 'server') { Browser }
        }
      `);

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isPlatformBrowser');
    });

    it('produces a warning for platform checks in an @for iterable expression', () => {
      const diags = setupTestComponent(`
        @for (item of isPlatformBrowser(platformId) ? items : []; track item) {
          {{ item }}
        }
      `);

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isPlatformBrowser');
    });

    it('produces a warning when the platform id comes from constructor-based DI', () => {
      const diags = setupTestComponent(
        `@if (isPlatformBrowser(platformId)) { Browser }`,
        `
          import {Inject, PLATFORM_ID} from '@angular/core';
          import {isPlatformBrowser} from '@angular/common';

          export class TestCmp {
            constructor(@Inject(PLATFORM_ID) public readonly platformId: object) {}
            isPlatformBrowser = isPlatformBrowser;
          }
        `,
      );

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isPlatformBrowser');
      expect(diags[0].messageText).toContain('Using isPlatformBrowser');
    });

    it('recognizes aliases that resolve to Angular common platform checks', () => {
      const diags = setupTestComponent(
        `@if (browserPlatformCheck(platformId)) { Browser }`,
        `
          import {inject, PLATFORM_ID} from '@angular/core';
          import {isPlatformBrowser as browserPlatformCheck} from '@angular/common';

          export class TestCmp {
            platformId = inject(PLATFORM_ID);
            browserPlatformCheck = browserPlatformCheck;
          }
        `,
      );

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('browserPlatformCheck');
      expect(diags[0].messageText).toContain('Using isPlatformBrowser');
    });

    it('does not warn for platform checks outside control flow', () => {
      const diags = setupTestComponent(`<div>{{ isPlatformBrowser(platformId) }}</div>`);

      expect(diags.length).toBe(0);
    });

    it('does not warn for user-defined functions with the same name', () => {
      const diags = setupTestComponent(
        `@if (isPlatformBrowser(platformId)) { Browser }`,
        `
          import {inject, PLATFORM_ID} from '@angular/core';

          export class TestCmp {
            platformId = inject(PLATFORM_ID);
            isPlatformBrowser(_platformId: object): boolean {
              return true;
            }
          }
        `,
      );

      expect(diags.length).toBe(0);
    });

    it('does not warn for browser globals in control flow', () => {
      const diags = setupTestComponent(`@if (navigator.userAgent) { Browser }`);

      expect(diags.length).toBe(0);
    });

    it('produces a warning for a class field that stores the boolean result of a platform check (inject)', () => {
      const diags = setupTestComponent(
        `
          @if (isBrowser) { <div>Browser</div> }
          @else {  <div>Server</div> }
        `,
        `
          import {inject, PLATFORM_ID} from '@angular/core';
          import {isPlatformBrowser} from '@angular/common';

          export class TestCmp {
            isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
          }
        `,
      );

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isBrowser');
      expect(diags[0].messageText).toContain('Using isPlatformBrowser');
    });

    it('produces a warning for a class field that stores the boolean result of a platform check (constructor-based DI)', () => {
      const diags = setupTestComponent(
        `
          @if (isBrowser) {  <div>Browser</div> }
          @else {  <div>Server</div> }
        `,
        `
          import {Inject, PLATFORM_ID} from '@angular/core';
          import {isPlatformBrowser} from '@angular/common';

          export class TestCmp {
            constructor(@Inject(PLATFORM_ID) public readonly platformId: object) {} 
            isBrowser = isPlatformBrowser(this.platformId);
          }
        `,
      );

      expect(diags.length).toBe(1);
      expect(getSourceCodeForDiagnostic(diags[0])).toBe('isBrowser');
      expect(diags[0].messageText).toContain('Using isPlatformBrowser');
    });

    it('does not warn for a class field initialized from an unrelated function', () => {
      const diags = setupTestComponent(
        `@if (isBrowser) { <div>Browser</div> }`,
        `
          import {inject, PLATFORM_ID} from '@angular/core';

          function someOtherCheck(_id: object): boolean { return true; }

          export class TestCmp {
            private readonly platformId = inject(PLATFORM_ID);
            readonly isBrowser = someOtherCheck(this.platformId);
          }
        `,
      );

      expect(diags.length).toBe(0);
    });
  });
});

function setupTestComponent(template: string, source = DEFAULT_SOURCE) {
  const fileName = absoluteFrom('/main.ts');
  const commonFileName = absoluteFrom('/node_modules/@angular/common/index.d.ts');
  const {program, templateTypeChecker} = setup([
    {
      fileName: commonFileName,
      source: COMMON_DTS,
    },
    {
      fileName,
      templates: {'TestCmp': template},
      source,
    },
  ]);
  const sf = getSourceFileOrError(program, fileName);
  const component = getClass(sf, 'TestCmp');
  const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
    templateTypeChecker,
    program.getTypeChecker(),
    [platformCheckInControlFlowFactory],
    {} /* options */,
  );

  return extendedTemplateChecker.getDiagnosticsForComponent(component);
}
