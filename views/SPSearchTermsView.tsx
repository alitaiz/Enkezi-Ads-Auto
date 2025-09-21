import React, { useState, useMemo, useEffect, useCallback, useContext } from 'react';
import { SPSearchTermReportData, SPFilterOptions } from '../types';
import { formatNumber, formatPercent, formatPrice } from '../utils';
import { DataCacheContext } from '../contexts/DataCacheContext';
import { DateRangePicker } from './components/DateRangePicker';

// --- Type Definitions for Hierarchical Data ---
interface Metrics {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    units: number;
    asin?: string | null;
    asins?: string[];
    productCount?: number;
}

interface TreeNode {
    id: string;
    name: string;
    type: 'campaign' | 'adGroup' | 'keyword' | 'searchTerm';
    metrics: Metrics;
    children?: TreeNode[];
    // Additional metadata for display
    keywordType?: 'keyword' | 'search term';
    matchType?: string;
}

type ViewLevel = 'campaigns' | 'adGroups' | 'keywords' | 'searchTerms';
type ReportType = 'SP' | 'SB';

// --- Styles ---
const styles: { [key: string]: React.CSSProperties } = {
    viewContainer: { padding: '20px', maxWidth: '100%', margin: '0 auto' },
    header: { marginBottom: '20px' },
    headerTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' },
    dateDisplay: { fontSize: '1.5rem', fontWeight: '600' },
    headerTabs: { display: 'flex', gap: '5px', borderBottom: '1px solid var(--border-color)' },
    tabButton: { padding: '10px 15px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', borderBottom: '3px solid transparent', color: '#555', fontWeight: 500 },
    tabButtonActive: { color: 'var(--primary-color)', borderBottom: '3px solid var(--primary-color)', fontWeight: 600 },
    actionsBar: { display: 'flex', alignItems: 'center', gap: '15px', padding: '15px 0' },
    actionButton: { padding: '8px 15px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' },
    tableContainer: { backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', overflowX: 'auto' },
    table: { width: '100%', minWidth: '2200px', borderCollapse: 'collapse', tableLayout: 'fixed' },
    th: { padding: '12px 10px', textAlign: 'left', borderBottom: '2px solid var(--border-color)', backgroundColor: '#f8f9fa', fontWeight: 600, whiteSpace: 'nowrap' },
    td: { padding: '10px', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    nameCell: { display: 'flex', alignItems: 'center', gap: '8px' },
    expandIcon: { cursor: 'pointer', width: '15px', textAlign: 'center', transition: 'transform 0.2s', userSelect: 'none' },
    statusCell: { display: 'flex', alignItems: 'center', gap: '5px' },
    statusDropdownIcon: { fontSize: '0.6em' },
    error: { color: 'var(--danger-color)', padding: '20px', backgroundColor: '#fdd', borderRadius: 'var(--border-radius)', marginTop: '20px' },
    message: { textAlign: 'center', padding: '50px', fontSize: '1.2rem', color: '#666' },
    dateButton: {
        padding: '8px 12px',
        borderRadius: '4px',
        border: '1px solid var(--border-color)',
        fontSize: '1rem',
        background: 'white',
        cursor: 'pointer',
    },
    integrityCheckContainer: {
        marginTop: '20px',
        padding: '15px',
        backgroundColor: '#fffbe6',
        border: '1px solid #ffe58f',
        borderRadius: 'var(--border-radius)',
        marginBottom: '20px',
    },
    integrityTitle: {
        margin: '0 0 10px 0',
        fontWeight: 600,
        color: '#d46b08',
    },
    missingDateItem: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px',
        borderBottom: '1px solid #ffe58f',
    },
    fetchButton: {
        padding: '6px 12px',
        border: '1px solid #d46b08',
        borderRadius: '4px',
        backgroundColor: 'white',
        color: '#d46b08',
        cursor: 'pointer',
    },
    reportTypeSelector: {
        display: 'flex',
        gap: '10px',
        marginBottom: '15px',
        backgroundColor: '#f8f9fa',
        padding: '8px',
        borderRadius: '8px'
    },
    reportTypeButton: {
        padding: '8px 16px',
        border: '1px solid transparent',
        borderRadius: '6px',
        background: 'none',
        cursor: 'pointer',
        fontSize: '0.9rem',
        fontWeight: '500'
    },
    reportTypeButtonActive: {
        backgroundColor: 'white',
        borderColor: 'var(--border-color)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        color: 'var(--primary-color)'
    }
};

// --- Column Definitions ---
const columns = [
    { id: 'name', label: 'Name', width: '350px' },
    { id: 'asin', label: 'ASIN', width: '200px' },
    { id: 'status', label: 'Status', width: '120px' },
    { id: 'costPerOrder', label: 'Cost per order', width: '120px' },
    { id: 'spend', label: 'Ad spend', width: '100px' },
    { id: 'clicks', label: 'Clicks', width: '100px' },
    { id: 'conversion', label: 'Conversion', width: '110px' },
    { id: 'orders', label: 'Orders', width: '100px' },
    { id: 'units', label: 'Units', width: '100px' },
    { id: 'cpc', label: 'CPC', width: '100px' },
    { id: 'sales', label: 'PPC sales', width: '110px' },
    { id: 'impressions', label: 'Impressions', width: '110px' },
    { id: 'sku', label: 'Same SKU/All SKU\'s', width: '150px' },
    { id: 'acos', label: 'ACOS', width: '100px' },
    { id: 'profit', label: 'Profit', width: '100px' },
    { id: 'tos', label: 'Top-of-search impression share', width: '200px' },
    { id: 'breakEvenAcos', label: 'Break even ACOS', width: '140px' },
    { id: 'breakEvenBid', label: 'Break Even Bid', width: '130px' },
    { id: 'dailyBudget', label: 'Daily budget', width: '120px' },
    { id: 'budgetUtil', label: 'Budget utilization', width: '140px' },
    { id: 'currentBid', label: 'Current bid', width: '120px' },
];


// --- Helper Functions ---
const addMetrics = (target: Metrics, source: Metrics) => {
    target.impressions += source.impressions;
    target.clicks += source.clicks;
    target.spend += source.spend;
    target.sales += source.sales;
    target.orders += source.orders;
    target.units += source.units;
    if (source.asin) {
        target.asins = target.asins || [];
        if (!target.asins.includes(source.asin)) target.asins.push(source.asin);
    }
};
const createMetrics = (row: SPSearchTermReportData): Metrics => ({
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    sales: row.sevenDayTotalSales,
    orders: row.sevenDayTotalOrders,
    units: row.sevenDayTotalUnits,
    asin: row.asin,
});
const emptyMetrics = (): Metrics => ({ impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0, productCount: 0, asins: [] });

const aggregateSearchTerms = (flatData: SPSearchTermReportData[]): TreeNode[] => {
    const terms = new Map<string, Metrics>();
    flatData.forEach(row => {
        const term = row.customerSearchTerm;
        if (!terms.has(term)) terms.set(term, emptyMetrics());
        addMetrics(terms.get(term)!, createMetrics(row));
    });
    return Array.from(terms.entries()).map(([name, metrics]) => ({
        id: `st-${name}`,
        name,
        type: 'searchTerm',
        keywordType: 'search term',
        metrics,
    }));
};

const buildHierarchyByLevel = (flatData: SPSearchTermReportData[], level: ViewLevel): TreeNode[] => {
    // For the search term and keyword tabs we only need aggregated data,
    // so avoid building the full campaign → ad group hierarchy which is
    // expensive for large datasets and previously caused the UI to freeze.
    if (level === 'searchTerms') {
        const terms = new Map<string, Metrics>();
        flatData.forEach(row => {
            const term = row.customerSearchTerm;
            if (!terms.has(term)) terms.set(term, emptyMetrics());
            addMetrics(terms.get(term)!, createMetrics(row));
        });
        return Array.from(terms.entries()).map(([name, metrics]) => ({
            id: `st-${name}`,
            name,
            type: 'searchTerm',
            keywordType: 'search term',
            metrics,
        }));
    }

    if (level === 'keywords') {
        interface KeywordEntry {
            node: TreeNode;
            termMap: Map<string, TreeNode>;
        }
        const keywordMap = new Map<string, KeywordEntry>();

        flatData.forEach(row => {
            const key = `${row.campaignId}-${row.adGroupId}-${row.targeting}`;
            if (!keywordMap.has(key)) {
                keywordMap.set(key, {
                    node: {
                        id: `k-${key}`,
                        name: row.targeting,
                        type: 'keyword',
                        keywordType: 'keyword',
                        matchType: row.matchType,
                        metrics: emptyMetrics(),
                        children: [],
                    },
                    termMap: new Map<string, TreeNode>(),
                });
            }

            const keywordEntry = keywordMap.get(key)!;
            const keywordNode = keywordEntry.node;
            const termMap = keywordEntry.termMap;

            addMetrics(keywordNode.metrics, createMetrics(row));

            if (!termMap.has(row.customerSearchTerm)) {
                termMap.set(row.customerSearchTerm, {
                    id: `st-${row.customerSearchTerm}-${key}`,
                    name: row.customerSearchTerm,
                    type: 'searchTerm',
                    keywordType: 'search term',
                    metrics: emptyMetrics(),
                });
            }
            const termNode = termMap.get(row.customerSearchTerm)!;
            addMetrics(termNode.metrics, createMetrics(row));
        });

        return Array.from(keywordMap.values()).map(({ node, termMap }) => {
            node.children = Array.from(termMap.values());
            return node;
        });
    }

    const campaignMap = new Map<number, TreeNode>();

    flatData.forEach(row => {
        const rowMetrics = createMetrics(row);

        if (!campaignMap.has(row.campaignId)) {
            campaignMap.set(row.campaignId, {
                id: `c-${row.campaignId}`,
                name: row.campaignName,
                type: 'campaign',
                metrics: emptyMetrics(),
                children: [],
            });
        }
        const campaignNode = campaignMap.get(row.campaignId)!;
        addMetrics(campaignNode.metrics, rowMetrics);

        let adGroupNode = campaignNode.children!.find(c => c.id === `ag-${row.adGroupId}`);
        if (!adGroupNode) {
            adGroupNode = {
                id: `ag-${row.adGroupId}`,
                name: row.adGroupName,
                type: 'adGroup',
                metrics: emptyMetrics(),
                children: [],
            };
            campaignNode.children!.push(adGroupNode);
        }
        addMetrics(adGroupNode.metrics, rowMetrics);
        adGroupNode.metrics.productCount = (adGroupNode.metrics.productCount || 0) + 1; // Assuming 1 product per row for simplicity

        let keywordNode = adGroupNode.children!.find(c => c.id === `k-${row.targeting}`);
        if (!keywordNode) {
            keywordNode = {
                id: `k-${row.targeting}`,
                name: row.targeting,
                type: 'keyword',
                keywordType: 'keyword',
                matchType: row.matchType,
                metrics: emptyMetrics(),
                children: level === 'campaigns' || level === 'adGroups' ? [] : undefined,
            };
            adGroupNode.children!.push(keywordNode);
        }
        addMetrics(keywordNode.metrics, rowMetrics);

        if (level === 'campaigns' || level === 'adGroups') {
            keywordNode.children!.push({
                id: `st-${row.customerSearchTerm}-${row.targeting}`,
                name: row.customerSearchTerm,
                type: 'searchTerm',
                keywordType: 'search term',
                metrics: rowMetrics,
            });
        }
    });

    switch (level) {
        case 'adGroups':
            return Array.from(campaignMap.values()).flatMap(c => c.children!);
        case 'campaigns':
        default:
            return Array.from(campaignMap.values());
    }
};

// --- Recursive Row Component ---
const TreeNodeRow: React.FC<{
    node: TreeNode;
    level: number;
    expandedIds: Set<string>;
    onToggle: (id: string) => void;
    selectedIds: Set<string>;
    onSelect: (id: string, checked: boolean) => void;
}> = ({ node, level, expandedIds, onToggle, selectedIds, onSelect }) => {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    
    const { impressions, clicks, spend, sales, orders, units, asins, productCount } = node.metrics;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const acos = sales > 0 ? spend / sales : 0;
    const conversion = clicks > 0 ? orders / clicks : 0;
    const costPerOrder = orders > 0 ? spend / orders : 0;
    const profit = sales - spend;

    const renderCell = (columnId: string) => {
        switch (columnId) {
            case 'name': 
                let nameSuffix = '';
                if(node.keywordType === 'keyword') nameSuffix = ' (keyword)';
                else if(node.keywordType === 'search term') nameSuffix = ' (search term)';
                
                return (
                <div style={{ ...styles.nameCell, paddingLeft: `${level * 25}px` }}>
                    <input type="checkbox" checked={selectedIds.has(node.id)} onChange={e => onSelect(node.id, e.target.checked)} />
                    {hasChildren && (
                        <span
                            style={{ ...styles.expandIcon, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            onClick={() => onToggle(node.id)}
                        >
                            ►
                        </span>
                    )}
                    <span title={node.name}>{node.name}{nameSuffix}</span>
                </div>
            );

            case 'asin':
                if (node.type === 'adGroup') return `ASINs: ${productCount || 1}`;

                if (node.type === 'campaign') {
                    const asinList = asins || [];
                    if (asinList.length === 1) {
                        const single = asinList[0];
                        return <img src={`https://m.media-amazon.com/images/I/${single}.jpg`} alt={single} height="30" onError={(e) => (e.currentTarget.style.display='none')} />;
                    }
                    if (asinList.length > 1) {
                        return (
                            <span style={{ color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={() => alert(asinList.join('\n'))}>
                                ASINS
                            </span>
                        );
                    }
                }
                return '—';
            case 'status': return node.type !== 'searchTerm' ? <div style={styles.statusCell}>Active <span style={styles.statusDropdownIcon}>▼</span></div> : '—';
            case 'costPerOrder': return formatPrice(costPerOrder);
            case 'spend': return spend < 0 ? `-${formatPrice(Math.abs(spend))}` : formatPrice(spend);
            case 'clicks': return formatNumber(clicks);
            case 'conversion': return formatPercent(conversion);
            case 'orders': return formatNumber(orders);
            case 'units': return formatNumber(units);
            case 'cpc': return formatPrice(cpc);
            case 'sales': return formatPrice(sales);
            case 'impressions': return formatNumber(impressions);
            case 'acos': return formatPercent(acos);
            case 'profit': return profit < 0 ? `-${formatPrice(Math.abs(profit))}` : formatPrice(profit);
            default: return '—';
        }
    };
    
    return (
        <>
            <tr style={{ backgroundColor: level < 2 ? '#fdfdfd' : 'transparent' }}>
                {columns.map(col => <td key={col.id} style={{ ...styles.td, ...(col.id === 'name' && { fontWeight: 500 }) }} title={node.name}>{renderCell(col.id)}</td>)}
            </tr>
            {isExpanded && hasChildren && node.children!.map(child => (
                <TreeNodeRow key={child.id} node={child} level={level + 1} expandedIds={expandedIds} onToggle={onToggle} selectedIds={selectedIds} onSelect={onSelect} />
            ))}
        </>
    );
};

// --- Main View Component ---
export function SPSearchTermsView() {
    const { cache, setCache } = useContext(DataCacheContext);
    const [reportType, setReportType] = useState<ReportType>('SP');
    const [flatData, setFlatData] = useState<SPSearchTermReportData[]>(cache.spSearchTerms.data || []);
    const [viewLevel, setViewLevel] = useState<ViewLevel>('campaigns');
    const campaignsTree = useMemo(() => buildHierarchyByLevel(flatData, 'campaigns'), [flatData]);
    const adGroupsTree = useMemo(() => buildHierarchyByLevel(flatData, 'adGroups'), [flatData]);
    const keywordsTree = useMemo(() => buildHierarchyByLevel(flatData, 'keywords'), [flatData]);
    const aggregatedSearchTerms = useMemo(() => aggregateSearchTerms(flatData), [flatData]);

    const treeData = useMemo<TreeNode[]>(() => {
        switch (viewLevel) {
            case 'adGroups':
                return adGroupsTree;
            case 'keywords':
                return keywordsTree;
            case 'searchTerms':
                return aggregatedSearchTerms;
            case 'campaigns':
            default:
                return campaignsTree;
        }
    }, [viewLevel, campaignsTree, adGroupsTree, keywordsTree, aggregatedSearchTerms]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    
    const [missingDates, setMissingDates] = useState<string[]>([]);
    const [fetchStatus, setFetchStatus] = useState<Record<string, 'fetching' | 'success' | 'error' | 'idle'>>({});

    const [dateRange, setDateRange] = useState(cache.spSearchTerms.filters ? { start: new Date(cache.spSearchTerms.filters.startDate), end: new Date(cache.spSearchTerms.filters.endDate)} : { start: new Date(), end: new Date() });
    const [isDatePickerOpen, setDatePickerOpen] = useState(false);

    const formatDateForQuery = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    useEffect(() => {
        const checkDataIntegrity = async () => {
            const today = new Date();
            const endDate = new Date(today);
            endDate.setDate(today.getDate() - 2);

            const startDate = new Date(endDate);
            startDate.setDate(endDate.getDate() - 6);

            const startDateStr = formatDateForQuery(startDate);
            const endDateStr = formatDateForQuery(endDate);

            try {
                const response = await fetch('/api/database/check-missing-dates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: 'searchTermReport', startDate: startDateStr, endDate: endDateStr }),
                });
                const data = await response.json();
                if (response.ok) {
                    setMissingDates(data.missingDates || []);
                    setFetchStatus({});
                }
            } catch (err) {
                console.error("Failed to run data integrity check:", err);
            }
        };

        checkDataIntegrity();
    }, []);

    useEffect(() => {
        setExpandedIds(new Set());
        setSelectedIds(new Set());
    }, [flatData, viewLevel]);

    const handleToggle = (id: string) => setExpandedIds(prev => { const s = new Set(prev); if(s.has(id)) s.delete(id); else s.add(id); return s; });
    const handleSelect = (id: string, checked: boolean) => setSelectedIds(prev => { const s = new Set(prev); if(checked) s.add(id); else s.delete(id); return s; });
    
    const handleSelectAll = (checked: boolean) => {
        if (!checked) { setSelectedIds(new Set()); return; }
        const allIds = new Set<string>();
        const collect = (nodes: TreeNode[]) => nodes.forEach(n => { allIds.add(n.id); if (n.children) collect(n.children); });
        collect(treeData);
        setSelectedIds(allIds);
    };
    
    const handleApply = useCallback(async (range: {start: Date, end: Date}, type: ReportType) => {
        setLoading(true);
        setError(null);
        const startDate = formatDateForQuery(range.start);
        const endDate = formatDateForQuery(range.end);

        try {
            const url = `/api/sp-search-terms?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&reportType=${type}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error((await response.json()).error);
            const data: SPSearchTermReportData[] = await response.json();
            setFlatData(data);
            setCache(prev => ({ ...prev, spSearchTerms: { data, filters: { asin: '', startDate, endDate } } }));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'An unknown error occurred.');
            setFlatData([]);
        } finally {
            setLoading(false);
        }
    }, [setCache]);

    const handleReportTypeChange = (newType: ReportType) => {
        setReportType(newType);
        setFlatData([]); // Clear old data
        handleApply(dateRange, newType);
    };
    
    useEffect(() => {
        if (cache.spSearchTerms.data.length === 0 && !cache.spSearchTerms.filters) {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 7);
            handleApply({ start, end }, reportType);
        }
    }, [handleApply, cache.spSearchTerms.data.length, cache.spSearchTerms.filters, reportType]);
    
    const handleApplyDateRange = (newRange: { start: Date; end: Date }) => {
        setDateRange(newRange);
        setDatePickerOpen(false);
        handleApply(newRange, reportType);
    };
    
    const handleFetchMissingDay = async (date: string) => {
        setFetchStatus(prev => ({ ...prev, [date]: 'fetching' }));
        try {
            const response = await fetch('/api/database/fetch-missing-day', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'searchTermReport', date }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            setFetchStatus(prev => ({ ...prev, [date]: 'success' }));
            // Refresh main table data in case the fetched day is in the current view
            handleApply(dateRange, reportType);
             // Remove the date from the missing list upon success
            setMissingDates(prev => prev.filter(d => d !== date));
        } catch (err) {
            setFetchStatus(prev => ({ ...prev, [date]: 'error' }));
            alert(`Failed to fetch data for ${date}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };
    
    const renderFetchButton = (date: string) => {
        const status = fetchStatus[date] || 'idle';
        let text = 'Fetch';
        let disabled = false;

        switch (status) {
            case 'fetching': text = 'Fetching...'; disabled = true; break;
            case 'success': text = 'Success!'; disabled = true; break;
            case 'error': text = 'Error - Retry'; disabled = false; break;
            default: text = 'Fetch'; disabled = false; break;
        }

        return <button style={styles.fetchButton} onClick={() => handleFetchMissingDay(date)} disabled={disabled}>{text}</button>;
    };

    const formatDateRangeDisplay = (start: Date, end: Date) => {
        const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
        const startStr = start.toLocaleDateString('en-US', options);
        const endStr = end.toLocaleDateString('en-US', options);
        return startStr === endStr ? startStr : `${startStr} - ${endStr}`;
    };

    const tabs: {id: ViewLevel, label: string}[] = [
        {id: 'campaigns', label: 'Campaigns'},
        {id: 'adGroups', label: 'Ad groups'},
        {id: 'keywords', label: 'Keywords'},
        {id: 'searchTerms', label: 'Search terms'},
    ];
    
    return (
        <div style={styles.viewContainer}>
            <header style={styles.header}>
                 <div style={styles.headerTop}>
                     {/* FIX: Changed `date.end` to `dateRange.end` to fix typo. */}
<h1 style={styles.dateDisplay}>{formatDateRangeDisplay(dateRange.start, dateRange.end)}</h1>
                     <div style={{ position: 'relative' }}>
                         <button style={styles.dateButton} onClick={() => setDatePickerOpen(o => !o)}>Select Date Range</button>
                        {isDatePickerOpen && <DateRangePicker initialRange={dateRange} onApply={handleApplyDateRange} onClose={() => setDatePickerOpen(false)} />}
                    </div>
                 </div>
                 <div style={styles.reportTypeSelector}>
                    <button 
                        style={reportType === 'SP' ? {...styles.reportTypeButton, ...styles.reportTypeButtonActive} : styles.reportTypeButton}
                        onClick={() => handleReportTypeChange('SP')}
                    >
                        Sponsored Products
                    </button>
                    <button 
                        style={reportType === 'SB' ? {...styles.reportTypeButton, ...styles.reportTypeButtonActive} : styles.reportTypeButton}
                        onClick={() => handleReportTypeChange('SB')}
                    >
                        Sponsored Brands
                    </button>
                 </div>
                 <div style={styles.headerTabs}>
                     {tabs.map(tab => (
                        <button key={tab.id} style={viewLevel === tab.id ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setViewLevel(tab.id)}>
                            {tab.label}
                        </button>
                     ))}
                 </div>
            </header>
            
            {missingDates.length > 0 && (
                <div style={styles.integrityCheckContainer}>
                    <h3 style={styles.integrityTitle}>⚠️ Data Integrity Check</h3>
                    <p>The following dates have missing report data in the last 7 days (ending 2 days ago). You can fetch them individually.</p>
                    {missingDates.map(date => (
                        <div key={date} style={styles.missingDateItem}>
                            <span>Missing data for: <strong>{date}</strong></span>
                            {renderFetchButton(date)}
                        </div>
                    ))}
                </div>
            )}
            
            <div style={styles.actionsBar}>
                <button style={styles.actionButton}><span>✎</span> Edit</button>
                <button style={styles.actionButton}><span>✓</span> Accept recommendations</button>
                <button style={styles.actionButton}><span>⤓</span></button>
                <button style={styles.actionButton}><span>❐</span></button>
            </div>
            
            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.tableContainer}>
                {loading ? <div style={styles.message}>Loading...</div> :
                 treeData.length === 0 ? <div style={styles.message}>No data found for the selected criteria.</div> :
                 (
                    <table style={styles.table}>
                        <colgroup>
                            {columns.map(c => <col key={c.id} style={{width: c.width}} />)}
                        </colgroup>
                        <thead>
                            <tr>
                                <th style={{...styles.th, width: '30px'}}><input type="checkbox" onChange={e => handleSelectAll(e.target.checked)} /></th>
                                {columns.slice(1).map(c => <th key={c.id} style={styles.th}>{c.label}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {treeData.map(node => (
                                <TreeNodeRow key={node.id} node={node} level={0} expandedIds={expandedIds} onToggle={handleToggle} selectedIds={selectedIds} onSelect={handleSelect} />
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}