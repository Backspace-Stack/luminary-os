// ============================================================
// Markdown — Chat message renderer.
//
// GitHub-flavored Markdown with syntax-highlighted code blocks
// and a copy button on every block. Styled to match the
// Luminary dark design language (see .lum-md in index.css).
// ============================================================

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check } from 'lucide-react';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (non-secure context) — fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.button
      onClick={copy}
      title="Copy code"
      whileTap={{ scale: 0.9 }}
      className="inline-flex items-center gap-1"
      style={{
        background: 'transparent',
        border: 'none',
        color: copied ? 'var(--lum-success)' : 'var(--lum-text-secondary)',
        fontSize: 11,
        cursor: 'pointer',
        padding: '2px 4px',
        transition: 'color 0.2s ease',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? 'check' : 'copy'}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
          className="flex"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </motion.span>
      </AnimatePresence>
      {copied ? 'Copied' : 'Copy'}
    </motion.button>
  );
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const match = /language-([\w-]+)/.exec(className ?? '');
  const text = String(children ?? '').replace(/\n$/, '');
  const isBlock = Boolean(match) || text.includes('\n');

  if (!isBlock) {
    return <code className="lum-inline-code">{children}</code>;
  }

  return (
    <div className="lum-codeblock">
      <div className="lum-codeblock-header">
        <span className="font-mono" style={{ fontSize: 10, color: '#4A5568', textTransform: 'uppercase', letterSpacing: 1 }}>
          {match?.[1] ?? 'text'}
        </span>
        <CopyButton text={text} />
      </div>
      <SyntaxHighlighter
        language={match?.[1] ?? 'text'}
        style={oneDark}
        PreTag="div"
        customStyle={{
          margin: 0,
          background: '#0B0E14',
          fontSize: 12.5,
          borderRadius: '0 0 8px 8px',
          padding: '12px 14px',
        }}
        codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace" } }}
      >
        {text}
      </SyntaxHighlighter>
    </div>
  );
}

export default function Markdown({ content }: { content: string }) {
  return (
    <div className="lum-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks render their own container — unwrap the <pre>
          pre: ({ children }) => <>{children}</>,
          code: CodeBlock,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--lum-accent-bright)' }}>{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
