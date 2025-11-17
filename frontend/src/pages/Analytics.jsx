import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { showSuccess, showError } from '../utils/alerts';
import './Analytics.css';

export function Analytics() {
  const { userRole } = useAuth();
  const [analytics, setAnalytics] = useState({
    totalRevenue: 0,
    monthlyRevenue: 0,
    totalCustomers: 0,
    activeSubscriptions: 0,
    paidInvoices: 0,
    unpaidInvoices: 0,
    overdueInvoices: 0
  });
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    loadAnalytics();
  }, [dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      
      // Load all data
      const [customersSnapshot, subscriptionsSnapshot, invoicesSnapshot, paymentsSnapshot] = await Promise.all([
        getDocs(collection(db, 'customers')),
        getDocs(collection(db, 'subscriptions')),
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'payments'))
      ]);

      const customers = [];
      customersSnapshot.forEach(doc => {
        customers.push({ id: doc.id, ...doc.data() });
      });

      const subscriptions = [];
      subscriptionsSnapshot.forEach(doc => {
        subscriptions.push({ id: doc.id, ...doc.data() });
      });

      const invoices = [];
      invoicesSnapshot.forEach(doc => {
        invoices.push({ id: doc.id, ...doc.data() });
      });

      const payments = [];
      paymentsSnapshot.forEach(doc => {
        payments.push({ id: doc.id, ...doc.data() });
      });

      // Calculate metrics
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);

      // Total revenue (all payments)
      const totalRevenue = payments.reduce((sum, payment) => {
        return sum + (payment.amountPaid || 0);
      }, 0);

      // Monthly revenue (payments in date range)
      const monthlyRevenue = payments.reduce((sum, payment) => {
        const paymentDate = payment.paymentDate?.toDate() || new Date(0);
        if (paymentDate >= startDate && paymentDate <= endDate) {
          return sum + (payment.amountPaid || 0);
        }
        return sum;
      }, 0);

      // Invoice counts
      const paidInvoices = invoices.filter(inv => inv.status === 'PAID').length;
      const unpaidInvoices = invoices.filter(inv => inv.status === 'UNPAID').length;
      const overdueInvoices = invoices.filter(inv => inv.status === 'OVERDUE').length;

      // Active subscriptions
      const activeSubscriptions = subscriptions.filter(sub => sub.status === 'ACTIVE').length;

      setAnalytics({
        totalRevenue,
        monthlyRevenue,
        totalCustomers: customers.length,
        activeSubscriptions,
        paidInvoices,
        unpaidInvoices,
        overdueInvoices
      });
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTestInvoiceGeneration = async () => {
    try {
      const testGenerate = httpsCallable(functions, 'testGenerateInvoices');
      const result = await testGenerate({});
      await showSuccess(`Test completed: ${result.data.message || `Generated ${result.data.count} invoices`}`);
      loadAnalytics();
    } catch (error) {
      console.error('Error testing invoice generation:', error);
      showError('Failed to test invoice generation: ' + (error.message || 'Unknown error'));
    }
  };

  const handleExportReport = () => {
    const reportData = {
      'Total Revenue': formatCurrency(analytics.totalRevenue),
      'Monthly Revenue': formatCurrency(analytics.monthlyRevenue),
      'Total Customers': analytics.totalCustomers,
      'Active Subscriptions': analytics.activeSubscriptions,
      'Paid Invoices': analytics.paidInvoices,
      'Unpaid Invoices': analytics.unpaidInvoices,
      'Overdue Invoices': analytics.overdueInvoices,
      'Date Range': `${dateRange.start} to ${dateRange.end}`
    };

    const csvContent = Object.entries(reportData)
      .map(([key, value]) => `"${key}","${value}"`)
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `analytics_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('Analytics report exported successfully!');
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (loading) {
    return <div className="page-loading">Loading analytics...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Analytics & Reports</h1>
        <div className="header-actions">
          {userRole === 'ADMIN' && (
            <button onClick={handleTestInvoiceGeneration} className="btn-secondary">
              Test Invoice Generation
            </button>
          )}
          <button onClick={handleExportReport} className="btn-primary">
            Export Report
          </button>
        </div>
      </div>

      <div className="date-range-filter">
        <div className="form-group">
          <label>Start Date</label>
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>End Date</label>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
          />
        </div>
      </div>

      <div className="analytics-grid">
        <div className="analytics-card revenue-card">
          <div className="analytics-label">Total Revenue (All Time)</div>
          <div className="analytics-value">{formatCurrency(analytics.totalRevenue)}</div>
        </div>

        <div className="analytics-card revenue-card">
          <div className="analytics-label">Revenue (Selected Period)</div>
          <div className="analytics-value">{formatCurrency(analytics.monthlyRevenue)}</div>
        </div>

        <div className="analytics-card customers-card">
          <div className="analytics-label">Total Customers</div>
          <div className="analytics-value">{analytics.totalCustomers}</div>
        </div>

        <div className="analytics-card subscriptions-card">
          <div className="analytics-label">Active Subscriptions</div>
          <div className="analytics-value">{analytics.activeSubscriptions}</div>
        </div>

        <div className="analytics-card paid-card">
          <div className="analytics-label">Paid Invoices</div>
          <div className="analytics-value">{analytics.paidInvoices}</div>
        </div>

        <div className="analytics-card unpaid-card">
          <div className="analytics-label">Unpaid Invoices</div>
          <div className="analytics-value">{analytics.unpaidInvoices}</div>
        </div>

        <div className="analytics-card overdue-card">
          <div className="analytics-label">Overdue Invoices</div>
          <div className="analytics-value">{analytics.overdueInvoices}</div>
        </div>
      </div>
    </div>
  );
}

