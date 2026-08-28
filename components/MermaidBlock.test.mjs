import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MermaidBlock, CodeBlock } = await jiti.import("./MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

// Simple sequenceDiagram for testing
const mermaidSrc = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`;

function renderMermaid(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MermaidBlock, props),
    ),
  );
}

test("MermaidBlock renders source by default", () => {
  const html = renderMermaid({ code: mermaidSrc });

  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.doesNotMatch(html, /mermaid-block-loading/);
});

test("MermaidBlock can render preview by default", () => {
  const html = renderMermaid({ code: mermaidSrc, defaultPreview: true });

  assert.match(html, />Source</);
  assert.match(html, /mermaid-block-loading/);
  assert.doesNotMatch(html, /Alice/);
});

test("MermaidBlock with isStreaming falls back to source view", () => {
  const html = renderMermaid({ code: mermaidSrc, isStreaming: true, defaultPreview: true });

  assert.match(html, /disabled/);
  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.match(html, /-&gt;&gt;/);
});

test("MermaidBlock renders empty graph without error", () => {
  const html = renderMermaid({ code: "graph TD", defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block-loading/);
});

function renderCode(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(CodeBlock, props),
    ),
  );
}

test("CodeBlock highlights code when not streaming", () => {
  const html = renderCode({ code: "const x = 1;", lang: "javascript" });

  assert.match(html, /class="token/);
  assert.match(html, /const/);
});

test("CodeBlock renders plain text without tokenization while streaming", () => {
  const html = renderCode({ code: "const x = 1;", lang: "javascript", isStreaming: true });

  assert.doesNotMatch(html, /class="token/);
  assert.match(html, /const x = 1;/);
});

const longCodeLine = `const value = "${"x".repeat(200)}";`;

test("CodeBlock wraps long streaming lines instead of scrolling horizontally", () => {
  const html = renderCode({ code: longCodeLine, lang: "javascript", isStreaming: true });

  assert.match(html, /<pre style="[^"]*white-space:pre-wrap/);
  assert.match(html, /<pre style="[^"]*overflow-x:hidden/);
  assert.match(html, /<code style="[^"]*white-space:pre-wrap;overflow-wrap:anywhere/);
  assert.doesNotMatch(html, /overflow-x:auto/);
});

test("CodeBlock wraps long highlighted lines beside the line-number gutter", () => {
  const html = renderCode({ code: longCodeLine, lang: "javascript" });

  assert.match(html, /class="markdown-code-line" style="display:flex"/);
  assert.match(html, /class="markdown-code-line-content" style="[^"]*white-space:pre-wrap;overflow-wrap:anywhere/);
  assert.match(html, /react-syntax-highlighter-line-number/);
  assert.match(html, /class="token/);
  assert.doesNotMatch(html, /overflow-x:auto/);
});

test("CodeBlock uses compact 9px typography in both streaming and settled states", () => {
  for (const isStreaming of [true, false]) {
    const html = renderCode({ code: longCodeLine, lang: "javascript", isStreaming });

    assert.match(html, /font-size:9px/);
    assert.match(html, /line-height:1\.45/);
  }
});

test("MermaidBlock handles Chinese characters in diagram", () => {
  const chineseMermaid = `sequenceDiagram
    participant PC as PC客户端
    PC->>SV: 请求登录`;

  const html = renderMermaid({ code: chineseMermaid, defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block/);
});
