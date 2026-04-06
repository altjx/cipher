import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(currentDir, 'MessageBubble.tsx');

async function readSource() {
  return readFile(sourcePath, 'utf8');
}

function parseSource(source) {
  return ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function getClassNameText(node, sourceFile) {
  const attributes = node.openingElement ? node.openingElement.attributes.properties : node.attributes.properties;
  const className = attributes.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.text === 'className'
  );

  if (!className?.initializer) return null;
  if (ts.isStringLiteral(className.initializer)) return className.initializer.text;
  if (ts.isJsxExpression(className.initializer)) return className.initializer.expression?.getText(sourceFile) ?? '';
  return className.initializer.getText(sourceFile);
}

function isDivElement(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText() === 'div';
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText() === 'div';
  return false;
}

function collectDivElements(node, result = []) {
  if (isDivElement(node)) result.push(node);
  ts.forEachChild(node, (child) => {
    collectDivElements(child, result);
  });
  return result;
}

function findDiv(sourceFile, predicate) {
  return collectDivElements(sourceFile).find((node) => predicate(getClassNameText(node, sourceFile) ?? '', node));
}

function hasAncestor(node, target) {
  let current = node.parent;
  while (current) {
    if (current === target) return true;
    current = current.parent;
  }
  return false;
}

test('keeps floating reactions outside the clipped bubble surface', async () => {
  const sourceFile = parseSource(await readSource());
  const outerWrapper = findDiv(
    sourceFile,
    (className) => className.includes('relative') && className.includes("message.reactions.length > 0 ? 'mb-3' : ''")
  );
  const innerBubble = findDiv(
    sourceFile,
    (className, node) => className.includes('overflow-hidden') && hasAncestor(node, outerWrapper)
  );
  const reactionRow = findDiv(
    sourceFile,
    (className) => className.includes('absolute') && className.includes('-bottom-3') && className.includes('z-10')
  );

  assert.ok(outerWrapper, 'expected a wrapper that owns the reaction offset margin');
  assert.ok(innerBubble, 'expected a clipped inner bubble surface inside the wrapper');
  assert.ok(reactionRow, 'expected a floating reaction row');
  assert.ok(!getClassNameText(outerWrapper, sourceFile)?.includes('overflow-hidden'), 'the outer wrapper should stay overflow-visible');
  assert.ok(hasAncestor(innerBubble, outerWrapper), 'the clipped bubble surface should live inside the wrapper');
  assert.ok(hasAncestor(reactionRow, outerWrapper), 'the reaction row should belong to the wrapper');
  assert.ok(!hasAncestor(reactionRow, innerBubble), 'the reaction row should not be clipped by the bubble surface');
});

test('renders floating reactions above neighboring messages', async () => {
  const sourceFile = parseSource(await readSource());
  const reactionRow = findDiv(
    sourceFile,
    (className) => className.includes('absolute') && className.includes('-bottom-3')
  );

  assert.ok(reactionRow, 'expected a floating reaction row');
  assert.ok(getClassNameText(reactionRow, sourceFile)?.includes('z-10'), 'floating reactions should have an explicit stacking order');
});
