import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface TextCourseProps {
    content: string;
}

const TextCourse: React.FC<TextCourseProps> = ({ content }) => {
    return (
        <div className="course-text-container glass-panel">
            <div className="markdown-content">
                {/* The page has its h1 (the course title): the lesson's headings start one level down. */}
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{ h1: 'h2', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6' }}
                >
                    {content}
                </ReactMarkdown>
            </div>
        </div>
    );
};

export default TextCourse;
