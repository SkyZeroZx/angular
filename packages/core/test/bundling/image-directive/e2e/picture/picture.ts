/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  IMAGE_LOADER,
  ImageLoaderConfig,
  NgOptimizedImage,
  NgOptimizedSource,
} from '@angular/common';
import {Component} from '../../../../../src/core';

function pictureImageLoader(config: ImageLoaderConfig): string {
  const params: string[] = [];
  if (config.width !== undefined) {
    params.push(`width=${config.width}`);
  }
  if (config.height !== undefined) {
    params.push(`height=${config.height}`);
  }
  return params.length ? `${config.src}?${params.join('&')}` : config.src;
}

@Component({
  selector: 'picture-test',
  imports: [NgOptimizedImage, NgOptimizedSource],
  template: `
    <picture>
      <source
        data-test-id="width-srcset"
        ngSrc="/e2e/a.png"
        ngSrcset="100w, 200w"
        sizes="100vw"
        media="(min-width: 1px)"
        type="image/png"
      />
      <source data-test-id="auto-srcset" ngSrc="/e2e/b.png" width="80" height="40" />
      <img ngSrc="/e2e/logo-500w.jpg" width="150" height="150" priority />
    </picture>
  `,
  providers: [{provide: IMAGE_LOADER, useValue: pictureImageLoader}],
})
export class PictureComponent {}
