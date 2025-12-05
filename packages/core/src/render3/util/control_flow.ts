/*!
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {collectNativeNodes} from '../collect_native_nodes';
import {getLContext} from '../context_discovery';
import {CONTAINER_HEADER_OFFSET, LContainer, NATIVE} from '../interfaces/container';
import {TNode, TNodeFlags} from '../interfaces/node';
import {isLContainer, isLView} from '../interfaces/type_checks';
import {CONTEXT, HEADER_OFFSET, HOST, LView, TVIEW} from '../interfaces/view';
import {RepeaterContext} from '../instructions/control_flow';

/** Internal details for a control flow block. */
interface ControlFlowBlockDetails {
  lContainer: LContainer;
  lView: LView;
  tNode: TNode;
}

/** Retrieved information about a control flow block. */
export interface ControlFlowBlockData {
  /** Type of the control flow block. */
  type: 'for' | 'if';

  /** Element root nodes that are currently being shown in the block. */
  rootNodes: Node[];
}

/**
 * Gets all of the control flow blocks (@for, @if) that are present inside the specified DOM node.
 * @param node Node in which to look for control flow blocks.
 *
 * @publicApi
 */
export function getControlFlowBlocks(node: Node): ControlFlowBlockData[] {
  const results: ControlFlowBlockData[] = [];
  const lView = getLContext(node)?.lView;

  if (lView) {
    findControlFlowBlocks(node, lView, results);
  }

  return results;
}

/**
 * Finds all the control flow blocks inside a specific node and view.
 * @param node Node in which to search for blocks.
 * @param lView View within the node in which to search for blocks.
 * @param results Array to which to add blocks once they're found.
 */
function findControlFlowBlocks(node: Node, lView: LView, results: ControlFlowBlockData[]) {
  // First, collect all control flow blocks in this view
  const blocks: ControlFlowBlockDetails[] = [];
  getControlFlowBlocksInternal(lView, blocks);

  for (const details of blocks) {
    const native = details.lContainer[NATIVE] as Node;

    // Filter out control flow blocks that aren't inside the specified root node.
    if (!node.contains(native)) {
      continue;
    }

    // Collect root nodes from the rendered views
    const rootNodes: Node[] = [];
    for (let i = CONTAINER_HEADER_OFFSET; i < details.lContainer.length; i++) {
      const view = details.lContainer[i];
      if (isLView(view)) {
        collectNativeNodes(view[TVIEW], view, view[TVIEW].firstChild, rootNodes);
      }
    }

    // Determine the type of control flow block
    const firstView =
      details.lContainer.length > CONTAINER_HEADER_OFFSET
        ? details.lContainer[CONTAINER_HEADER_OFFSET]
        : null;

    let type: 'for' | 'if' = 'if';
    if (firstView && isLView(firstView)) {
      const context = firstView[CONTEXT];
      if (context instanceof RepeaterContext) {
        type = 'for';
      }
    }

    results.push({type, rootNodes});

    // Recurse into nested views
    for (let i = CONTAINER_HEADER_OFFSET; i < details.lContainer.length; i++) {
      const view = details.lContainer[i];
      if (isLView(view)) {
        findControlFlowBlocks(node, view, results);
      }
    }
  }
}

/**
 * Retrieves all control flow blocks in a given LView.
 * Follows the same pattern as getDeferBlocks in defer/discovery.ts.
 */
function getControlFlowBlocksInternal(lView: LView, blocks: ControlFlowBlockDetails[]) {
  const tView = lView[TVIEW];

  for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
    if (isLContainer(lView[i])) {
      const lContainer = lView[i];
      const tNode = tView.data[i] as TNode;

      // Check if this is a control flow start node (@for or @if)
      if (tNode.flags & TNodeFlags.isControlFlowStart) {
        blocks.push({lContainer, lView, tNode});
      }

      // The host can be an `LView` if this is the container
      // for a component that injects `ViewContainerRef`.
      if (isLView(lContainer[HOST])) {
        getControlFlowBlocksInternal(lContainer[HOST], blocks);
      }

      for (let j = CONTAINER_HEADER_OFFSET; j < lContainer.length; j++) {
        const view = lContainer[j];
        if (isLView(view)) {
          getControlFlowBlocksInternal(view, blocks);
        }
      }
    } else if (isLView(lView[i])) {
      // This is a component, enter the recursively.
      getControlFlowBlocksInternal(lView[i], blocks);
    }
  }
}
