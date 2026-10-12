// Minimal message formatting, styled like SillyTavern: *italics*, **bold**,
// "quotes", `inline code` and ``` fenced code blocks. Everything else is
// escaped, so model output can never inject HTML.

/** @param {string} text */
export function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** @param {string} text Raw text without code fences */
function formatInline(text) {
    // Pull inline code out first so nothing inside it gets formatted.
    const codeSpans = [];
    let html = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, code) => {
        codeSpans.push(`<code>${code}</code>`);
        return `\u0000${codeSpans.length - 1}\u0000`;
    });

    html = html
        .replace(/\*\*(?!\s)([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*(?![\s*])([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^\w])_(?![\s_])([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>')
        .replace(/(&quot;|“)([^\n]*?)(&quot;|”)/g, '<q>$1$2$3</q>');

    html = html
        .split(/\n{2,}/)
        .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
        .join('');

    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
}

/**
 * Converts message text to safe HTML.
 * @param {string} text
 * @returns {string}
 */
export function formatMessage(text) {
    // Odd indices are fenced code blocks (an unterminated one runs to the end,
    // which keeps code readable while it is still streaming in).
    const parts = String(text ?? '').trim().split(/```([^\n`]*\n?[\s\S]*?)(?:```|$)/g);
    return parts.map((part, i) => {
        if (i % 2 === 0) {
            return part.trim() ? formatInline(part.trim()) : '';
        }
        const code = part.replace(/^[^\n]*\n/, ''); // drop the language tag line
        return `<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
    }).join('');
}
