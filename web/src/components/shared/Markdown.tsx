// Markdown renderer with syntax highlighting and XSS sanitization
import { createMemo } from 'solid-js';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

interface MarkdownProps {
  content: string;
  class?: string;
  /** Raw HTML to inject inline at the end of the last block element (e.g. a streaming cursor) */
  injectHtml?: string;
}

// Configure marked with syntax highlighting
const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : '';
      const highlighted = language
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;

      return `<div class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${language}</span></div><pre><code class="hljs ${language ? `language-${language}` : ''}">${highlighted}</code></pre></div>`;
    },
    codespan({ text }: { text: string }) {
      return `<code>${text}</code>`;
    },
  },
});

/**
 * Inject HTML right before the last closing block tag so it appears
 * inline with the final rendered characters.
 */
function appendInline(html: string, extra: string): string {
  // Match the last closing block-level tag (possibly followed by more closing tags and whitespace)
  const match = html.match(/<\/(p|li|h[1-6]|pre|div|blockquote|td|code)>(\s*(<\/[^>]+>))*\s*$/i);
  if (match) {
    const pos = html.lastIndexOf(match[0]);
    return html.slice(0, pos) + extra + html.slice(pos);
  }
  return html + extra;
}

export default function Markdown(props: MarkdownProps) {
  let ref: HTMLDivElement | undefined;

  const html = createMemo(() => {
    let result: string;
    try {
      result = marked.parse(props.content || '', { async: false }) as string;
    } catch {
      result = props.content || '';
    }
    // Sanitize rendered HTML to prevent XSS from agent/LLM output
    result = DOMPurify.sanitize(result, {
      ADD_TAGS: ['code', 'pre'],
      ADD_ATTR: ['class'],
    });
    if (props.injectHtml) {
      result = appendInline(result, props.injectHtml);
    }
    return result;
  });

  return (
    <div
      ref={ref}
      class={`md-prose ${props.class || ''}`}
      innerHTML={html()}
    />
  );
}
