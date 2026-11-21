import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { useAuth, homeFor } from '../auth.jsx';
import { Wizard, StepPanel } from '../components/Wizard.jsx';
import { Alert, CheckField, SelectField, TextField, focusFirstError, useFields } from '../components/ui.jsx';

const STEPS = [
  { id: 'hospital', label: 'Hospital details' },
  { id: 'contact', label: 'Contact person' },
  { id: 'account', label: 'Your account' },
];

const STEP_FIELDS = {
  hospital: ['hospital_name', 'hospital_type', 'registration_number', 'gstin', 'pan', 'phone', 'email', 'website', 'registered_address', 'city', 'state', 'pincode'],
  contact: ['contact_person_name', 'contact_person_designation', 'contact_person_mobile', 'contact_person_email'],
  account: ['full_name', 'user_email', 'user_mobile', 'password', 'terms_accepted'],
};
const REQUIRED = {
  hospital: ['hospital_name', 'registration_number', 'gstin', 'pan', 'phone', 'email', 'registered_address', 'city', 'state', 'pincode'],
  contact: ['contact_person_name', 'contact_person_designation', 'contact_person_mobile', 'contact_person_email'],
  account: ['full_name', 'user_email', 'user_mobile', 'password'],
};
const stepOf = (field) => Object.keys(STEP_FIELDS).find((s) => STEP_FIELDS[s].includes(field));

const INITIAL = {
  hospital_name: '', hospital_type: 'private', registration_number: '', gstin: '', pan: '', phone: '', email: '', website: '',
  registered_address: '', city: '', state: '', pincode: '',
  contact_person_name: '', contact_person_designation: '', contact_person_mobile: '', contact_person_email: '',
  full_name: '', user_email: '', user_mobile: '', password: '', terms_accepted: false,
};

const SERVER_KEY = { 'user.full_name': 'full_name', 'user.email': 'user_email', 'user.mobile': 'user_mobile', 'user.password': 'password' };

export default function RegisterHospital() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { values, bind } = useFields(INITIAL);
  const [step, setStep] = useState('hospital');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState(null);

  useEffect(() => { api('/terms/buyer').then((d) => setTerms(d.terms)).catch(() => {}); }, []);

  const errorSteps = useMemo(() => new Set(Object.keys(errors).map(stepOf).filter(Boolean)), [errors]);
  const idx = STEPS.findIndex((s) => s.id === step);
  const err = (name) => errors[name];

  function checkStep(id) {
    const missing = {};
    for (const f of REQUIRED[id]) if (!String(values[f]).trim()) missing[f] = 'Required';
    setErrors((e) => {
      const next = { ...e };
      for (const f of STEP_FIELDS[id]) delete next[f];
      return { ...next, ...missing };
    });
    if (Object.keys(missing).length) focusFirstError();
    return Object.keys(missing).length === 0;
  }
  const next = () => { if (checkStep(step)) setStep(STEPS[idx + 1].id); };

  async function submit(e) {
    e.preventDefault();
    if (!checkStep('account')) return;
    if (!values.terms_accepted) { setErrors((x) => ({ ...x, terms_accepted: 'Accept the Terms & Conditions to continue' })); focusFirstError(); return; }
    setBusy(true); setFormError('');
    const v = values;
    const body = {
      hospital: {
        hospital_name: v.hospital_name, hospital_type: v.hospital_type, registration_number: v.registration_number,
        registered_address: v.registered_address, city: v.city, state: v.state, pincode: v.pincode, phone: v.phone,
        email: v.email, website: v.website, contact_person_name: v.contact_person_name,
        contact_person_designation: v.contact_person_designation, contact_person_mobile: v.contact_person_mobile,
        contact_person_email: v.contact_person_email, gstin: v.gstin, pan: v.pan,
      },
      user: { full_name: v.full_name, email: v.user_email, mobile: v.user_mobile, password: v.password },
      terms_accepted: v.terms_accepted,
    };
    try {
      const data = await api('/auth/register/hospital', { method: 'POST', body });
      signIn(data);
      navigate(homeFor(data.user), { replace: true });
    } catch (ex) {
      if (ex instanceof ApiError) {
        const mapped = {};
        for (const [k, msg] of Object.entries(ex.fields || {})) mapped[SERVER_KEY[k] || k.replace(/^hospital\./, '')] = msg;
        setErrors(mapped);
        setFormError(Object.keys(mapped).length ? 'Some details need fixing. The steps marked with ! show where.' : ex.message);
        const first = Object.keys(mapped).map(stepOf).filter(Boolean).sort((a, b) => STEPS.findIndex((s) => s.id === a) - STEPS.findIndex((s) => s.id === b))[0];
        if (first) setStep(first);
        focusFirstError();
      } else setFormError('Something went wrong. Try again.');
    } finally { setBusy(false); }
  }

  const t = (label, name, extra = {}) => <TextField label={label} error={err(name)} {...bind(name)} {...extra} />;

  return (
    <form onSubmit={submit} noValidate>
      <Wizard
        title="Register your hospital"
        intro="You can browse, request quotes and negotiate straight away. We verify your hospital before your first order."
        steps={STEPS} current={step} onGo={setStep} errorSteps={errorSteps}
      >
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Alert>{formError}</Alert>

          {step === 'hospital' && (
            <StepPanel title="Hospital details" description="These details appear on your RFQs and orders." onNext={next}>
              <div className="form-grid">
                {t('Hospital name', 'hospital_name', { autoComplete: 'organization' })}
                <SelectField label="Hospital type" error={err('hospital_type')} {...bind('hospital_type')}>
                  <option value="private">Private</option>
                  <option value="government">Government</option>
                  <option value="trust">Trust</option>
                  <option value="clinic">Clinic</option>
                  <option value="nursing_home">Nursing home</option>
                </SelectField>
                {t('Registration number', 'registration_number', { hint: 'Clinical establishment or hospital licence number' })}
                {t('GSTIN', 'gstin', { maxLength: 15, placeholder: '23ABCDE1234F1Z5' })}
                {t('PAN', 'pan', { maxLength: 10, placeholder: 'ABCDE1234F' })}
                {t('Phone', 'phone', { type: 'tel', autoComplete: 'tel' })}
                {t('Hospital email', 'email', { type: 'email' })}
                {t('Website', 'website', { optional: true, placeholder: 'https://' })}
              </div>
              <div className="form-grid form-grid--full">
                {t('Registered address', 'registered_address', { autoComplete: 'street-address' })}
              </div>
              <div className="form-grid">
                {t('City', 'city')}
                {t('State', 'state')}
                {t('Pincode', 'pincode', { maxLength: 6, inputMode: 'numeric' })}
              </div>
            </StepPanel>
          )}

          {step === 'contact' && (
            <StepPanel title="Contact person" description="Suppliers and our team will use these details to reach you about quotes and orders." onBack={() => setStep('hospital')} onNext={next}>
              <div className="form-grid">
                {t('Name', 'contact_person_name')}
                {t('Designation', 'contact_person_designation')}
                {t('Mobile', 'contact_person_mobile', { maxLength: 10, inputMode: 'numeric', hint: '10-digit Indian mobile number' })}
                {t('Email', 'contact_person_email', { type: 'email' })}
              </div>
            </StepPanel>
          )}

          {step === 'account' && (
            <StepPanel title="Your account" description="You will be the Hospital Admin and can invite colleagues later." onBack={() => setStep('contact')} last busy={busy} nextLabel="Create account">
              <div className="form-grid">
                {t('Your full name', 'full_name', { autoComplete: 'name' })}
                {t('Your email', 'user_email', { type: 'email', autoComplete: 'email' })}
                {t('Your mobile', 'user_mobile', { maxLength: 10, inputMode: 'numeric', autoComplete: 'tel-national' })}
                {t('Password', 'password', { type: 'password', autoComplete: 'new-password', hint: 'At least 8 characters with a letter and a number' })}
              </div>
              <CheckField error={err('terms_accepted')} {...bind('terms_accepted')} checked={values.terms_accepted}>
                I accept the {terms ? <a href={terms.document_url} target="_blank" rel="noreferrer">Terms &amp; Conditions (version {terms.version})</a> : 'Terms & Conditions'}
              </CheckField>
            </StepPanel>
          )}

          <p className="muted small">Already registered? <Link to="/login">Sign in</Link></p>
        </div>
      </Wizard>
    </form>
  );
}
