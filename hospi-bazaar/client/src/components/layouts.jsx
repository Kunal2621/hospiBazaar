import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2, ClipboardList, FileText, LayoutDashboard, LogOut, Menu, MessagesSquare, Package, ReceiptText, Scale, Settings, ShieldCheck, ShoppingCart, Store, Wallet, Wrench, X,
} from 'lucide-react';
import { useAuth, homeFor } from '../auth.jsx';
import { Alert, Loading, useToast } from './ui.jsx';
import { api } from '../api.js';
import { NotificationBell } from './common.jsx';

export function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand" aria-label="Hospi Bazaar home">
      <span className="brand__mark" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
          <path d="M12 4v16M4 12h16" />
        </svg>
      </span>
      <span>Hospi<span className="brand__tail"> Bazaar</span></span>
    </Link>
  );
}

/* ---------------- Public site ---------------- */
export function PublicLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
      <header className="site-header">
        <div className="wrap site-header__inner">
          <Brand />
          <nav className="site-nav" aria-label="Main">
            {user ? (
              <>
                <Link to="/marketplace" className="site-nav__link site-nav__link--hide-sm">Browse products</Link>
                <Link to={homeFor(user)} className="btn btn--small">Open your workspace</Link>
              </>
            ) : (
              <>
                <Link to="/marketplace" className="site-nav__link site-nav__link--hide-sm">Browse products</Link>
                <Link to="/register/supplier" className="site-nav__link site-nav__link--hide-sm">Sell on Hospi Bazaar</Link>
                <Link to="/login" className="site-nav__link">Sign in</Link>
                <Link to="/register/hospital" className="btn btn--small"><span>Register<span className="site-nav__long"> hospital</span></span></Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main><Outlet /></main>
      <footer className="site-footer">
        <div className="wrap site-footer__inner">
          <div>
            <Brand />
            <p className="muted small" style={{ marginTop: '0.75rem' }}>Structured procurement for hospital furniture and medical equipment.</p>
          </div>
          <div>
            <p className="site-footer__title">For hospitals</p>
            <ul className="site-footer__list">
              <li><Link to="/register/hospital">Register your hospital</Link></li>
              <li><Link to="/login">Sign in</Link></li>
            </ul>
          </div>
          <div>
            <p className="site-footer__title">For suppliers</p>
            <ul className="site-footer__list">
              <li><Link to="/register/supplier">Apply as a supplier</Link></li>
              <li><Link to="/login">Sign in</Link></li>
            </ul>
          </div>
          <p className="site-footer__fine">Sample figures on this site are for illustration only.</p>
        </div>
      </footer>
    </>
  );
}

/* ---------------- Signed-in shell ---------------- */
const NAV = {
  hospital_user: {
    title: 'My Hospital',
    items: [
      { to: '/hospital', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/marketplace', label: 'Marketplace', icon: Store },
      { to: '/hospital/cart', label: 'Cart', icon: ShoppingCart },
      { to: '/hospital/rfqs', label: 'RFQs and quotations', icon: FileText },
      { to: '/hospital/negotiations', label: 'Negotiations', icon: MessagesSquare },
      { to: '/hospital/orders', label: 'Orders', icon: ReceiptText },
      { to: '/hospital/warranty', label: 'Warranty', icon: ShieldCheck },
      { to: '/hospital/service', label: 'Service requests', icon: Wrench },
    ],
  },
  supplier_user: {
    title: 'My Business',
    items: [
      { to: '/supplier', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/supplier/products', label: 'Products', icon: Package },
      { to: '/supplier/rfqs', label: 'RFQs and quotations', icon: FileText },
      { to: '/supplier/negotiations', label: 'Negotiations', icon: MessagesSquare },
      { to: '/supplier/orders', label: 'Orders', icon: ReceiptText },
      { to: '/supplier/warranty', label: 'Warranty', icon: ShieldCheck },
      { to: '/supplier/service', label: 'Service requests', icon: Wrench },
    ],
  },
  admin: {
    title: 'Admin Panel',
    items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/admin/suppliers', label: 'Suppliers', icon: Building2 },
      { to: '/admin/hospitals', label: 'Hospitals', icon: Building2 },
      { to: '/admin/products', label: 'Product approval', icon: Package },
      { to: '/admin/orders', label: 'Orders', icon: ReceiptText },
      { to: '/admin/manual', label: 'Manual orders', icon: ClipboardList },
      { to: '/admin/payouts', label: 'Supplier payouts', icon: Wallet },
      { to: '/admin/disputes', label: 'Disputes', icon: Scale },
      { to: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
};

const ROLE_TEXT = {
  hospital_admin: 'Hospital admin', purchase_manager: 'Purchase manager', purchase_executive: 'Purchase executive',
  doctor: 'Doctor', biomedical_engineer: 'Biomedical engineer',
  owner: 'Owner', sales: 'Sales', operations: 'Operations', service: 'Service',
  super_admin: 'Super admin', verifier: 'Verifier', catalog_manager: 'Catalogue manager', support: 'Support',
};

export function RequireType({ type }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="wrap" style={{ paddingBlock: '3rem' }}><Loading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.type !== type) return <Navigate to={homeFor(user)} replace />;
  return <AppShell />;
}

function VerifyEmailBanner() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Looks again whenever the person comes back to this tab, so confirming in another tab clears the banner.
  useEffect(() => {
    if (!user || user.type === 'admin' || user.emailVerified) return undefined;
    const again = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [user, refresh]);
  if (!user || user.type === 'admin' || user.emailVerified) return null;

  async function resend() {
    setBusy(true);
    try { await api('/auth/resend-verification', { method: 'POST' }); toast(`Email sent to ${user.email}`); }
    catch (e) { toast(e.message, 'bad'); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ marginBottom: '1rem' }}>
      <Alert kind="warn">
        Confirm your email address. We sent a link to <strong>{user.email}</strong>.{' '}
        <button type="button" className="text-button" onClick={resend} disabled={busy}>{busy ? 'Sending…' : 'Send it again'}</button>
      </Alert>
    </div>
  );
}

function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);

  const nav = NAV[user.type];
  const role = user.type === 'admin' ? user.adminRole : user.type === 'supplier_user' ? user.supplierRole : user.hospitalRole;

  return (
    <div className="shell">
      <div className={`shell__scrim${open ? ' is-open' : ''}`} onClick={() => setOpen(false)} aria-hidden />
      <aside className={`shell__side${open ? ' is-open' : ''}`} aria-label="Sidebar">
        <Brand to={homeFor(user)} />
        <nav className="shell__nav" aria-label={nav.title}>
          <span className="shell__heading">{nav.title}</span>
          {nav.items.map((item) => {
            const Icon = item.icon;
            if (!item.to) {
              return (
                <span key={item.label} className="shell__link is-disabled" aria-disabled="true">
                  <Icon size={18} aria-hidden /> {item.label}
                  <span className="badge badge--soon shell__link-soon">Soon</span>
                </span>
              );
            }
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `shell__link${isActive ? ' is-active' : ''}`}>
                <Icon size={18} aria-hidden /> {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="shell__user">
          <div>
            <div className="shell__user-name">{user.fullName}</div>
            <div className="muted small">{ROLE_TEXT[role] || ''}</div>
          </div>
          <button className="btn btn--quiet btn--small" onClick={() => { signOut(); navigate('/'); }}>
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      </aside>
      <div className="shell__main">
        <div className="shell__bar">
          <Brand to={homeFor(user)} />
          <div className="shell__bar-actions">
            <NotificationBell homePath={homeFor(user)} />
            <button className="icon-button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        <div className="shell__content">
          <div className="topline"><NotificationBell homePath={homeFor(user)} /></div>
                    <VerifyEmailBanner />
          <Outlet />
        </div>
      </div>
    </div>
  );
}
