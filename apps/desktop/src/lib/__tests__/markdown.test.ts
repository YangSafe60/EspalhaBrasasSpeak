import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";

const html = (s: string) =>
  renderToStaticMarkup(
    createElement(Fragment, null, ...renderMarkdown(s, (t, k) => [createElement(Fragment, { key: k }, t)])),
  );

describe("message formatting", () => {
  it("formats bold, italic, underline, strike and spoilers", () => {
    expect(html("**b** *i* __u__ ~~s~~")).toBe("<strong>b</strong> <em>i</em> <u>u</u> <s>s</s>");
    expect(html("||secret||")).toContain('class="spoiler"');
    expect(html("**bold *and italic***")).toBe("<strong>bold <em>and italic</em></strong>");
  });

  it("keeps code as is", () => {
    expect(html("use `**not bold**` here")).toBe('use <code class="inline-code">**not bold**</code> here');
    expect(html("```js\nconst a = *b*;\n```")).toBe(
      '<pre class="code-block" data-lang="js"><code>const a = *b*;</code></pre>',
    );
  });

  it("leaves links, math and escapes alone", () => {
    expect(html("see https://x.com/a_b__c_d *ok*")).toBe("see https://x.com/a_b__c_d <em>ok</em>");
    expect(html("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(html("\\*not italic\\*")).toBe("*not italic*");
    expect(html("**unclosed")).toBe("**unclosed");
  });

  it("turns > lines into quotes", () => {
    expect(html("> quoted\nnormal")).toBe('<blockquote class="message-quote">quoted</blockquote>normal');
  });
});
