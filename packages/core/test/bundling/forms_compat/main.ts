/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Component, signal} from '@angular/core';
import {required} from '@angular/forms/signals';
import {compatForm} from '@angular/forms/signals/compat';
import {bootstrapApplication} from '@angular/platform-browser';

@Component({
  selector: 'app-root',
  template: `
    <input
      #input
      [value]="profile.name().value()"
      (input)="profile.name().value.set(input.value)"
    />
    {{ profile.name().errors().length }}
  `,
})
class CompatFormsExample {
  readonly model = signal({name: ''});
  readonly profile = compatForm(this.model, (path) => required(path.name));
}

bootstrapApplication(CompatFormsExample);
