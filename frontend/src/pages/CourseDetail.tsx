import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiGet, showToast } from '../utils/helpers';
import { preloaded } from '../preloaded';
import { setPageTitle } from '../pageMeta';
import TextCourse from '../components/courses/TextCourse';
import VideoCourse from '../components/courses/VideoCourse';
import LabCourse from '../components/courses/LabCourse';
import { ArrowLeft, FileText, FlaskConical, TriangleAlert, Video } from 'lucide-react';

const CourseTypeIcon: Record<string, React.ElementType> = {
    text: FileText,
    video: Video,
    lab: FlaskConical,
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
    // The lesson this page was built with, if it is this one; the fetch below brings it up to date.
    const [course, setCourse] = useState<Course | null>(() => preloaded<Course>(`/api/courses/${id}`) ?? null);
    const [loading, setLoading] = useState(() => !preloaded(`/api/courses/${id}`));

    useEffect(() => {
        apiGet(`/api/courses/${id}`)
            .then(data => {
                if (data.error) showToast(data.error, 'error');
                else setCourse(data);
            })
            .catch(err => {
                // A page built with the lesson still shows it: nothing to report.
                if (!preloaded(`/api/courses/${id}`)) showToast(`Failed to load course: ${err.message}`, 'error');
            })
            .finally(() => setLoading(false));
    }, [id]);

    // Each lesson gets its own title and description (the route only knows "Courses").
    useEffect(() => {
        if (course) setPageTitle(course.title, course.description);
    }, [course]);

    if (loading) {
        return <div className="page-header"><h1>Loading course module...</h1></div>;
    }

    if (!course) {
        return (
            <div className="page-header text-center">
                <h1><TriangleAlert size={28} aria-hidden="true" style={{ verticalAlign: '-3px', color: 'var(--color-warning)' }} /> Course Not Found</h1>
                <Link className="btn btn-primary mt-2" to="/courses"><ArrowLeft size={14} aria-hidden="true" /> Back to Courses</Link>
            </div>
        );
    }

    return (
        <div className="course-detail-container">
            <div className="flex align-center gap-1 mb-2">
                <Link className="btn btn-sm btn-ghost" to="/courses">
                    <ArrowLeft size={14} aria-hidden="true" /> All courses
                </Link>
            </div>

            <div className="page-header mb-2" style={{ textAlign: 'left', padding: 0 }}>
                <div className="flex gap-1 align-center mb-05">
                    <span className="course-detail-icon">{React.createElement(CourseTypeIcon[course.type] ?? FileText, { size: 18, strokeWidth: 1.75, 'aria-hidden': true })}</span>
                    <span className="course-detail-type vx-label">
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
