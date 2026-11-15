import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Inbox, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { TableSkeleton } from './ui/EnterpriseUI';

export interface TableColumn<T> {
  key: string;
  header: string;
  sortValue?: (row: T) => string | number | null | undefined;
  render: (row: T) => ReactNode;
  align?: 'right' | 'left' | 'center';
}

interface DataTableProps<T> {
  rows: T[];
  columns: TableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  searchPlaceholder?: string;
  searchText?: (row: T) => string;
  emptyTitle?: string;
  emptySubtitle?: string;
  pageSize?: number;
  loading?: boolean;
  toolbarExtra?: ReactNode;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchPlaceholder = 'ابحث في الجدول...',
  searchText,
  emptyTitle = 'لا توجد سجلات مطابقة',
  emptySubtitle = 'قم بتعديل الفلاتر أو إضافة/استيراد بيانات جديدة لعرضها هنا.',
  pageSize: initialPageSize = 15,
  loading = false,
  toolbarExtra,
  onRowClick,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortCol, setSortCol] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const filtered = useMemo(() => {
    if (!query.trim() || !searchText) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [rows, query, searchText]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const col = columns.find((c) => c.key === sortCol);
    if (!col || !col.sortValue) return filtered;
    const getter = col.sortValue;
    return [...filtered].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [filtered, sortCol, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pageRows = sorted.slice(startIndex, startIndex + pageSize);

  const toggleSort = (key: string) => {
    if (sortCol === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(key);
      setSortDir('desc');
    }
    setPage(1);
  };

  if (loading) {
    return <TableSkeleton rows={6} cols={Math.min(6, Math.max(3, columns.length))} />;
  }

  return (
    <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {(searchText || rows.length > 0 || toolbarExtra) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[200px]">
            {searchText && (
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder={searchPlaceholder}
                  className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pr-8 pl-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors focus:border-blue-600 dark:focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            )}
            {toolbarExtra}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span>عرض:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs font-mono-num text-slate-800 dark:text-slate-200 focus:border-blue-600 focus:outline-none"
              >
                {[15, 30, 50, 100].map((sz) => (
                  <option key={sz} value={sz}>
                    {sz}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num whitespace-nowrap">
              {sorted.length.toLocaleString('en-US')} سجل
            </div>
          </div>
        </div>
      )}

      {pageRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400">
            <Inbox className="h-5 w-5" />
          </div>
          <div className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-200">{emptyTitle}</div>
          <div className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">{emptySubtitle}</div>
        </div>
      ) : (
        <div className="overflow-x-auto erp-scroll">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/90 text-[11px] font-bold text-slate-600 dark:text-slate-400">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`h-10 px-4 whitespace-nowrap ${
                      col.align === 'center' ? 'text-center' : col.align === 'left' ? 'text-left' : 'text-right'
                    }`}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white transition-colors"
                      >
                        <span>{col.header}</span>
                        {sortCol === col.key ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-35" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {pageRows.map((row, idx) => (
                <tr
                  key={rowKey(row, idx)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`h-[44px] transition-colors ${
                    onRowClick
                      ? 'cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-950/20'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap align-middle ${
                        col.align === 'center' ? 'text-center' : col.align === 'left' ? 'text-left' : 'text-right'
                      }`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-mono-num">
            عرض {(startIndex + 1).toLocaleString('en-US')}–{Math.min(startIndex + pageSize, sorted.length).toLocaleString('en-US')} من{' '}
            {sorted.length.toLocaleString('en-US')} · صفحة {safePage} من {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span>السابق</span>
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <span>التالي</span>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
