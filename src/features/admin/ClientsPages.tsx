import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, KeyRound, Mail, MapPin, PawPrint, Pencil, Phone, Plus, Search, Send, Sparkles, StickyNote, Users } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import type { Client, ClientNote, Job } from '@/lib/types';
import { clientAddress, fmtAgo, mapsUrl } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/Button';
import { TextArea, TextField, optionalEmail, required, validate } from '@/components/ui/Form';
import { EmptyState, QueryState } from '@/components/ui/Feedback';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Avatar, Badge, PageHeader, Segmented } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { InviteLinkModal, JobRow } from '@/features/shared/components';
import { JOB_LIST_SELECT, inviteUrl, qk, useClients } from '@/features/shared/api';
import { useTrade } from '@/features/shared/useTrade';
import { EquipmentSection } from '@/features/equipment/EquipmentSection';

type ClientForm = Pick<Client,
  'full_name' | 'email' | 'phone' | 'address_line1' | 'address_line2' | 'city' | 'state' | 'postal_code' |
  'access_instructions' | 'cleaning_preferences' | 'pets' | 'special_notes'>;

const EMPTY: Record<keyof ClientForm, string> = {
  full_name: '', email: '', phone: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '',
  access_instructions: '', cleaning_preferences: '', pets: '', special_notes: '',
};

export function ClientFormModal({ open, onClose, client, onSaved }: { open: boolean; onClose: () => void; client?: Client | null; onSaved?: (c: Client) => void }) {
  const tp = useTrade();
  const ws = useWorkspace();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (open) {
      setErrors({});
      setForm(client ? (Object.fromEntries(Object.keys(EMPTY).map((k) => [k, (client as unknown as Record<string, string | null>)[k] ?? ''])) as typeof EMPTY) : EMPTY);
    }
  }, [open, client]);

  const m = useMutation({
    mutationFn: async () => {
      const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
      if (client) return unwrap(await supabase.from('clients').update(clean).eq('id', client.id).select().single()) as Client;
      return unwrap(await supabase.from('clients').insert({ ...clean, org_id: ws.org.id }).select().single()) as Client;
    },
    onSuccess: (c) => {
      toast.success(client ? 'Client updated' : 'Client added');
      void qc.invalidateQueries({ queryKey: qk.clients(ws.org.id) });
      void qc.invalidateQueries({ queryKey: qk.client(c.id) });
      onSaved?.(c);
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(form, { full_name: required('Name'), email: optionalEmail });
    setErrors(v);
    if (!Object.keys(v).length) m.mutate();
  };
  const f = (k: keyof ClientForm) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? 'Edit client' : 'New client'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="client-form" loading={m.isPending}>{client ? 'Save changes' : 'Add client'}</Button></>}
    >
      <form id="client-form" className="form-grid two" onSubmit={submit} noValidate>
        <TextField className="span-2" label="Full name" {...f('full_name')} error={errors.full_name} autoFocus />
        <TextField label="Phone" type="tel" inputMode="tel" {...f('phone')} />
        <TextField label="Email" type="email" {...f('email')} error={errors.email} hint="Needed for their portal login" />
        <TextField className="span-2" label="Street address" autoComplete="street-address" {...f('address_line1')} />
        <TextField className="span-2" label="Apt / unit" {...f('address_line2')} />
        <TextField label="City" {...f('city')} />
        <div className="form-grid two"><TextField label="State" {...f('state')} /><TextField label="ZIP" inputMode="numeric" {...f('postal_code')} /></div>
        <TextArea className="span-2" label="Access instructions" placeholder="Gate code, lockbox, where the key is, parking…" {...f('access_instructions')} />
        <TextArea className="span-2" label={tp.prefsLabel} placeholder={tp.prefsPlaceholder} {...f('cleaning_preferences')} />
        <TextField className="span-2" label="Pets" placeholder="e.g. Friendly dog, keep cat inside" {...f('pets')} />
        <TextArea className="span-2" label="Special notes (internal)" {...f('special_notes')} />
      </form>
    </Modal>
  );
}

export function ClientsPage() {
  const tp = useTrade();
  const q = useClients();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'inactive'>('active');
  const [open, setOpen] = useState(params.get('new') === '1');
  const navigate = useNavigate();

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((c) =>
      c.status === filter && (!s || [c.full_name, c.email, c.phone, c.address_line1, c.city].some((v) => v?.toLowerCase().includes(s))));
  }, [q.data, search, filter]);

  return (
    <>
      <PageHeader title="Clients" sub={q.data ? `${q.data.filter((c) => c.status === 'active').length} active` : undefined}
        actions={<Button icon={<Plus />} onClick={() => setOpen(true)}>Add client</Button>} />
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="search grow" style={{ minWidth: 220 }}>
          <Search aria-hidden />
          <input className="input" type="search" placeholder="Search name, address, phone…" aria-label="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Segmented label="Status" value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
      </div>
      <QueryState query={q}>
        {() => list.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Users />} title={search ? 'No matches' : 'No clients yet'}
              action={!search && <Button onClick={() => setOpen(true)} icon={<Plus />}>Add your first client</Button>}>
              {search ? 'Try a different search.' : `Add clients to schedule ${tp.visits} and give them portal access.`}
            </EmptyState>
          </div>
        ) : (
          <div className="card list">
            {list.map((c) => (
              <Link key={c.id} to={`/clients/${c.id}`} className="list-item">
                <Avatar name={c.full_name} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="strong">{c.full_name}</span>
                  <span className="muted small truncate" style={{ display: 'block' }}>{clientAddress(c) || c.phone || c.email || 'No contact info'}</span>
                </span>
                {c.user_id ? <Badge tone="green">Portal</Badge> : null}
              </Link>
            ))}
          </div>
        )}
      </QueryState>
      <button className="fab" aria-label="Add client" onClick={() => setOpen(true)}><Plus /></button>
      <ClientFormModal open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}); }} onSaved={(c) => navigate(`/clients/${c.id}`)} />
    </>
  );
}

export function ClientDetailPage() {
  const tp = useTrade();
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const { user, profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [note, setNote] = useState('');
  const [confirmStatus, setConfirmStatus] = useState(false);

  const q = useQuery({
    queryKey: qk.client(id),
    queryFn: async () => {
      const [c, jobs, notes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', id).maybeSingle(),
        supabase.from('jobs').select(JOB_LIST_SELECT).eq('client_id', id).order('scheduled_start', { ascending: false }).limit(100),
        supabase.from('client_notes').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      ]);
      const client = unwrap(c) as Client | null;
      if (!client) throw new Error('Client not found');
      return { client, jobs: unwrap(jobs) as unknown as Job[], notes: unwrap(notes) as ClientNote[] };
    },
  });

  const makeInvite = useMutation({
    mutationFn: async () => {
      const existing = unwrap(await supabase.from('invitations').select('token, expires_at, accepted_at').eq('client_id', id)
        .is('accepted_at', null).gt('expires_at', new Date().toISOString()).limit(1)) as { token: string }[];
      if (existing[0]) return existing[0].token;
      const inv = unwrap(await supabase.from('invitations').insert({
        org_id: ws.org.id, role: 'client', client_id: id, email: q.data?.client.email, created_by: user!.id,
      }).select('token').single()) as { token: string };
      return inv.token;
    },
    onSuccess: (t) => setInvite(inviteUrl(t)),
    onError: (e) => toast.error(e),
  });

  const addNote = useMutation({
    mutationFn: async () => unwrap(await supabase.from('client_notes').insert({
      org_id: ws.org.id, client_id: id, author_id: user!.id, author_name: profile?.full_name ?? 'Office', body: note.trim(),
    })),
    onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: qk.client(id) }); toast.success('Note saved'); },
    onError: (e) => toast.error(e),
  });

  const toggleStatus = useMutation({
    mutationFn: async () => unwrap(await supabase.from('clients').update({ status: q.data!.client.status === 'active' ? 'inactive' : 'active' }).eq('id', id)),
    onSuccess: () => { setConfirmStatus(false); void qc.invalidateQueries({ queryKey: qk.client(id) }); void qc.invalidateQueries({ queryKey: qk.clients(ws.org.id) }); toast.success('Client updated'); },
    onError: (e) => toast.error(e),
  });

  return (
    <QueryState query={q}>
      {({ client, jobs, notes }) => {
        const now = Date.now();
        const upcoming = jobs.filter((j) => new Date(j.scheduled_end).getTime() >= now && j.status !== 'completed').reverse();
        const past = jobs.filter((j) => !(new Date(j.scheduled_end).getTime() >= now && j.status !== 'completed'));
        const map = mapsUrl(client);
        return (
          <>
            <PageHeader
              back={{ to: '/clients', label: 'Clients' }}
              title={client.full_name}
              sub={client.status === 'inactive' ? 'Inactive client' : client.user_id ? 'Has portal access' : 'No portal access yet'}
              actions={<>
                <Button variant="secondary" icon={<Pencil />} onClick={() => setEdit(true)}>Edit</Button>
                <ButtonLink to={`/jobs/new?client=${client.id}`} icon={<CalendarPlus />}>Schedule</ButtonLink>
              </>}
            />
            <div className="grid-2-lg">
              <div className="stack" style={{ ['--gap' as string]: '16px' }}>
                <div className="card card-pad stack">
                  {client.phone && <a className="row" href={`tel:${client.phone}`}><Phone size={18} aria-hidden /> {client.phone}</a>}
                  {client.email && <a className="row" href={`mailto:${client.email}`}><Mail size={18} aria-hidden /> {client.email}</a>}
                  {clientAddress(client) && (
                    <a className="row" href={map ?? undefined} target="_blank" rel="noreferrer"><MapPin size={18} aria-hidden /> {clientAddress(client)}</a>
                  )}
                  {client.access_instructions && <div className="callout"><div className="label"><KeyRound aria-hidden />Access</div><p className="pre">{client.access_instructions}</p></div>}
                  {client.pets && <div className="callout"><div className="label"><PawPrint aria-hidden />Pets</div><p>{client.pets}</p></div>}
                  {client.cleaning_preferences && <div className="callout"><div className="label"><Sparkles aria-hidden />Preferences</div><p className="pre">{client.cleaning_preferences}</p></div>}
                  {client.special_notes && <div className="callout"><div className="label"><StickyNote aria-hidden />Internal notes</div><p className="pre">{client.special_notes}</p></div>}
                  {!client.phone && !client.email && !clientAddress(client) && <p className="muted">No contact details yet. <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>Add details</button></p>}
                </div>

                <div className="card">
                  <div className="card-header">
                    <h2>Appointments</h2>
                    <Segmented label="Appointments" value={tab} onChange={setTab} options={[{ value: 'upcoming', label: `Upcoming (${upcoming.length})` }, { value: 'past', label: 'Past' }]} />
                  </div>
                  <div className="list mt-8">
                    {(tab === 'upcoming' ? upcoming : past).map((j) => <JobRow key={j.id} job={j} to={`/jobs/${j.id}`} showDate />)}
                    {(tab === 'upcoming' ? upcoming : past).length === 0 && (
                      <EmptyState title={tab === 'upcoming' ? 'Nothing scheduled' : `No past ${tp.visits}`}
                        action={tab === 'upcoming' && <ButtonLink to={`/jobs/new?client=${client.id}`} size="sm" variant="soft">Schedule a {tp.visit}</ButtonLink>} />
                    )}
                  </div>
                </div>
              </div>

              <div className="stack" style={{ ['--gap' as string]: '16px' }}>
                {tp.features.equipment && <EquipmentSection orgId={client.org_id} clientId={client.id} mode="admin" trade={tp.key} />}
                <div className="card card-pad stack">
                  <h2>Client portal</h2>
                  <p className="muted small">
                    {client.user_id
                      ? 'This client can sign in to see appointments, leave notes and reviews.'
                      : 'Send a private link so they can see appointments, leave notes and reviews.'}
                  </p>
                  {!client.user_id && <Button icon={<Send />} onClick={() => makeInvite.mutate()} loading={makeInvite.isPending}>Get portal invite link</Button>}
                </div>

                <div className="card">
                  <div className="card-header"><h2>Notes</h2></div>
                  <div className="card-body stack">
                    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
                      <TextArea label="Add a note" placeholder="Visible to the client and assigned crew" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 72 }} />
                      <Button type="submit" variant="secondary" size="sm" loading={addNote.isPending} disabled={!note.trim()}>Save note</Button>
                    </form>
                    {notes.map((n) => (
                      <div key={n.id} className={`note ${n.from_client ? 'from-client' : ''}`}>
                        <div className="row-between"><span className="strong small">{n.from_client ? client.full_name : n.author_name || 'Office'}</span><span className="subtle">{fmtAgo(n.created_at)}</span></div>
                        <p className="pre small mt-8">{n.body}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <Button variant={client.status === 'active' ? 'danger-ghost' : 'secondary'} onClick={() => setConfirmStatus(true)}>
                  {client.status === 'active' ? 'Mark client inactive' : 'Reactivate client'}
                </Button>
              </div>
            </div>

            <ClientFormModal open={edit} onClose={() => setEdit(false)} client={client} />
            <InviteLinkModal open={!!invite} onClose={() => setInvite(null)} url={invite} name={client.full_name} role="client" orgName={ws.org.name} />
            <ConfirmDialog
              open={confirmStatus}
              onClose={() => setConfirmStatus(false)}
              onConfirm={() => toggleStatus.mutate()}
              loading={toggleStatus.isPending}
              danger={client.status === 'active'}
              title={client.status === 'active' ? 'Mark client inactive?' : 'Reactivate client?'}
              confirmLabel={client.status === 'active' ? 'Mark inactive' : 'Reactivate'}
            >
              {client.status === 'active'
                ? 'They’ll move to the inactive list. Existing appointments stay on the calendar — cancel them separately if needed.'
                : 'They’ll appear in your active client list again.'}
            </ConfirmDialog>
          </>
        );
      }}
    </QueryState>
  );
}
