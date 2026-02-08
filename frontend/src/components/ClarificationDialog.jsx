import React, { useState } from 'react';
import { HelpCircle, Send, ChevronRight } from 'lucide-react';
import './ClarificationDialog.css';

/**
 * ClarificationDialog - Shows when AI detects a vague prompt
 * Displays clarification questions with options and freeform input
 * Answers are sent back to the AI for a more precise design
 */
function ClarificationDialog({ questions, understood, vaguenessScore, onSubmit, onSkip }) {
    const [answers, setAnswers] = useState({});

    const handleOptionClick = (questionId, option) => {
        setAnswers(prev => ({ ...prev, [questionId]: option }));
    };

    const handleFreeformChange = (questionId, value) => {
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    const handleSubmit = () => {
        const formattedAnswers = questions.map(q => ({
            id: q.id,
            question: q.question,
            answer: answers[q.id] || '(not answered)',
            category: q.category,
        }));
        onSubmit(formattedAnswers);
    };

    const answeredCount = Object.keys(answers).filter(k => answers[k]?.trim()).length;

    return (
        <div className="clarification-dialog">
            <div className="clarification-header">
                <HelpCircle size={16} />
                <span>A few questions to get the best result</span>
                {vaguenessScore !== undefined && (
                    <span className="vagueness-badge">
                        Clarity: {Math.round((vaguenessScore || 0) * 100)}%
                    </span>
                )}
            </div>

            {understood && (
                <div className="clarification-understood">
                    {understood}
                </div>
            )}

            <div className="clarification-questions">
                {questions.map((q, idx) => (
                    <div key={q.id || idx} className="clarification-question">
                        <div className="question-label">
                            <span className="question-number">{idx + 1}</span>
                            <span className="question-text">{q.question}</span>
                            {q.category && (
                                <span className={`question-category cat-${q.category}`}>{q.category}</span>
                            )}
                        </div>

                        {q.why && <div className="question-why">{q.why}</div>}

                        {q.options && q.options.length > 0 && (
                            <div className="question-options">
                                {q.options.map((opt, optIdx) => (
                                    <button
                                        key={optIdx}
                                        className={`option-chip ${answers[q.id] === opt ? 'selected' : ''}`}
                                        onClick={() => handleOptionClick(q.id, opt)}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        )}

                        {(q.allowFreeform !== false) && (
                            <input
                                type="text"
                                className="freeform-input"
                                placeholder="Type your answer..."
                                value={answers[q.id] || ''}
                                onChange={(e) => handleFreeformChange(q.id, e.target.value)}
                            />
                        )}
                    </div>
                ))}
            </div>

            <div className="clarification-actions">
                <button className="clarification-skip" onClick={onSkip}>
                    Skip, generate anyway
                    <ChevronRight size={14} />
                </button>
                <button
                    className="clarification-submit"
                    onClick={handleSubmit}
                    disabled={answeredCount === 0}
                >
                    <Send size={14} />
                    Submit ({answeredCount}/{questions.length})
                </button>
            </div>
        </div>
    );
}

export default ClarificationDialog;
