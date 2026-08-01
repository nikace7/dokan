import { Link } from 'react-router-dom';

const REPORTS = [
  {
    to: '/reports/sales',
    title: 'Sales / बिक्री',
    description: 'Daily sales by BS date, monthly totals by fiscal year, and top-selling items.',
  },
  {
    to: '/reports/stock',
    title: 'Stock / स्टक',
    description: 'Stock summary with valuation, low-stock against reorder levels, and dead stock.',
  },
  {
    to: '/reports/profit',
    title: 'Profit / नाफा',
    description: 'Revenue, cost of goods, and gross profit by BS month. Owner only.',
  },
  {
    to: '/reports/dues',
    title: 'Dues / उधारो',
    description: 'Customer udharo aging (0–30 / 31–60 / 61–90 / 90+ days) and supplier payables.',
  },
  {
    to: '/reports/vat',
    title: 'VAT register / भ्याट',
    description: 'IRD sales and purchase VAT registers by BS date range.',
  },
] as const;

/** Reports home — card grid into each report. */
export function ReportsHomePage() {
  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Reports / प्रतिवेदन</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Link
            key={report.to}
            to={report.to}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <h2 className="text-base font-semibold text-blue-800">{report.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{report.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
