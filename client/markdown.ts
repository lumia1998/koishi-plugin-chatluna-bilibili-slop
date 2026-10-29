/**
 * 日报正文只用到很窄的一段 Markdown（标题 / 列表 / 粗体 / 链接 / 引用 / 代码块），
 * 与其引一个解析库，不如自己转一遍——顺便把 HTML 全部转义掉，`v-html` 才安全。
 */

const ESCAPES: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

function escape(text: string) {
    return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

/** 行内语法：先抽走 `code`，其它规则就不会误伤里面的内容 */
function inline(text: string) {
    let out = escape(text)
    const codes: string[] = []
    out = out.replace(/`([^`]+)`/g, (_, code: string) => {
        codes.push(code)
        return `\u0000${codes.length - 1}\u0000`
    })
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    // 裸链接：已经生成的 <a href="..."> 前面是引号，排除掉，免得二次包装
    out = out.replace(/(^|[^\w"'(<\]])(https?:\/\/[^\s<)"']+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    out = out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => `<code>${codes[Number(index)]}</code>`)
    return out
}

/** Markdown → 安全的 HTML 片段 */
export function renderMarkdown(source: string): string {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n')
    const out: string[] = []
    let list: 'ul' | 'ol' | null = null
    let fence: string[] | null = null
    let quote: string[] | null = null

    const flushList = () => {
        if (list) { out.push(`</${list}>`); list = null }
    }
    const flushQuote = () => {
        if (quote) { out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = null }
    }

    for (const raw of lines) {
        const line = raw.trimEnd()

        if (fence) {
            if (/^\s*```/.test(line)) {
                out.push(`<pre><code>${escape(fence.join('\n'))}</code></pre>`)
                fence = null
            } else fence.push(raw)
            continue
        }
        if (/^\s*```/.test(line)) { flushList(); flushQuote(); fence = []; continue }
        if (!line.trim()) { flushList(); flushQuote(); continue }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
            flushList(); flushQuote()
            // 页面自己已经有 h3 标题，正文从 h2 起
            const level = Math.min(heading[1].length + 1, 6)
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
            continue
        }

        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushList(); flushQuote(); out.push('<hr>'); continue }

        const quoted = /^>\s?(.*)$/.exec(line)
        if (quoted) { flushList(); (quote ??= []).push(quoted[1]); continue }
        flushQuote()

        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
        if (bullet) {
            if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul' }
            out.push(`<li>${inline(bullet[1])}</li>`)
            continue
        }

        const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
        if (ordered) {
            if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol' }
            out.push(`<li>${inline(ordered[1])}</li>`)
            continue
        }

        flushList()
        out.push(`<p>${inline(line)}</p>`)
    }

    if (fence) out.push(`<pre><code>${escape(fence.join('\n'))}</code></pre>`)
    flushList()
    flushQuote()
    return out.join('\n')
}
