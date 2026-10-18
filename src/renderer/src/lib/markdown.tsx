import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Claude's answers are markdown. Raw HTML in them is not rendered (react-markdown's default), and
// links open in the browser rather than inside the app.
const components = (openLink: (url: string) => void): Components => ({
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 text-[14px] font-semibold">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-[14px] font-semibold">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-stamp underline"
      onClick={(e) => {
        e.preventDefault()
        if (href && /^https?:\/\//i.test(href)) openLink(href)
      }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-sheet px-1 py-0.5 text-[13px]">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-sheet p-2 text-[13px]">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-rule-strong pl-3 text-ink-muted">{children}</blockquote>,
  hr: () => <hr className="my-3 border-rule" />,
  // Never load images from an answer: text from an email could plant one whose address carries
  // figures to someone else's server. Show its description instead.
  img: ({ alt }) => (alt ? <span className="text-ink-muted">[{alt}]</span> : null),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="num w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b border-rule-strong px-2 py-1 text-left font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-rule px-2 py-1 align-top">
      {children}
    </td>
  )
})

/** One chat answer from Claude, as formatted text. Shared by the desktop and the phone app. */
export function ChatMarkdown({ text, openLink }: { text: string; openLink: (url: string) => void }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components(openLink)}>
      {text}
    </Markdown>
  )
}
