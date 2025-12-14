import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where, getDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { showSuccess, showError } from '../utils/alerts';
import './Analytics.css';

export function Analytics() {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const exportDropdownRef = useRef(null);
  const [analytics, setAnalytics] = useState({
    totalRevenue: 0,
    monthlyRevenue: 0,
    totalCustomers: 0,
    activeSubscriptions: 0,
    paidInvoices: 0,
    unpaidInvoices: 0,
    overdueInvoices: 0
  });
  const [customerStats, setCustomerStats] = useState({
    withStandingOrder: 0,
    withoutStandingOrder: 0,
    pending: 0,
    active: 0,
    left: 0,
    weekly: 0,
    monthly: 0,
    paused: 0,
    trial: 0
  });
  const [weeklyReport, setWeeklyReport] = useState({
    weekNumber: 0,
    totalActiveClients: 0,
    paymentExpected: 0,
    activeClientsPaying: 0,
    paidAmount: 0,
    clientsDidNotPay: 0,
    lostValue: 0,
    clientsInTrial: 0,
    expectedAmountFromTrial: 0,
    standingOrders: 0,
    needChase: 0,
    hardChase: 0,
    restricted: 0,
    missedPayments: []
  });
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [selectedWeekDate, setSelectedWeekDate] = useState(new Date());

  useEffect(() => {
    loadAnalytics();
  }, [dateRange, selectedWeekDate]);

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClickOutside = (event) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target)) {
        const dropdown = document.getElementById('exportDropdown');
        if (dropdown) {
          dropdown.style.display = 'none';
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handlePreviousWeek = () => {
    const newDate = new Date(selectedWeekDate);
    newDate.setDate(newDate.getDate() - 7);
    setSelectedWeekDate(newDate);
  };

  const handleNextWeek = () => {
    const newDate = new Date(selectedWeekDate);
    newDate.setDate(newDate.getDate() + 7);
    setSelectedWeekDate(newDate);
  };

  const handleCurrentWeek = () => {
    setSelectedWeekDate(new Date());
  };

  const getWeekDateRange = (date) => {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    return {
      start: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      end: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };
  };

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

      // Calculate customer statistics
      await calculateCustomerStats(customers, subscriptions);
      
      // Calculate weekly report for selected week
      await calculateWeeklyReport(customers, subscriptions, invoices, payments, selectedWeekDate);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateCustomerStats = async (customers, subscriptions) => {
    try {
      // Load all plans to determine billing cycles
      const plansSnapshot = await getDocs(collection(db, 'plans'));
      const plansMap = {};
      plansSnapshot.forEach(doc => {
        plansMap[doc.id] = doc.data();
      });

      // Initialize stats
      let withStandingOrder = 0;
      let withoutStandingOrder = 0;
      let pending = 0;
      let active = 0;
      let left = 0;
      const weeklyCustomers = new Set();
      const monthlyCustomers = new Set();
      const pausedCustomers = new Set();
      const trialCustomers = new Set();

      // Process customers
      customers.forEach(customer => {
        const status = customer.status || 'ACTIVE';
        
        // Count by status
        if (status === 'PENDING') pending++;
        if (status === 'ACTIVE') active++;
        if (status === 'LEFT') left++;

        // Count by standing order
        if (customer.excludeFromDashboard === true) {
          withoutStandingOrder++;
        } else {
          withStandingOrder++;
        }
      });

      // Process subscriptions to find weekly/monthly/paused/trial customers
      for (const sub of subscriptions) {
        const customerId = sub.customerId?.id || sub.customerId?.path?.split('/').pop() || sub.customerId;
        if (!customerId) continue;

        // Get plan to determine billing cycle
        const planId = sub.planId?.id || sub.planId?.path?.split('/').pop() || sub.planId;
        if (planId && plansMap[planId]) {
          const plan = plansMap[planId];
          if (plan.billingCycle === 'WEEKLY') {
            weeklyCustomers.add(customerId);
          } else if (plan.billingCycle === 'MONTHLY') {
            monthlyCustomers.add(customerId);
          }
        }

        // Count by subscription status
        if (sub.status === 'SUSPENDED') {
          pausedCustomers.add(customerId);
        } else if (sub.status === 'TRIAL') {
          trialCustomers.add(customerId);
        }
      }

      setCustomerStats({
        withStandingOrder,
        withoutStandingOrder,
        pending,
        active,
        left,
        weekly: weeklyCustomers.size,
        monthly: monthlyCustomers.size,
        paused: pausedCustomers.size,
        trial: trialCustomers.size
      });
    } catch (error) {
      console.error('Error calculating customer stats:', error);
    }
  };

  const calculateWeeklyReport = async (customers, subscriptions, invoices, payments, weekDate = new Date()) => {
    try {
      // Get week number for the selected week
      const selectedDate = new Date(weekDate);
      const startOfYear = new Date(selectedDate.getFullYear(), 0, 1);
      const days = Math.floor((selectedDate - startOfYear) / (24 * 60 * 60 * 1000));
      const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);

      // Get selected week start and end
      const currentWeekStart = new Date(selectedDate);
      currentWeekStart.setDate(selectedDate.getDate() - selectedDate.getDay()); // Start of week (Sunday)
      currentWeekStart.setHours(0, 0, 0, 0);
      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
      currentWeekEnd.setHours(23, 59, 59, 999);

      console.log('Weekly Report Date Range:', {
        selectedWeekDate: selectedDate.toISOString(),
        currentWeekStart: currentWeekStart.toISOString(),
        currentWeekEnd: currentWeekEnd.toISOString()
      });

      // Load all plans
      const plansSnapshot = await getDocs(collection(db, 'plans'));
      const plansMap = {};
      plansSnapshot.forEach(doc => {
        plansMap[doc.id] = doc.data();
      });

      // Filter active customers
      const activeCustomers = customers.filter(c => c.status === 'ACTIVE');
      const totalActiveClients = activeCustomers.length;

      // Calculate payment expected (weekly subscriptions + monthly subscriptions / 4)
      let paymentExpected = 0;
      const customerExpectedPayments = {}; // customerId -> expected weekly amount
      const customerWeeklySubscriptions = {}; // customerId -> subscription data
      const customersWithSubscriptions = new Set(); // customers with weekly OR monthly subscriptions

      for (const sub of subscriptions) {
        const customerId = sub.customerId?.id || sub.customerId?.path?.split('/').pop() || sub.customerId;
        if (!customerId) continue;

        const planId = sub.planId?.id || sub.planId?.path?.split('/').pop() || sub.planId;
        if (!planId || !plansMap[planId]) continue;

        const plan = plansMap[planId];
        const customer = activeCustomers.find(c => c.id === customerId);
        if (!customer) continue;

        if (sub.status === 'ACTIVE' || sub.status === 'TRIAL') {
          const amount = sub.customPrice || plan.basePrice || 0;
          
          if (plan.billingCycle === 'WEEKLY') {
            // Weekly subscriptions: full amount
            paymentExpected += amount;
            customerExpectedPayments[customerId] = (customerExpectedPayments[customerId] || 0) + amount;
            customersWithSubscriptions.add(customerId);
            if (!customerWeeklySubscriptions[customerId]) {
              customerWeeklySubscriptions[customerId] = [];
            }
            customerWeeklySubscriptions[customerId].push({ sub, plan, amount });
          } else if (plan.billingCycle === 'MONTHLY') {
            // Monthly subscriptions: amount / 4 (weekly equivalent)
            const weeklyEquivalent = amount / 4;
            paymentExpected += weeklyEquivalent;
            customerExpectedPayments[customerId] = (customerExpectedPayments[customerId] || 0) + weeklyEquivalent;
            customersWithSubscriptions.add(customerId);
          }
        }
      }

      // Get list of customers with weekly or monthly subscriptions
      const totalCustomersWithSubs = customersWithSubscriptions.size;

      // Find active clients who paid this week (for weekly OR monthly subscription invoices)
      const activeClientsPaying = new Set();
      let paidAmount = 0;

      console.log('Total payments to check:', payments.length);
      let paymentsThisWeekCount = 0;

      for (const payment of payments) {
        const paymentDate = payment.paymentDate?.toDate();
        if (!paymentDate) {
          console.log('Payment without date:', payment.id);
          continue;
        }

        // Check if payment is in current week
        if (paymentDate >= currentWeekStart && paymentDate <= currentWeekEnd) {
          paymentsThisWeekCount++;
          console.log('Payment this week:', {
            paymentId: payment.id,
            paymentDate: paymentDate.toISOString(),
            amount: payment.amountPaid
          });
          // Find the invoice for this payment
          const invoiceId = payment.invoiceId?.id || payment.invoiceId?.path?.split('/').pop() || payment.invoiceId;
          if (!invoiceId) continue;

          const invoice = invoices.find(inv => inv.id === invoiceId);
          if (!invoice) continue;

          const invoiceCustomerId = invoice.customerId?.id || invoice.customerId?.path?.split('/').pop() || invoice.customerId;
          if (!invoiceCustomerId) continue;

          const customer = activeCustomers.find(c => c.id === invoiceCustomerId);
          if (!customer) continue;

          // Check if this invoice is from a weekly or monthly subscription
          const subscriptionId = invoice.subscriptionId?.id || invoice.subscriptionId?.path?.split('/').pop() || invoice.subscriptionId;
          if (subscriptionId) {
            const subscription = subscriptions.find(sub => sub.id === subscriptionId);
            if (subscription) {
              const planId = subscription.planId?.id || subscription.planId?.path?.split('/').pop() || subscription.planId;
              if (planId && plansMap[planId]) {
                const plan = plansMap[planId];
                // Count payments for weekly OR monthly subscription invoices
                if ((plan.billingCycle === 'WEEKLY' || plan.billingCycle === 'MONTHLY') && 
                    customersWithSubscriptions.has(invoiceCustomerId)) {
                  activeClientsPaying.add(invoiceCustomerId);
                  paidAmount += payment.amountPaid || 0;
                }
              }
            }
          } else {
            // Manual invoices - also count if customer has subscriptions
            if (customersWithSubscriptions.has(invoiceCustomerId)) {
              activeClientsPaying.add(invoiceCustomerId);
              paidAmount += payment.amountPaid || 0;
            }
          }
        }
      }

      console.log('Weekly Report Payment Stats:', {
        paymentsThisWeek: paymentsThisWeekCount,
        activeClientsPaying: activeClientsPaying.size,
        paidAmount,
        customersWithSubs: totalCustomersWithSubs
      });

      // Calculate clients who didn't pay (only those with weekly or monthly subscriptions)
      const clientsDidNotPay = totalCustomersWithSubs - activeClientsPaying.size;
      const lostValue = paymentExpected - paidAmount;

      // Count trial clients
      const trialCustomers = new Set();
      let expectedAmountFromTrial = 0;
      for (const sub of subscriptions) {
        if (sub.status === 'TRIAL') {
          const customerId = sub.customerId?.id || sub.customerId?.path?.split('/').pop() || sub.customerId;
          if (customerId) {
            const customer = activeCustomers.find(c => c.id === customerId);
            if (customer) {
              trialCustomers.add(customerId);
              const planId = sub.planId?.id || sub.planId?.path?.split('/').pop() || sub.planId;
              if (planId && plansMap[planId]) {
                const plan = plansMap[planId];
                if (plan.billingCycle === 'WEEKLY') {
                  expectedAmountFromTrial += sub.customPrice || plan.basePrice || 0;
                }
              }
            }
          }
        }
      }

      // Count standing orders (customers with excludeFromDashboard = false)
      const standingOrders = activeCustomers.filter(c => !c.excludeFromDashboard || c.excludeFromDashboard === false).length;

      // Count need chase (customers with overdue/unpaid invoices)
      const needChaseCustomers = new Set();
      for (const invoice of invoices) {
        if (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE') {
          const customerId = invoice.customerId?.id || invoice.customerId?.path?.split('/').pop() || invoice.customerId;
          if (customerId) {
            const customer = activeCustomers.find(c => c.id === customerId);
            if (customer) {
              needChaseCustomers.add(customerId);
            }
          }
        }
      }

      // Calculate missed weeks for each customer (for Hard Chase and Restricted)
      const customerMissedWeeksCount = {}; // customerId -> number of missed weeks
      for (const customer of activeCustomers) {
        if (!customersWithSubscriptions.has(customer.id)) continue;

        // Get all unpaid/overdue invoices for this customer that are from weekly or monthly subscriptions
        const customerInvoices = invoices.filter(inv => {
          const invCustomerId = inv.customerId?.id || inv.customerId?.path?.split('/').pop() || inv.customerId;
          if (invCustomerId !== customer.id) return false;
          if (inv.status !== 'UNPAID' && inv.status !== 'OVERDUE') return false;
          
          // Check if invoice is from a weekly or monthly subscription
          const subscriptionId = inv.subscriptionId?.id || inv.subscriptionId?.path?.split('/').pop() || inv.subscriptionId;
          if (!subscriptionId) return false;
          
          const subscription = subscriptions.find(sub => sub.id === subscriptionId);
          if (!subscription) return false;
          
          const planId = subscription.planId?.id || subscription.planId?.path?.split('/').pop() || subscription.planId;
          if (!planId || !plansMap[planId]) return false;
          
          return plansMap[planId].billingCycle === 'WEEKLY' || plansMap[planId].billingCycle === 'MONTHLY';
        });

        customerMissedWeeksCount[customer.id] = customerInvoices.length;
      }

      // Hard Chase: customers with 3+ missed weeks
      const hardChase = Object.values(customerMissedWeeksCount).filter(count => count >= 3).length;

      // Restricted: customers with 4+ missed weeks
      const restricted = Object.values(customerMissedWeeksCount).filter(count => count >= 4).length;

      // Calculate missed payments for each customer (with weekly or monthly subscriptions)
      const missedPayments = [];

      for (const customer of activeCustomers) {
        // Only process customers with weekly or monthly subscriptions
        if (!customersWithSubscriptions.has(customer.id)) continue;

        // Get customer's expected weekly payment amount
        const weeklyAmount = customerExpectedPayments[customer.id] || 0;
        
        // Get all unpaid/overdue invoices for this customer that are from weekly or monthly subscriptions
        const customerUnpaidInvoices = invoices.filter(inv => {
          const invCustomerId = inv.customerId?.id || inv.customerId?.path?.split('/').pop() || inv.customerId;
          if (invCustomerId !== customer.id) return false;
          if (inv.status !== 'UNPAID' && inv.status !== 'OVERDUE') return false;
          
          // Check if invoice is from a weekly or monthly subscription
          const subscriptionId = inv.subscriptionId?.id || inv.subscriptionId?.path?.split('/').pop() || inv.subscriptionId;
          if (!subscriptionId) return false;
          
          const subscription = subscriptions.find(sub => sub.id === subscriptionId);
          if (!subscription) return false;
          
          const planId = subscription.planId?.id || subscription.planId?.path?.split('/').pop() || subscription.planId;
          if (!planId || !plansMap[planId]) return false;
          
          return plansMap[planId].billingCycle === 'WEEKLY' || plansMap[planId].billingCycle === 'MONTHLY';
        });

        // Count missed weeks (number of unpaid invoices)
        const missedWeeks = customerUnpaidInvoices.length;
        
        if (missedWeeks > 0) {
          const totalRequired = weeklyAmount * missedWeeks;
          missedPayments.push({
            customerName: customer.name,
            payment: weeklyAmount,
            missedWeeks: missedWeeks,
            totalRequired: totalRequired
          });
        } else if (weeklyAmount === 0) {
          // Customer has subscription but no expected payment amount (shouldn't happen, but handle it)
          const hasSubscription = subscriptions.some(sub => {
            const subCustomerId = sub.customerId?.id || sub.customerId?.path?.split('/').pop() || sub.customerId;
            return subCustomerId === customer.id && (sub.status === 'ACTIVE' || sub.status === 'TRIAL');
          });

          if (!hasSubscription) {
            // Customer didn't send first payment
            missedPayments.push({
              customerName: customer.name,
              payment: 0,
              missedWeeks: 'Didnt send first payment',
              totalRequired: ''
            });
          }
        }
      }

      // Sort by missed weeks (descending)
      missedPayments.sort((a, b) => {
        if (a.missedWeeks === 'Didnt send first payment') return 1;
        if (b.missedWeeks === 'Didnt send first payment') return -1;
        return b.missedWeeks - a.missedWeeks;
      });

      setWeeklyReport({
        weekNumber,
        totalActiveClients,
        paymentExpected,
        activeClientsPaying: activeClientsPaying.size,
        paidAmount,
        clientsDidNotPay,
        lostValue,
        clientsInTrial: trialCustomers.size,
        expectedAmountFromTrial,
        standingOrders,
        needChase: needChaseCustomers.size,
        hardChase,
        restricted,
        missedPayments
      });
    } catch (error) {
      console.error('Error calculating weekly report:', error);
    }
  };

  const handleNavigateToCustomers = (filterType, filterValue) => {
    const params = new URLSearchParams();
    if (filterType === 'standingOrder') {
      params.set('standingOrder', filterValue);
    } else if (filterType === 'status') {
      params.set('status', filterValue);
    } else if (filterType === 'billingCycle') {
      params.set('billingCycle', filterValue);
    } else if (filterType === 'subscriptionStatus') {
      params.set('subscriptionStatus', filterValue);
    }
    navigate(`/customers?${params.toString()}`);
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

  const closeDropdown = () => {
    const dropdown = document.getElementById('exportDropdown');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
  };

  const exportCSV = (data, filename) => {
    const headers = ['Category', 'Metric', 'Value'];
    const csvRows = [
      headers.join(','),
      ...data.map(row => 
        [
          `"${row.Category || ''}"`,
          `"${row.Metric || ''}"`,
          `"${row.Value || ''}"`
        ].join(',')
      )
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `${filename}_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    closeDropdown();
  };

  const handleExportRevenueReport = () => {
    const reportData = [
      { Category: 'REVENUE', Metric: 'Total Revenue (All Time)', Value: formatCurrency(analytics.totalRevenue) },
      { Category: 'REVENUE', Metric: 'Revenue (Selected Period)', Value: formatCurrency(analytics.monthlyRevenue) },
      { Category: 'REVENUE', Metric: 'Date Range', Value: `${dateRange.start} to ${dateRange.end}` },
    ];
    exportCSV(reportData, 'revenue_report');
    showSuccess('Revenue report exported successfully!');
  };

  const handleExportCustomerOverviewReport = () => {
    const reportData = [
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Total Customers', Value: analytics.totalCustomers },
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Active Customers', Value: customerStats.active },
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Pending Customers', Value: customerStats.pending },
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Left Customers', Value: customerStats.left },
    ];
    exportCSV(reportData, 'customer_overview_report');
    showSuccess('Customer overview report exported successfully!');
  };

  const handleExportStandingOrdersReport = () => {
    const reportData = [
      { Category: 'STANDING ORDERS', Metric: 'With Standing Order', Value: customerStats.withStandingOrder },
      { Category: 'STANDING ORDERS', Metric: 'Without Standing Order', Value: customerStats.withoutStandingOrder },
    ];
    exportCSV(reportData, 'standing_orders_report');
    showSuccess('Standing orders report exported successfully!');
  };

  const handleExportBillingCyclesReport = () => {
    const reportData = [
      { Category: 'BILLING CYCLES', Metric: 'Weekly Payment Customers', Value: customerStats.weekly },
      { Category: 'BILLING CYCLES', Metric: 'Monthly Payment Customers', Value: customerStats.monthly },
    ];
    exportCSV(reportData, 'billing_cycles_report');
    showSuccess('Billing cycles report exported successfully!');
  };

  const handleExportSubscriptionStatusReport = () => {
    const reportData = [
      { Category: 'SUBSCRIPTION STATUS', Metric: 'Active Subscriptions', Value: analytics.activeSubscriptions },
      { Category: 'SUBSCRIPTION STATUS', Metric: 'Paused Customers', Value: customerStats.paused },
      { Category: 'SUBSCRIPTION STATUS', Metric: 'Trial Customers', Value: customerStats.trial },
    ];
    exportCSV(reportData, 'subscription_status_report');
    showSuccess('Subscription status report exported successfully!');
  };

  const handleExportInvoicesReport = () => {
    const reportData = [
      { Category: 'INVOICES', Metric: 'Paid Invoices', Value: analytics.paidInvoices },
      { Category: 'INVOICES', Metric: 'Unpaid Invoices', Value: analytics.unpaidInvoices },
      { Category: 'INVOICES', Metric: 'Overdue Invoices', Value: analytics.overdueInvoices },
    ];
    exportCSV(reportData, 'invoices_report');
    showSuccess('Invoices report exported successfully!');
  };

  const handleExportWeeklyReport = () => {
    // Create summary section
    const summaryData = [
      { Category: 'WEEKLY REPORT', Metric: 'Week Number', Value: weeklyReport.weekNumber },
      { Category: 'WEEKLY REPORT', Metric: 'Total Active Clients', Value: weeklyReport.totalActiveClients },
      { Category: 'WEEKLY REPORT', Metric: 'Payment Expected', Value: formatCurrency(weeklyReport.paymentExpected) },
      { Category: 'WEEKLY REPORT', Metric: '# Active client paying', Value: weeklyReport.activeClientsPaying },
      { Category: 'WEEKLY REPORT', Metric: 'Paid amount (Active client)', Value: formatCurrency(weeklyReport.paidAmount) },
      { Category: 'WEEKLY REPORT', Metric: '# of Client Did Not Pay', Value: weeklyReport.clientsDidNotPay },
      { Category: 'WEEKLY REPORT', Metric: 'Lost Value (Not Paid)', Value: formatCurrency(weeklyReport.lostValue) },
      { Category: 'WEEKLY REPORT', Metric: 'Clients in Trial', Value: weeklyReport.clientsInTrial },
      { Category: 'WEEKLY REPORT', Metric: 'Expected Amount from trial', Value: formatCurrency(weeklyReport.expectedAmountFromTrial) },
      { Category: 'WEEKLY REPORT', Metric: 'Standing orders at the moment', Value: weeklyReport.standingOrders },
      { Category: 'WEEKLY REPORT', Metric: 'Need Chase', Value: weeklyReport.needChase },
      { Category: 'WEEKLY REPORT', Metric: 'Hard Chase', Value: weeklyReport.hardChase },
      { Category: 'WEEKLY REPORT', Metric: 'Restricted', Value: weeklyReport.restricted },
    ];

    // Create missed payments table section
    const missedPaymentsHeaders = [
      { Category: 'MISSED PAYMENTS', Metric: 'Client Name Missed The Payments', Value: 'Payment' },
      { Category: 'MISSED PAYMENTS', Metric: 'Number of missed weeks', Value: 'Total Required' },
    ];

    const missedPaymentsRows = weeklyReport.missedPayments.map(mp => ({
      Category: 'MISSED PAYMENTS',
      Metric: mp.customerName,
      Value: `${mp.payment > 0 ? formatCurrency(mp.payment) : 'N/A'},${typeof mp.missedWeeks === 'string' ? mp.missedWeeks : mp.missedWeeks},${mp.totalRequired ? formatCurrency(mp.totalRequired) : ''}`
    }));

    // Better format: separate CSV for missed payments table
    const csvContent = [
      // Summary section
      'Category,Metric,Value',
      ...summaryData.map(row => `"${row.Category}","${row.Metric}","${row.Value}"`),
      '',
      // Missed payments table
      'Client Name Missed The Payments,Payment,Number of missed weeks,Total Required',
      ...weeklyReport.missedPayments.map(mp => 
        `"${mp.customerName}","${mp.payment > 0 ? formatCurrency(mp.payment) : 'N/A'}","${typeof mp.missedWeeks === 'string' ? mp.missedWeeks : mp.missedWeeks}","${mp.totalRequired ? formatCurrency(mp.totalRequired) : ''}"`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `weekly_payment_report_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    closeDropdown();
    showSuccess('Weekly payment report exported successfully!');
  };

  const handleExportFullReport = () => {
    const reportData = [
      // Revenue Section
      { Category: 'REVENUE', Metric: 'Total Revenue (All Time)', Value: formatCurrency(analytics.totalRevenue) },
      { Category: 'REVENUE', Metric: 'Revenue (Selected Period)', Value: formatCurrency(analytics.monthlyRevenue) },
      { Category: 'REVENUE', Metric: 'Date Range', Value: `${dateRange.start} to ${dateRange.end}` },
      { Category: '', Metric: '', Value: '' },
      
      // Customer Overview
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Total Customers', Value: analytics.totalCustomers },
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Active Customers', Value: customerStats.active },
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Pending Customers', Value: customerStats.pending },
      { Category: 'CUSTOMER OVERVIEW', Metric: 'Left Customers', Value: customerStats.left },
      { Category: '', Metric: '', Value: '' },
      
      // Standing Orders
      { Category: 'STANDING ORDERS', Metric: 'With Standing Order', Value: customerStats.withStandingOrder },
      { Category: 'STANDING ORDERS', Metric: 'Without Standing Order', Value: customerStats.withoutStandingOrder },
      { Category: '', Metric: '', Value: '' },
      
      // Billing Cycles
      { Category: 'BILLING CYCLES', Metric: 'Weekly Payment Customers', Value: customerStats.weekly },
      { Category: 'BILLING CYCLES', Metric: 'Monthly Payment Customers', Value: customerStats.monthly },
      { Category: '', Metric: '', Value: '' },
      
      // Subscription Status
      { Category: 'SUBSCRIPTION STATUS', Metric: 'Active Subscriptions', Value: analytics.activeSubscriptions },
      { Category: 'SUBSCRIPTION STATUS', Metric: 'Paused Customers', Value: customerStats.paused },
      { Category: 'SUBSCRIPTION STATUS', Metric: 'Trial Customers', Value: customerStats.trial },
      { Category: '', Metric: '', Value: '' },
      
      // Invoices
      { Category: 'INVOICES', Metric: 'Paid Invoices', Value: analytics.paidInvoices },
      { Category: 'INVOICES', Metric: 'Unpaid Invoices', Value: analytics.unpaidInvoices },
      { Category: 'INVOICES', Metric: 'Overdue Invoices', Value: analytics.overdueInvoices },
    ];
    exportCSV(reportData, 'full_general_report');
    showSuccess('Full general report exported successfully!');
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
          <div className="export-dropdown" ref={exportDropdownRef}>
            <button 
              className="btn-primary" 
              onClick={(e) => {
                e.stopPropagation();
                const dropdown = document.getElementById('exportDropdown');
                if (dropdown) {
                  dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
                }
              }}
            >
              Export Reports ▼
            </button>
            <div className="export-dropdown-content" id="exportDropdown">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportRevenueReport();
                }} 
                className="export-option"
              >
                Revenue Report
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportCustomerOverviewReport();
                }} 
                className="export-option"
              >
                Customer Overview Report
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportStandingOrdersReport();
                }} 
                className="export-option"
              >
                Standing Orders Report
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportBillingCyclesReport();
                }} 
                className="export-option"
              >
                Billing Cycles Report
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportSubscriptionStatusReport();
                }} 
                className="export-option"
              >
                Subscription Status Report
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportInvoicesReport();
                }} 
                className="export-option"
              >
                Invoices Report
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportWeeklyReport();
                }} 
                className="export-option"
              >
                Weekly Payment Report
              </button>
              <div className="export-divider"></div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportFullReport();
                }} 
                className="export-option export-full"
              >
                Full General Report
          </button>
            </div>
          </div>
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

      <div className="analytics-section">
        <h2 style={{ marginBottom: '24px', fontSize: '24px', fontWeight: '600', color: '#111827' }}>Customer Statistics</h2>
        <div className="analytics-grid">
          <div 
            className="analytics-card customers-card clickable-card"
            onClick={() => handleNavigateToCustomers('standingOrder', 'HAS_STANDING_ORDER')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">With Standing Order</div>
            <div className="analytics-value">{customerStats.withStandingOrder}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card unpaid-card clickable-card"
            onClick={() => handleNavigateToCustomers('standingOrder', 'NO_STANDING_ORDER')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Without Standing Order</div>
            <div className="analytics-value">{customerStats.withoutStandingOrder}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card unpaid-card clickable-card"
            onClick={() => handleNavigateToCustomers('status', 'PENDING')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Pending Customers</div>
            <div className="analytics-value">{customerStats.pending}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card customers-card clickable-card"
            onClick={() => handleNavigateToCustomers('status', 'ACTIVE')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Active Customers</div>
            <div className="analytics-value">{customerStats.active}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card overdue-card clickable-card"
            onClick={() => handleNavigateToCustomers('status', 'LEFT')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Left Customers</div>
            <div className="analytics-value">{customerStats.left}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card subscriptions-card clickable-card"
            onClick={() => handleNavigateToCustomers('billingCycle', 'WEEKLY')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Weekly Payment</div>
            <div className="analytics-value">{customerStats.weekly}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card subscriptions-card clickable-card"
            onClick={() => handleNavigateToCustomers('billingCycle', 'MONTHLY')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Monthly Payment</div>
            <div className="analytics-value">{customerStats.monthly}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card unpaid-card clickable-card"
            onClick={() => handleNavigateToCustomers('subscriptionStatus', 'SUSPENDED')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Paused Customers</div>
            <div className="analytics-value">{customerStats.paused}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>

          <div 
            className="analytics-card subscriptions-card clickable-card"
            onClick={() => handleNavigateToCustomers('subscriptionStatus', 'TRIAL')}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-label">Trial Customers</div>
            <div className="analytics-value">{customerStats.trial}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Click to view</div>
          </div>
        </div>
      </div>

      <div className="analytics-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: '600', color: '#111827', margin: 0 }}>Weekly Payment Report</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="week-selector">
              <button onClick={handlePreviousWeek} className="week-nav-btn">
                ← Previous Week
              </button>
              <span className="week-display">
                Week {weeklyReport.weekNumber}: {getWeekDateRange(selectedWeekDate).start} - {getWeekDateRange(selectedWeekDate).end}
              </span>
              <button onClick={handleNextWeek} className="week-nav-btn">
                Next Week →
              </button>
              <button onClick={handleCurrentWeek} className="week-current-btn">
                Current Week
              </button>
            </div>
          </div>
        </div>
        <div className="weekly-report-container">
          <div className="weekly-report-summary">
            <div className="weekly-report-item">
              <span className="weekly-label">Week Number:</span>
              <span className="weekly-value">{weeklyReport.weekNumber}</span>
            </div>
            <div className="weekly-report-item">
              <span className="weekly-label">Total Active Clients:</span>
              <span className="weekly-value">{weeklyReport.totalActiveClients}</span>
            </div>
            <div className="weekly-report-item">
              <span className="weekly-label">Payment Expected:</span>
              <span className="weekly-value">{formatCurrency(weeklyReport.paymentExpected)}</span>
            </div>
            <div className="weekly-report-item positive">
              <span className="weekly-label"># Active client paying:</span>
              <span className="weekly-value">{weeklyReport.activeClientsPaying}</span>
            </div>
            <div className="weekly-report-item positive">
              <span className="weekly-label">Paid amount (Active client):</span>
              <span className="weekly-value">{formatCurrency(weeklyReport.paidAmount)}</span>
            </div>
            <div className="weekly-report-item negative">
              <span className="weekly-label"># of Client Did Not Pay:</span>
              <span className="weekly-value">{weeklyReport.clientsDidNotPay}</span>
            </div>
            <div className="weekly-report-item negative">
              <span className="weekly-label">Lost Value (Not Paid):</span>
              <span className="weekly-value">{formatCurrency(weeklyReport.lostValue)}</span>
            </div>
            <div className="weekly-report-item">
              <span className="weekly-label">Clients in Trial:</span>
              <span className="weekly-value">{weeklyReport.clientsInTrial}</span>
            </div>
            <div className="weekly-report-item">
              <span className="weekly-label">Expected Amount from trial:</span>
              <span className="weekly-value">{formatCurrency(weeklyReport.expectedAmountFromTrial)}</span>
            </div>
            <div className="weekly-report-item positive">
              <span className="weekly-label">Standing orders at the moment:</span>
              <span className="weekly-value">{weeklyReport.standingOrders}</span>
            </div>
            <div className="weekly-report-item">
              <span className="weekly-label">Need Chase:</span>
              <span className="weekly-value">{weeklyReport.needChase}</span>
            </div>
            <div className="weekly-report-item">
              <span className="weekly-label">Hard Chase:</span>
              <span className="weekly-value">{weeklyReport.hardChase}</span>
            </div>
            <div className="weekly-report-item">
              <span className="weekly-label">Restricted:</span>
              <span className="weekly-value">{weeklyReport.restricted}</span>
            </div>
          </div>

          {weeklyReport.missedPayments.length > 0 && (
            <div className="missed-payments-table-container">
              <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                Client Name Missed The Payments
              </h3>
              <table className="missed-payments-table">
                <thead>
                  <tr>
                    <th>Client Name Missed The Payments</th>
                    <th>Payment</th>
                    <th>Number of missed weeks</th>
                    <th>Total Required</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyReport.missedPayments.map((mp, index) => (
                    <tr key={index} className={typeof mp.missedWeeks === 'string' ? 'no-first-payment' : ''}>
                      <td>{mp.customerName}</td>
                      <td>{mp.payment > 0 ? formatCurrency(mp.payment) : (typeof mp.missedWeeks === 'string' ? 'N/A' : formatCurrency(mp.payment))}</td>
                      <td>{typeof mp.missedWeeks === 'string' ? mp.missedWeeks : mp.missedWeeks}</td>
                      <td>{mp.totalRequired && mp.totalRequired !== '' ? formatCurrency(mp.totalRequired) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

