'use client';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const month = (m: string) => new Date(m + '-01').toLocaleString('en-IN', { month: 'short' });

export default function TrendChart({ data, onMonth }: { data: { month: string; logins: number; handovers: number; handoverAmount: number }[]; onMonth?: (month: string) => void }) {
  return (
    <div>
      <div role="img" aria-label={`Logins by month: ${data.map((d) => `${month(d.month)} ${d.logins}`).join(', ')}`} className={onMonth ? 'h-52 cursor-pointer' : 'h-52'}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
          onClick={(e) => {
            const m = (e as { activeLabel?: string } | null)?.activeLabel;
            if (m && onMonth) onMonth(String(m));
          }}
        >
          <CartesianGrid vertical={false} stroke="#e3e7e4" />
          <XAxis dataKey="month" tickFormatter={month} tickLine={false} axisLine={false} tick={{ fill: '#6b746f', fontSize: 12 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#6b746f', fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: '#f0f2f0' }}
            labelFormatter={(m) => new Date(m + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
            formatter={(v, name) => [v as number, name === 'logins' ? 'Logins' : 'Handovers']}
            contentStyle={{ borderRadius: 12, border: '1px solid #e3e7e4' }}
          />
          <Bar dataKey="logins" fill="#d9463b" radius={[6, 6, 0, 0]} maxBarSize={36} />
          <Line dataKey="handovers" stroke="#2f8f83" strokeWidth={3} dot={{ r: 4, fill: '#2f8f83' }} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-ink-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-red" />Logins</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-teal" />Handovers</span>
      </div>
      {onMonth && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.map((d) => (
            <button key={d.month} type="button" onClick={() => onMonth(d.month)} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-600 ring-1 ring-inset ring-ink-200 transition hover:bg-teal-50 hover:text-teal-800 hover:ring-teal-200">
              {month(d.month)}: {d.logins} {d.logins === 1 ? 'case' : 'cases'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
