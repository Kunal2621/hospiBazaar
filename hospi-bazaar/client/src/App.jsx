import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout, RequireType } from './components/layouts.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import { ForgotPassword, ResetPassword } from './pages/PasswordReset.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';
import RegisterHospital from './pages/RegisterHospital.jsx';
import RegisterSupplier from './pages/RegisterSupplier.jsx';
import Marketplace from './pages/Marketplace.jsx';
import ProductPage from './pages/ProductPage.jsx';
import HospitalDashboard from './pages/HospitalDashboard.jsx';
import SupplierDashboard from './pages/SupplierDashboard.jsx';
import AdminQueue from './pages/AdminDashboard.jsx';
import Cart from './pages/hospital/Cart.jsx';
import { RfqDetail, RfqList, RfqNew } from './pages/hospital/Rfqs.jsx';
import { ProductForm, ProductList } from './pages/supplier/Products.jsx';
import { SupplierRfqDetail, SupplierRfqList } from './pages/supplier/Rfqs.jsx';
import { OrderDetail, OrdersList } from './pages/shared/Orders.jsx';
import { NegotiationDetail, NegotiationsList } from './pages/shared/Negotiations.jsx';
import { ServiceDetail, ServiceList, ServiceNew, WarrantyList } from './pages/shared/Service.jsx';
import { AdminHome, Disputes, ManualOrders, Payouts, PlatformSettings, ProductApproval } from './pages/admin/Admin.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/products/:slug" element={<ProductPage />} />
        <Route path="/register/hospital" element={<RegisterHospital />} />
        <Route path="/register/supplier" element={<RegisterSupplier />} />
      </Route>

      <Route element={<RequireType type="hospital_user" />}>
        <Route path="/hospital" element={<HospitalDashboard />} />
        <Route path="/hospital/cart" element={<Cart />} />
        <Route path="/hospital/rfqs" element={<RfqList />} />
        <Route path="/hospital/rfqs/new" element={<RfqNew />} />
        <Route path="/hospital/rfqs/:id" element={<RfqDetail />} />
        <Route path="/hospital/negotiations" element={<NegotiationsList base="/hospital" party="hospital" />} />
        <Route path="/hospital/negotiations/:id" element={<NegotiationDetail base="/hospital" />} />
        <Route path="/hospital/orders" element={<OrdersList base="/hospital" party="hospital" />} />
        <Route path="/hospital/orders/:id" element={<OrderDetail base="/hospital" />} />
        <Route path="/hospital/warranty" element={<WarrantyList base="/hospital" party="hospital" />} />
        <Route path="/hospital/service" element={<ServiceList base="/hospital" party="hospital" />} />
        <Route path="/hospital/service/new" element={<ServiceNew base="/hospital" />} />
        <Route path="/hospital/service/:id" element={<ServiceDetail base="/hospital" party="hospital" />} />
      </Route>

      <Route element={<RequireType type="supplier_user" />}>
        <Route path="/supplier" element={<SupplierDashboard />} />
        <Route path="/supplier/products" element={<ProductList />} />
        <Route path="/supplier/products/new" element={<ProductForm />} />
        <Route path="/supplier/products/:id" element={<ProductForm />} />
        <Route path="/supplier/rfqs" element={<SupplierRfqList />} />
        <Route path="/supplier/rfqs/:id" element={<SupplierRfqDetail />} />
        <Route path="/supplier/negotiations" element={<NegotiationsList base="/supplier" party="supplier" />} />
        <Route path="/supplier/negotiations/:id" element={<NegotiationDetail base="/supplier" />} />
        <Route path="/supplier/orders" element={<OrdersList base="/supplier" party="supplier" />} />
        <Route path="/supplier/orders/:id" element={<OrderDetail base="/supplier" />} />
        <Route path="/supplier/warranty" element={<WarrantyList base="/supplier" party="supplier" />} />
        <Route path="/supplier/service" element={<ServiceList base="/supplier" party="supplier" />} />
        <Route path="/supplier/service/:id" element={<ServiceDetail base="/supplier" party="supplier" />} />
      </Route>

      <Route element={<RequireType type="admin" />}>
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/products" element={<ProductApproval />} />
        <Route path="/admin/orders" element={<OrdersList base="/admin" party="admin" />} />
        <Route path="/admin/orders/:id" element={<OrderDetail base="/admin" />} />
        <Route path="/admin/manual" element={<ManualOrders />} />
        <Route path="/admin/payouts" element={<Payouts />} />
        <Route path="/admin/disputes" element={<Disputes />} />
        <Route path="/admin/settings" element={<PlatformSettings />} />
        <Route path="/admin/:kind" element={<AdminQueue />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
