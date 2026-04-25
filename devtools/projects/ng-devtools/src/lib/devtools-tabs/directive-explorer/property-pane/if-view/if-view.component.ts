/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Component, input} from '@angular/core';
import {MatToolbar} from '@angular/material/toolbar';

import {IfBlock, IfBranch} from '../../../../../../../protocol';

@Component({
  templateUrl: './if-view.component.html',
  selector: 'ng-if-view',
  styleUrls: ['./if-view.component.scss', '../styles/view-tab.scss'],
  imports: [MatToolbar],
})
export class IfViewComponent {
  protected readonly ifBlock = input.required<NonNullable<IfBlock>>();

  protected branchLabel(branch: IfBranch, total: number): string {
    if (branch.index === 0) {
      return '@if';
    }
    if (branch.index === total - 1) {
      return '@else';
    }
    return '@else if';
  }
}
