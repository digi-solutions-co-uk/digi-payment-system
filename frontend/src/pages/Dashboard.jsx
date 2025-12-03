import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, getDoc, doc, addDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { showSuccess, showError, showWarning } from '../utils/alerts';
import './Dashboard.css';

export function Dashboard() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [dueTodayInvoices, setDueTodayInvoices] = useState([]);
  const [allUnpaidInvoices, setAllUnpaidInvoices] = useState([]);
  const [trialsEnding, setTrialsEnding] = useState([]);
  const [customerNames, setCustomerNames] = useState({});
  const [customerBanks, setCustomerBanks] = useState({});
  const [kpis, setKpis] = useState({
    overdueAmount: 0,
    dueTodayAmount: 0,
    activeSubscriptions: 0
  });
  const [loading, setLoading] = useState(true);
  const [paymentModal, setPaymentModal] = useState({ isOpen: false, invoice: null });
  const [paymentData, setPaymentData] = useState({
    amountPaid: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: ''
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 7);

      // Get all unpaid invoices (UNPAID and OVERDUE)
      const unpaidQuery = query(
        collection(db, 'invoices'),
        where('status', 'in', ['UNPAID', 'OVERDUE'])
      );
      const unpaidSnapshot = await getDocs(unpaidQuery);
      
      const overdue = [];
      const dueToday = [];
      const allUnpaid = [];
      let overdueTotal = 0;
      let dueTodayTotal = 0;
      
      unpaidSnapshot.forEach(doc => {
        const data = doc.data();
        const dueDate = data.dueDate?.toDate();
        const invoice = { id: doc.id, ...data };
        
        // Add to all unpaid list
        allUnpaid.push(invoice);
        
        if (dueDate) {
          // Check if invoice is overdue (due date is before today)
          if (dueDate < today) {
            overdueTotal += data.amount || 0;
            overdue.push(invoice);
          }
          // Check if invoice is due today (within today's date range)
          else if (dueDate >= today && dueDate <= todayEnd) {
            dueTodayTotal += data.amount || 0;
            dueToday.push(invoice);
          }
        } else {
          // If no due date, treat as overdue if status is OVERDUE
          if (data.status === 'OVERDUE') {
            overdueTotal += data.amount || 0;
            overdue.push(invoice);
          }
        }
      });

      // Get active subscriptions
      const subscriptionsQuery = query(
        collection(db, 'subscriptions'),
        where('status', '==', 'ACTIVE')
      );
      const subscriptionsSnapshot = await getDocs(subscriptionsQuery);

      // Get trials ending soon
      const trialsQuery = query(
        collection(db, 'subscriptions'),
        where('status', '==', 'TRIAL')
      );
      const trialsSnapshot = await getDocs(trialsQuery);
      const trials = [];
      
      trialsSnapshot.forEach(doc => {
        const data = doc.data();
        const nextBilling = data.nextBillingDate?.toDate();
        if (nextBilling && nextBilling <= tomorrow) {
          trials.push({ id: doc.id, ...data });
        }
      });

      setTrialsEnding(trials);

      // Also update invoice status to OVERDUE if needed (client-side check)
      const batch = [];
      overdue.forEach(inv => {
        if (inv.status === 'UNPAID') {
          // Mark as overdue in Firestore
          updateDoc(doc(db, 'invoices', inv.id), {
            status: 'OVERDUE',
            updatedAt: Timestamp.now()
          }).catch(err => console.error('Error updating invoice status:', err));
        }
      });

      // Load customer names for invoices and filter out invoices for deleted customers
      const customerIds = new Set();
      allUnpaid.forEach(inv => {
        // Handle both Firestore reference format and direct ID
        const customerId = inv.customerId?.id || inv.customerId?.path?.split('/').pop() || inv.customerId;
        if (customerId) {
          customerIds.add(customerId);
        }
      });
      
      const names = {};
      const banks = {};
      const validCustomerIds = new Set();

      // Load all needed customers in parallel for better performance
      const customerPromises = Array.from(customerIds).map(async (customerId) => {
        try {
          const customerDoc = await getDoc(doc(db, 'customers', customerId));
          if (customerDoc.exists()) {
            const customerData = customerDoc.data();
            names[customerId] = customerData.name;
            banks[customerId] = customerData.bankName || '';
            validCustomerIds.add(customerId);
          }
        } catch (error) {
          console.error(`Error loading customer ${customerId}:`, error);
        }
      });

      await Promise.all(customerPromises);
      setCustomerNames(names);
      setCustomerBanks(banks);

      // Filter out invoices for deleted customers
      const validOverdue = overdue.filter(inv => {
        const customerId = inv.customerId?.id || inv.customerId?.path?.split('/').pop() || inv.customerId;
        return customerId && validCustomerIds.has(customerId);
      });
      const validDueToday = dueToday.filter(inv => {
        const customerId = inv.customerId?.id || inv.customerId?.path?.split('/').pop() || inv.customerId;
        return customerId && validCustomerIds.has(customerId);
      });
      const validAllUnpaid = allUnpaid.filter(inv => {
        const customerId = inv.customerId?.id || inv.customerId?.path?.split('/').pop() || inv.customerId;
        return customerId && validCustomerIds.has(customerId);
      });

      setOverdueInvoices(validOverdue);
      setDueTodayInvoices(validDueToday);
      setAllUnpaidInvoices(validAllUnpaid);
      
      // Recalculate totals for valid invoices only
      let validOverdueTotal = 0;
      let validDueTodayTotal = 0;
      validOverdue.forEach(inv => {
        validOverdueTotal += inv.amount || 0;
      });
      validDueToday.forEach(inv => {
        validDueTodayTotal += inv.amount || 0;
      });

      setKpis({
        overdueAmount: validOverdueTotal,
        dueTodayAmount: validDueTodayTotal,
        activeSubscriptions: subscriptionsSnapshot.size
      });
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRecordPayment = (invoice) => {
    setPaymentModal({ isOpen: true, invoice });
    setPaymentData({
      amountPaid: invoice.amount || '',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: ''
    });
  };

  const submitPayment = async () => {
    try {
      if (!currentUser) {
        showWarning('You must be logged in to record payments');
        return;
      }

      if (!paymentData.amountPaid || !paymentData.paymentDate) {
        showWarning('Please fill in all required fields');
        return;
      }

      const invoice = paymentModal.invoice;

      // Create payment record
      await addDoc(collection(db, 'payments'), {
        invoiceId: doc(db, 'invoices', invoice.id),
        recordedByUserId: doc(db, 'users', currentUser.uid),
        paymentDate: Timestamp.fromDate(new Date(paymentData.paymentDate)),
        amountPaid: parseFloat(paymentData.amountPaid),
        notes: paymentData.notes || '',
        createdAt: Timestamp.now()
      });

      // Update invoice status
      await updateDoc(doc(db, 'invoices', invoice.id), {
        status: 'PAID',
        updatedAt: Timestamp.now()
      });

      // Update subscription's nextBillingDate if this is not a manual invoice
      if (invoice.subscriptionId) {
        const subscriptionId = invoice.subscriptionId?.id || invoice.subscriptionId?.path?.split('/').pop() || invoice.subscriptionId;
        if (subscriptionId) {
          try {
            const subscriptionDoc = await getDoc(doc(db, 'subscriptions', subscriptionId));
            if (subscriptionDoc.exists()) {
              const subscription = subscriptionDoc.data();
              const planDoc = await getDoc(subscription.planId);
              if (planDoc.exists()) {
                const plan = planDoc.data();
                const periodEnd = invoice.periodEnd?.toDate() || new Date();
                
                // Calculate next billing date: for weekly, next billing = period end date
                let nextBillingDate = new Date(periodEnd);
                if (plan.billingCycle === 'WEEKLY') {
                  // For weekly subscriptions, the next billing date is simply the period end date
                  // Period end date IS the billing day (due date)
                  // No calculation needed - period end is already the next billing date
                } else if (plan.billingCycle === 'MONTHLY') {
                  const billingDay = parseInt(subscription.billingDay) || 1;
                  const validDay = Math.max(1, Math.min(31, billingDay));
                  nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
                  nextBillingDate.setDate(validDay);
                }
                
                await updateDoc(doc(db, 'subscriptions', subscriptionId), {
                  nextBillingDate: Timestamp.fromDate(nextBillingDate),
                  updatedAt: Timestamp.now()
                });
              }
            }
          } catch (error) {
            console.error('Error updating subscription nextBillingDate:', error);
            // Don't fail the payment if subscription update fails
          }
        }
      }
      
      setPaymentModal({ isOpen: false, invoice: null });
      await showSuccess('Payment recorded successfully!');
      loadDashboardData();
    } catch (error) {
      console.error('Error recording payment:', error);
      showError('Failed to record payment: ' + (error.message || 'Unknown error'));
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  if (loading) {
    return <div className="dashboard-loading">Loading...</div>;
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
      </div>

      <div className="kpi-cards">
        <div className="kpi-card kpi-overdue">
          <div className="kpi-label">Overdue Amount</div>
          <div className="kpi-value">{formatCurrency(kpis.overdueAmount)}</div>
        </div>
        <div className="kpi-card kpi-due">
          <div className="kpi-label">Due Today</div>
          <div className="kpi-value">{formatCurrency(kpis.dueTodayAmount)}</div>
        </div>
        <div className="kpi-card kpi-active">
          <div className="kpi-label">Active Subscriptions</div>
          <div className="kpi-value">{kpis.activeSubscriptions}</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h2>Overdue Invoices</h2>
        <InvoiceTable
          invoices={overdueInvoices}
          customerNames={customerNames}
          customerBanks={customerBanks}
          onRecordPayment={handleRecordPayment}
        />
      </div>

      <div className="dashboard-section">
        <h2>Due Today</h2>
        {dueTodayInvoices.length === 0 ? (
          <p className="empty-state">No invoices due today</p>
        ) : (
          <InvoiceTable
            invoices={dueTodayInvoices}
            customerNames={customerNames}
            customerBanks={customerBanks}
            onRecordPayment={handleRecordPayment}
          />
        )}
      </div>

      <div className="dashboard-section">
        <h2>All Unpaid Invoices</h2>
        {allUnpaidInvoices.length === 0 ? (
          <p className="empty-state">No unpaid invoices</p>
        ) : (
          <InvoiceTable
            invoices={allUnpaidInvoices}
            customerNames={customerNames}
            customerBanks={customerBanks}
            onRecordPayment={handleRecordPayment}
          />
        )}
      </div>

      <div className="dashboard-section">
        <h2>Trials Ending Soon</h2>
        {trialsEnding.length > 0 ? (
          <div className="trials-list">
            {trialsEnding.map(trial => (
              <div key={trial.id} className="trial-item">
                <span>Trial ending: {formatDate(trial.nextBillingDate)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No trials ending soon</p>
        )}
      </div>

      <Modal
        isOpen={paymentModal.isOpen}
        onClose={() => setPaymentModal({ isOpen: false, invoice: null })}
        title="Record Payment"
      >
        <div className="payment-form">
          <div className="form-group">
            <label>Invoice Amount</label>
            <input type="text" value={formatCurrency(paymentModal.invoice?.amount || 0)} disabled />
          </div>
          <div className="form-group">
            <label>Amount Paid *</label>
            <input
              type="number"
              step="0.01"
              value={paymentData.amountPaid}
              onChange={(e) => setPaymentData({ ...paymentData, amountPaid: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Payment Date *</label>
            <input
              type="date"
              value={paymentData.paymentDate}
              onChange={(e) => setPaymentData({ ...paymentData, paymentDate: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={paymentData.notes}
              onChange={(e) => setPaymentData({ ...paymentData, notes: e.target.value })}
              rows="3"
            />
          </div>
          <div className="modal-actions">
            <button onClick={() => setPaymentModal({ isOpen: false, invoice: null })} className="btn-secondary">
              Cancel
            </button>
            <button onClick={submitPayment} className="btn-primary">
              Record Payment
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function InvoiceTable({ invoices, customerNames, customerBanks, onRecordPayment }) {
  const navigate = useNavigate();
  
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PAID': return 'status-paid';
      case 'UNPAID': return 'status-unpaid';
      case 'OVERDUE': return 'status-overdue';
      default: return '';
    }
  };

  const getCustomerName = (invoice) => {
    // Handle both Firestore reference format and direct ID
    const customerId = invoice.customerId?.id || invoice.customerId?.path?.split('/').pop() || invoice.customerId;
    if (!customerId) return 'N/A';
    return customerNames[customerId] || customerId;
  };

  const getCustomerBank = (invoice) => {
    const customerId = invoice.customerId?.id || invoice.customerId?.path?.split('/').pop() || invoice.customerId;
    if (!customerId) return 'N/A';
    const bank = customerBanks[customerId];
    return bank && bank.trim() !== '' ? bank : 'N/A';
  };

  if (invoices.length === 0) {
    return <p className="empty-state">No invoices found</p>;
  }

  return (
    <table className="invoice-table">
      <thead>
        <tr>
          <th>Customer</th>
          <th>Bank</th>
          <th>Amount</th>
          <th>Period</th>
          <th>Due Date</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map(invoice => {
          // Handle both Firestore reference format and direct ID
          const customerId = invoice.customerId?.id || invoice.customerId?.path?.split('/').pop() || invoice.customerId;
          const periodStart = formatDate(invoice.periodStart);
          const periodEnd = formatDate(invoice.periodEnd);
          const periodDisplay = periodStart !== 'N/A' && periodEnd !== 'N/A' 
            ? `${periodStart} - ${periodEnd}` 
            : 'N/A';
          
          return (
            <tr key={invoice.id}>
              <td>
                {customerId ? (
                  <button
                    onClick={() => navigate(`/customers/${customerId}`)}
                    className="customer-link"
                  >
                    {getCustomerName(invoice)}
                  </button>
                ) : (
                  'N/A'
                )}
              </td>
              <td>{getCustomerBank(invoice)}</td>
              <td>{formatCurrency(invoice.amount)}</td>
              <td>{periodDisplay}</td>
              <td>{formatDate(invoice.dueDate)}</td>
              <td>
                <span className={`status-badge ${getStatusColor(invoice.status)}`}>
                  {invoice.status}
                </span>
              </td>
              <td>
                <button
                  onClick={() => onRecordPayment(invoice)}
                  className="btn-action"
                >
                  Record Payment
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

