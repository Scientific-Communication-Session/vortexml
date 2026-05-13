import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

type QuestionLevel = 'beginner' | 'intermediate' | 'expert';

interface Question {
    id: number;
    text: string;
    options: { text: string; value: QuestionLevel }[];
}

const SURVEY_QUESTIONS: Question[] = [
    {
        id: 1,
        text: "How experienced are you with programming (Python in particular)?",
        options: [
            { text: "I've written a few scripts or just starting.", value: "beginner" },
            { text: "I can build standard applications and use APIs.", value: "intermediate" },
            { text: "I write high-performance or complex system code daily.", value: "expert" }
        ]
    },
    {
        id: 2,
        text: "What is your familiarity with Neural Network mathematics (e.g., Backpropagation, Gradients)?",
        options: [
            { text: "Math is mostly a black box to me.", value: "beginner" },
            { text: "I understand the basic calculus, chain rule, and loss curves.", value: "intermediate" },
            { text: "I can manually derive gradients or write custom autograd engines.", value: "expert" }
        ]
    },
    {
        id: 3,
        text: "How much experience do you have with Deep Learning frameworks (PyTorch, TensorFlow)?",
        options: [
            { text: "Never used them, or I strictly use pre-built APIs like Scikit-Learn.", value: "beginner" },
            { text: "I have trained a few models and understand Tensors.", value: "intermediate" },
            { text: "I regularly design complex, custom architectures from scratch.", value: "expert" }
        ]
    }
];

const Survey: React.FC = () => {
    const [answers, setAnswers] = useState<Record<number, QuestionLevel>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { checkAuth } = useAuth();
    const navigate = useNavigate();

    const handleSelect = (questionId: number, value: QuestionLevel) => {
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    const isComplete = Object.keys(answers).length === SURVEY_QUESTIONS.length;

    const handleSubmit = async () => {
        if (!isComplete) return;
        setSubmitting(true);
        setError(null);

        // Simple algorithm: if more than 1 'beginner' answer, they are a beginner.
        // Otherwise they are advanced.
        const beginnerCount = Object.values(answers).filter(v => v === 'beginner').length;
        const isBeginner = beginnerCount > 1;

        try {
            const res = await fetch('/api/auth/survey', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_beginner: isBeginner })
            });

            if (res.ok) {
                await checkAuth();
                navigate('/');
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || `Submission failed (HTTP ${res.status}).`);
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="survey-page page-container fade-in">
            <div className="survey-header">
                <div className="icon-wrapper glass-icon">
                    <span className="card-icon">🧠</span>
                </div>
                <h2>Machine Learning Experience</h2>
                <p>Welcome to Vortex ML. Let's customize your journey by understanding your background.</p>
            </div>

            <div className="survey-questions-grid">
                {SURVEY_QUESTIONS.map((q, index) => (
                    <div key={q.id} className="survey-question-card glass-panel" style={{ animationDelay: `${index * 0.15}s` }}>
                        <h3>{q.id}. {q.text}</h3>
                        <div className="options-group">
                            {q.options.map((opt, i) => {
                                const isSelected = answers[q.id] === opt.value;
                                return (
                                    <label key={i} className={`survey-option ${isSelected ? 'selected pulse-glow-subtle' : ''}`}>
                                        <input
                                            type="radio"
                                            name={`q-${q.id}`}
                                            value={opt.value}
                                            checked={isSelected}
                                            onChange={() => handleSelect(q.id, opt.value)}
                                        />
                                        <div className="option-content">
                                            <span className="radio-custom"></span>
                                            <span className="option-text">{opt.text}</span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className={`survey-footer ${isComplete ? 'visible' : ''}`}>
                {error && (
                    <div
                        role="alert"
                        className="survey-error"
                        style={{
                            marginBottom: '0.75rem',
                            padding: '0.75rem 1rem',
                            borderRadius: '0.75rem',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            background: 'rgba(239, 68, 68, 0.07)',
                            color: '#fca5a5',
                            fontSize: '0.85rem',
                            fontWeight: 500,
                        }}
                    >
                        {error}
                    </div>
                )}
                <button
                    className="btn-primary pulse-glow btn-lg survey-submit"
                    onClick={handleSubmit}
                    disabled={!isComplete || submitting}
                >
                    {submitting ? 'Analyzing profile...' : 'Complete Registration'}
                </button>
            </div>
        </div>
    );
};

export default Survey;
