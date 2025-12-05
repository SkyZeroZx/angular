/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ɵFrameworkAgnosticGlobalUtils as FrameworkAgnosticGlobalUtils,
  ɵDeferBlockData as DeferBlockData,
  ɵControlFlowBlockData as ControlFlowBlockData,
  ɵHydratedNode as HydrationNode,
} from '@angular/core';
import {CurrentDeferBlock, HydrationStatus} from '../../../../protocol';

import {ComponentTreeNode} from '../interfaces';
import {ngDebugClient} from '../ng-debug-api/ng-debug-api';
import {isCustomElement} from '../utils';

const extractViewTree = (
  domNode: Node | Element,
  result: ComponentTreeNode[],
  deferBlocks: DeferBlocksIterator,
  controlFlowBlocks: ControlFlowBlocksIterator,
  rootId: number,
  getComponent?: FrameworkAgnosticGlobalUtils['getComponent'],
  getDirectives?: FrameworkAgnosticGlobalUtils['getDirectives'],
  getDirectiveMetadata?: FrameworkAgnosticGlobalUtils['getDirectiveMetadata'],
): ComponentTreeNode[] => {
  // Ignore DOM Node if it came from a different frame. Use instanceof Node to check this.
  if (!(domNode instanceof Node)) {
    return result;
  }

  const directives = getDirectives?.(domNode) ?? [];
  if (!directives.length && !(domNode instanceof Element)) {
    return result;
  }
  const componentTreeNode: ComponentTreeNode = {
    children: [],
    component: null,
    directives: directives.map((dir) => {
      return {
        instance: dir,
        name: dir.constructor.name,
      };
    }),
    element: domNode.nodeName.toLowerCase(),
    nativeElement: domNode,
    hydration: hydrationStatus(domNode),
    defer: null,
  };

  if (!(domNode instanceof Element)) {
    // In case we show the Comment nodes
    result.push(componentTreeNode);
    return result;
  }

  const isDehydratedElement = componentTreeNode.hydration?.status === 'dehydrated';
  const component = getComponent?.(domNode);
  if (component) {
    componentTreeNode.component = {
      instance: component,
      isElement: isCustomElement(domNode),
      name: getDirectiveMetadata?.(component)?.name ?? domNode.nodeName.toLowerCase(),
    };
  }

  const isDisplayableNode = component || componentTreeNode.directives.length || isDehydratedElement;
  if (isDisplayableNode) {
    result.push(componentTreeNode);
  }

  // Nodes that are part of a defer block or control flow block will be added as children
  // of the respective block and should be skipped from the regular code path
  const nodesToSkip = new Set<Node>();
  const appendTo = isDisplayableNode ? componentTreeNode.children : result;

  domNode.childNodes.forEach((node) => {
    // Handle defer blocks
    groupDeferChildrenIfNeeded(
      node,
      nodesToSkip,
      appendTo,
      deferBlocks,
      controlFlowBlocks,
      rootId,
      getComponent,
      getDirectives,
      getDirectiveMetadata,
    );

    // Handle control flow blocks (@for, @if)
    groupControlFlowChildrenIfNeeded(
      node,
      nodesToSkip,
      appendTo,
      controlFlowBlocks,
      deferBlocks,
      rootId,
      getComponent,
      getDirectives,
      getDirectiveMetadata,
    );

    if (!nodesToSkip.has(node)) {
      extractViewTree(
        node,
        appendTo,
        deferBlocks,
        controlFlowBlocks,
        rootId,
        getComponent,
        getDirectives,
        getDirectiveMetadata,
      );
    }
  });

  return result;
};

/**
 * Group Nodes under a defer block if they are part of it.
 *
 * @param node
 * @param nodesToSkip Will mutate the set with the nodes that are grouped into the created block.
 * @param deferBlocks
 * @param controlFlowBlocks
 * @param appendTo
 * @param getComponent
 * @param getDirectives
 * @param getDirectiveMetadata
 */
function groupDeferChildrenIfNeeded(
  node: Node,
  nodesToSkip: Set<Node>,
  appendTo: ComponentTreeNode[],
  deferBlocks: DeferBlocksIterator,
  controlFlowBlocks: ControlFlowBlocksIterator,
  rootId: number,
  getComponent?: FrameworkAgnosticGlobalUtils['getComponent'],
  getDirectives?: FrameworkAgnosticGlobalUtils['getDirectives'],
  getDirectiveMetadata?: FrameworkAgnosticGlobalUtils['getDirectiveMetadata'],
) {
  const currentDeferBlock = deferBlocks.currentBlock;
  const isFirstDefferedChild = node === currentDeferBlock?.rootNodes[0];
  if (isFirstDefferedChild) {
    deferBlocks.advance();

    // When encountering the first child of a defer block
    // We create a synthetic TreeNode reprensenting the defer block
    const childrenTree: ComponentTreeNode[] = [];
    currentDeferBlock.rootNodes.forEach((child) => {
      extractViewTree(
        child,
        childrenTree,
        deferBlocks,
        controlFlowBlocks,
        rootId,
        getComponent,
        getDirectives,
        getDirectiveMetadata,
      );
    });

    const deferBlockTreeNode = {
      children: childrenTree,
      component: null,
      directives: [],
      element: '@defer',
      nativeElement: undefined,
      hydration: null,
      defer: {
        id: `deferId-${rootId}-${deferBlocks.currentIndex}`,
        state: currentDeferBlock.state,
        currentBlock: currentBlock(currentDeferBlock),
        triggers: groupTriggers(currentDeferBlock.triggers),
        blocks: {
          hasErrorBlock: currentDeferBlock.hasErrorBlock,
          placeholderBlock: currentDeferBlock.placeholderBlock,
          loadingBlock: currentDeferBlock.loadingBlock,
        },
      },
    } satisfies ComponentTreeNode;

    currentDeferBlock?.rootNodes.forEach((child) => nodesToSkip.add(child));
    appendTo.push(deferBlockTreeNode);
  }
}

/**
 * Group Nodes under a control flow block (@for, @if) if they are part of it.
 *
 * @param node
 * @param nodesToSkip Will mutate the set with the nodes that are grouped into the created block.
 * @param appendTo
 * @param controlFlowBlocks
 * @param deferBlocks
 * @param rootId
 * @param getComponent
 * @param getDirectives
 * @param getDirectiveMetadata
 */
function groupControlFlowChildrenIfNeeded(
  node: Node,
  nodesToSkip: Set<Node>,
  appendTo: ComponentTreeNode[],
  controlFlowBlocks: ControlFlowBlocksIterator,
  deferBlocks: DeferBlocksIterator,
  rootId: number,
  getComponent?: FrameworkAgnosticGlobalUtils['getComponent'],
  getDirectives?: FrameworkAgnosticGlobalUtils['getDirectives'],
  getDirectiveMetadata?: FrameworkAgnosticGlobalUtils['getDirectiveMetadata'],
) {
  const currentControlFlowBlock = controlFlowBlocks.currentBlock;
  const isFirstControlFlowChild = node === currentControlFlowBlock?.rootNodes[0];
  if (isFirstControlFlowChild) {
    controlFlowBlocks.advance();

    // When encountering the first child of a control flow block
    // We create a synthetic TreeNode representing the control flow block
    const childrenTree: ComponentTreeNode[] = [];
    currentControlFlowBlock.rootNodes.forEach((child) => {
      extractViewTree(
        child,
        childrenTree,
        deferBlocks,
        controlFlowBlocks,
        rootId,
        getComponent,
        getDirectives,
        getDirectiveMetadata,
      );
    });

    const elementName = `@${currentControlFlowBlock.type}`;
    const controlFlowBlockTreeNode = {
      children: childrenTree,
      component: null,
      directives: [],
      element: elementName,
      nativeElement: undefined,
      hydration: null,
      defer: null,
    } satisfies ComponentTreeNode;

    currentControlFlowBlock?.rootNodes.forEach((child) => nodesToSkip.add(child));
    appendTo.push(controlFlowBlockTreeNode);
  }
}

function hydrationStatus(element: Node): HydrationStatus {
  if (!(element instanceof Element)) {
    return null;
  }

  if (!!element.getAttribute('ngh')) {
    return {status: 'dehydrated'};
  }

  const hydrationInfo = (element as HydrationNode).__ngDebugHydrationInfo__;
  switch (hydrationInfo?.status) {
    case 'hydrated':
      return {status: 'hydrated'};
    case 'skipped':
      return {status: 'skipped'};
    case 'mismatched':
      return {
        status: 'mismatched',
        expectedNodeDetails: hydrationInfo.expectedNodeDetails,
        actualNodeDetails: hydrationInfo.actualNodeDetails,
      };
    default:
      return null;
  }
}

function groupTriggers(triggers: string[]) {
  const defer: string[] = [];
  const hydrate: string[] = [];
  const prefetch: string[] = [];

  for (let trigger of triggers) {
    if (trigger.startsWith('hydrate')) {
      hydrate.push(trigger);
    } else if (trigger.startsWith('prefetch')) {
      prefetch.push(trigger);
    } else {
      defer.push(trigger);
    }
  }
  return {defer, hydrate, prefetch};
}

function currentBlock(deferBlock: DeferBlockData): CurrentDeferBlock | null {
  if (['placeholder', 'loading', 'error'].includes(deferBlock.state)) {
    return deferBlock.state as 'placeholder' | 'loading' | 'error';
  }
  return null;
}
export class RTreeStrategy {
  supports(): boolean {
    return (['getDirectiveMetadata', 'getComponent'] as const).every(
      (method) => typeof ngDebugClient()[method] === 'function',
    );
  }

  build(element: Element, rootId: number = 0): ComponentTreeNode[] {
    const ng = ngDebugClient();
    const deferBlocks = ng.ɵgetDeferBlocks?.(element) ?? [];
    const controlFlowBlocks = ng.ɵgetControlFlowBlocks?.(element) ?? [];

    return extractViewTree(
      element,
      [],
      new DeferBlocksIterator(deferBlocks),
      new ControlFlowBlocksIterator(controlFlowBlocks),
      rootId,
      ng.getComponent,
      ng.getDirectives,
      ng.getDirectiveMetadata,
    );
  }
}

class DeferBlocksIterator {
  public currentIndex = 0;
  private blocks: DeferBlockData[] = [];
  constructor(blocks: DeferBlockData[]) {
    this.blocks = blocks;
  }

  advance() {
    this.currentIndex++;
  }

  get currentBlock() {
    return this.blocks[this.currentIndex];
  }
}

class ControlFlowBlocksIterator {
  public currentIndex = 0;
  private blocks: ControlFlowBlockData[] = [];
  constructor(blocks: ControlFlowBlockData[]) {
    this.blocks = blocks;
  }

  advance() {
    this.currentIndex++;
  }

  get currentBlock() {
    return this.blocks[this.currentIndex];
  }
}
