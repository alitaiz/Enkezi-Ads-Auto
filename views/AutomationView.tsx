import React, { useEffect, useState, useCallback } from 'react';
import { AutomationRule, AutomationRuleCondition, AutomationConditionGroup, AutomationRuleAction } from '../types';

const styles: { [key: string]: React.CSSProperties } = {
  container: { maxWidth: '1200px', margin: '0 auto', padding: '20px' },
  header: { marginBottom: '20px' },
  title: { fontSize: '2rem', margin: 0 },
  tabs: { display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '20px' },
  tabButton: { padding: '10px 15px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 500, color: '#555', borderBottom: '3px solid transparent' },
  tabButtonActive: { color: 'var(--primary-color)', borderBottom: '3px solid var(--primary-color)' },
  contentHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  contentTitle: { fontSize: '1.5rem', margin: 0 },
  primaryButton: { padding: '10px 20px', backgroundColor: 'var(--primary-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' },
  rulesGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px' },
  ruleCard: { backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' },
  ruleCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  ruleName: { fontSize: '1.2rem', fontWeight: 600, margin: 0 },
  ruleDetails: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', fontSize: '0.9rem' },
  ruleLabel: { color: '#666' },
  ruleValue: { fontWeight: 500 },
  ruleActions: { display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '15px', borderTop: '1px solid var(--border-color)' },
  button: { padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', background: 'none' },
  dangerButton: { borderColor: 'var(--danger-color)', color: 'var(--danger-color)' },
  modalBackdrop: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#f0f2f2', padding: '30px', borderRadius: 'var(--border-radius)', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '25px' },
  modalHeader: { fontSize: '1.75rem', margin: 0, paddingBottom: '10px', color: '#333' },
  form: { display: 'flex', flexDirection: 'column', gap: '20px' },
  card: { border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', backgroundColor: 'white', padding: '20px' },
  cardTitle: { fontSize: '1.1rem', fontWeight: 600, margin: '0 0 15px 0', color: '#333' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '5px' },
  label: { fontWeight: 500, fontSize: '0.9rem', color: '#555' },
  input: { padding: '10px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '1rem', width: '100%' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 'auto', paddingTop: '20px', gap: '10px' },
  activeCheckboxContainer: { display: 'flex', alignItems: 'center', gap: '10px', marginRight: 'auto' },
  logTable: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: { textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--border-color)' },
  td: { padding: '8px', borderBottom: '1px solid var(--border-color)'},
  ifThenBlock: { border: '1px dashed #ccc', borderRadius: 'var(--border-radius)', padding: '20px', backgroundColor: '#fafafa' },
  ifBlockHeader: { fontWeight: 'bold', fontSize: '1rem', marginBottom: '15px', color: '#333' },
  conditionRow: { display: 'grid', gridTemplateColumns: '2fr auto auto auto 1.5fr auto', alignItems: 'center', gap: '10px', marginBottom: '10px' },
  conditionInput: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' },
  conditionText: { fontSize: '0.9rem', color: '#333' },
  deleteButton: { background: 'none', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: '4px', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', lineHeight: '1' },
  thenBlock: { marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' },
  thenHeader: { fontWeight: 'bold', fontSize: '1rem', marginBottom: '15px', color: '#333' },
  thenGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' },
};

const guideStyles: { [key: string]: React.CSSProperties } = {
    container: { lineHeight: 1.6, color: '#333', backgroundColor: 'var(--card-background-color)', padding: '20px 40px', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)' },
    h1: { fontSize: '2em', borderBottom: '2px solid var(--border-color)', paddingBottom: '10px', marginBottom: '20px' },
    h2: { fontSize: '1.75em', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginTop: '40px', marginBottom: '20px' },
    h3: { fontSize: '1.5em', marginTop: '30px', marginBottom: '15px' },
    h4: { fontSize: '1.2em', marginTop: '25px', marginBottom: '10px', color: '#111' },
    p: { marginBottom: '15px' },
    ul: { paddingLeft: '20px', marginBottom: '15px' },
    ol: { paddingLeft: '20px', marginBottom: '15px' },
    li: { marginBottom: '8px' },
    code: { backgroundColor: '#eef', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', color: '#d63384' },
    blockquote: { borderLeft: '4px solid var(--primary-color)', paddingLeft: '15px', margin: '20px 0', fontStyle: 'italic', color: '#555', backgroundColor: '#f8f9fa' },
};


const getDefaultCondition = (): AutomationRuleCondition => ({
    metric: 'spend',
    timeWindow: 5,
    operator: '>',
    value: 0
});

const getDefaultBidAdjustmentAction = (): AutomationRuleAction => ({ 
    type: 'adjustBidPercent', 
    value: -1,
    minBid: undefined,
    maxBid: undefined,
});

const getDefaultSearchTermAction = (): AutomationRuleAction => ({ 
    type: 'negateSearchTerm', 
    matchType: 'NEGATIVE_EXACT' 
});

const getDefaultBidAdjustmentGroup = (): AutomationConditionGroup => ({
    conditions: [getDefaultCondition()],
    action: getDefaultBidAdjustmentAction()
});

const getDefaultSearchTermGroup = (): AutomationConditionGroup => ({
    conditions: [
        { metric: 'spend', timeWindow: 60, operator: '>', value: 15 },
        { metric: 'sales', timeWindow: 60, operator: '=', value: 0 },
    ],
    action: getDefaultSearchTermAction()
});

const getDefaultRuleConfig = () => ({
    conditionGroups: [],
    frequency: { unit: 'hours' as 'minutes' | 'hours' | 'days', value: 1 },
    cooldown: { unit: 'hours' as 'minutes' | 'hours' | 'days', value: 24 }
});


const getDefaultBidAdjustmentRule = (): Partial<AutomationRule> => ({
    name: '',
    rule_type: 'BID_ADJUSTMENT',
    config: { ...getDefaultRuleConfig(), conditionGroups: [getDefaultBidAdjustmentGroup()] },
    scope: { campaignIds: [] },
    is_active: true,
});

const getDefaultSearchTermRule = (): Partial<AutomationRule> => ({
    name: '',
    rule_type: 'SEARCH_TERM_AUTOMATION',
    config: { ...getDefaultRuleConfig(), conditionGroups: [getDefaultSearchTermGroup()] },
    scope: { campaignIds: [] },
    is_active: true,
});


export function AutomationView() {
  const [activeTab, setActiveTab] = useState('bidAdjustment');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState({ rules: true, logs: true });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(prev => ({ ...prev, rules: true }));
    try {
      const res = await fetch('/api/automation/rules');
      const data = await res.json();
      setRules(data);
    } catch (err) { console.error("Failed to fetch rules", err); }
    finally { setLoading(prev => ({ ...prev, rules: false })); }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(prev => ({ ...prev, logs: true }));
    try {
      const res = await fetch('/api/automation/logs');
      const data = await res.json();
      setLogs(data);
    } catch (err) { console.error("Failed to fetch logs", err); }
    finally { setLoading(prev => ({ ...prev, logs: false })); }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchLogs();
  }, [fetchRules, fetchLogs]);
  
  const handleOpenModal = (rule: AutomationRule | null = null) => {
    setEditingRule(rule);
    setIsModalOpen(true);
  };

  const handleSaveRule = async (formData: AutomationRule) => {
    const { id, ...data } = formData;
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/automation/rules/${id}` : '/api/automation/rules';
    
    const profileId = localStorage.getItem('selectedProfileId');
    if (!profileId) {
        alert("Please select a profile on the PPC Management page first.");
        return;
    }
    const payload = { ...data, profile_id: profileId };

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), // FIX: Removed double JSON.stringify
    });
    setIsModalOpen(false);
    setEditingRule(null);
    fetchRules();
  };

  const handleDeleteRule = async (id: number) => {
      if (window.confirm('Are you sure you want to delete this rule?')) {
          await fetch(`/api/automation/rules/${id}`, { method: 'DELETE' });
          fetchRules();
      }
  };

  const filteredRules = rules.filter(r => 
      (activeTab === 'bidAdjustment' && r.rule_type === 'BID_ADJUSTMENT') ||
      (activeTab === 'searchTerm' && r.rule_type === 'SEARCH_TERM_AUTOMATION')
  );

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Automation Center</h1>
      </header>

      <div style={styles.tabs}>
        <button style={activeTab === 'bidAdjustment' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('bidAdjustment')}>Bid Adjustment Rules</button>
        <button style={activeTab === 'searchTerm' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('searchTerm')}>Search Term Automation</button>
        <button style={activeTab === 'history' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('history')}>Automation History</button>
        <button style={activeTab === 'ruleGuide' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('ruleGuide')}>Rule Guide</button>
      </div>
      
      {activeTab !== 'history' && activeTab !== 'ruleGuide' && (
          <div style={styles.contentHeader}>
              <h2 style={styles.contentTitle}>{activeTab === 'bidAdjustment' ? 'Bid Adjustment Rules' : 'Search Term Automation Rules'}</h2>
              <button style={styles.primaryButton} onClick={() => handleOpenModal()}>+ Create New Rule</button>
          </div>
      )}

      {activeTab === 'bidAdjustment' && <RulesList rules={filteredRules} onEdit={handleOpenModal} onDelete={handleDeleteRule} />}
      {activeTab === 'searchTerm' && <RulesList rules={filteredRules} onEdit={handleOpenModal} onDelete={handleDeleteRule} />}
      {activeTab === 'history' && <LogsTab logs={logs} loading={loading.logs} />}
      {activeTab === 'ruleGuide' && <RuleGuideTab />}
      
      {isModalOpen && (
          <RuleBuilderModal 
              rule={editingRule} 
              ruleType={editingRule ? (editingRule.rule_type === 'BID_ADJUSTMENT' ? 'bidAdjustment' : 'searchTerm') : activeTab}
              onClose={() => setIsModalOpen(false)}
              onSave={handleSaveRule}
          />
      )}
    </div>
  );
}

const RulesList = ({ rules, onEdit, onDelete }: { rules: AutomationRule[], onEdit: (rule: AutomationRule) => void, onDelete: (id: number) => void}) => (
    <div style={styles.rulesGrid}>
        {rules.map(rule => (
            <div key={rule.id} style={styles.ruleCard}>
                <div style={styles.ruleCardHeader}>
                    <h3 style={styles.ruleName}>{rule.name}</h3>
                    <label style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                        <input type="checkbox" checked={rule.is_active} readOnly />
                        {rule.is_active ? 'Active' : 'Paused'}
                    </label>
                </div>
                <div style={styles.ruleDetails}>
                    <span style={styles.ruleLabel}>Frequency</span>
                    <span style={styles.ruleValue}>Every {rule.config.frequency?.value || 1} {rule.config.frequency?.unit || 'hour'}(s)</span>
                    <span style={styles.ruleLabel}>Cooldown</span>
                    <span style={styles.ruleValue}>{rule.config.cooldown?.value || 24} {rule.config.cooldown?.unit || 'hour'}(s)</span>
                    <span style={styles.ruleLabel}>Last Run</span>
                    <span style={styles.ruleValue}>{rule.last_run_at ? new Date(rule.last_run_at).toLocaleString() : 'Never'}</span>
                </div>
                <div style={styles.ruleActions}>
                    <button style={styles.button} onClick={() => onEdit(rule)}>Edit</button>
                    <button style={{...styles.button, ...styles.dangerButton}} onClick={() => onDelete(rule.id)}>Delete</button>
                </div>
            </div>
        ))}
    </div>
);

const LogsTab = ({ logs, loading }: { logs: any[], loading: boolean}) => (
    <div>
        <h2 style={styles.contentTitle}>Automation History</h2>
        {loading ? <p>Loading logs...</p> : (
            <div style={{...styles.tableContainer, maxHeight: '600px', overflowY: 'auto'}}>
                <table style={styles.logTable}>
                    <thead><tr><th style={styles.th}>Time</th><th style={styles.th}>Rule</th><th style={styles.th}>Status</th><th style={styles.th}>Summary</th></tr></thead>
                    <tbody>
                        {logs.map(log => (
                            <tr key={log.id}>
                                <td style={styles.td}>{new Date(log.run_at).toLocaleString()}</td>
                                <td style={styles.td}>{log.rule_name}</td>
                                <td style={styles.td}>{log.status}</td>
                                <td style={styles.td} title={log.details ? JSON.stringify(log.details, null, 2) : ''}>{log.summary}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </div>
);

const RuleGuideTab = () => (
    <div style={guideStyles.container}>
        <h1 style={guideStyles.h1}>PPC Automation Guide</h1>

        <h2 style={guideStyles.h2}>1. Introduction - The Power of Automation</h2>
        <p style={guideStyles.p}>
            Welcome to the <strong>Automation Center</strong>, a powerful control center designed to save you time, reduce wasted spend, and optimize ad performance 24/7. Instead of manual daily checks and adjustments, you can set up smart "rules" to let the system work for you, based on your actual business goals.
        </p>
        <p style={guideStyles.p}>
            This tool allows you to perform two main types of automation:
        </p>
        <ol style={guideStyles.ol}>
            <li style={guideStyles.li}><strong>Bid Adjustment:</strong> Automatically increase or decrease keyword/target bids based on performance metrics like ACOS, ROAS, Profit, Conversion Rate, etc.</li>
            <li style={guideStyles.li}><strong>Search Term Management:</strong> Automatically analyze customer search terms to <strong>negate</strong> inefficient ones or <strong>"harvest"</strong> golden terms to scale.</li>
        </ol>
        <p style={guideStyles.p}>
            This document will explain the core concepts, guide you in identifying key business metrics, and provide real-world examples to get you started immediately.
        </p>

        <h2 style={guideStyles.h2}>2. Core Concepts</h2>
        <p style={guideStyles.p}>To use the tool effectively, you need to master the following concepts:</p>

        <h3 style={guideStyles.h3}>2.1. Rule</h3>
        <p style={guideStyles.p}>A <strong>Rule</strong> is a container that holds a complete automation strategy. Each rule has:</p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}>A name (e.g., "Optimize Bid by Profit").</li>
            <li style={guideStyles.li}>A type (Bid Adjustment or Search Term Automation).</li>
            <li style={guideStyles.li}>One or more logical condition groups.</li>
            <li style={guideStyles.li}>Settings for frequency and scope of application.</li>
        </ul>

        <h3 style={guideStyles.h3}>2.2. Condition Group (IF/THEN Logic)</h3>
        <p style={guideStyles.p}>This is the heart of each rule, acting like an <code style={guideStyles.code}>IF ... THEN ...</code> block:</p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>IF:</strong> Includes one or more conditions connected by <strong>AND</strong> logic. All conditions in this group must be met.</li>
            <li style={guideStyles.li}><strong>THEN:</strong> Includes a specific action to be executed when the <code style={guideStyles.code}>IF</code> block is true.</li>
        </ul>
        
        <h3 style={guideStyles.h3}>2.3. "First Match Wins" Principle</h3>
        <p style={guideStyles.p}>This is the <strong>most important principle</strong> to remember when a Rule has multiple Condition Groups (the <code style={guideStyles.code}>OR IF</code> blocks).</p>
        <ol style={guideStyles.ol}>
            <li style={guideStyles.li}><strong>Order is everything:</strong> The system will always evaluate condition groups in the order you arrange them, <strong>from top to bottom</strong>.</li>
            <li style={guideStyles.li}><strong>Stops when found:</strong> As soon as a keyword/target satisfies all conditions in a group, the system will execute that group's action and <strong>stop processing</strong> that entity. It will not consider the groups below it.</li>
        </ol>
        <blockquote style={guideStyles.blockquote}>
            <p style={guideStyles.p}><strong>Golden Rule:</strong> Place the <strong>most specific</strong> and highest priority rules (e.g., the strongest bid reductions) at the top. More general rules should be placed below.</p>
        </blockquote>

        <h2 style={guideStyles.h2}>3. Strategy Foundation</h2>
        
        <h3 style={guideStyles.h3}>3.1. Part 1: Calculate Break-Even ACoS & Target ACoS</h3>
        <p style={guideStyles.p}>Before creating any rules, you must answer the most important question: "For each product, how much can I spend on advertising and still be profitable?" The answer is the <strong>Break-Even ACoS</strong>.</p>
        <p style={guideStyles.p}><strong>Formula:</strong> <code style={guideStyles.code}>Break-Even ACoS = Profit before Ad Spend / Product Selling Price</code></p>
        <p style={guideStyles.p}>Let's calculate for your example products:</p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>Product A ($9.99, Profit $4.00):</strong> Break-Even ACoS = $4.00 / $9.99 ≈ <strong>40%</strong></li>
            <li style={guideStyles.li}><strong>Product B ($19.99, Profit $5.00):</strong> Break-Even ACoS = $5.00 / $19.99 ≈ <strong>25%</strong></li>
            <li style={guideStyles.li}><strong>Product C ($29.99, Profit $8.00):</strong> Break-Even ACoS = $8.00 / $29.99 ≈ <strong>27%</strong></li>
        </ul>
        <p style={guideStyles.p}><strong>Target ACoS</strong> must be <strong>lower than</strong> Break-Even ACoS to ensure profitability. For example, for Product B, you might set a Target ACoS of <strong>15-20%</strong>.</p>
        
        <h3 style={guideStyles.h3}>3.2. Part 2: Determine Break-Even Clicks</h3>
        <p style={guideStyles.p}>When creating negation rules, you often see conditions like <code style={guideStyles.code}>IF clicks &gt; 12 AND orders = 0</code>. But why the number 12? Choosing an arbitrary number can lead you to negate keywords too early (missing opportunities) or too late (wasting money).</p>
        <p style={guideStyles.p}>The expert approach is to use your <strong>Conversion Rate (CVR)</strong> to determine a statistically sound click threshold.</p>
        <p style={guideStyles.p}><strong>Formula:</strong> <code style={guideStyles.code}>Click Threshold = 1 / Target Conversion Rate</code></p>
        <p style={guideStyles.p}><strong>Explanation:</strong></p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}>If your product's average CVR is <strong>8%</strong> (i.e., 8 orders per 100 clicks), then you theoretically need <code style={guideStyles.code}>1 / 0.08 = 12.5</code> clicks to get one order.</li>
            <li style={guideStyles.li}>This means that if a keyword gets <strong>13-15 clicks</strong> with zero orders, it's performing below average, and that's a strong signal to consider action (reducing bid or negating).</li>
        </ul>
        <blockquote style={guideStyles.blockquote}>
            <p style={guideStyles.p}><strong>Pro Tip:</strong> Check your average CVR in the "Business Reports" section of Seller Central to get a good starting number for your target CVR.</p>
        </blockquote>

        <h2 style={guideStyles.h2}>4. Bid Adjustment Automation: Strategies & Examples</h2>
        
        <h3 style={guideStyles.h3}>Strategy 1: Foundation - Cut Waste & Protect Profit</h3>
        <p style={guideStyles.p}><strong>Goal:</strong> Quickly identify and reduce spend on keywords/targets that are not generating any revenue.</p>
        <h4 style={guideStyles.h4}>Example: "Quick Loss-Cutting" Rule for Product A ($9.99, Profit $4.00)</h4>
        <p style={guideStyles.p}><strong>Rule Name:</strong> <code style={guideStyles.code}>[SP-A] Quick Loss-Cutting</code></p>
        <p style={guideStyles.p}><strong>Strategy:</strong> If a keyword has spent the entire potential profit ($4.00) without generating an order, drastically reduce its bid.</p>
        <p style={guideStyles.p}><strong>Configuration (<code style={guideStyles.code}>config</code>):</strong></p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>Frequency:</strong> Every 24 hours.</li>
            <li style={guideStyles.li}><strong>Cooldown:</strong> 7 days.</li>
            <li style={guideStyles.li}><strong>Logic:</strong></li>
            <ul style={{paddingLeft: '20px'}}>
                <li><strong>IF</strong> (spend in last 30 days &gt; $4.00 <strong>AND</strong> orders = 0) <strong>THEN</strong> decrease bid by 50% (but not lower than $0.15).</li>
            </ul>
        </ul>

        <h3 style={guideStyles.h3}>Strategy 2: Profitability Optimization</h3>
        <p style={guideStyles.p}><strong>Goal:</strong> Automatically adjust active keywords to bring their ACoS closer to the Target ACoS.</p>
        <h4 style={guideStyles.h4}>Example: "Tiered ACoS Optimization" Rule for Product C ($29.99, Target ACoS ~20%)</h4>
        <p style={guideStyles.p}><strong>Rule Name:</strong> <code style={guideStyles.code}>[SP-C] Tiered ACoS Optimization</code></p>
        <p style={guideStyles.p}><strong>Configuration (<code style={guideStyles.code}>config</code>):</strong></p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>Frequency:</strong> Every 4 hours.</li>
            <li style={guideStyles.li}><strong>Cooldown:</strong> 48 hours.</li>
            <li style={guideStyles.li}><strong>Condition Groups (evaluated top to bottom):</strong></li>
            <ol style={{paddingLeft: '20px'}}>
                <li style={guideStyles.li}><strong>IF</strong> (ACOS in last 30 days &gt; 40% <strong>AND</strong> spend &gt; $16) <strong>THEN</strong> decrease bid by 20%.</li>
                <li style={guideStyles.li}><strong>OR IF</strong> (ACOS in last 14 days &gt; 25%) <strong>THEN</strong> decrease bid by 10%.</li>
                <li style={guideStyles.li}><strong>OR IF</strong> (ACOS in last 14 days &lt; 15% <strong>AND</strong> orders &gt; 1) <strong>THEN</strong> increase bid by 8%.</li>
            </ol>
        </ul>

        <h2 style={guideStyles.h2}>5. Search Term Automation: From Defense to Offense</h2>
        <p style={guideStyles.p}>Search term automation is not just about "defense" (negating bad keywords) but also about "offense" (finding and scaling new opportunities).</p>
        
        <h3 style={guideStyles.h3}>5.1. Negate Wasted Spend Search Terms (Defense)</h3>
        <p style={guideStyles.p}><strong>Goal:</strong> Keep your campaigns "clean" by automatically removing irrelevant or inefficient search terms.</p>
        <h4 style={guideStyles.h4}>Example 1: Negate based on Wasted Spend</h4>
        <p style={guideStyles.p}><strong>Rule Name:</strong> <code style={guideStyles.code}>Negate by Profit</code></p>
        <p style={guideStyles.p}><strong>Configuration (<code style={guideStyles.code}>config</code>):</strong></p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>Frequency:</strong> Every 48 hours.</li>
            <li style={guideStyles.li}><strong>Cooldown:</strong> 90 days.</li>
            <li style={guideStyles.li}><strong>Logic:</strong></li>
            <ul style={{paddingLeft: '20px'}}>
                <li><strong>IF</strong> (spend in last 60 days &gt; $6.00 <strong>AND</strong> sales = 0) <strong>THEN</strong> create a Negative Exact keyword.</li>
            </ul>
        </ul>
        
        <h4 style={guideStyles.h4}>Example 2: Negate based on Non-Converting Clicks</h4>
        <p style={guideStyles.p}><strong>Rule Name:</strong> <code style={guideStyles.code}>Negate Non-Converting</code></p>
        <p style={guideStyles.p}><strong>Strategy:</strong> Use the Click Threshold formula. Assuming our target CVR is 7%, the click threshold is <code style={guideStyles.code}>1 / 0.07 ≈ 14</code>.</p>
        <p style={guideStyles.p}><strong>Configuration (<code style={guideStyles.code}>config</code>):</strong></p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>Frequency:</strong> Every 48 hours.</li>
            <li style={guideStyles.li}><strong>Cooldown:</strong> 90 days.</li>
            <li style={guideStyles.li}><strong>Logic:</strong></li>
            <ul style={{paddingLeft: '20px'}}>
                <li><strong>IF</strong> (clicks in last 30 days &gt; 14 <strong>AND</strong> orders = 0) <strong>THEN</strong> create a Negative Phrase keyword.</li>
            </ul>
        </ul>

        <h2 style={guideStyles.h2}>6. Advanced Strategic Thinking - When ACoS Isn't Everything</h2>
        <p style={guideStyles.p}>ACoS-based rules are incredibly powerful for optimizing profitability. However, focusing solely on ACoS can be a trap. A professional advertiser always looks at the bigger picture.</p>
        
        <h3 style={guideStyles.h3}>6.1. TACOS (Total ACoS) - The True Health Metric</h3>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>ACoS (Advertising Cost of Sales):</strong> <code style={guideStyles.code}>Ad Spend / Ad Sales</code>. This measures the efficiency of <strong>advertising alone</strong>.</li>
            <li style={guideStyles.li}><strong>TACOS (Total Advertising Cost of Sales):</strong> <code style={guideStyles.code}>Ad Spend / TOTAL Sales (Ad + Organic)</code>. This measures the <strong>overall impact</strong> of your advertising on your entire business.</li>
        </ul>
        <p style={guideStyles.p}><strong>Why is TACOS important?</strong></p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}>The ultimate goal of advertising is to create a "flywheel effect": ads drive sales, which boosts organic rank, leading to more organic sales.</li>
            <li style={guideStyles.li}>A good campaign might have a slightly increasing ACoS but cause a strong increase in organic sales, leading to a <strong>decreasing TACOS</strong>. This is an excellent sign.</li>
            <li style={guideStyles.li}>Conversely, if you "squeeze" ACoS too tightly, you might lose impressions, reduce ad sales, and harm your organic rank, leading to an <strong>increasing TACOS</strong>.</li>
        </ul>
        <blockquote style={guideStyles.blockquote}>
            <p style={guideStyles.p}><strong>Expert Advice:</strong> Keep a close eye on your TACOS. Your automation rules should aim to keep TACOS stable or trending down over time.</p>
        </blockquote>

        <h3 style={guideStyles.h3}>6.2. Protecting Strategic Keywords & Impression Share</h3>
        <p style={guideStyles.p}>Not all keywords are created equal.</p>
        <ul style={guideStyles.ul}>
            <li style={guideStyles.li}><strong>"Branded" Keywords:</strong> e.g., "Nike shoes". These might have a higher ACoS than your target, but lowering their bids is a fatal mistake. You must dominate the top spot for your brand keywords to defend against competitors.</li>
            <li style={guideStyles.li}><strong>"Main Category" Keywords:</strong> e.g., "running shoes for men". These are the highest-traffic keywords. Lowering their bids just because ACoS is slightly high can cause you to lose <strong>Impression Share</strong>, giving ground to competitors.</li>
        </ul>
        <blockquote style={guideStyles.blockquote}>
            <p style={guideStyles.p}><strong>Expert Advice:</strong></p>
            <ol style={guideStyles.ol}>
                <li style={guideStyles.li}><strong>Create Separate Campaigns:</strong> Consider creating separate campaigns for "Branded" and "Strategic" keywords.</li>
                <li style={guideStyles.li}><strong>Don't Apply Aggressive Rules:</strong> <strong>DO NOT</strong> apply overly aggressive bid reduction rules to these campaigns. The goal here is presence and top position, not maximum profit on every click.</li>
                <li style={guideStyles.li}><strong>Use Bid Increase Rules:</strong> Instead, you could create rules to <strong>increase bids</strong> if your <strong>Top-of-Search Impression Share</strong> drops below a certain threshold, ensuring you're always where customers look first.</li>
            </ol>
        </blockquote>
        <p style={guideStyles.p}>By combining ACoS-based automation rules with a broader strategic mindset, you will build a system that is not only cost-effective but also sustainable and drives long-term growth.</p>
    </div>
);


const RuleBuilderModal = ({ rule, ruleType, onClose, onSave }: { rule: AutomationRule | null, ruleType: string, onClose: () => void, onSave: (data: any) => void }) => {
    const [formData, setFormData] = useState<Partial<AutomationRule>>(() => {
        if (rule) return JSON.parse(JSON.stringify(rule));
        return ruleType === 'bidAdjustment' ? getDefaultBidAdjustmentRule() : getDefaultSearchTermRule();
    });

    const handleConfigChange = (field: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            config: { ...prev.config!, [field]: value }
        }));
    };

    const handleConditionChange = (groupIndex: number, condIndex: number, field: keyof AutomationRuleCondition, value: any) => {
        setFormData(prev => {
            const newGroups = JSON.parse(JSON.stringify(prev.config!.conditionGroups));
            newGroups[groupIndex].conditions[condIndex][field] = value;
            return { ...prev, config: { ...prev.config!, conditionGroups: newGroups } };
        });
    };

    const addConditionToGroup = (groupIndex: number) => {
        setFormData(prev => {
            const newGroups = JSON.parse(JSON.stringify(prev.config!.conditionGroups));
            newGroups[groupIndex].conditions.push(getDefaultCondition());
            return { ...prev, config: { ...prev.config!, conditionGroups: newGroups } };
        });
    };
    
    const removeCondition = (groupIndex: number, condIndex: number) => {
         setFormData(prev => {
            const newGroups = JSON.parse(JSON.stringify(prev.config!.conditionGroups));
            // Don't remove the last condition in a group
            if (newGroups[groupIndex].conditions.length > 1) {
                newGroups[groupIndex].conditions.splice(condIndex, 1);
            } else if (newGroups.length > 1) {
                // If it's the last condition, remove the whole group
                newGroups.splice(groupIndex, 1);
            }
            return { ...prev, config: { ...prev.config!, conditionGroups: newGroups } };
        });
    };
    
    const addConditionGroup = () => {
        setFormData(prev => {
            const newGroup = ruleType === 'bidAdjustment' ? getDefaultBidAdjustmentGroup() : getDefaultSearchTermGroup();
            const newGroups = [...prev.config!.conditionGroups, newGroup];
            return { ...prev, config: { ...prev.config!, conditionGroups: newGroups } };
        });
    };
    
    const handleActionChange = (groupIndex: number, field: string, value: any) => {
        setFormData(prev => {
            const newGroups = JSON.parse(JSON.stringify(prev.config!.conditionGroups));
            newGroups[groupIndex].action[field] = value;
            return { ...prev, config: { ...prev.config!, conditionGroups: newGroups }};
        });
    };

    const modalTitle = ruleType === 'bidAdjustment' ? 'Edit Bid Adjustment Rule' : 'Edit Search Term Rule';

    return (
        <div style={styles.modalBackdrop} onClick={onClose}>
            <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                <form style={styles.form} onSubmit={e => { e.preventDefault(); onSave(formData); }}>
                    <h2 style={styles.modalHeader}>{modalTitle}</h2>
                    
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Rule Name</label>
                        <input style={styles.input} value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} required />
                    </div>

                     <div style={styles.card}>
                        <h3 style={styles.cardTitle}>Scheduling &amp; Cooldown</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div style={styles.formGroup}>
                                <label style={styles.label}>Frequency</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={styles.conditionText}>Run every</span>
                                    <input 
                                        type="number" 
                                        style={{...styles.input, width: '80px'}} 
                                        value={formData.config?.frequency?.value || 1}
                                        min="1"
                                        onChange={e => handleConfigChange('frequency', { ...formData.config?.frequency, value: Number(e.target.value) })}
                                        required
                                    />
                                    <select 
                                        style={{...styles.input, flex: 1}}
                                        value={formData.config?.frequency?.unit || 'hours'}
                                        onChange={e => handleConfigChange('frequency', { ...formData.config?.frequency, unit: e.target.value as any })}
                                    >
                                        <option value="minutes">Minute(s)</option>
                                        <option value="hours">Hour(s)</option>
                                        <option value="days">Day(s)</option>
                                    </select>
                                </div>
                            </div>
                            <div style={styles.formGroup}>
                                <label style={styles.label}>Action Cooldown</label>
                                 <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={styles.conditionText}>Wait for</span>
                                    <input
                                        type="number"
                                        style={{...styles.input, width: '80px'}}
                                        value={formData.config?.cooldown?.value ?? 24}
                                        min="0"
                                        onChange={e => handleConfigChange('cooldown', { ...formData.config?.cooldown, value: Number(e.target.value) })}
                                        required
                                    />
                                    <select
                                        style={{...styles.input, flex: 1}}
                                        value={formData.config?.cooldown?.unit || 'hours'}
                                        onChange={e => handleConfigChange('cooldown', { ...formData.config?.cooldown, unit: e.target.value as any })}
                                    >
                                        <option value="minutes">Minute(s)</option>
                                        <option value="hours">Hour(s)</option>
                                        <option value="days">Day(s)</option>
                                    </select>
                                </div>
                                <p style={{fontSize: '0.8rem', color: '#666', margin: '5px 0 0 0'}}>After acting on an item, wait this long before acting on it again. Set to 0 to disable.</p>
                            </div>
                        </div>
                    </div>

                    <div style={styles.card}>
                         <h3 style={styles.cardTitle}>Rule Logic (First Match Wins)</h3>
                         <p style={{fontSize: '0.8rem', color: '#666', marginTop: '-10px', marginBottom: '15px'}}>Rules are checked from top to bottom. The first group whose conditions are met will trigger its action, and the engine will stop.</p>

                        {formData.config?.conditionGroups.map((group, groupIndex) => (
                           <React.Fragment key={groupIndex}>
                                <div style={styles.ifThenBlock}>
                                    <h4 style={styles.ifBlockHeader}>IF</h4>
                                    {group.conditions.map((cond, condIndex) => (
                                        <div key={condIndex} style={styles.conditionRow}>
                                           <select style={styles.conditionInput} value={cond.metric} onChange={e => handleConditionChange(groupIndex, condIndex, 'metric', e.target.value)}>
                                                <option value="spend">Spend</option>
                                                <option value="sales">Sales</option>
                                                <option value="acos">ACOS</option>
                                                <option value="orders">Orders</option>
                                                <option value="clicks">Clicks</option>
                                                <option value="impressions">Impressions</option>
                                            </select>
                                            <span style={styles.conditionText}>in last</span>
                                            <input type="number" min="1" max="90" style={{...styles.conditionInput, width: '60px'}} value={cond.timeWindow} onChange={e => handleConditionChange(groupIndex, condIndex, 'timeWindow', Number(e.target.value))} required />
                                            <span style={styles.conditionText}>days</span>
                                            <select style={{...styles.conditionInput, width: '60px'}} value={cond.operator} onChange={e => handleConditionChange(groupIndex, condIndex, 'operator', e.target.value)}>
                                                <option value=">">&gt;</option> <option value="<">&lt;</option> <option value="=">=</option>
                                            </select>
                                            <input type="number" step="0.01" style={styles.conditionInput} value={cond.value} onChange={e => handleConditionChange(groupIndex, condIndex, 'value', Number(e.target.value))} required />
                                            <button type="button" onClick={() => removeCondition(groupIndex, condIndex)} style={styles.deleteButton}>&times;</button>
                                        </div>
                                    ))}
                                     <button type="button" onClick={() => addConditionToGroup(groupIndex)} style={{...styles.button, marginTop: '10px'}}>+ Add Condition (AND)</button>
                                
                                     <div style={styles.thenBlock}>
                                        <h4 style={styles.thenHeader}>THEN</h4>
                                        {ruleType === 'bidAdjustment' && (
                                            <div style={styles.thenGrid}>
                                                <div style={styles.formGroup}>
                                                    <label style={styles.label}>Action</label>
                                                    <select style={styles.input} value={(group.action.value || 0) >= 0 ? 'increase' : 'decrease'} 
                                                        onChange={e => {
                                                            const sign = e.target.value === 'increase' ? 1 : -1;
                                                            handleActionChange(groupIndex, 'value', sign * Math.abs(group.action.value || 0))
                                                        }}
                                                    >
                                                        <option value="decrease">Decrease Bid By</option>
                                                        <option value="increase">Increase Bid By</option>
                                                    </select>
                                                </div>
                                                <div style={styles.formGroup}>
                                                    <label style={styles.label}>Value (%)</label>
                                                    <input type="number" style={styles.input} value={Math.abs(group.action.value || 0)} 
                                                        onChange={e => {
                                                            const sign = (group.action.value || -1) >= 0 ? 1 : -1;
                                                            handleActionChange(groupIndex, 'value', sign * Math.abs(Number(e.target.value)))
                                                        }}
                                                    />
                                                </div>
                                                <div style={styles.formGroup}>
                                                    <label style={styles.label}>Min Bid ($)</label>
                                                    <input type="number" step="0.01" style={styles.input} placeholder="e.g., 0.10"
                                                           value={group.action.minBid ?? ''} 
                                                           onChange={e => handleActionChange(groupIndex, 'minBid', e.target.value ? Number(e.target.value) : undefined)} />
                                                </div>
                                                <div style={styles.formGroup}>
                                                    <label style={styles.label}>Max Bid ($)</label>
                                                    <input type="number" step="0.01" style={styles.input} placeholder="e.g., 2.50"
                                                           value={group.action.maxBid ?? ''} 
                                                           onChange={e => handleActionChange(groupIndex, 'maxBid', e.target.value ? Number(e.target.value) : undefined)} />
                                                </div>
                                            </div>
                                        )}
                                         {ruleType === 'searchTerm' && (
                                            <div style={styles.thenGrid}>
                                                 <div style={styles.formGroup}>
                                                    <label style={styles.label}>Action</label>
                                                    <input style={styles.input} value="Create Negative Keyword" disabled />
                                                </div>
                                                <div style={styles.formGroup}>
                                                    <label style={styles.label}>Match Type</label>
                                                    <select style={styles.input} value={group.action.matchType} onChange={e => handleActionChange(groupIndex, 'matchType', e.target.value)}>
                                                        <option value="NEGATIVE_EXACT">Negative Exact</option>
                                                        <option value="NEGATIVE_PHRASE">Negative Phrase</option>
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                               {groupIndex < formData.config!.conditionGroups.length - 1 && <div style={{textAlign: 'center', margin: '15px 0', fontWeight: 'bold', color: '#555'}}>OR</div>}
                           </React.Fragment>
                        ))}
                        <button type="button" onClick={addConditionGroup} style={{...styles.button, marginTop: '15px'}}>+ Add Condition Group (OR)</button>
                    </div>
                    
                    <div style={styles.modalFooter}>
                        <div style={styles.activeCheckboxContainer}>
                           <input type="checkbox" id="rule-is-active" style={{ transform: 'scale(1.2)' }} checked={formData.is_active} onChange={e => setFormData(p => ({...p, is_active: e.target.checked!}))} />
                           <label htmlFor="rule-is-active" style={{...styles.label, cursor: 'pointer'}}>Rule is Active</label>
                        </div>
                        <button type="button" style={{...styles.button, ...styles.dangerButton}} onClick={onClose}>Cancel</button>
                        <button type="submit" style={styles.primaryButton}>Save Rule</button>
                    </div>
                </form>
            </div>
        </div>
    );
};