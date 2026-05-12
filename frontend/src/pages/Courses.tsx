import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, showToast } from '../utils/helpers';

interface CourseSummary {
    id: string;
    title: string;
    type: 'text' | 'video' | 'lab';
    description: string;
    duration: string;
    tags: string[];
}

const CourseTypeIcon: Record<string, string> = {
    text: '📄',
    video: '🎥',
    lab: '🔬'
};

const CourseTypeColor: Record<string, string> = {
    text: 'var(--accent-2)',
    video: 'var(--accent-3)',
    lab: 'var(--accent-4)'
};

const Courses: React.FC = () => {
    const navigate = useNavigate();
    const [courses, setCourses] = useState<CourseSummary[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiGet('/api/courses')
            .then(data => setCourses(data))
            .catch(err => showToast(`Failed to load courses: ${err.message}`, 'error'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return <div className="page-header"><h1>Loading courses...</h1></div>;
    }

    return (
        <div className="courses-container">
            <div className="page-header" style={{ marginBottom: '2.5rem' }}>
                <h1>ML <em>Learning Paths.</em></h1>
                <p>Master Machine Learning concepts securely and interactively.</p>
            </div>

            <div className="bento-grid">
                {courses.map(course => (
                    <div
                        key={course.id}
                        className="bento-card"
                        onClick={() => navigate(`/courses/${course.id}`)}
                    >
                        <div className="bento-card-bg"></div>
                        <div className="bento-content">
                            <div className="bento-header flex-between mb-1">
                                <span className="bento-icon" style={{ backgroundColor: CourseTypeColor[course.type] + '20', color: CourseTypeColor[course.type] }}>
                                    {CourseTypeIcon[course.type]}
                                </span>
                                <span className="bento-duration">{course.duration}</span>
                            </div>
                            <h3 className="bento-title">{course.title}</h3>
                            <p className="bento-desc text-muted">{course.description}</p>

                            <div className="bento-tags flex gap-05">
                                {course.tags.map(tag => (
                                    <span key={tag} className="bento-tag">{tag}</span>
                                ))}
                            </div>
                        </div>
                        <div className="bento-hover-effect"></div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Courses;
