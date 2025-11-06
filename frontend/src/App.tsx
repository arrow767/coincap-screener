import { useState, useEffect, useMemo, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  FilterFn,
} from '@tanstack/react-table';
import { CoinData } from './types';
import './App.css';

const numericFilterFn: FilterFn<any> = (row, columnId, filterValue) => {
  const value = row.getValue(columnId) as number;
  if (value == null) return false;
  const [operator, threshold] = filterValue as [string, number];
  if (operator === '>') return value > threshold;
  if (operator === '<') return value < threshold;
  if (operator === '>=') return value >= threshold;
  if (operator === '<=') return value <= threshold;
  return true;
};

// Булевый фильтр: true/false/undefined (все)
const booleanFilterFn: FilterFn<any> = (row, columnId, filterValue) => {
  if (filterValue === undefined || filterValue === 'all') return true;
  const value = row.getValue(columnId) as boolean | null;
  if (value == null) return false;
  return filterValue === true ? value === true : value === false;
};

function App() {
  const [data, setData] = useState<CoinData[]>([]);
  const [sorting, setSorting] = useState<SortingState>(() => {
    const saved = localStorage.getItem('tableSorting');
    return saved ? JSON.parse(saved) : [];
  });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const saved = localStorage.getItem('tableFilters');
    return saved ? JSON.parse(saved) : [];
  });
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [newCoins, setNewCoins] = useState<Set<string>>(new Set());
  // Popover для числовых фильтров
  const [filterPopover, setFilterPopover] = useState<{ columnId: string | null; x: number; y: number }>(
    { columnId: null, x: 0, y: 0 }
  );
  const [activeFilterColumn, setActiveFilterColumn] = useState<any | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(() => {
    const saved = localStorage.getItem('showFavoritesOnly');
    return saved === 'true';
  });
  const [priceChanges, setPriceChanges] = useState<Record<string, number>>({});
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [searchSymbol, setSearchSymbol] = useState('');
  const favoritesRef = useRef(favorites);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  // Сохраняем сортировку в localStorage
  useEffect(() => {
    localStorage.setItem('tableSorting', JSON.stringify(sorting));
  }, [sorting]);

  // Сохраняем фильтры в localStorage
  useEffect(() => {
    localStorage.setItem('tableFilters', JSON.stringify(columnFilters));
  }, [columnFilters]);

  // Сохраняем флаг "только избранное"
  useEffect(() => {
    localStorage.setItem('showFavoritesOnly', showFavoritesOnly.toString());
  }, [showFavoritesOnly]);

  useEffect(() => {
    const stored = localStorage.getItem('favorites');
    if (stored) setFavorites(new Set(JSON.parse(stored)));
    
    const storedNew = localStorage.getItem('newCoins');
    if (storedNew) setNewCoins(new Set(JSON.parse(storedNew)));
    
    loadData();
    load24hChanges();
    const interval = setInterval(() => {
      loadData();
      load24hChanges();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const res = await fetch('/output/perp_screener_latest.csv');
      const text = await res.text();
      const parsed = parseCSV(text);
      
      const oldSymbols = new Set(data.map(d => d.binance_symbol));
      const newSet = new Set(newCoins);
      parsed.forEach(coin => {
        if (!oldSymbols.has(coin.binance_symbol)) {
          newSet.add(coin.binance_symbol);
        }
      });
      setNewCoins(newSet);
      localStorage.setItem('newCoins', JSON.stringify([...newSet]));
      
      setData(parsed.map(d => ({ ...d, isNew: newSet.has(d.binance_symbol) })));
    } catch (e) {
      console.error('Failed to load data:', e);
    }
  };

  const load24hChanges = async () => {
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      const tickers = await res.json();
      const changes: Record<string, number> = {};
      const volumes: Record<string, number> = {};
      tickers.forEach((t: any) => {
        changes[t.symbol] = parseFloat(t.priceChangePercent);
        volumes[t.symbol] = parseFloat(t.quoteVolume); // Объём в USDT
      });
      setPriceChanges(changes);
      setVolumes(volumes);
    } catch (e) {
      console.error('Failed to load 24h changes:', e);
    }
  };

  const parseCSV = (text: string): CoinData[] => {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1).map((line, lineIdx) => {
      const values = line.split(',');
      const obj: any = {};
      
      headers.forEach((h, i) => {
        const val = values[i]?.trim();
        
        if (h === 'has_spot_usdt') {
          // Ищем индекс колонки has_spot_usdt в заголовках
          const spotIndex = headers.indexOf('has_spot_usdt');
          const spotValue = values[spotIndex]?.trim();
          
          if (lineIdx < 3) {
            console.log(`Line ${lineIdx}: spot index=${spotIndex}, value="${spotValue}", result=${spotValue === 'true'}`);
          }
          
          obj[h] = spotValue === 'true';
          return;
        }
        
        if (val === '' || val === 'null' || val === undefined) {
          obj[h] = null;
        } else if (h.includes('_usd') || h.includes('price') || h.includes('pct') || h.includes('days') || h === 'multiplier') {
          obj[h] = parseFloat(val);
        } else {
          obj[h] = val;
        }
      });
      
      return obj as CoinData;
    });
  };

  const toggleFavorite = (symbol: string) => {
    const newFavs = new Set(favorites);
    if (newFavs.has(symbol)) newFavs.delete(symbol);
    else newFavs.add(symbol);
    setFavorites(newFavs);
    localStorage.setItem('favorites', JSON.stringify([...newFavs]));
  };

  const openFilterPopover = (ev: React.MouseEvent<HTMLButtonElement>, column: any) => {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const isMobile = window.innerWidth < 768;
    
    if (isMobile) {
      // На мобилке открываем по центру экрана
      setFilterPopover({ 
        columnId: column.id, 
        x: window.innerWidth / 2, 
        y: window.innerHeight / 2 
      });
    } else {
      // На десктопе под кнопкой
      setFilterPopover({ columnId: column.id, x: rect.left, y: rect.bottom + 6 });
    }
    setActiveFilterColumn(column);
  };
  const closeFilterPopover = () => {
    setFilterPopover({ columnId: null, x: 0, y: 0 });
    setActiveFilterColumn(null);
  };

  const resetAllFilters = () => {
    setSorting([]);
    setColumnFilters([]);
    setShowFavoritesOnly(false);
    localStorage.removeItem('tableSorting');
    localStorage.removeItem('tableFilters');
    localStorage.setItem('showFavoritesOnly', 'false');
  };

  // Форматирование числа с пробелами между тысячами
  const formatNumberInput = (value: string): string => {
    const num = value.replace(/\s/g, '');
    if (!num || isNaN(Number(num))) return value;
    return Number(num).toLocaleString('ru-RU');
  };

  // Парсинг отформатированного числа
  const parseNumberInput = (value: string): number => {
    return parseFloat(value.replace(/\s/g, ''));
  };

  const filteredData = useMemo(() => {
    let result = data;
    
    // Фильтр по избранному
    if (showFavoritesOnly) {
      result = result.filter(row => favorites.has(row.binance_symbol));
    }
    
    // Фильтр по поиску символа
    if (searchSymbol.trim()) {
      const search = searchSymbol.trim().toUpperCase();
      result = result.filter(row => row.binance_symbol.toUpperCase().includes(search));
    }
    
    return result;
  }, [data, showFavoritesOnly, favorites, searchSymbol]);

  const tableData = useMemo(() => (
    filteredData.map(row => {
      const volume24h = volumes[row.binance_symbol] ?? null;
      const mcap = row.market_cap_usd;
      const volumeMcapRatio = (volume24h && mcap && mcap > 0) ? (volume24h / mcap) * 100 : null;
      return {
        ...row,
        change24h: priceChanges[row.binance_symbol] ?? null,
        volume_24h: volume24h,
        volume_mcap_ratio: volumeMcapRatio
      };
    })
  ), [filteredData, priceChanges, volumes]);

  const columns = useMemo<ColumnDef<CoinData>[]>(() => [
    {
      id: 'favorite',
      header: '⭐',
      cell: ({ row }) => {
        const isFav = favorites.has(row.original.binance_symbol);
        return (
          <button
            onClick={() => toggleFavorite(row.original.binance_symbol)}
            className={`fav-btn${isFav ? ' active' : ''}`}
            aria-pressed={isFav}
            title={isFav ? 'Удалить из избранного' : 'Добавить в избранное'}
          >
            <svg className="fav-svg" width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z"
                stroke="currentColor" strokeWidth="1.4" fill={isFav ? 'currentColor' : 'transparent'} />
            </svg>
          </button>
        );
      },
      size: 50,
    },
    {
      accessorKey: 'binance_symbol',
      header: 'Symbol',
      cell: ({ row, getValue }) => {
        const days = row.original.perp_onboard_days;
        const isNew = days != null && days < 10;
        return (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span className={row.original.isNew ? 'new-coin' : ''}>{getValue<string>()}</span>
            {isNew && <span className="new-badge">NEW</span>}
          </div>
        );
      },
    },
    {
      accessorKey: 'futures_price_usd',
      header: 'Price',
      cell: ({ getValue }) => `$${getValue<number>()?.toFixed(4) || '—'}`,
      filterFn: numericFilterFn,
    },
    {
      accessorKey: 'change24h',
      id: 'change24h',
      header: 'Change 24h',
      enableSorting: true,
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue<number | null>(columnId);
        const b = rowB.getValue<number | null>(columnId);
        const av = a == null ? -Infinity : a;
        const bv = b == null ? -Infinity : b;
        return av - bv;
      },
      cell: ({ getValue }) => {
        const change = getValue<number | null>();
        if (change == null) return <span style={{color:'#999'}}>—</span>;
        const color = change >= 0 ? '#fbbf24' : '#ef4444';
        const bgColor = change >= 0 ? 'rgba(251, 191, 36, 0.12)' : 'rgba(239, 68, 68, 0.12)';
        return (
          <span style={{ color, background: bgColor, padding: '4px 8px', borderRadius: '6px', fontWeight: '600' }}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
          </span>
        );
      },
    },
    {
      accessorKey: 'perp_onboard_days',
      header: 'Days',
      cell: ({ getValue }) => getValue<number>() >= 0 ? getValue<number>() : '—',
      filterFn: numericFilterFn,
    },
    {
      accessorKey: 'has_spot_usdt',
      header: 'Spot',
      cell: ({ getValue }) => getValue<boolean>() ? '✅' : '❌',
      size: 70,
      filterFn: booleanFilterFn,
    },
    {
      accessorKey: 'market_cap_usd',
      header: 'Market Cap',
      cell: ({ getValue }) => {
        const val = getValue<number>();
        if (!val) return '—';
        if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
        if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
        return `$${(val / 1e3).toFixed(2)}K`;
      },
      filterFn: numericFilterFn,
    },
    {
      accessorKey: 'fdv_usd',
      header: 'FDV',
      cell: ({ getValue }) => {
        const val = getValue<number>();
        if (!val) return '—';
        if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
        if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
        return `$${(val / 1e3).toFixed(2)}K`;
      },
      filterFn: numericFilterFn,
    },
    {
      accessorKey: 'volume_24h',
      header: 'Volume 24h',
      cell: ({ getValue }) => {
        const val = getValue<number>();
        if (!val) return '—';
        if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
        if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
        return `$${(val / 1e3).toFixed(2)}K`;
      },
      filterFn: numericFilterFn,
    },
    {
      accessorKey: 'volume_mcap_ratio',
      header: 'Vol/MCap %',
      cell: ({ getValue }) => {
        const val = getValue<number>();
        return val != null ? `${val.toFixed(2)}%` : '—';
      },
      filterFn: numericFilterFn,
    },
    {
      id: 'locked',
      header: 'Locked %',
      cell: ({ row }) => {
        const fdv = row.original.fdv_usd;
        const mcap = row.original.market_cap_usd;
        if (!fdv || !mcap) return '—';
        const pct = Math.min(100, (mcap / fdv) * 100);
        return (
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
            <span className="progress-text">{pct.toFixed(1)}%</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'chain',
      header: 'Chain',
      cell: ({ getValue }) => getValue<string>() || '—',
    },
    {
      accessorKey: 'contract',
      header: 'Contract',
      cell: ({ row, getValue }) => {
        const val = getValue<string>();
        if (!val) return '—';
        const short = `${val.slice(0,6)}...${val.slice(-4)}`;
        const isCopied = copied === row.original.binance_symbol;
        return (
          <div className="contract-cell">
            <span className="contract-short" title={val}>{short}</span>
            <button
              className="copy-btn"
              title="Скопировать"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(val);
                  setCopied(row.original.binance_symbol);
                  setTimeout(() => setCopied(prev => (prev === row.original.binance_symbol ? null : prev)), 1200);
                } catch (e) {
                  console.error('Clipboard failed', e);
                }
              }}
            >
              {isCopied ? '✓' : '⧉'}
            </button>
          </div>
        );
      },
    },
    {
      id: 'links',
      header: 'Links',
      cell: ({ row }) => {
        const cgId = row.original.coingecko_id;
        const cgSymbol = row.original.coingecko_symbol;
        const rawSymbol = row.original.binance_symbol.toLowerCase().replace('usdt', '');
        
        const crSlug = cgId || cgSymbol || rawSymbol;
        const cmcSlug = cgId || cgSymbol || rawSymbol;
        
        return (
          <div className="links">
            {cgId && <a href={`https://www.coingecko.com/en/coins/${cgId}`} target="_blank" rel="noopener">CG</a>}
            <a href={`https://cryptorank.io/price/${crSlug}`} target="_blank" rel="noopener">CR</a>
            <a href={`https://coinmarketcap.com/currencies/${cmcSlug}/`} target="_blank" rel="noopener">CMC</a>
          </div>
        );
      },
    },
  ], [favorites, newCoins, priceChanges, volumes]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="app">
      <header>
        <h1>🚀 Binance Perpetual Screener</h1>
        <div className="header-middle">
          <div className="search-box">
            <input
              type="text"
              placeholder="🔍 Поиск по символу (например: BTC, ETH)"
              value={searchSymbol}
              onChange={(e) => setSearchSymbol(e.target.value)}
              className="search-input"
            />
            {searchSymbol && (
              <button className="clear-search" onClick={() => setSearchSymbol('')} title="Очистить">
                ✕
              </button>
            )}
          </div>
          <div className="stats">
            <span>Total: {filteredData.length}</span>
            <span>Favorites: {favorites.size}</span>
            <span>New: {newCoins.size}</span>
          </div>
        </div>
        <div className="header-controls">
          <label className="fav-filter">
            <input type="checkbox" checked={showFavoritesOnly} onChange={e => setShowFavoritesOnly(e.target.checked)} />
            Show favorites only
          </label>
          <button className="reset-filters-btn" onClick={resetAllFilters} title="Сбросить все фильтры и сортировку">
            🔄 Сбросить фильтры
          </button>
        </div>
      </header>

      <div className="table-container">
        <table>
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <>
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th key={header.id} style={{ width: header.getSize() }}>
                      {header.isPlaceholder ? null : (
                        <div className="header-cell">
                          <div
                            className={header.column.getCanSort() ? 'sortable' : ''}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {{ asc: ' 🔼', desc: ' 🔽' }[header.column.getIsSorted() as string] ?? ''}
                          </div>
                          {(header.column.columnDef.filterFn === numericFilterFn || header.column.columnDef.filterFn === booleanFilterFn) && (
                            <button
                              className="filter-toggle"
                              onClick={(e) => openFilterPopover(e, header.column)}
                              title="Фильтр"
                              aria-label="Фильтр"
                            >
                              {/* иконка-фильтр */}
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 5H21L14 12V19L10 21V12L3 5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
                {/* Убрали нижнюю строку фильтров, фильтр теперь во всплывающем поповере */}
              </>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Поповер фильтра */}
      {filterPopover.columnId && activeFilterColumn && (
        <>
          <div className="popover-backdrop" onClick={closeFilterPopover} />
          <div className="filter-popover" style={{ top: filterPopover.y, left: filterPopover.x }}>
            <div className="filter-popover-title">Фильтр</div>
            {activeFilterColumn.columnDef.filterFn === numericFilterFn ? (
              <div className="filter-row" style={{ marginTop: 8 }}>
                <select
                  onChange={(e) => {
                    const val = (activeFilterColumn.getFilterValue() as [string, number]) || ['>', 0];
                    activeFilterColumn.setFilterValue([e.target.value, val[1]]);
                  }}
                  className="filter-select"
                  defaultValue={(activeFilterColumn.getFilterValue() as [string, number])?.[0] || '>'}
                >
                  <option value=">">{'>'}</option>
                  <option value="<">{'<'}</option>
                  <option value=">=">{'>='}</option>
                  <option value="<=">{'<='}</option>
                </select>
                <input
                  type="text"
                  placeholder="например: 1 000 000"
                  onChange={(e) => {
                    const val = (activeFilterColumn.getFilterValue() as [string, number]) || ['>', 0];
                    const num = parseNumberInput(e.target.value);
                    activeFilterColumn.setFilterValue(isNaN(num) ? undefined : [val[0], num]);
                    // Форматируем на лету
                    e.target.value = formatNumberInput(e.target.value);
                  }}
                  className="filter-input"
                  defaultValue={
                    (activeFilterColumn.getFilterValue() as [string, number])?.[1]
                      ? formatNumberInput(String((activeFilterColumn.getFilterValue() as [string, number])[1]))
                      : ''
                  }
                />
              </div>
            ) : (
              <div className="filter-row" style={{ marginTop: 8 }}>
                <select
                  className="filter-select"
                  defaultValue={
                    (activeFilterColumn.getFilterValue() as 'all' | true | false | undefined) === true
                      ? 'true'
                      : (activeFilterColumn.getFilterValue() as any) === false
                      ? 'false'
                      : 'all'
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'all') activeFilterColumn.setFilterValue(undefined);
                    else if (v === 'true') activeFilterColumn.setFilterValue(true);
                    else activeFilterColumn.setFilterValue(false);
                  }}
                >
                  <option value="all">Все</option>
                  <option value="true">Только ✅</option>
                  <option value="false">Только ❌</option>
                </select>
              </div>
            )}
            <div className="popover-actions">
              <button className="btn ghost" onClick={() => { activeFilterColumn.setFilterValue(undefined); closeFilterPopover(); }}>Сброс</button>
              <button className="btn primary" onClick={closeFilterPopover}>Ок</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
