/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {absoluteFrom} from '@angular/compiler-cli';
import {initMockFileSystem} from '@angular/compiler-cli/private/testing';
import {runTsurgeMigration} from '../../utils/tsurge/testing';
import {ProvideIncrementalHydrationMigration} from './migration';

describe('provide incremental hydration migration', () => {
  beforeEach(() => {
    initMockFileSystem('Native');
  });

  it('should add withNoIncrementalHydration to an empty provideClientHydration', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration()]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration(withNoIncrementalHydration())');
    expect(actual).toMatch(/import \{.*withNoIncrementalHydration.*\}/);
  });

  it('should add withNoIncrementalHydration when other features are present', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration, withEventReplay} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withEventReplay())]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain(
      'provideClientHydration(withNoIncrementalHydration(), withEventReplay())',
    );
    expect(actual).toMatch(/import \{.*withNoIncrementalHydration.*\}/);
  });

  it('should remove withIncrementalHydration as only argument', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration, withIncrementalHydration} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withIncrementalHydration())]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration()');
    expect(actual).not.toContain('withIncrementalHydration');
  });

  it('should remove withIncrementalHydration when used with other features', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration, withIncrementalHydration, withI18nSupport} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withIncrementalHydration(), withI18nSupport())]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration(withI18nSupport())');
    expect(actual).not.toContain('withIncrementalHydration');
  });

  it('should remove withIncrementalHydration when it is the last argument', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration, withIncrementalHydration, withI18nSupport} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withI18nSupport(), withIncrementalHydration())]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration(withI18nSupport())');
    expect(actual).not.toContain('withIncrementalHydration');
  });

  it('should remove withIncrementalHydration between other features', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration, withIncrementalHydration, withI18nSupport, withHttpTransferCacheOptions} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withI18nSupport(), withIncrementalHydration(), withHttpTransferCacheOptions({}))]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain(
      'provideClientHydration(withI18nSupport(), withHttpTransferCacheOptions({}))',
    );
    expect(actual).not.toContain('withIncrementalHydration');
  });

  it('should remove withEventReplay alongside withIncrementalHydration', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration, withIncrementalHydration, withEventReplay} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withIncrementalHydration(), withEventReplay())]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration()');
    expect(actual).not.toContain('withIncrementalHydration');
    expect(actual).not.toContain('withEventReplay');
  });

  it('should remove withEventReplay and withIncrementalHydration but keep other features', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration, withIncrementalHydration, withEventReplay, withI18nSupport} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withEventReplay(), withIncrementalHydration(), withI18nSupport())]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration(withI18nSupport())');
    expect(actual).not.toContain('withIncrementalHydration');
    expect(actual).not.toContain('withEventReplay');
  });

  it('should not modify when withNoIncrementalHydration is already present', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {provideClientHydration, withNoIncrementalHydration} from '@angular/platform-browser';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration(withNoIncrementalHydration())]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration(withNoIncrementalHydration())');
  });

  it('should not modify provideClientHydration from a different module', async () => {
    const {fs} = await runTsurgeMigration(new ProvideIncrementalHydrationMigration(), [
      {
        name: absoluteFrom('/index.ts'),
        isProgramRootFile: true,
        contents: `
        import {AppConfig} from '@angular/core';
        import {provideClientHydration} from './my-module';

        const appConfig: ApplicationConfig = {
          providers: [provideClientHydration()]
        };
          `,
      },
    ]);

    const actual = fs.readFile(absoluteFrom('/index.ts'));
    expect(actual).toContain('provideClientHydration()');
    expect(actual).not.toContain('withNoIncrementalHydration');
  });
});
