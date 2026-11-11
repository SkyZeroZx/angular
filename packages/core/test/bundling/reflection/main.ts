/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  booleanAttribute,
  Component,
  input,
  Input,
  output,
  reflectComponentType,
} from '@angular/core';

@Component({
  selector: 'catalog-card',
  template: `
    <h2>{{ title() }}</h2>
    <ng-content select="[summary]" />
  `,
})
class CatalogCard {
  readonly title = input('', {alias: 'heading'});
  @Input({alias: 'inactive', transform: booleanAttribute}) disabled = false;
  readonly opened = output<void>({alias: 'cardOpened'});
}

// Metadata consumers do not need to instantiate or render the component.
(globalThis as any).componentCatalog = reflectComponentType(CatalogCard);
