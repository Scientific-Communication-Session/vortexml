import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// The tutor answers in Markdown (bold, lists, inline code). Kept in its own
// chunk so the renderer is only downloaded once the tutor actually replies.
const TutorMarkdown: React.FC<{ children: string }> = ({ children }) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
);

export default TutorMarkdown;
