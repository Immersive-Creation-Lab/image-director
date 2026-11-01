import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config';

const TASKS = [
  {
    id: 0,
    title: 'Practice Task',
    description: 'Familiarize yourself with the interface',
    image: '/task-images/livingroom.png',
    steps: [
      {
        title: 'Step 1: Read the instructions',
        content:
          'Each step shows you a task to complete. Read the instructions carefully, then use the tool to make the requested change. When done, drag your result image into the drop zone below and click Next.',
        image: '/task-images/livingroom_step1.png',
      },
      {
        title: 'Step 2: Submit an image',
        content:
          'Try dragging any image from another browser tab into the drop zone below. You should see a preview appear. You can replace it by dragging a new image.',
        image: null,
      },
      {
        title: 'Step 3: Finish',
        content:
          'When you are happy with your submission, click Finish. Your results will be saved automatically. This is the end of the practice task — you are ready to begin the real tasks!',
        image: null,
      },
    ],
  },
  {
    id: 1,
    title: 'Task 1',
    description: 'Workshop',
    image: '/task-images/workshop.png',
    steps: [
      {
        title: 'Client Feedback #1',
        content:
          'To show a scene after someone just used the tools, move the screw driver (starred in red) to the red circle. The arrow indicates the direction of the tip.',
        image: '/task-images/workshop_step1.png',
      },
      {
        title: 'Client Feedback #2',
        content:
          'The power drill is too close to the user and looks dangerous! Move it to the red circle but behind the multimeter. The arrow indicates the direction of the drill.',
        image: '/task-images/workshop_step2.png',
      },
      {
        title: 'Client Feedback #3',
        content:
          'To show a scene after someone just used the wrench, move the wrench (starred in red) to the red circle.',
        image: '/task-images/workshop_step3.png',
      },
    ],
  },
  {
    id: 2,
    title: 'Task 2',
    description: 'Kitchen',
    image: '/task-images/kitchen.png',
    steps: [
      {
        title: 'Client Feedback #1',
        content:
          'Bring the blue mug (starred in red) to the circle and rotate it. The arrow indicates the direction of the handle. This change creates a feeling as if the photographer is using the mug.',
        image: '/task-images/kitchen_step1.png',
      },
      {
        title: 'Client Feedback #2',
        content:
          'The knife looks dangerous. Hide it between the avocado and the bread. The red arrow indicates the direction of the blade.',
        image: '/task-images/kitchen_step2.png',
      },
      {
        title: 'Client Feedback #3',
        content:
          'The two bananas should be spread out to make the scene more balanced. Specifically, the banana on the top should be moved to the red circle.',
        image: '/task-images/kitchen_step3.png',
      },
    ],
  },
];

const TIMER_DURATION = 10 * 60;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ── Drop Zone Component ── */
function DropZone({ submissionKey, submissions, onSubmit, onClear }) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);
  const submitted = submissions[submissionKey];

  const extractImage = useCallback((dataTransfer) => {
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      const file = dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        return { src: URL.createObjectURL(file), blob: file, name: file.name, type: 'file' };
      }
    }
    const uri = dataTransfer.getData('text/uri-list');
    if (uri && uri.trim()) {
      const firstUrl = uri.split('\n').find((u) => u.trim() && !u.startsWith('#'));
      if (firstUrl) return { src: firstUrl.trim(), name: 'dropped-image.png', type: 'url' };
    }
    const html = dataTransfer.getData('text/html');
    if (html) {
      const match = html.match(/src="([^"]+)"/);
      if (match) return { src: match[1], name: 'dropped-image.png', type: 'url' };
    }
    return null;
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDraggingOver(false);
      const result = extractImage(e.dataTransfer);
      if (result) onSubmit(submissionKey, result);
    },
    [extractImage, onSubmit, submissionKey]
  );

  const handleDragEnter = (e) => { e.preventDefault(); dragCounter.current += 1; setIsDraggingOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); dragCounter.current -= 1; if (dragCounter.current === 0) setIsDraggingOver(false); };
  const handleDragOver = (e) => { e.preventDefault(); };

  if (submitted) {
    return (
      <div style={styles.dropZoneSubmitted}>
        <img src={submitted.src} alt="Submitted" style={styles.submittedImg} />
        <div style={styles.submittedOverlay}>
          <div style={styles.submittedBadge}>✓ Submitted</div>
          <button style={styles.clearBtn} onClick={() => onClear(submissionKey)}>Replace</button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.dropZone,
        borderColor: isDraggingOver ? '#6366f1' : '#d1d5db',
        backgroundColor: isDraggingOver ? '#eef2ff' : '#f9fafb',
        transform: isDraggingOver ? 'scale(1.01)' : 'scale(1)',
      }}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
    >
      <div style={styles.dropZoneIcon}>{isDraggingOver ? '📥' : '🖼️'}</div>
      <div style={styles.dropZoneLabel}>
        {isDraggingOver ? 'Release to submit' : 'Drag your result image here to submit'}
      </div>
      <div style={styles.dropZoneHint}>Drag an image from the other browser tab and drop it here</div>
    </div>
  );
}

/* ── Participant ID Screen ── */
function ParticipantEntry({ onConfirm }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) { setError('Please enter your Participant ID.'); return; }
    onConfirm(trimmed);
  };

  return (
    <div style={styles.entryWrapper}>
      <div style={styles.entryCard}>
        <h2 style={styles.entryTitle}>Welcome</h2>
        <p style={styles.entrySubtitle}>Enter your Participant ID to begin the study.</p>
        <form onSubmit={handleSubmit}>
          <input
            style={{ ...styles.entryInput, borderColor: error ? '#ef4444' : '#d1d5db' }}
            type="text"
            placeholder="e.g. P01"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            autoFocus
          />
          {error && <div style={styles.entryError}>{error}</div>}
          <button style={styles.entryBtn} type="submit">Continue →</button>
        </form>
      </div>
    </div>
  );
}

/* ── Save session helper ── */
async function saveSession(participantId, task, stepTimestamps, stepStartTimes, submissions) {
  const formData = new FormData();
  formData.append('participant_id', participantId);

  const steps = task.steps.map((step, i) => {
    const key = `${task.id}-${i}`;
    const sub = submissions[key];
    const startedAt = stepStartTimes[key] || null;
    const completedAt = stepTimestamps[key] || null;
    return {
      key,
      step_index: i,
      title: step.title,
      started_at: startedAt,
      completed_at: completedAt,
      time_spent_seconds:
        startedAt && completedAt
          ? (new Date(completedAt) - new Date(startedAt)) / 1000
          : null,
      submitted_image: sub ? sub.name : null,
    };
  });

  const sessionData = {
    participant_id: participantId,
    task_id: task.id,
    task_title: task.title,
    finished_at: new Date().toISOString(),
    steps,
  };

  formData.append('session_data', JSON.stringify(sessionData));

  // Attach images
  for (const step of steps) {
    const sub = submissions[step.key];
    if (!sub) continue;

    if (sub.type === 'file' && sub.blob) {
      const ext = sub.name.split('.').pop() || 'png';
      const filename = `task${task.id}_step${step.step_index + 1}.${ext}`;
      formData.append(`image_file_${step.key}`, sub.blob, filename);
      formData.append(`image_name_${step.key}`, filename);
    } else if (sub.type === 'url') {
      try {
        const res = await fetch(sub.src);
        const blob = await res.blob();
        const ext = blob.type.split('/')[1] || 'png';
        const filename = `task${task.id}_step${step.step_index + 1}.${ext}`;
        formData.append(`image_file_${step.key}`, blob, filename);
        formData.append(`image_name_${step.key}`, filename);
      } catch {
        // If fetch fails (CORS), just skip the image — JSON still saves
      }
    }
  }

  const res = await fetch(`${API_BASE_URL}/api/save_session`, { method: 'POST', body: formData });
  return res.json();
}

/* ── Main Page ── */
export default function TasksPage() {
  const [participantId, setParticipantId] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [started, setStarted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIMER_DURATION);
  const [finished, setFinished] = useState(false);
  const [submissions, setSubmissions] = useState({});
  // key → ISO timestamp of when user clicked Next/Finish on that step
  const [stepTimestamps, setStepTimestamps] = useState({});
  const [stepStartTimes, setStepStartTimes] = useState({});
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const intervalRef = useRef(null);

  useEffect(() => {
    if (started && !finished) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) { clearInterval(intervalRef.current); setFinished(true); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [started, finished]);

  // Auto-save when finished
  useEffect(() => {
    if (finished && selectedTask && participantId && saveStatus === 'idle') {
      setSaveStatus('saving');
      saveSession(participantId, selectedTask, stepTimestamps, stepStartTimes, submissions)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
    }
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const submissionKey = selectedTask ? `${selectedTask.id}-${currentStep}` : null;

  const handleSubmit = useCallback((key, image) => {
    setSubmissions((prev) => ({ ...prev, [key]: image }));
  }, []);

  const handleClear = useCallback((key) => {
    setSubmissions((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const handleSelectTask = (task) => {
    setSelectedTask(task);
    setStarted(false);
    setCurrentStep(0);
    setTimeLeft(TIMER_DURATION);
    setFinished(false);
    setSaveStatus('idle');
    clearInterval(intervalRef.current);
  };

  const handleStart = () => {
    const now = new Date().toISOString();
    setStarted(true);
    setCurrentStep(0);
    setTimeLeft(TIMER_DURATION);
    setFinished(false);
    // Record start time for step 0
    setStepStartTimes({ [`${selectedTask.id}-0`]: now });
  };

  const handleNext = () => {
    const now = new Date().toISOString();
    const key = `${selectedTask.id}-${currentStep}`;
    setStepTimestamps((prev) => ({ ...prev, [key]: now }));
    if (currentStep < selectedTask.steps.length - 1) {
      const nextKey = `${selectedTask.id}-${currentStep + 1}`;
      setStepStartTimes((prev) => ({ ...prev, [nextKey]: now }));
      setCurrentStep((s) => s + 1);
    } else {
      clearInterval(intervalRef.current);
      setFinished(true);
    }
  };

  const handleReset = () => {
    clearInterval(intervalRef.current);
    setSelectedTask(null);
    setStarted(false);
    setCurrentStep(0);
    setTimeLeft(TIMER_DURATION);
    setFinished(false);
    setSubmissions({});
    setStepTimestamps({});
    setStepStartTimes({});
    setSaveStatus('idle');
  };

  const progress = ((TIMER_DURATION - timeLeft) / TIMER_DURATION) * 100;
  const isLowTime = timeLeft <= 60;
  const submittedCount = selectedTask
    ? selectedTask.steps.filter((_, i) => submissions[`${selectedTask.id}-${i}`]).length
    : 0;

  // ── Screens ──
  if (!participantId) return <ParticipantEntry onConfirm={setParticipantId} />;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Study Tasks</h1>
        <div style={styles.headerRight}>
          <span style={styles.pidBadge}>ID: {participantId}</span>
          {selectedTask && (
            <button style={styles.resetBtn} onClick={handleReset}>← Back</button>
          )}
        </div>
      </header>

      <main style={styles.main}>
        {/* Task Selection */}
        {!selectedTask && (
          <div style={styles.selectionContainer}>
            <h2 style={styles.sectionTitle}>Select a Task to Begin</h2>
            <div style={styles.taskGrid}>
              {TASKS.map((task) => (
                <button
                  key={task.id}
                  style={styles.taskCard}
                  onClick={() => handleSelectTask(task)}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
                >
                  <span style={styles.taskNumber}>{task.id}</span>
                  <h3 style={styles.taskTitle}>{task.title}</h3>
                  <p style={styles.taskDesc}>{task.description}</p>
                  <div style={styles.stepsPreview}>
                    {task.steps.map((_, i) => <span key={i} style={styles.stepDot} />)}
                    <span style={styles.stepsCount}>{task.steps.length} steps</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Task View */}
        {selectedTask && (
          <div style={styles.taskView}>
            {/* Timer */}
            <div style={{ ...styles.timerCard, borderColor: isLowTime ? '#ef4444' : '#e5e7eb' }}>
              <div style={styles.timerRow}>
                <div>
                  <div style={styles.timerLabel}>{selectedTask.title}</div>
                  <div style={{ ...styles.timerDisplay, color: isLowTime ? '#ef4444' : '#111827' }}>
                    {formatTime(timeLeft)}
                  </div>
                  {isLowTime && started && !finished && (
                    <div style={styles.lowTimeWarning}>Less than 1 minute remaining</div>
                  )}
                </div>
                {!started && <button style={styles.startBtn} onClick={handleStart}>Start Timer</button>}
                {started && finished && <div style={styles.timesUpBadge}>Time's up</div>}
              </div>
              {started && (
                <div style={styles.progressBar}>
                  <div style={{ ...styles.progressFill, width: `${progress}%`, backgroundColor: isLowTime ? '#ef4444' : '#6366f1' }} />
                </div>
              )}
            </div>

            {!started && (
              <div style={styles.waitingCard}>
                {selectedTask.image && (
                  <img src={selectedTask.image} alt="Task intro" style={styles.taskIntroImage} />
                )}
                <div style={styles.waitingMsg}>
                  Click <strong>Start Timer</strong> to begin. Steps will appear here.
                </div>
              </div>
            )}

            {/* Active step */}
            {started && !finished && (
              <div style={styles.stepCard}>
                <div style={styles.stepIndicator}>
                  {selectedTask.steps.map((_, i) => {
                    const key = `${selectedTask.id}-${i}`;
                    const isSubmitted = !!submissions[key];
                    return (
                      <React.Fragment key={i}>
                        <div style={{
                          ...styles.stepBubble,
                          backgroundColor: isSubmitted ? '#059669' : i <= currentStep ? '#6366f1' : '#e5e7eb',
                          color: i <= currentStep || isSubmitted ? '#fff' : '#9ca3af',
                        }}>
                          {isSubmitted ? '✓' : i + 1}
                        </div>
                        {i < selectedTask.steps.length - 1 && (
                          <div style={{ ...styles.stepLine, backgroundColor: i < currentStep ? '#6366f1' : '#e5e7eb' }} />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                <h2 style={styles.stepTitle}>{selectedTask.steps[currentStep].title}</h2>
                {selectedTask.steps[currentStep].image && (
                  <img src={selectedTask.steps[currentStep].image} alt={`Step ${currentStep + 1}`} style={styles.stepImage} />
                )}
                <p style={styles.stepContent}>{selectedTask.steps[currentStep].content}</p>

                <DropZone submissionKey={submissionKey} submissions={submissions} onSubmit={handleSubmit} onClear={handleClear} />

                <div style={styles.stepFooter}>
                  <span style={styles.stepCounter}>Step {currentStep + 1} of {selectedTask.steps.length}</span>
                  <button style={styles.nextBtn} onClick={handleNext}>
                    {currentStep < selectedTask.steps.length - 1 ? 'Next →' : 'Finish'}
                  </button>
                </div>
              </div>
            )}

            {/* Finished */}
            {finished && (
              <div style={styles.finishedCard}>
                <div style={styles.finishedIcon}>✓</div>
                <h2 style={styles.finishedTitle}>Task Complete!</h2>
                <p style={styles.finishedMsg}>
                  You have finished <strong>{selectedTask.title}</strong> with{' '}
                  <strong>{submittedCount} of {selectedTask.steps.length}</strong> steps submitted.
                </p>

                {/* Save status */}
                <div style={styles.saveStatus}>
                  {saveStatus === 'saving' && <span style={{ color: '#6b7280' }}>⏳ Saving your session…</span>}
                  {saveStatus === 'saved' && <span style={{ color: '#059669' }}>✓ Session saved to folder <strong>{participantId}</strong></span>}
                  {saveStatus === 'error' && <span style={{ color: '#dc2626' }}>⚠ Save failed — please let the facilitator know.</span>}
                </div>

                {/* Submission thumbnails */}
                {submittedCount > 0 && (
                  <div style={styles.submissionGrid}>
                    {selectedTask.steps.map((step, i) => {
                      const s = submissions[`${selectedTask.id}-${i}`];
                      const ts = stepTimestamps[`${selectedTask.id}-${i}`];
                      return s ? (
                        <div key={i} style={styles.submissionThumb}>
                          <img src={s.src} alt={`Step ${i + 1}`} style={styles.thumbImg} />
                          <div style={styles.thumbLabel}>Step {i + 1}</div>
                          {ts && <div style={styles.thumbTs}>{new Date(ts).toLocaleTimeString()}</div>}
                        </div>
                      ) : null;
                    })}
                  </div>
                )}

                <p style={{ color: '#9ca3af', fontSize: '0.9rem', margin: '0 0 24px' }}>
                  Please let the facilitator know you are done.
                </p>
                <button style={styles.resetBtn2} onClick={handleReset}>Return to Task Selection</button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/* ── Styles ── */
const styles = {
  page: { minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: '#111827' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 },
  headerTitle: { margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#111827' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  pidBadge: { fontSize: '0.85rem', color: '#6b7280', backgroundColor: '#f3f4f6', padding: '4px 10px', borderRadius: 6, fontWeight: 500 },
  main: { maxWidth: 720, margin: '0 auto', padding: '48px 24px', overflowY: 'auto' },
  /* Participant entry */
  entryWrapper: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', fontFamily: "'Inter', -apple-system, sans-serif" },
  entryCard: { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '48px 40px', width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' },
  entryTitle: { margin: '0 0 8px', fontSize: '1.6rem', fontWeight: 700 },
  entrySubtitle: { color: '#6b7280', margin: '0 0 28px', lineHeight: 1.5 },
  entryInput: { width: '100%', padding: '12px 14px', border: '1.5px solid', borderRadius: 10, fontSize: '1rem', outline: 'none', boxSizing: 'border-box', marginBottom: 8 },
  entryError: { color: '#ef4444', fontSize: '0.85rem', marginBottom: 8, textAlign: 'left' },
  entryBtn: { width: '100%', padding: '12px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '1rem', cursor: 'pointer', marginTop: 8 },
  /* Selection */
  selectionContainer: { textAlign: 'center' },
  sectionTitle: { fontSize: '1.5rem', fontWeight: 600, marginBottom: 32, color: '#374151' },
  taskGrid: { display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' },
  taskCard: { width: 280, padding: '32px 28px', backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', cursor: 'pointer', textAlign: 'left', transition: 'transform 0.2s, box-shadow 0.2s' },
  taskNumber: { display: 'inline-block', width: 32, height: 32, lineHeight: '32px', textAlign: 'center', borderRadius: '50%', backgroundColor: '#6366f1', color: '#fff', fontWeight: 700, fontSize: '0.9rem', marginBottom: 12 },
  taskTitle: { margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 600 },
  taskDesc: { margin: '0 0 20px', color: '#6b7280', fontSize: '0.9rem', lineHeight: 1.5 },
  stepsPreview: { display: 'flex', alignItems: 'center', gap: 6 },
  stepDot: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: '#c7d2fe' },
  stepsCount: { marginLeft: 4, fontSize: '0.8rem', color: '#9ca3af' },
  /* Task view */
  taskView: { display: 'flex', flexDirection: 'column', gap: 24 },
  timerCard: { backgroundColor: '#fff', border: '2px solid', borderRadius: 16, padding: '24px 28px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  timerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  timerLabel: { fontSize: '0.85rem', color: '#6b7280', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' },
  timerDisplay: { fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 },
  lowTimeWarning: { marginTop: 6, fontSize: '0.8rem', color: '#ef4444', fontWeight: 500 },
  progressBar: { marginTop: 16, height: 6, backgroundColor: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, transition: 'width 1s linear, background-color 0.3s' },
  startBtn: { padding: '12px 28px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '1rem', cursor: 'pointer' },
  timesUpBadge: { padding: '8px 16px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: 8, fontWeight: 600, fontSize: '0.9rem' },
  waitingCard: { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  taskIntroImage: { width: '100%', maxHeight: 520, objectFit: 'contain', backgroundColor: '#f9fafb', display: 'block' },
  waitingMsg: { textAlign: 'center', color: '#9ca3af', fontSize: '0.95rem', padding: '24px' },
  /* Step card */
  stepCard: { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '32px 28px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  stepIndicator: { display: 'flex', alignItems: 'center', marginBottom: 32 },
  stepBubble: { width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0, transition: 'background-color 0.2s' },
  stepLine: { flex: 1, height: 2, margin: '0 6px' },
  stepTitle: { margin: '0 0 16px', fontSize: '1.2rem', fontWeight: 600 },
  stepImage: { width: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 10, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', marginBottom: 16 },
  stepContent: { color: '#4b5563', lineHeight: 1.7, fontSize: '1rem', margin: '0 0 20px' },
  stepFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  stepCounter: { fontSize: '0.85rem', color: '#9ca3af' },
  nextBtn: { padding: '10px 24px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer' },
  /* Drop zone */
  dropZone: { border: '2px dashed', borderRadius: 12, padding: '28px 20px', textAlign: 'center', cursor: 'default', transition: 'border-color 0.15s, background-color 0.15s, transform 0.15s', marginBottom: 4 },
  dropZoneIcon: { fontSize: '2rem', marginBottom: 8 },
  dropZoneLabel: { fontWeight: 600, fontSize: '0.95rem', color: '#374151', marginBottom: 4 },
  dropZoneHint: { fontSize: '0.8rem', color: '#9ca3af' },
  dropZoneSubmitted: { position: 'relative', borderRadius: 12, overflow: 'hidden', marginBottom: 4, border: '2px solid #d1fae5' },
  submittedImg: { width: '100%', maxHeight: 180, objectFit: 'contain', display: 'block', backgroundColor: '#f9fafb' },
  submittedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(0,0,0,0.4)' },
  submittedBadge: { backgroundColor: '#059669', color: '#fff', padding: '4px 10px', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem' },
  clearBtn: { backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, padding: '4px 10px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 500 },
  /* Finished */
  finishedCard: { backgroundColor: '#fff', border: '1px solid #d1fae5', borderRadius: 16, padding: '48px 28px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  finishedIcon: { width: 64, height: 64, borderRadius: '50%', backgroundColor: '#d1fae5', color: '#059669', fontSize: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' },
  finishedTitle: { margin: '0 0 8px', fontSize: '1.4rem', fontWeight: 700 },
  finishedMsg: { color: '#6b7280', lineHeight: 1.6, margin: '0 0 16px' },
  saveStatus: { margin: '0 0 24px', fontSize: '0.9rem' },
  submissionGrid: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 },
  submissionThumb: { width: 120, textAlign: 'center' },
  thumbImg: { width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' },
  thumbLabel: { fontSize: '0.75rem', color: '#6b7280', marginTop: 4, fontWeight: 600 },
  thumbTs: { fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 },
  /* Buttons */
  resetBtn: { padding: '8px 16px', backgroundColor: 'transparent', color: '#6366f1', border: '1px solid #6366f1', borderRadius: 8, fontWeight: 500, fontSize: '0.9rem', cursor: 'pointer' },
  resetBtn2: { padding: '12px 28px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '1rem', cursor: 'pointer' },
};
