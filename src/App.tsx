import { Navigate, Route, Routes } from 'react-router-dom';
import {
  Home, CalendarDays, Users, UsersRound, Menu, Sun, ListChecks, Activity, UserRound, CalendarClock, MessageSquare, ClipboardList, Star, Settings, LayoutDashboard, Receipt, Package,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { HomeRedirect, PublicOnly, RequireAuth, RequireRole } from '@/auth/guards';
import { AppShell, type NavItem } from '@/components/layout/AppShell';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage, AuthLayout, CompanyLinkPage } from '@/features/auth/AuthPages';
import { JoinPage } from '@/features/auth/JoinPage';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { DashboardPage } from '@/features/admin/DashboardPage';
import { CalendarPage } from '@/features/admin/CalendarPage';
import { NewJobPage, EditJobPage } from '@/features/admin/JobFormPage';
import { AdminJobPage } from '@/features/admin/JobDetailPage';
import { ClientsPage, ClientDetailPage } from '@/features/admin/ClientsPages';
import { TeamPage } from '@/features/admin/TeamPage';
import { SettingsPage, ReviewsPage, MorePage } from '@/features/admin/SettingsPages';
import { ChecklistsPage, ChecklistEditorPage } from '@/features/checklists/ChecklistPages';
import { TodayPage, MyJobsPage, WorkJobPage, ActivityPage } from '@/features/employee/EmployeePages';
import { PortalHome, PortalAppointments, PortalAppointmentDetail, PortalNotes, PortalProfile } from '@/features/portal/PortalPages';
import { NotificationsPage } from '@/features/shared/notifications';
import { InventoryPage, InventoryItemPage } from '@/features/inventory/InventoryPages';
import { AccountPage } from '@/features/shared/AccountPage';
import { BillingOverviewPage } from '@/features/billing/OverviewPage';
import { InvoicesPage, NewInvoicePage, EditInvoicePage, InvoiceDetailPage } from '@/features/billing/InvoicePages';
import { EstimatesPage, NewEstimatePage, EditEstimatePage, EstimateDetailPage } from '@/features/billing/EstimatePages';
import { PaymentsPage, ReportsPage } from '@/features/billing/MoneyPages';
import { RecurringPage, CatalogPage, BillingSettingsPage } from '@/features/billing/SetupPages';
import { PortalBilling, PortalInvoiceDetail, PortalEstimateDetail, PublicInvoicePage, PublicEstimatePage } from '@/features/portal/PortalBilling';

const ADMIN_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/billing', label: 'Billing', icon: Receipt },
  { to: '/team', label: 'Team', icon: UsersRound, desktopOnly: true },
  { to: '/inventory', label: 'Inventory', icon: Package, desktopOnly: true },
  { to: '/checklists', label: 'Checklists', icon: ClipboardList, desktopOnly: true },
  { to: '/reviews', label: 'Reviews', icon: Star, desktopOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, desktopOnly: true },
  { to: '/more', label: 'More', icon: Menu, mobileOnly: true },
];

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/work', label: 'Today', icon: Sun, end: true },
  { to: '/work/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/work/activity', label: 'Activity', icon: Activity },
  { to: '/work/profile', label: 'Profile', icon: UserRound },
];

const CLIENT_NAV: NavItem[] = [
  { to: '/portal', label: 'Home', icon: Home, end: true },
  { to: '/portal/appointments', label: 'Appointments', icon: CalendarClock },
  { to: '/portal/billing', label: 'Billing', icon: Receipt },
  { to: '/portal/notes', label: 'Notes', icon: MessageSquare },
  { to: '/portal/profile', label: 'Profile', icon: UserRound },
];

function EmployeeShell() {
  const { workspace } = useAuth();
  const nav = workspace?.billingAccess && !workspace.isAdmin
    ? [...EMPLOYEE_NAV.slice(0, 3), { to: '/work/billing', label: 'Billing', icon: Receipt }, EMPLOYEE_NAV[3]]
    : EMPLOYEE_NAV;
  return (
    <AppShell
      nav={nav}
      notificationsPath="/work/activity"
      sidebarExtra={workspace?.isAdmin && <ButtonLink to="/dashboard" variant="soft" size="sm" icon={<LayoutDashboard />}>Back to admin</ButtonLink>}
    />
  );
}

/** Read-only billing for team members an admin granted access to. */
function RequireBillingAccess({ children }: { children: JSX.Element }) {
  const { workspace } = useAuth();
  return workspace?.billingAccess ? children : <Navigate to="/work" replace />;
}

function NotFound() {
  return (
    <AuthLayout>
      <EmptyState title="Page not found" action={<ButtonLink to="/">Go home</ButtonLink>}>That link doesn’t go anywhere.</EmptyState>
    </AuthLayout>
  );
}

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/c/:slug" element={<CompanyLinkPage />} />
      <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
      <Route path="/" element={<HomeRedirect />} />
      {/* Secure links for clients without a portal login */}
      <Route path="/pay/:token" element={<PublicInvoicePage />} />
      <Route path="/estimate/:token" element={<PublicEstimatePage />} />

      {/* Business owner / admin */}
      <Route element={<RequireRole roles={['owner', 'admin']}><AppShell nav={ADMIN_NAV} notificationsPath="/notifications" /></RequireRole>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/jobs" element={<Navigate to="/calendar" replace />} />
        <Route path="/jobs/new" element={<NewJobPage />} />
        <Route path="/jobs/:id" element={<AdminJobPage />} />
        <Route path="/jobs/:id/edit" element={<EditJobPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/:id" element={<InventoryItemPage />} />
        <Route path="/checklists" element={<ChecklistsPage />} />
        <Route path="/checklists/:id" element={<ChecklistEditorPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/more" element={<MorePage />} />
        <Route path="/account" element={<AccountPage backTo={{ to: '/more', label: 'More' }} />} />
        <Route path="/billing" element={<BillingOverviewPage />} />
        <Route path="/billing/invoices" element={<InvoicesPage />} />
        <Route path="/billing/invoices/new" element={<NewInvoicePage />} />
        <Route path="/billing/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/billing/invoices/:id/edit" element={<EditInvoicePage />} />
        <Route path="/billing/estimates" element={<EstimatesPage />} />
        <Route path="/billing/estimates/new" element={<NewEstimatePage />} />
        <Route path="/billing/estimates/:id" element={<EstimateDetailPage />} />
        <Route path="/billing/estimates/:id/edit" element={<EditEstimatePage />} />
        <Route path="/billing/payments" element={<PaymentsPage />} />
        <Route path="/billing/recurring" element={<RecurringPage />} />
        <Route path="/billing/services" element={<CatalogPage />} />
        <Route path="/billing/reports" element={<ReportsPage />} />
        <Route path="/billing/settings" element={<BillingSettingsPage />} />
      </Route>

      {/* Team member / employee (owners who also clean can use it too) */}
      <Route element={<RequireRole roles={['employee']}><EmployeeShell /></RequireRole>}>
        <Route path="/work" element={<TodayPage />} />
        <Route path="/work/jobs" element={<MyJobsPage />} />
        <Route path="/work/jobs/:id" element={<WorkJobPage />} />
        <Route path="/work/activity" element={<ActivityPage />} />
        <Route path="/work/profile" element={<AccountPage />} />
        <Route path="/work/billing" element={<RequireBillingAccess><InvoicesPage basePath="/work/billing" readOnly /></RequireBillingAccess>} />
        <Route path="/work/billing/:id" element={<RequireBillingAccess><InvoiceDetailPage readOnly backTo="/work/billing" /></RequireBillingAccess>} />
      </Route>

      {/* Client portal */}
      <Route element={<RequireRole roles={['client']}><AppShell nav={CLIENT_NAV} notificationsPath="/portal/notifications" /></RequireRole>}>
        <Route path="/portal" element={<PortalHome />} />
        <Route path="/portal/appointments" element={<PortalAppointments />} />
        <Route path="/portal/appointments/:id" element={<PortalAppointmentDetail />} />
        <Route path="/portal/billing" element={<PortalBilling />} />
        <Route path="/portal/billing/invoices/:id" element={<PortalInvoiceDetail />} />
        <Route path="/portal/billing/estimates/:id" element={<PortalEstimateDetail />} />
        <Route path="/portal/notes" element={<PortalNotes />} />
        <Route path="/portal/notifications" element={<NotificationsPage title="Reminders" />} />
        <Route path="/portal/profile" element={<PortalProfile />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
