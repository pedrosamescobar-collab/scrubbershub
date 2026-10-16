import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Send, Trash2, UserCheck, UserX, Users, Pencil, HardHat } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth, useWorkspace } from '@/auth/AuthProvider';
import type { Employee, Team, TimeEntry } from '@/lib/types';
import { fmtDuration, minutesBetween } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Switch, TextField, optionalEmail, required, validate } from '@/components/ui/Form';
import { EmptyState, QueryState } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Avatar, Badge, PageHeader, Segmented } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { InviteLinkModal } from '@/features/shared/components';
import { inviteUrl, qk, useEmployees, useTeams } from '@/features/shared/api';
import { useTrade } from '@/features/shared/useTrade';

const EMP_COLORS = ['#0E9F8E', '#1E6FD9', '#7048E8', '#D6336C', '#E8590C', '#2F9E44', '#0B7285', '#B7791F'];

function EmployeeModal({ open, onClose, employee, onCreated }: { open: boolean; onClose: () => void; employee?: Employee | null; onCreated?: (e: Employee) => void }) {
  const tp = useTrade();
  const ws = useWorkspace();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', role_title: '', color: EMP_COLORS[0], billing_access: false });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    if (open) {
      setErrors({});
      setForm(employee
        ? { full_name: employee.full_name, phone: employee.phone ?? '', email: employee.email ?? '', role_title: employee.role_title ?? '', color: employee.color, billing_access: !!employee.billing_access }
        : { full_name: '', phone: '', email: '', role_title: '', color: EMP_COLORS[Math.floor(Math.random() * EMP_COLORS.length)], billing_access: false });
    }
  }, [open, employee]);

  const m = useMutation({
    mutationFn: async () => {
      const row = { full_name: form.full_name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, role_title: form.role_title.trim() || null, color: form.color, billing_access: form.billing_access };
      if (employee) return unwrap(await supabase.from('employees').update(row).eq('id', employee.id).select().single()) as Employee;
      return unwrap(await supabase.from('employees').insert({ ...row, org_id: ws.org.id }).select().single()) as Employee;
    },
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: qk.employees(ws.org.id) });
      toast.success(employee ? 'Employee updated' : 'Employee added');
      onClose();
      if (!employee) onCreated?.(e);
    },
    onError: (e) => toast.error(e),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(form, { full_name: required('Name'), email: optionalEmail });
    setErrors(v);
    if (!Object.keys(v).length) m.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={employee ? 'Edit employee' : 'Add employee'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="emp-form" loading={m.isPending}>{employee ? 'Save' : 'Add & invite'}</Button></>}>
      <form id="emp-form" className="form-grid two" onSubmit={submit} noValidate>
        <TextField className="span-2" label="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} error={errors.full_name} autoFocus />
        <TextField label="Mobile" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <TextField className="span-2" label="Role / title (optional)" placeholder={tp.roleTitlePlaceholder} value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} />
        <div className="span-2 field">
          <span className="label">Calendar color</span>
          <div className="color-swatches" role="radiogroup" aria-label="Calendar color">
            {EMP_COLORS.map((c) => (
              <button type="button" key={c} role="radio" aria-checked={form.color === c} aria-label={c} className="swatch" style={{ background: c, width: 36, height: 36 }} onClick={() => setForm({ ...form, color: c })} />
            ))}
          </div>
        </div>
        <div className="span-2">
          <Switch label="Can view billing" description="Read-only access to invoices and payments. Off by default — only owners and admins manage money."
            checked={form.billing_access} onChange={(v) => setForm({ ...form, billing_access: v })} />
        </div>
      </form>
    </Modal>
  );
}

function TeamModal({ open, onClose, team, employees }: { open: boolean; onClose: () => void; team?: Team | null; employees: Employee[] }) {
  const ws = useWorkspace();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => {
    if (open) { setName(team?.name ?? ''); setMembers(team?.team_members?.map((m) => m.employee_id) ?? []); setErr(undefined); }
  }, [open, team]);

  const m = useMutation({
    mutationFn: async () => {
      let id = team?.id;
      if (team) unwrap(await supabase.from('teams').update({ name: name.trim() }).eq('id', team.id));
      else id = (unwrap(await supabase.from('teams').insert({ org_id: ws.org.id, name: name.trim() }).select('id').single()) as { id: string }).id;
      const current = new Set(team?.team_members?.map((x) => x.employee_id) ?? []);
      const toAdd = members.filter((x) => !current.has(x));
      const toRemove = [...current].filter((x) => !members.includes(x));
      if (toAdd.length) unwrap(await supabase.from('team_members').insert(toAdd.map((employee_id) => ({ team_id: id, employee_id, org_id: ws.org.id }))));
      if (toRemove.length) unwrap(await supabase.from('team_members').delete().eq('team_id', id!).in('employee_id', toRemove));
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.teams(ws.org.id) }); toast.success(team ? 'Team updated' : 'Team created'); onClose(); },
    onError: (e) => toast.error(e),
  });

  return (
    <Modal open={open} onClose={onClose} title={team ? 'Edit team' : 'New team'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => { const e = required('Team name')(name); setErr(e ?? undefined); if (!e) m.mutate(); }}>Save team</Button></>}>
      <div className="stack">
        <TextField label="Team name" placeholder="e.g. Team North" value={name} onChange={(e) => setName(e.target.value)} error={err} autoFocus />
        <span className="label">Members</span>
        {employees.length === 0 && <p className="subtle">Add employees first.</p>}
        <div className="row wrap">
          {employees.filter((e) => e.status === 'active').map((e) => (
            <button key={e.id} type="button" className="chip" aria-pressed={members.includes(e.id)}
              onClick={() => setMembers((m) => (m.includes(e.id) ? m.filter((x) => x !== e.id) : [...m, e.id]))}>
              <span className="dot" style={{ background: e.color }} />{e.full_name}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function TeamPage() {
  const tp = useTrade();
  const ws = useWorkspace();
  const { user, profile, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'people' | 'teams'>('people');
  const [empModal, setEmpModal] = useState<{ open: boolean; employee?: Employee | null }>({ open: params.get('new') === '1' });
  const [teamModal, setTeamModal] = useState<{ open: boolean; team?: Team | null }>({ open: false });
  const [invite, setInvite] = useState<{ url: string; name: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'deactivate' | 'activate' | 'delete-team'; employee?: Employee; team?: Team } | null>(null);

  const employees = useEmployees();
  const teams = useTeams();
  const openEntries = useQuery({
    queryKey: ['open-entries', ws.org.id],
    refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.from('time_entries').select('*').eq('org_id', ws.org.id).is('clock_out_at', null)) as TimeEntry[],
  });

  const getInvite = useMutation({
    mutationFn: async (e: Employee) => {
      const existing = unwrap(await supabase.from('invitations').select('token').eq('employee_id', e.id)
        .is('accepted_at', null).gt('expires_at', new Date().toISOString()).limit(1)) as { token: string }[];
      const token = existing[0]?.token ?? (unwrap(await supabase.from('invitations').insert({
        org_id: ws.org.id, role: 'employee', employee_id: e.id, email: e.email, created_by: user!.id,
      }).select('token').single()) as { token: string }).token;
      return { url: inviteUrl(token), name: e.full_name };
    },
    onSuccess: setInvite,
    onError: (e) => toast.error(e),
  });

  const setStatus = useMutation({
    mutationFn: async ({ e, status }: { e: Employee; status: 'active' | 'inactive' }) =>
      unwrap(await supabase.rpc('set_employee_status', { p_employee: e.id, p_status: status })),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: qk.employees(ws.org.id) }); toast.success(v.status === 'active' ? 'Employee reactivated' : 'Employee deactivated — they can no longer sign in to this workspace'); setConfirm(null); },
    onError: (e) => toast.error(e),
  });

  const deleteTeam = useMutation({
    mutationFn: async (t: Team) => unwrap(await supabase.from('teams').delete().eq('id', t.id)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.teams(ws.org.id) }); toast.success('Team deleted'); setConfirm(null); },
    onError: (e) => toast.error(e),
  });

  const addSelf = useMutation({
    mutationFn: async () => unwrap(await supabase.from('employees').insert({
      org_id: ws.org.id, user_id: user!.id, full_name: profile?.full_name || user?.email || 'Owner', email: user?.email, role_title: 'Owner',
    })),
    onSuccess: async () => { void qc.invalidateQueries({ queryKey: qk.employees(ws.org.id) }); await refresh(); toast.success('You can now be assigned jobs'); },
    onError: (e) => toast.error(e),
  });

  const closeEmp = () => { setEmpModal({ open: false }); if (params.get('new')) setParams({}); };
  const iAmOnTeam = (employees.data ?? []).some((e) => e.user_id === user?.id);

  return (
    <>
      <PageHeader
        title="Team"
        sub="Employees, crews and who’s on the clock"
        actions={tab === 'people'
          ? <Button icon={<Plus />} onClick={() => setEmpModal({ open: true })}>Add employee</Button>
          : <Button icon={<Plus />} onClick={() => setTeamModal({ open: true })}>New team</Button>}
      />
      <Segmented label="Team view" value={tab} onChange={setTab} options={[{ value: 'people', label: 'People' }, { value: 'teams', label: 'Teams' }]} />

      <div className="mt-16">
        {tab === 'people' ? (
          <QueryState query={employees}>
            {(list) => (
              <>
                {!iAmOnTeam && (
                  <div className="card card-pad row wrap" style={{ marginBottom: 14 }}>
                    <HardHat aria-hidden color="var(--brand-strong)" />
                    <span className="grow">{tp.selfWorkHint}</span>
                    <Button size="sm" variant="soft" loading={addSelf.isPending} onClick={() => addSelf.mutate()}>Add me to the team</Button>
                  </div>
                )}
                {list.length === 0 ? (
                  <div className="card"><EmptyState icon={<Users />} title="No employees yet" action={<Button icon={<Plus />} onClick={() => setEmpModal({ open: true })}>Add your first employee</Button>}>
                    Add team members, then send each one a private invite link.</EmptyState></div>
                ) : (
                  <div className="card list">
                    {list.map((e) => {
                      const open = openEntries.data?.find((t) => t.employee_id === e.id);
                      return (
                        <div key={e.id} className="list-item" style={{ opacity: e.status === 'inactive' ? 0.6 : 1 }}>
                          <Avatar name={e.full_name} color={e.color} />
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="strong">{e.full_name}</span>{e.user_id === user?.id && <span className="subtle"> (you)</span>}
                            <span className="muted small truncate" style={{ display: 'block' }}>
                              {[e.role_title, e.phone, e.email].filter(Boolean).join(' · ') || 'No contact info'}
                            </span>
                          </span>
                          <span className="row" style={{ ['--gap' as string]: '6px' }}>
                            {e.status === 'inactive' ? <Badge tone="gray">Inactive</Badge>
                              : open ? <Badge tone="green">{`On the clock · ${fmtDuration(minutesBetween(open.clock_in_at))}`}</Badge>
                              : e.user_id ? <Badge tone="brand">Active</Badge>
                              : <Button size="sm" variant="soft" icon={<Send />} onClick={() => getInvite.mutate(e)} loading={getInvite.isPending && getInvite.variables?.id === e.id}>Invite</Button>}
                            <span style={{ position: 'relative' }}>
                              <button className="icon-btn" aria-label={`Actions for ${e.full_name}`} aria-expanded={menu === e.id} onClick={() => setMenu(menu === e.id ? null : e.id)}><MoreHorizontal /></button>
                              {menu === e.id && (
                                <div className="card" role="menu" style={{ position: 'absolute', right: 0, top: 44, zIndex: 20, minWidth: 200, padding: 6, boxShadow: 'var(--shadow-lg)' }} onMouseLeave={() => setMenu(null)}>
                                  <button role="menuitem" className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(null); setEmpModal({ open: true, employee: e }); }}><Pencil /> Edit</button>
                                  {!e.user_id && <button role="menuitem" className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(null); getInvite.mutate(e); }}><Send /> Invite link</button>}
                                  {e.user_id !== user?.id && (e.status === 'active'
                                    ? <button role="menuitem" className="btn btn-danger-ghost btn-sm btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(null); setConfirm({ kind: 'deactivate', employee: e }); }}><UserX /> Deactivate</button>
                                    : <button role="menuitem" className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(null); setConfirm({ kind: 'activate', employee: e }); }}><UserCheck /> Reactivate</button>)}
                                </div>
                              )}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </QueryState>
        ) : (
          <QueryState query={teams}>
            {(list) => list.length === 0 ? (
              <div className="card"><EmptyState icon={<Users />} title="No teams yet" action={<Button icon={<Plus />} onClick={() => setTeamModal({ open: true })}>Create a team</Button>}>
                Group employees into crews and assign a whole team to a job at once.</EmptyState></div>
            ) : (
              <div className="grid-auto">
                {list.map((t) => {
                  const mem = (employees.data ?? []).filter((e) => t.team_members?.some((m) => m.employee_id === e.id));
                  return (
                    <div key={t.id} className="card card-pad stack">
                      <div className="row-between">
                        <h2>{t.name}</h2>
                        <span className="row" style={{ ['--gap' as string]: '2px' }}>
                          <button className="icon-btn" aria-label={`Edit ${t.name}`} onClick={() => setTeamModal({ open: true, team: t })}><Pencil /></button>
                          <button className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => setConfirm({ kind: 'delete-team', team: t })}><Trash2 /></button>
                        </span>
                      </div>
                      {mem.length ? (
                        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                          {mem.map((e) => <div key={e.id} className="row"><Avatar name={e.full_name} color={e.color} size="sm" />{e.full_name}</div>)}
                        </div>
                      ) : <p className="subtle">No members yet</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </QueryState>
        )}
      </div>

      <button className="fab" aria-label={tab === 'people' ? 'Add employee' : 'New team'} onClick={() => (tab === 'people' ? setEmpModal({ open: true }) : setTeamModal({ open: true }))}><Plus /></button>
      <EmployeeModal open={empModal.open} employee={empModal.employee} onClose={closeEmp} onCreated={(e) => getInvite.mutate(e)} />
      <TeamModal open={teamModal.open} team={teamModal.team} onClose={() => setTeamModal({ open: false })} employees={employees.data ?? []} />
      <InviteLinkModal open={!!invite} onClose={() => setInvite(null)} url={invite?.url ?? null} name={invite?.name ?? ''} role="employee" orgName={ws.org.name} />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        danger={confirm?.kind !== 'activate'}
        loading={setStatus.isPending || deleteTeam.isPending}
        title={confirm?.kind === 'deactivate' ? `Deactivate ${confirm.employee?.full_name}?` : confirm?.kind === 'activate' ? `Reactivate ${confirm?.employee?.full_name}?` : `Delete ${confirm?.team?.name}?`}
        confirmLabel={confirm?.kind === 'deactivate' ? 'Deactivate' : confirm?.kind === 'activate' ? 'Reactivate' : 'Delete team'}
        onConfirm={() => {
          if (confirm?.kind === 'delete-team' && confirm.team) deleteTeam.mutate(confirm.team);
          else if (confirm?.employee) setStatus.mutate({ e: confirm.employee, status: confirm.kind === 'activate' ? 'active' : 'inactive' });
        }}
      >
        {confirm?.kind === 'deactivate' && 'They’ll lose access to this workspace immediately. Their past time entries and notes are kept.'}
        {confirm?.kind === 'activate' && 'They’ll be able to sign in and see assigned jobs again.'}
        {confirm?.kind === 'delete-team' && 'Jobs assigned to this team will lose that assignment. Employees are not deleted.'}
      </ConfirmDialog>
    </>
  );
}
