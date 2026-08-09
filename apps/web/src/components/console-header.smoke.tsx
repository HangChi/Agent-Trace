import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const renderedProps: Array<Record<string, unknown>> = [];
const instrumentedReact = {
  ...React,
  createElement(
    type: React.ElementType,
    props: Record<string, unknown> | null,
    ...children: React.ReactNode[]
  ) {
    if (props) {
      renderedProps.push(props);
    }
    return React.createElement(type, props, ...children);
  }
};

(globalThis as typeof globalThis & { React: typeof React }).React =
  instrumentedReact as typeof React;

const { ConsoleHeader } = await import("./console-header");

const noticeId = "coming-soon-notice";
const entries = [
  { route: "/analytics", zh: "分析", en: "Analytics" },
  { route: "/evaluations", zh: "评测", en: "Evaluations" },
  { route: "/sandbox", zh: "回放", en: "Replay" },
  { route: "/maintenance", zh: "维护", en: "Maintenance" }
] as const;

for (const [locale, prompt] of [
  ["zh", "敬请期待"],
  ["en", "Coming soon"]
] as const) {
  renderedProps.length = 0;
  const markup = renderToStaticMarkup(
    React.createElement(ConsoleHeader, { locale, path: "/runs" })
  );

  for (const entry of entries) {
    const label = entry[locale];
    assert.ok(markup.includes(`>${label}</span>`), `${locale} header should keep the ${label} label.`);
    assert.ok(
      !markup.includes(`href="${entry.route}`),
      `${locale} ${entry.route} entry should not navigate while it is unavailable.`
    );
  }

  const noticeControls = renderedProps.filter(
    (props) => props.popoverTarget === noticeId && props.popoverTargetAction !== "hide"
  );
  assert.equal(noticeControls.length, 4, `${locale} header should open the custom notice from four controls.`);
  for (const control of noticeControls) {
    assert.equal(control.type, "button");
    assert.equal(control.onClick, undefined, "Coming-soon controls must not call a native alert handler.");
  }

  const notice = renderedProps.find((props) => props.id === noticeId);
  assert.equal(notice?.popover, "auto", `${locale} notice should support light dismiss and Escape.`);
  assert.equal(notice?.role, "status", `${locale} notice should be announced without blocking interaction.`);
  assert.ok(markup.includes(`>${prompt}</p>`), `${locale} header should render the custom prompt.`);
}

console.log("console header smoke tests passed");
