import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ClipboardList, Copy, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useWorkspace } from '@/auth/AuthProvider';
import type { ChecklistItem, ChecklistSection, ChecklistTemplate } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { TextField, required } from '@/components/ui/Form';
import { EmptyState, QueryState } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { qk, useTemplates } from '@/features/shared/api';
import { starterTemplatesFor, installStarterTemplate } from './starterTemplates';

export function ChecklistsPage() {
  const ws = useWorkspace();
  const q = useTemplates();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | undefined>();

  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.from('checklist_templates').insert({ org_id: ws.org.id, name: name.trim() }).select('id').single()) as { id: string },
    onSuccess: (t) => { void qc.invalidateQueries({ queryKey: qk.templates(ws.org.id) }); navigate(`/checklists/${t.id}`); },
    onError: (e) => toast.error(e),
  });
  const install = useMutation({
    mutationFn: async (key: string) => installStarterTemplate(ws.org.id, starterTemplatesFor(ws.org.trade).find((t) => t.key === key)!),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.templates(ws.org.id) }); toast.success('Checklist added'); },
    onError: (e) => toast.error(e),
  });
  const duplicate = useMutation({
    mutationFn: async (id: string) => {
      const src = unwrap(await supabase.from('checklist_templates').select('*, checklist_sections(*, checklist_items(*))').eq('id', id).single()) as ChecklistTemplate;
      await installStarterTemplate(ws.org.id, {
        key: 'copy', name: `${src.name} (copy)`, description: src.description ?? '',
        sections: [...(src.checklist_sections ?? [])].sort((a, b) => a.position - b.position).map((s) => ({
          name: s.name,
          items: [...(s.checklist_items ?? [])].sort((a, b) => a.position - b.position).map((i) => (i.is_required ? i.label : [i.label, false] as [string, false])),
        })),
      });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.templates(ws.org.id) }); toast.success('Checklist duplicated'); },
    onError: (e) => toast.error(e),
  });

  const names = new Set((q.data ?? []).map((t) => t.name));
  const starters = starterTemplatesFor(ws.org.trade).filter((t) => !names.has(t.name));

  return (
    <>
      <PageHeader title="Checklists" sub={ws.org.trade === 'plumbing' ? 'Step-by-step work orders your technicians follow on every job' : 'Room-by-room task lists your crew follows on every job'}
        actions={<Button icon={<Plus />} onClick={() => { setName(''); setErr(undefined); setNewOpen(true); }}>New checklist</Button>} />
      <QueryState query={q}>
        {(list) => (
          <>
            {list.length === 0 ? (
              <div className="card"><EmptyState icon={<ClipboardList />} title="No checklists yet">Start from a template below or build your own.</EmptyState></div>
            ) : (
              <div className="grid-auto">
                {list.map((t) => {
                  const secs = t.checklist_sections ?? [];
                  const count = secs.reduce((n, s) => n + (s.checklist_items?.length ?? 0), 0);
                  return (
                    <div key={t.id} className="card card-pad stack">
                      <Link to={`/checklists/${t.id}`} style={{ color: 'inherit' }}>
                        <h2>{t.name}</h2>
                        <p className="subtle">{secs.length} room{secs.length === 1 ? '' : 's'} · {count} task{count === 1 ? '' : 's'}</p>
                      </Link>
                      {t.description && <p className="muted small">{t.description}</p>}
                      <div className="row">
                        <Link to={`/checklists/${t.id}`} className="btn btn-soft btn-sm"><Pencil /> Edit</Link>
                        <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => duplicate.mutate(t.id)} loading={duplicate.isPending && duplicate.variables === t.id}>Duplicate</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {starters.length > 0 && (
              <>
                <h2 className="mt-24" style={{ marginBottom: 10 }}>Starter templates</h2>
                <div className="grid-auto">
                  {starters.map((t) => (
                    <div key={t.key} className="card card-pad stack" style={{ background: 'var(--surface-2)' }}>
                      <h3>{t.name}</h3>
                      <p className="subtle">{t.description} · {t.sections.map((s) => s.name).join(', ')}</p>
                      <Button size="sm" variant="secondary" icon={<Plus />} loading={install.isPending && install.variables === t.key} onClick={() => install.mutate(t.key)}>Add & customize</Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </QueryState>
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New checklist" size="sm"
        footer={<><Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button><Button type="submit" form="new-tpl" loading={create.isPending}>Create</Button></>}>
        <form id="new-tpl" onSubmit={(e: FormEvent) => { e.preventDefault(); const m = required('Name')(name); setErr(m ?? undefined); if (!m) create.mutate(); }}>
          <TextField label="Checklist name" placeholder="e.g. Airbnb turnover" value={name} onChange={(e) => setName(e.target.value)} error={err} autoFocus />
        </form>
      </Modal>
    </>
  );
}

export function ChecklistEditorPage() {
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newSection, setNewSection] = useState('');

  const q = useQuery({
    queryKey: qk.template(id),
    queryFn: async () => {
      const t = unwrap(await supabase.from('checklist_templates').select('*, checklist_sections(*, checklist_items(*))').eq('id', id).maybeSingle()) as ChecklistTemplate | null;
      if (!t) throw new Error('Checklist not found');
      const sections = [...(t.checklist_sections ?? [])].sort((a, b) => a.position - b.position)
        .map((s) => ({ ...s, checklist_items: [...(s.checklist_items ?? [])].sort((a, b) => a.position - b.position) }));
      return { ...t, checklist_sections: sections };
    },
  });

  const reload = () => { void qc.invalidateQueries({ queryKey: qk.template(id) }); void qc.invalidateQueries({ queryKey: qk.templates(ws.org.id) }); };
  const run = (fn: () => Promise<unknown>, ok?: string) => fn().then(() => { reload(); if (ok) toast.success(ok); }).catch((e) => toast.error(e));

  const rename = (name: string) => run(async () => unwrap(await supabase.from('checklist_templates').update({ name }).eq('id', id)), 'Renamed');
  const addSection = (name: string) => run(async () => {
    const pos = (q.data?.checklist_sections?.length ?? 0);
    unwrap(await supabase.from('checklist_sections').insert({ org_id: ws.org.id, template_id: id, name, position: pos }));
  });
  const swap = async (table: 'checklist_sections' | 'checklist_items', a: { id: string; position: number }, b: { id: string; position: number }) => {
    unwrap(await supabase.from(table).update({ position: b.position }).eq('id', a.id));
    unwrap(await supabase.from(table).update({ position: a.position }).eq('id', b.id));
  };

  const archive = useMutation({
    mutationFn: async () => unwrap(await supabase.from('checklist_templates').update({ is_archived: true }).eq('id', id)),
    onSuccess: () => { reload(); toast.success('Checklist deleted'); navigate('/checklists'); },
    onError: (e) => toast.error(e),
  });

  return (
    <QueryState query={q}>
      {(t) => (
        <>
          <PageHeader
            back={{ to: '/checklists', label: 'Checklists' }}
            title={editingName !== null ? (
              <form className="row" onSubmit={(e) => { e.preventDefault(); if (editingName.trim()) { rename(editingName.trim()); setEditingName(null); } }}>
                <input className="input" aria-label="Checklist name" value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus style={{ fontSize: 20, fontWeight: 800 }} />
                <Button type="submit" size="sm" iconOnly aria-label="Save name" icon={<Check />} />
                <Button size="sm" variant="ghost" iconOnly aria-label="Cancel" icon={<X />} onClick={() => setEditingName(null)} />
              </form>
            ) : (
              <span className="row">{t.name}<button className="icon-btn" aria-label="Rename checklist" onClick={() => setEditingName(t.name)}><Pencil /></button></span>
            )}
            sub="Changes apply to newly scheduled jobs. Jobs already scheduled keep their copy."
            actions={<Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Delete</Button>}
          />

          <div className="stack" style={{ ['--gap' as string]: '14px', maxWidth: 760 }}>
            {(t.checklist_sections ?? []).map((s, si, arr) => (
              <SectionEditor
                key={s.id}
                section={s}
                isFirst={si === 0}
                isLast={si === arr.length - 1}
                onMove={(dir) => run(() => swap('checklist_sections', s, arr[si + dir]))}
                onChanged={reload}
                swapItems={(a, b) => run(() => swap('checklist_items', a, b))}
              />
            ))}
            {(t.checklist_sections ?? []).length === 0 && (
              <div className="card"><EmptyState icon={<ClipboardList />} title="Add your first room">Rooms group tasks — Kitchen, Bathrooms, Bedrooms…</EmptyState></div>
            )}
            <form className="card card-pad row" onSubmit={(e) => { e.preventDefault(); if (newSection.trim()) { addSection(newSection.trim()); setNewSection(''); } }}>
              <input className="input grow" placeholder="Add a room or section (e.g. Laundry room)" aria-label="New section name" value={newSection} onChange={(e) => setNewSection(e.target.value)} />
              <Button type="submit" icon={<Plus />} disabled={!newSection.trim()}>Add room</Button>
            </form>
          </div>

          <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => archive.mutate()} loading={archive.isPending}
            danger title={`Delete “${t.name}”?`} confirmLabel="Delete checklist">
            It won’t be available for new jobs. Jobs that already use it keep their checklist.
          </ConfirmDialog>
        </>
      )}
    </QueryState>
  );
}

function SectionEditor({
  section, isFirst, isLast, onMove, onChanged, swapItems,
}: {
  section: ChecklistSection; isFirst: boolean; isLast: boolean; onMove: (dir: -1 | 1) => void; onChanged: () => void;
  swapItems: (a: ChecklistItem, b: ChecklistItem) => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; label: string } | null>(null);
  const items = section.checklist_items ?? [];
  const act = (fn: () => Promise<unknown>) => fn().then(onChanged).catch((e) => toast.error(e));

  const addItem = (e: FormEvent) => {
    e.preventDefault();
    const text = label.trim();
    if (!text) return;
    setLabel('');
    act(async () => unwrap(await supabase.from('checklist_items').insert({
      org_id: section.org_id, template_id: section.template_id, section_id: section.id, label: text, is_required: true, position: items.length,
    })));
  };

  return (
    <section className="card" aria-label={section.name}>
      <div className="card-header">
        {renaming !== null ? (
          <form className="row grow" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) act(async () => unwrap(await supabase.from('checklist_sections').update({ name: renaming.trim() }).eq('id', section.id))); setRenaming(null); }}>
            <input className="input" aria-label="Section name" value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
            <Button type="submit" size="sm" iconOnly aria-label="Save" icon={<Check />} />
          </form>
        ) : (
          <h2 className="grow">{section.name} <span className="subtle">· {items.length}</span></h2>
        )}
        <span className="row" style={{ ['--gap' as string]: '0px' }}>
          <button className="icon-btn" aria-label="Move room up" disabled={isFirst} onClick={() => onMove(-1)}><ArrowUp /></button>
          <button className="icon-btn" aria-label="Move room down" disabled={isLast} onClick={() => onMove(1)}><ArrowDown /></button>
          <button className="icon-btn" aria-label="Rename room" onClick={() => setRenaming(section.name)}><Pencil /></button>
          <button className="icon-btn" aria-label="Delete room" onClick={() => setConfirm(true)}><Trash2 /></button>
        </span>
      </div>
      <div className="list mt-8">
        {items.map((it, ii) => (
          <div key={it.id} className="list-item" style={{ minHeight: 54, padding: '8px 12px 8px 18px' }}>
            {editItem?.id === it.id ? (
              <form className="row grow" onSubmit={(e) => { e.preventDefault(); if (editItem.label.trim()) act(async () => unwrap(await supabase.from('checklist_items').update({ label: editItem.label.trim() }).eq('id', it.id))); setEditItem(null); }}>
                <input className="input" aria-label="Task" value={editItem.label} onChange={(e) => setEditItem({ ...editItem, label: e.target.value })} autoFocus />
                <Button type="submit" size="sm" iconOnly aria-label="Save task" icon={<Check />} />
              </form>
            ) : (
              <button className="grow" style={{ background: 'none', border: 0, textAlign: 'left', font: 'inherit', padding: 0, cursor: 'text', color: 'inherit' }} onClick={() => setEditItem({ id: it.id, label: it.label })} aria-label={`Edit task ${it.label}`}>
                {it.label}
              </button>
            )}
            <button
              className={`badge ${it.is_required ? 'badge-amber' : 'badge-gray'} no-dot`}
              style={{ border: 0, cursor: 'pointer' }}
              aria-pressed={it.is_required}
              aria-label={`${it.label}: ${it.is_required ? 'required' : 'optional'}. Toggle.`}
              onClick={() => act(async () => unwrap(await supabase.from('checklist_items').update({ is_required: !it.is_required }).eq('id', it.id)))}
            >
              {it.is_required ? 'Required' : 'Optional'}
            </button>
            <span className="row" style={{ ['--gap' as string]: '0px' }}>
              <button className="icon-btn" aria-label="Move task up" disabled={ii === 0} onClick={() => swapItems(it, items[ii - 1])}><ArrowUp /></button>
              <button className="icon-btn" aria-label="Move task down" disabled={ii === items.length - 1} onClick={() => swapItems(it, items[ii + 1])}><ArrowDown /></button>
              <button className="icon-btn" aria-label={`Remove ${it.label}`} onClick={() => act(async () => unwrap(await supabase.from('checklist_items').delete().eq('id', it.id)))}><Trash2 /></button>
            </span>
          </div>
        ))}
      </div>
      <form className="row card-body" onSubmit={addItem}>
        <input className="input grow" placeholder="Add a task…" aria-label={`New task in ${section.name}`} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button type="submit" variant="secondary" icon={<Plus />} disabled={!label.trim()}>Add</Button>
      </form>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={`Delete “${section.name}”?`} confirmLabel="Delete room"
        onConfirm={() => { setConfirm(false); act(async () => unwrap(await supabase.from('checklist_sections').delete().eq('id', section.id))); }}>
        This removes the room and its {items.length} task{items.length === 1 ? '' : 's'} from this checklist.
      </ConfirmDialog>
    </section>
  );
}
