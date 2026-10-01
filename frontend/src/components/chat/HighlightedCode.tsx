import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Preserve the full existing Prism language set, loaded only when code needs it.
export default function HighlightedCode({ language, text }: { language: string; text: string }) {
  return (
    <SyntaxHighlighter
      language={language}
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
  );
}
