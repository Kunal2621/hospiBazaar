import { useEffect } from 'react';
import { Check } from 'lucide-react';

/**
 * Stepped registration frame: a vertical step rail (horizontal on phones) and one panel per step.
 * steps: [{ id, label }]; errorSteps: Set of step ids that have errors.
 */
export function Wizard({ title, intro, steps, current, onGo, errorSteps, children }) {
  const idx = steps.findIndex((s) => s.id === current);
  // Each step starts at the top, so the heading and any messages are visible.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [current]);
  return (
    <div className="wrap reg">
      <aside className="reg__rail" aria-label="Progress">
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <h1 style={{ fontSize: '1.7rem' }}>{title}</h1>
          <p className="muted small">{intro}</p>
        </div>
        <ol className="reg__steps">
          {steps.map((s, i) => {
            const state = errorSteps?.has(s.id) ? 'is-error' : i < idx ? 'is-done' : i === idx ? 'is-current' : '';
            return (
              <li key={s.id} className={`reg__step ${state}`} aria-current={i === idx ? 'step' : undefined}>
                <button type="button" className="reg__step-btn" onClick={() => onGo(s.id)} disabled={i > idx && !errorSteps?.has(s.id)}>
                  <span className="reg__step-dot">{state === 'is-done' ? <Check size={14} strokeWidth={3} aria-hidden /> : state === 'is-error' ? '!' : i + 1}</span>
                  <span className="reg__step-name">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      {children}
    </div>
  );
}

export function StepPanel({ title, description, children, onBack, onNext, nextLabel = 'Continue', busy, last }) {
  return (
    <section className="reg__panel">
      <div className="reg__panel-head">
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
      <div className="reg__nav">
        {onBack ? <button type="button" className="btn btn--quiet" onClick={onBack}>Back</button> : <span />}
        <button type={last ? 'submit' : 'button'} className="btn" onClick={last ? undefined : onNext} disabled={busy}>
          {busy ? 'Submitting…' : nextLabel}
        </button>
      </div>
    </section>
  );
}
