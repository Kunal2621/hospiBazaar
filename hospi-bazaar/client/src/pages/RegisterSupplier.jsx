import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { useAuth, homeFor } from '../auth.jsx';
import { Wizard, StepPanel } from '../components/Wizard.jsx';
import { Alert, AreaField, CheckField, SelectField, TextField, focusFirstError, useFields } from '../components/ui.jsx';

const STEPS = [
  { id: 'company', label: 'Company' },
  { id: 'offer', label: 'What you supply' },
  { id: 'bank', label: 'Bank and documents' },
  { id: 'account', label: 'Your account' },
];

const STEP_FIELDS = {
  company: ['company_name', 'supplier_type', 'pan', 'gstin', 'phone', 'email', 'website', 'business_proof_type', 'business_proof_number', 'registered_address', 'city', 'state', 'pincode'],
  offer: ['has_own_factory', 'factory_address', 'trademark_number', 'brands', 'categories', 'states', 'service_capability_note'],
  bank: ['account_holder_name', 'account_number', 'ifsc', 'cancelled_cheque_url', 'documents'],
  account: ['full_name', 'user_email', 'user_mobile', 'password', 'terms_accepted'],
};
const REQUIRED = {
  company: ['company_name', 'pan', 'gstin', 'phone', 'email', 'business_proof_number', 'registered_address', 'city', 'state', 'pincode'],
  offer: [],
  bank: ['account_holder_name', 'account_number', 'ifsc', 'cancelled_cheque_url'],
  account: ['full_name', 'user_email', 'user_mobile', 'password'],
};
const stepOf = (field) => Object.keys(STEP_FIELDS).find((s) => STEP_FIELDS[s].includes(field));

const INITIAL = {
  company_name: '', supplier_type: 'manufacturer', pan: '', gstin: '', phone: '', email: '', website: '',
  business_proof_type: 'udyam', business_proof_number: '', registered_address: '', city: '', state: '', pincode: '',
  has_own_factory: true, factory_address: '', trademark_number: '', brands: '', states: '', service_capability_note: '',
  account_holder_name: '', account_number: '', ifsc: '', cancelled_cheque_url: '',
  full_name: '', user_email: '', user_mobile: '', password: '', terms_accepted: false,
};

const isDealerType = (t) => t === 'authorised_dealer' || t === 'distributor';

// Supporting documents asked for, by supplier type (spec §19).
const DOC_FIELDS = [
  { type: 'business_proof', label: 'Business proof' },
  { type: 'factory_license', label: 'Factory or manufacturing licence', show: (v) => !isDealerType(v.supplier_type) && v.has_own_factory },
  { type: 'trademark', label: 'Trademark registration', show: (v) => !isDealerType(v.supplier_type) && v.has_own_factory },
  { type: 'sourcing_invoice', label: 'Sample purchase invoice from your manufacturer', show: (v) => !isDealerType(v.supplier_type) && !v.has_own_factory },
  { type: 'dealer_authorisation', label: 'Dealer authorisation letter', show: (v) => isDealerType(v.supplier_type) },
  { type: 'iso_13485', label: 'ISO 13485 or CDSCO certificate', optional: true },
];

const SERVER_KEY = { 'user.full_name': 'full_name', 'user.email': 'user_email', 'user.mobile': 'user_mobile', 'user.password': 'password' };

export default function RegisterSupplier() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { values, bind } = useFields(INITIAL);
  const [docUrls, setDocUrls] = useState({});
  const [categories, setCategories] = useState([]);
  const [picked, setPicked] = useState([]);
  const [step, setStep] = useState('company');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState(null);

  useEffect(() => {
    api('/categories').then((d) => setCategories(d.categories)).catch(() => {});
    api('/terms/supplier').then((d) => setTerms(d.terms)).catch(() => {});
  }, []);

  const errorSteps = useMemo(() => new Set(Object.keys(errors).map(stepOf).filter(Boolean)), [errors]);
  const idx = STEPS.findIndex((s) => s.id === step);
  const err = (name) => errors[name];
  const dealer = isDealerType(values.supplier_type);
  const togglePick = (id) => { setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setErrors((e) => ({ ...e, categories: undefined })); };

  function checkStep(id) {
    const missing = {};
    for (const f of REQUIRED[id]) if (!String(values[f]).trim()) missing[f] = 'Required';
    if (id === 'offer') {
      if (picked.length === 0) missing.categories = 'Choose at least one category';
      if (!dealer && values.has_own_factory && !values.factory_address.trim()) missing.factory_address = 'Required';
    }
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
    const ownFactory = !dealer && v.has_own_factory;
    const body = {
      supplier: {
        company_name: v.company_name, supplier_type: v.supplier_type, registered_address: v.registered_address,
        city: v.city, state: v.state, pincode: v.pincode, phone: v.phone, email: v.email, website: v.website,
        pan: v.pan, gstin: v.gstin, business_proof_type: v.business_proof_type, business_proof_number: v.business_proof_number,
        has_own_factory: ownFactory, factory_address: ownFactory ? v.factory_address : '',
        trademark_number: ownFactory ? v.trademark_number : '', service_capability_note: v.service_capability_note,
      },
      user: { full_name: v.full_name, email: v.user_email, mobile: v.user_mobile, password: v.password },
      categories: picked,
      brands: v.brands.split(',').map((b) => b.trim()).filter(Boolean),
      service_locations: v.states.split(',').map((s) => s.trim()).filter(Boolean).map((state) => ({ state })),
      bank: { account_holder_name: v.account_holder_name, account_number: v.account_number, ifsc: v.ifsc, cancelled_cheque_url: v.cancelled_cheque_url },
      documents: DOC_FIELDS.filter((d) => (!d.show || d.show(v)) && docUrls[d.type]).map((d) => ({ document_type: d.type, file_url: docUrls[d.type] })),
      terms_accepted: v.terms_accepted,
    };
    try {
      const data = await api('/auth/register/supplier', { method: 'POST', body });
      signIn(data);
      navigate(homeFor(data.user), { replace: true });
    } catch (ex) {
      if (ex instanceof ApiError) {
        const mapped = {};
        for (const [k, msg] of Object.entries(ex.fields || {})) {
          const key = SERVER_KEY[k] || k.replace(/^supplier\./, '').replace(/^bank\./, '');
          mapped[key.startsWith('documents') ? 'documents' : key] = msg;
        }
        setErrors(mapped);
        setFormError(Object.keys(mapped).length ? 'Some details need fixing. The steps marked with ! show where.' : ex.message);
        const order = (id) => STEPS.findIndex((s) => s.id === id);
        const first = Object.keys(mapped).map(stepOf).filter(Boolean).sort((a, b) => order(a) - order(b))[0];
        if (first) setStep(first);
        focusFirstError();
      } else setFormError('Something went wrong. Try again.');
    } finally { setBusy(false); }
  }

  const t = (label, name, extra = {}) => <TextField label={label} error={err(name)} {...bind(name)} {...extra} />;

  return (
    <form onSubmit={submit} noValidate>
      <Wizard
        title="Apply as a supplier"
        intro="Our team reviews every application. You can list products and quote on RFQs once you are verified."
        steps={STEPS} current={step} onGo={setStep} errorSteps={errorSteps}
      >
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Alert>{formError}</Alert>

          {step === 'company' && (
            <StepPanel title="Company" description="Enter these exactly as they appear on your GST and PAN records." onNext={next}>
              <div className="form-grid">
                {t('Company name', 'company_name', { autoComplete: 'organization' })}
                <SelectField label="Supplier type" error={err('supplier_type')} {...bind('supplier_type')}>
                  <option value="manufacturer">Manufacturer</option>
                  <option value="brand_oem">Brand owner or OEM</option>
                  <option value="authorised_dealer">Authorised dealer</option>
                  <option value="distributor">Distributor</option>
                </SelectField>
                {t('PAN', 'pan', { maxLength: 10, placeholder: 'AAACM1234B' })}
                {t('GSTIN', 'gstin', { maxLength: 15, placeholder: '27AAACM1234B1Z5' })}
                {t('Phone', 'phone', { type: 'tel', autoComplete: 'tel' })}
                {t('Company email', 'email', { type: 'email' })}
                {t('Website', 'website', { optional: true, placeholder: 'https://' })}
                <SelectField label="Business proof" error={err('business_proof_type')} {...bind('business_proof_type')}>
                  <option value="udyam">Udyam (MSME) registration</option>
                  <option value="incorporation_certificate">Certificate of Incorporation</option>
                  <option value="shop_establishment">Shop and Establishment</option>
                  <option value="trade_license">Trade licence</option>
                </SelectField>
                {t('Business proof number', 'business_proof_number')}
              </div>
              <div className="form-grid form-grid--full">{t('Registered address', 'registered_address', { autoComplete: 'street-address' })}</div>
              <div className="form-grid">
                {t('City', 'city')}
                {t('State', 'state')}
                {t('Pincode', 'pincode', { maxLength: 6, inputMode: 'numeric' })}
              </div>
            </StepPanel>
          )}

          {step === 'offer' && (
            <StepPanel title="What you supply" description="Choose the categories you sell. Hospitals asking for these categories will see your quotations." onBack={() => setStep('company')} onNext={next}>
              {!dealer && (
                <div className="reg__section">
                  <h3 className="reg__section-title">Manufacturing</h3>
                  <CheckField {...bind('has_own_factory')} checked={values.has_own_factory}>We manufacture in our own factory</CheckField>
                  {values.has_own_factory ? (
                    <div className="form-grid">
                      {t('Factory address', 'factory_address')}
                      {t('Trademark number', 'trademark_number', { optional: true, hint: 'Proof that the brand is yours' })}
                    </div>
                  ) : (
                    <p className="muted small">You will be asked for a sample purchase invoice from your manufacturer in the next step.</p>
                  )}
                </div>
              )}

              <div className="reg__section">
                <h3 className="reg__section-title">Categories</h3>
                {err('categories') && <span className="field__error">{err('categories')}</span>}
                {categories.map((g) => (
                  <div key={g.id} className="reg__group">
                    <span className="reg__group-name">{g.name}</span>
                    <div className="choice-chips">
                      {g.children.map((c) => (
                        <label key={c.id} className="choice">
                          <input type="checkbox" checked={picked.includes(c.id)} onChange={() => togglePick(c.id)} />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="reg__section">
                <h3 className="reg__section-title">Brands and service</h3>
                <div className="form-grid">
                  {t('Brands you sell', 'brands', { optional: true, hint: 'Separate with commas' })}
                  {t('States where you provide service', 'states', { optional: true, hint: 'Separate with commas' })}
                </div>
                <div className="form-grid form-grid--full">
                  <AreaField label="Service capability" optional hint="Service centres, technician availability, response times" error={err('service_capability_note')} {...bind('service_capability_note')} />
                </div>
              </div>
            </StepPanel>
          )}

          {step === 'bank' && (
            <StepPanel title="Bank and documents" description="Your bank account is used for payouts and refunds. It is shown to our verification team only." onBack={() => setStep('offer')} onNext={next}>
              <div className="form-grid">
                {t('Account holder name', 'account_holder_name')}
                {t('Account number', 'account_number', { inputMode: 'numeric' })}
                {t('IFSC', 'ifsc', { maxLength: 11, placeholder: 'HDFC0001234' })}
                {t('Cancelled cheque (link)', 'cancelled_cheque_url', { placeholder: 'https://', hint: 'File upload is coming. For now, paste a link.' })}
              </div>
              <div className="reg__section">
                <h3 className="reg__section-title">Supporting documents</h3>
                {err('documents') && <span className="field__error">{err('documents')}</span>}
                <div className="form-grid">
                  {DOC_FIELDS.filter((d) => !d.show || d.show(values)).map((d) => (
                    <TextField key={d.type} label={d.label} optional={d.optional} placeholder="https://" value={docUrls[d.type] || ''}
                      onChange={(e) => setDocUrls((u) => ({ ...u, [d.type]: e.target.value }))} />
                  ))}
                </div>
              </div>
            </StepPanel>
          )}

          {step === 'account' && (
            <StepPanel title="Your account" description="You will be the account owner for this supplier." onBack={() => setStep('bank')} last busy={busy} nextLabel="Submit application">
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
