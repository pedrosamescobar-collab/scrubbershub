import type { Theme } from './brand';

// Row types mirroring supabase/migrations/0001_scrubhub_schema.sql

export type Role = 'owner' | 'admin' | 'employee' | 'client';
export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type Recurrence = 'none' | 'weekly' | 'biweekly' | 'monthly';
export type PhotoKind = 'before' | 'after' | 'other';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  brand_color: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  timezone: string;
  created_at: string;
  trade: Trade;
  theme: Theme | null;
}

export type Trade = 'cleaning' | 'plumbing';
export type JobPriority = 'normal' | 'urgent' | 'emergency';

export interface OrganizationSettings {
  org_id: string;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  reminder_hours_before: number;
  review_requests_enabled: boolean;
  email_notifications: boolean;
  sms_notifications: boolean;
  require_photos_to_complete: boolean;
}

export interface Subscription {
  org_id: string;
  plan: string;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused';
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  status: 'active' | 'inactive';
  organization?: Organization;
}

export interface Employee {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_title: string | null;
  color: string;
  status: 'active' | 'inactive';
  billing_access?: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  org_id: string;
  name: string;
  color: string;
  team_members?: { employee_id: string }[];
}

export interface Client {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  access_instructions: string | null;
  cleaning_preferences: string | null;
  pets: string | null;
  special_notes: string | null;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface Invitation {
  id: string;
  org_id: string;
  token: string;
  role: 'admin' | 'employee' | 'client';
  employee_id: string | null;
  client_id: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface ChecklistTemplate {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  checklist_sections?: ChecklistSection[];
}

export interface ChecklistSection {
  id: string;
  org_id: string;
  template_id: string;
  name: string;
  position: number;
  checklist_items?: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  org_id: string;
  template_id: string;
  section_id: string;
  label: string;
  is_required: boolean;
  position: number;
}

export interface Appointment {
  id: string;
  org_id: string;
  client_id: string;
  service_name: string;
  checklist_template_id: string | null;
  starts_at: string;
  duration_minutes: number;
  recurrence: Recurrence;
  occurrences: number;
  internal_notes: string | null;
}

export interface JobAssignment {
  id: string;
  job_id: string;
  employee_id: string | null;
  team_id: string | null;
  employee?: Pick<Employee, 'id' | 'full_name' | 'color' | 'user_id'> | null;
  team?: Pick<Team, 'id' | 'name' | 'color'> | null;
}

export interface JobChecklistItem {
  id: string;
  job_id: string;
  section_name: string;
  section_position: number;
  label: string;
  is_required: boolean;
  position: number;
  completed_at: string | null;
  completed_by: string | null;
}

export interface Job {
  id: string;
  org_id: string;
  appointment_id: string | null;
  client_id: string;
  service_name: string;
  scheduled_start: string;
  scheduled_end: string;
  status: JobStatus;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  priority: JobPriority;
  client?: Client | null;
  appointment?: Pick<Appointment, 'id' | 'recurrence' | 'internal_notes' | 'checklist_template_id'> | null;
  job_assignments?: JobAssignment[];
  job_checklist_items?: Pick<JobChecklistItem, 'id' | 'is_required' | 'completed_at'>[];
  reviews?: Pick<Review, 'id' | 'rating'>[];
}

export interface JobNote {
  id: string;
  job_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface ClientNote {
  id: string;
  org_id: string;
  client_id: string;
  job_id: string | null;
  author_id: string | null;
  author_name: string | null;
  from_client: boolean;
  body: string;
  created_at: string;
  client?: Pick<Client, 'id' | 'full_name'> | null;
}

export interface TimeEntry {
  id: string;
  job_id: string;
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  employee?: Pick<Employee, 'id' | 'full_name' | 'color'> | null;
  job?: Pick<Job, 'id' | 'service_name' | 'client_id'> & { client?: Pick<Client, 'full_name'> | null } | null;
}

export interface JobPhoto {
  id: string;
  job_id: string;
  kind: PhotoKind;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Review {
  id: string;
  org_id: string;
  job_id: string;
  client_id: string;
  rating: number;
  body: string | null;
  private_feedback: string | null;
  admin_response: string | null;
  is_hidden: boolean;
  created_at: string;
  client?: Pick<Client, 'id' | 'full_name'> | null;
  job?: Pick<Job, 'id' | 'service_name' | 'scheduled_start'> | null;
}

export interface AppNotification {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// ---- Inventory (supabase/migrations/0003_inventory.sql)
export type InventoryMovementKind = 'restock' | 'use' | 'waste' | 'adjust';

export interface InventoryItem {
  id: string;
  org_id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  reorder_level: number;
  reorder_quantity: number | null;
  unit_cost: number | null;
  supplier: string | null;
  sku: string | null;
  location: string | null;
  assigned_employee_id: string | null;
  notes: string | null;
  is_archived: boolean;
  billable: boolean;
  sell_price: number | null;
  low_stock_notified_at: string | null;
  created_at: string;
  updated_at: string;
  assigned_employee?: Pick<Employee, 'id' | 'full_name' | 'color'> | null;
}

export interface InventoryMovement {
  id: string;
  org_id: string;
  item_id: string;
  kind: InventoryMovementKind;
  quantity_change: number;
  quantity_after: number;
  unit_cost: number | null;
  job_id: string | null;
  employee_id: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  reverses_id: string | null;
  undone_at: string | null;
  created_at: string;
  item?: Pick<InventoryItem, 'id' | 'name' | 'unit' | 'category'> | null;
  job?: { id: string; service_name: string; scheduled_start: string; client?: { full_name: string } | null } | null;
}

// ---- Equipment at a client's property (0004_trades_theme_equipment.sql)
export interface ClientEquipment {
  id: string;
  org_id: string;
  client_id: string;
  kind: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  location: string | null;
  installed_on: string | null;
  warranty_until: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  job_equipment?: (JobEquipment & { job?: { id: string; service_name: string; scheduled_start: string; status: JobStatus } | null })[];
}

export interface JobEquipment {
  job_id: string;
  equipment_id: string;
  org_id: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  equipment?: ClientEquipment | null;
}
