// views/AutomationView.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { AutomationRule, AutomationRuleCondition, AutomationConditionGroup, AutomationRuleAction } from '../types';
import { RuleGuideContent } from './components/RuleGuideContent';

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
  infoBox: { backgroundColor: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 'var(--border-radius)', padding: '10px 15px', fontSize: '0.9rem', color: '#0050b3' }
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

const getDefaultBudgetAccelerationAction = (): AutomationRuleAction => ({
    type: 'increaseBudgetPercent',
    value: 50
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

const getDefaultBudgetAccelerationGroup = (): AutomationConditionGroup => ({
    conditions: [
        { metric: 'roas', timeWindow: 'TODAY', operator: '>', value: 2.5 },
        { metric: 'budgetUtilization', timeWindow: 'TODAY', operator: '>', value: 75 },
    ],
    action: getDefaultBudgetAccelerationAction()
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

const getDefaultBudgetAccelerationRule = (): Partial<AutomationRule> => ({
    name: '',
    rule_type: 'BUDGET_ACCELERATION',
    config: {
        conditionGroups: [getDefaultBudgetAccelerationGroup()],
        frequency: { unit: 'minutes', value: 30 }, // Default to high frequency
        cooldown: { unit: 'hours', value: 0 } // Cooldown is handled by the daily reset mechanism
    },
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

  const handleDuplicateRule = (ruleToDuplicate: AutomationRule) => {
    // Create a deep copy to avoid any state mutation issues
    const newRule = JSON.parse(JSON.stringify(ruleToDuplicate));

    // Remove properties that are specific to an existing rule instance
    delete newRule.id;
    delete newRule.last_run_at;

    // Update the name to indicate it's a copy
    newRule.name = `${newRule.name} - Copy`;

    // The modal will now open pre-filled with this data.
    // When saved, `handleSaveRule` will see it has no 'id' and will perform a 'POST' (create).
    setEditingRule(newRule);
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
      body: JSON.stringify(payload),
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
      (activeTab === 'searchTerm' && r.rule_type === 'SEARCH_TERM_AUTOMATION') ||
      (activeTab === 'budgetAcceleration' && r.rule_type === 'BUDGET_ACCELERATION')
  );

  const ruleTypeTitles: { [key: string]: string } = {
      bidAdjustment: 'Bid Adjustment Rules',
      searchTerm: 'Search Term Automation Rules',
      budgetAcceleration: 'Budget Acceleration Rules'
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Automation Center</h1>
      </header>

      <div style={styles.tabs}>
        <button style={activeTab === 'bidAdjustment' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('bidAdjustment')}>Bid Adjustment</button>
        <button style={activeTab === 'searchTerm' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('searchTerm')}>Search Term</button>
        <button style={activeTab === 'budgetAcceleration' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('budgetAcceleration')}>Budget Acceleration</button>
        <button style={activeTab === 'history' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('history')}>History</button>
        <button style={activeTab === 'ruleGuide' ? {...styles.tabButton, ...styles.tabButtonActive} : styles.tabButton} onClick={() => setActiveTab('ruleGuide')}>Guide</button>
      </div>
      
      {['bidAdjustment', 'searchTerm', 'budgetAcceleration'].includes(activeTab) && (
          <div style={styles.contentHeader}>
              <h2 style={styles.contentTitle}>{ruleTypeTitles[activeTab]}</h2>
              <button style={styles.primaryButton} onClick={() => handleOpenModal()}>+ Create New Rule</button>
          </div>
      )}

      {activeTab !== 'history' && activeTab !== 'ruleGuide' && <RulesList rules={filteredRules} onEdit={handleOpenModal} onDelete={handleDeleteRule} onDuplicate={handleDuplicateRule} />}
      {activeTab === 'history' && <LogsTab logs={logs} loading={loading.logs} />}
      {activeTab === 'ruleGuide' && <RuleGuideContent />}
      
      {isModalOpen && (
          <RuleBuilderModal 
              rule={editingRule} 
              ruleType={editingRule ? editingRule.rule_type.toLowerCase().replace(/_/g, '') : activeTab}
              onClose={() => setIsModalOpen(false)}
              onSave={handleSaveRule}
          />
      )}
    </div>
  );
}

const RulesList = ({ rules, onEdit, onDelete, onDuplicate }: { rules: AutomationRule[], onEdit: (rule: AutomationRule) => void, onDelete: (id: number) => void, onDuplicate: (rule: AutomationRule) => void }) => (
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
                    <span style={styles.ruleValue}>{rule.config.cooldown?.value ?? 24} {rule.config.cooldown?.unit || 'hour'}(s)</span>
                    <span style={styles.ruleLabel}>Last Run</span>
                    <span style={styles.ruleValue}>{rule.last_run_at ? new Date(rule.last_run_at).toLocaleString() : 'Never'}</span>
                </div>
                <div style={styles.ruleActions}>
                    <button style={styles.button} onClick={() => onEdit(rule)}>Edit</button>
                    <button style={styles.button} onClick={() => onDuplicate(rule)}>Duplicate</button>
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

const RuleBuilderModal = ({ rule, ruleType, onClose, onSave }: { rule: AutomationRule | null, ruleType: string, onClose: () => void, onSave: (data: any) => void }) => {
    const [formData, setFormData] = useState<Partial<AutomationRule>>(() => {
        if (rule) return JSON.parse(JSON.stringify(rule));
        if (ruleType === 'bidadjustment') return getDefaultBidAdjustmentRule();
        if (ruleType === 'searchTerm') return getDefaultSearchTermRule();
        if (ruleType === 'budgetacceleration') return getDefaultBudgetAccelerationRule();
        return getDefaultBidAdjustmentRule();
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
            let newGroup;
            if (ruleType === 'bidadjustment') newGroup = getDefaultBidAdjustmentGroup();
            else if (ruleType === 'searchTerm') newGroup = getDefaultSearchTermGroup();
            else if (ruleType === 'budgetacceleration') newGroup = getDefaultBudgetAccelerationGroup();
            else newGroup = getDefaultBidAdjustmentGroup();
            
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

    const modalTitle: { [key: string]: string } = {
        'bidadjustment': 'Edit Bid Adjustment Rule',
        'searchTerm': 'Edit Search Term Rule',
        'budgetacceleration': 'Edit Budget Acceleration Rule'
    };

    return (
        <div style={styles.modalBackdrop} onClick={onClose}>
            <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                <form style={styles.form} onSubmit={e => { e.preventDefault(); onSave(formData); }}>
                    <h2 style={styles.modalHeader}>{modalTitle[ruleType] || 'Edit Rule'}</h2>
                    
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Rule Name</label>
                        <input style={styles.input} value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} required />
                    </div>

                     <div style={styles.card}>
                        <h3 style={styles.cardTitle}>Scheduling &amp; Cooldown</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                                            onChange={e => {
                                                const newUnit = e.target.value as any;
                                                const currentFrequency = formData.config?.frequency || { value: 1 };
                                                const newFrequency = { ...currentFrequency, unit: newUnit };
                                                if (newUnit === 'days' && !(newFrequency as any).startTime) {
                                                    (newFrequency as any).startTime = '01:00'; // Default start time
                                                }
                                                handleConfigChange('frequency', newFrequency);
                                            }}
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
                                            disabled={ruleType === 'budgetacceleration'}
                                        />
                                        <select
                                            style={{...styles.input, flex: 1}}
                                            value={formData.config?.cooldown?.unit || 'hours'}
                                            onChange={e => handleConfigChange('cooldown', { ...formData.config?.cooldown, unit: e.target.value as any })}
                                            disabled={ruleType === 'budgetacceleration'}
                                        >
                                            <option value="minutes">Minute(s)</option>
                                            <option value="hours">Hour(s)</option>
                                            <option value="days">Day(s)</option>
                                        </select>
                                    </div>
                                    <p style={{fontSize: '0.8rem', color: '#666', margin: '5px 0 0 0'}}>
                                        {ruleType === 'budgetacceleration' ? 'Cooldown is handled by the daily reset mechanism.' : 'After acting on an item, wait this long before acting on it again. Set to 0 to disable.'}
                                    </p>
                                </div>
                            </div>

                            {formData.config?.frequency?.unit === 'days' && (
                                <div style={styles.formGroup}>
                                    <label style={styles.label}>Scheduled Start Time (UTC-7)</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <input
                                            type="time"
                                            style={{...styles.input, width: '150px'}}
                                            value={(formData.config.frequency as any).startTime || '01:00'}
                                            onChange={e => handleConfigChange('frequency', { ...(formData.config.frequency as any), startTime: e.target.value })}
                                            required
                                        />
                                        <p style={{fontSize: '0.8rem', color: '#666', margin: 0}}>Rule will run after this time, every {formData.config.frequency.value} day(s).</p>
                                    </div>
                                </div>
                            )}
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
                                                {ruleType === 'budgetacceleration' ? (
                                                    <>
                                                        <option value="roas">ROAS</option>
                                                        <option value="acos">ACoS</option>
                                                        <option value="sales">Sales</option>
                                                        <option value="orders">Orders</option>
                                                        <option value="budgetUtilization">Budget Utilization %</option>
                                                    </>
                                                ) : (
                                                    <>
                                                        <option value="spend">Spend</option>
                                                        <option value="sales">Sales</option>
                                                        <option value="acos">ACOS</option>
                                                        <option value="orders">Orders</option>
                                                        <option value="clicks">Clicks</option>
                                                        <option value="impressions">Impressions</option>
                                                    </>
                                                )}
                                            </select>
                                            <span style={styles.conditionText}>in last</span>
                                            {ruleType === 'budgetacceleration' ? (
                                                <input style={{...styles.conditionInput, width: '60px', textAlign: 'center'}} value="Today" disabled />
                                            ) : (
                                                <input type="number" min="1" max="90" style={{...styles.conditionInput, width: '60px'}} value={cond.timeWindow} onChange={e => handleConditionChange(groupIndex, condIndex, 'timeWindow', Number(e.target.value))} required />
                                            )}
                                            <span style={styles.conditionText}>{ruleType !== 'budgetacceleration' && 'days'}</span>
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
                                        {ruleType === 'bidadjustment' && (
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
                                        {ruleType === 'budgetacceleration' && (
                                            <>
                                            <div style={styles.thenGrid}>
                                                 <div style={styles.formGroup}>
                                                    <label style={styles.label}>Action</label>
                                                    <select style={styles.input} value={group.action.type} onChange={e => handleActionChange(groupIndex, 'type', e.target.value)}>
                                                        <option value="increaseBudgetPercent">Increase Budget By (%)</option>
                                                        <option value="setBudgetAmount">Set Budget To ($)</option>
                                                    </select>
                                                </div>
                                                <div style={styles.formGroup}>
                                                    <label style={styles.label}>Value</label>
                                                    <input type="number" step="0.01" style={styles.input} value={group.action.value} onChange={e => handleActionChange(groupIndex, 'value', Number(e.target.value))} required />
                                                </div>
                                            </div>
                                            <div style={{...styles.infoBox, marginTop: '15px'}}>
                                                ℹ️ Budgets will be automatically restored to their original values at the end of the day.
                                            </div>
                                            </>
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