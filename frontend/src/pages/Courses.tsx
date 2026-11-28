import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, showToast } from '../utils/helpers';
import { preloaded } from '../preloaded';
import { FileText, FlaskConical, Video } from 'lucide-react';

interface CourseSummary {
    id: string;
    title: string;
    type: 'text' | 'video' | 'lab';
    description: string;
    duration: string;
    tags: string[];
}

const CourseTypeIcon: Record<string, React.ElementType> = {
    text: FileText,
    video: Video,
    lab: FlaskConical,
};


// `embedded`: shown as a tab of the Learn page, which has the page's h1.
const Courses: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
    const Title = embedded ? 'h2' : 'h1';
    // The list this page was built with, if any; the fetch below brings it up to date.
    const [courses, setCourses] = useState<CourseSummary[]>(() => preloaded<CourseSummary[]>('/api/courses') ?? []);
    const [loading, setLoading] = useState(() => !preloaded('/api/courses'));

    useEffect(() => {
        apiGet('/api/courses')
            .then(data => setCourses(data))
            .catch(err => {
                if (!preloaded('/api/courses')) showToast(`Failed to load courses: ${err.message}`, 'error');
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return <div className="page-header"><Title className="page-header__title">Loading courses...</Title></div>;
    }

    return (
        <div className="courses-container">
            <div className="page-header" style={{ marginBottom: '2.5rem' }}>
                <Title className="page-header__title">ML <em>Learning Paths.</em></Title>
                <p>Master Machine Learning concepts securely and interactively.</p>
            </div>

            <div className="bento-grid">
                {courses.map(course => (
                    <Link key={course.id} to={`/courses/${course.id}`} className="bento-card">
                        <div className="bento-card-bg"></div>
                        <div className="bento-content">
                            <div className="bento-header flex-between mb-1">
                                <span className="bento-icon">
                                    {React.createElement(CourseTypeIcon[course.type] ?? FileText, { size: 18, strokeWidth: 1.75, 'aria-hidden': true })}
                                </span>
                                <span className="bento-duration">{course.duration}</span>
                            </div>
                            {React.createElement(embedded ? 'h3' : 'h2', { className: 'bento-title' }, course.title)}
                            <p className="bento-desc text-muted">{course.description}</p>

                            <div className="bento-tags flex gap-05">
                                {course.tags.map(tag => (
                                    <span key={tag} className="bento-tag">{tag}</span>
                                ))}
                            </div>
                        </div>
                        <div className="bento-hover-effect"></div>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default Courses;
