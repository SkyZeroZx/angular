/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {browser, by, element} from 'protractor';

describe('NgOptimizedSource directive', () => {
  it('should render optimized source elements inside a picture', async () => {
    await browser.get('/e2e/picture');

    const widthSource = element(by.css('source[data-test-id="width-srcset"]'));
    const widthSrcset = await widthSource.getAttribute('srcset');
    expect(widthSrcset).toContain('/e2e/a.png?width=100 100w');
    expect(widthSrcset).toContain('/e2e/a.png?width=200 200w');
    expect(await widthSource.getAttribute('sizes')).toBe('100vw');
    expect(await widthSource.getAttribute('media')).toBe('(min-width: 1px)');
    expect(await widthSource.getAttribute('type')).toBe('image/png');

    const autoSource = element(by.css('source[data-test-id="auto-srcset"]'));
    const autoSrcset = await autoSource.getAttribute('srcset');
    expect(autoSrcset).toContain('/e2e/b.png?width=80&height=40 1x');
    expect(autoSrcset).toContain('/e2e/b.png?width=160&height=80 2x');
    expect(await autoSource.getAttribute('width')).toBe('80');
    expect(await autoSource.getAttribute('height')).toBe('40');

    const img = element(by.css('img'));
    expect(await img.getAttribute('src')).toContain('/e2e/logo-500w.jpg');
    expect(await img.getAttribute('fetchpriority')).toBe('high');

    const currentSrc = await browser.executeScript<string>(
      'return document.querySelector("img").currentSrc;',
    );
    expect(currentSrc).toContain('/e2e/a.png?width=');
  });
});
