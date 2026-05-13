import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, showToast } from '../utils/helpers';
import TextCourse from '../components/courses/TextCourse';
import VideoCourse from '../components/courses/VideoCourse';
import LabCourse from '../components/courses/LabCourse';

const CourseTypeIcon: Record<string, string> = {
    text: '📄',
    video: '🎥',
    lab: '🔬'
};

interface Course {
    id: string;
    title: string;
    type: 'text' | 'video' | 'lab';
    description: string;
    duration: string;
    tags?: string[];
    content?: string;
    transcript?: string;
    videoUrl?: string;
    video_url?: string;
    notebookUrl?: string;
    notebook_url?: string;
}

const CourseDetail: React.FC = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [course, setCourse] = useState<Course | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiGet(`/api/courses/${id}`)
            .then(data => {
                if (data.error) showToast(data.error, 'error');
                else setCourse(data);
            })
            .catch(err => showToast(`Failed to load course: ${err.message}`, 'error'))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) {
        return <div className="page-header"><h1>Loading course module...</h1></div>;
    }

    if (!course) {
        return (
            <div className="page-header text-center">
                <h1>⚠️ Course Not Found</h1>
                <button className="btn btn-primary mt-2" onClick={() => navigate('/courses')}>← Back to Courses</button>
            </div>
        );
    }

    return (
        <div className="course-detail-container">
            <div className="flex align-center gap-1 mb-2">
                <button className="btn btn-sm btn-ghost" onClick={() => navigate('/courses')}>
                    ← Back
                </button>
            </div>

            <div className="page-header mb-2" style={{ textAlign: 'left', padding: 0 }}>
                <div className="flex gap-1 align-center mb-05">
                    <span className="course-detail-icon">{CourseTypeIcon[course.type]}</span>
                    <span className="course-detail-type uppercase gradient-text font-mono" style={{ fontSize: '0.8rem' }}>
                        {course.type} MODULE • {course.duration}
                    </span>
                </div>
                <h1 style={{ marginTop: '0.5rem' }}>{course.title}</h1>
                <p className="text-muted" style={{ maxWidth: '800px', textAlign: 'left', margin: 0 }}>{course.description}</p>
                <div className="flex gap-05 mt-1">
                    {course.tags?.map((tag: string) => (
                        <span key={tag} className="bento-tag bento-tag-sm">{tag}</span>
                    ))}
                </div>
            </div>

            <div className="course-content-area mt-2">
                {course.type === 'text' && <TextCourse content={course.content || ''} />}
                {course.type === 'video' && <VideoCourse videoUrl={course.videoUrl || course.video_url || ''} transcript={course.transcript} />}
                {course.type === 'lab' && <LabCourse notebookUrl={course.notebookUrl || course.notebook_url || ''} />}
            </div>
        </div>
    );
};

export default CourseDetail;
