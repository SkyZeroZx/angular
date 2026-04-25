/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ControlFlowBlock,
  ControlFlowBlockType,
  DeferBlock,
  ForLoopBlock,
  IfBlock,
} from '../../../../../protocol';

export const BlockType = {
  isDeferBlock(node: ControlFlowBlock | null): node is DeferBlock {
    return !!node && node.type === ControlFlowBlockType.Defer;
  },

  isForLoopBlock(node: ControlFlowBlock | null): node is ForLoopBlock {
    return !!node && node.type === ControlFlowBlockType.For;
  },

  isIfBlock(node: ControlFlowBlock | null): node is IfBlock {
    return !!node && node.type === ControlFlowBlockType.If;
  },
};
