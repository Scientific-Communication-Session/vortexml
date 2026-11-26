import { ScrollText } from 'lucide-react';
import React from 'react';

interface VideoCourseProps {
    videoUrl: string;
    transcript?: string;
}

const VideoCourse: React.FC<VideoCourseProps> = ({ videoUrl, transcript }) => {
    return (
        <div className="course-video-container">
            <div className="video-player-wrapper glass-panel p-0">
                <iframe
                    src={videoUrl}
                    title="Video Player"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="video-iframe"
                ></iframe>
            </div>

            {transcript && (
                <div className="glass-panel mt-2">
                    <h3 className="panel-title"><span className="pt-icon"><ScrollText size={18} strokeWidth={1.75} /></span> Transcript</h3>
                    <div className="video-transcript text-muted">
                        {transcript}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VideoCourse;
