import { Link } from 'react-router-dom';
import { PackageX } from 'lucide-react';
import { SectionTitle } from '@/components/ui/Misc';
import { fmtStock, stockLevel, useInventoryItems } from './api';
import { StockBadge } from './components';

/** Dashboard card: only renders when something is at or below its reorder level. */
export function LowStockCard() {
  const q = useInventoryItems();
  const low = (q.data ?? []).filter((i) => stockLevel(i) !== 'ok' && (Number(i.reorder_level) > 0 || Number(i.quantity) <= 0));
  if (!low.length) return null;
  return (
    <>
      <SectionTitle action={<Link to="/inventory?filter=low" className="small strong">Reorder list</Link>}>
        <span className="row" style={{ ['--gap' as string]: '8px' }}><PackageX size={18} color="var(--amber)" aria-hidden />Low on supplies</span>
      </SectionTitle>
      <div className="card list">
        {low.slice(0, 5).map((i) => (
          <Link key={i.id} to={`/inventory/${i.id}`} className="list-item" style={{ minHeight: 54 }}>
            <span className="grow strong truncate">{i.name}</span>
            <span className="muted small">{fmtStock(i.quantity, i.unit)} left</span>
            <StockBadge item={i} />
          </Link>
        ))}
        {low.length > 5 && <Link to="/inventory?filter=low" className="list-item small strong" style={{ minHeight: 48 }}>+{low.length - 5} more</Link>}
      </div>
    </>
  );
}
