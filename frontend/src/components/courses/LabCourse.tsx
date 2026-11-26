import { ExternalLink, FlaskConical } from 'lucide-react';
import React from 'react';

interface LabCourseProps {
    notebookUrl: string;
}

const LabCourse: React.FC<LabCourseProps> = ({ notebookUrl }) => {
    return (
        <div className="course-lab-container glass-panel p-0">
            <div className="lab-header flex-between p-1 border-bottom">
                <div className="flex gap-1 align-center">
                    <span className="pt-icon"><FlaskConical size={18} strokeWidth={1.75} /></span>
                    <strong>Interactive Lab Environment</strong>
                </div>
                <a href={notebookUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                    Open in New Tab <ExternalLink size={13} aria-hidden="true" />
                </a>
            </div>
            <div className="lab-iframe-wrapper">
                <iframe
                    src={notebookUrl}
                    title="Jupyter Lab"
                    frameBorder="0"
                    className="lab-iframe"
                ></iframe>
            </div>
        </div>
    );
};

export default LabCourse;
