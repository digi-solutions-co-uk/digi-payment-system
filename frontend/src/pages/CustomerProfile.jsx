import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { showSuccess, showError, showWarning, showConfirm } from '../utils/alerts';
import Swal from 'sweetalert2';
import './CustomerProfile.css';

export function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userRole, currentUser } = useAuth();
  const [customer, setCustomer] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [planNames, setPlanNames] = useState({});
  const [activeTab, setActiveTab] = useState('subscriptions');
  const [loading, setLoading] = useState(true);
  const [manualInvoiceModal, setManualInvoiceModal] = useState(false);
  const [editInvoiceModal, setEditInvoiceModal] = useState({ isOpen: false, invoice: null });
  const [newSubscriptionModal, setNewSubscriptionModal] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState(null);
  const [paymentModal, setPaymentModal] = useState({ isOpen: false, invoice: null });
  const [plans, setPlans] = useState([]);
  const [manualInvoiceData, setManualInvoiceData] = useState({
    amount: '',
    periodStart: '',
    periodEnd: '',
    notes: ''
  });
  const [newSubscriptionData, setNewSubscriptionData] = useState({
    planId: '',
    branchId: '',
    customPrice: '',
    billingDay: '',
    status: 'ACTIVE'
  });
  const [paymentData, setPaymentData] = useState({
    amountPaid: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [editInvoiceData, setEditInvoiceData] = useState({
    amount: '',
    dueDate: '',
    status: 'UNPAID'
  });

  useEffect(() => {
    loadCustomerData();
    loadPlans();
  }, [id]);

  const loadCustomerData = async () => {
    try {
      const customerDoc = await getDoc(doc(db, 'customers', id));
      if (!customerDoc.exists()) {
        navigate('/customers');
        return;
      }
      setCustomer({ id: customerDoc.id, ...customerDoc.data() });

      // Load subscriptions
      const subsQuery = query(
        collection(db, 'subscriptions'),
        where('customerId', '==', doc(db, 'customers', id))
      );
      const subsSnapshot = await getDocs(subsQuery);
      const subs = [];
      const planIds = new Set();
      subsSnapshot.forEach(doc => {
        const data = doc.data();
        subs.push({ id: doc.id, ...data });
        if (data.planId?.id) {
          planIds.add(data.planId.id);
        }
      });
      setSubscriptions(subs);

      // Load plan names
      const planNamesMap = {};
      for (const planId of planIds) {
        try {
          const planDoc = await getDoc(doc(db, 'plans', planId));
          if (planDoc.exists()) {
            planNamesMap[planId] = planDoc.data().name;
          }
        } catch (error) {
          console.error(`Error loading plan ${planId}:`, error);
        }
      }
      setPlanNames(planNamesMap);

      // Load invoices
      const invQuery = query(
        collection(db, 'invoices'),
        where('customerId', '==', doc(db, 'customers', id))
      );
      const invSnapshot = await getDocs(invQuery);
      const invoicesList = [];
      invSnapshot.forEach(doc => {
        invoicesList.push({ id: doc.id, ...doc.data() });
      });
      invoicesList.sort((a, b) => {
        const dateA = a.createdAt?.toDate() || new Date(0);
        const dateB = b.createdAt?.toDate() || new Date(0);
        return dateB - dateA;
      });
      setInvoices(invoicesList);

      // Load payments for this customer
      const paymentsQuery = query(collection(db, 'payments'));
      const paymentsSnapshot = await getDocs(paymentsQuery);
      const paymentsList = [];
      paymentsSnapshot.forEach(doc => {
        const payment = doc.data();
        if (payment.invoiceId?.id) {
          // Check if this payment's invoice belongs to this customer
          invoicesList.forEach(inv => {
            if (inv.id === payment.invoiceId.id) {
              paymentsList.push({ id: doc.id, ...payment, invoiceAmount: inv.amount });
            }
          });
        }
      });
      paymentsList.sort((a, b) => {
        const dateA = a.paymentDate?.toDate() || new Date(0);
        const dateB = b.paymentDate?.toDate() || new Date(0);
        return dateB - dateA;
      });
      setPayments(paymentsList);
    } catch (error) {
      console.error('Error loading customer data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPlans = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'plans'));
      const plansList = [];
      snapshot.forEach(doc => {
        plansList.push({ id: doc.id, ...doc.data() });
      });
      setPlans(plansList);
    } catch (error) {
      console.error('Error loading plans:', error);
    }
  };

  const handleSuspendSubscription = async (subscriptionId) => {
    const result = await showConfirm('Are you sure you want to suspend this subscription?');
    if (!result.isConfirmed) return;
    
    try {
      await updateDoc(doc(db, 'subscriptions', subscriptionId), {
        status: 'SUSPENDED',
        updatedAt: Timestamp.now()
      });
      await showSuccess('Subscription suspended successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error suspending subscription:', error);
      showError('Failed to suspend subscription: ' + (error.message || 'Unknown error'));
    }
  };

  const handleResumeSubscription = async (subscriptionId) => {
    const { value: nextBillingDate } = await Swal.fire({
      title: 'Resume Subscription',
      text: 'Enter next billing date',
      input: 'date',
      inputLabel: 'Next Billing Date (YYYY-MM-DD)',
      inputPlaceholder: 'Select date',
      showCancelButton: true,
      confirmButtonColor: '#3b82f6',
      cancelButtonColor: '#6b7280',
      inputValidator: (value) => {
        if (!value) {
          return 'You need to enter a date!';
        }
      }
    });

    if (!nextBillingDate) return;

    try {
      const date = new Date(nextBillingDate);
      await updateDoc(doc(db, 'subscriptions', subscriptionId), {
        status: 'ACTIVE',
        nextBillingDate: Timestamp.fromDate(date),
        updatedAt: Timestamp.now()
      });
      await showSuccess('Subscription resumed successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error resuming subscription:', error);
      showError('Failed to resume subscription: ' + (error.message || 'Unknown error'));
    }
  };

  const submitManualInvoice = async () => {
    if (!manualInvoiceData.amount) {
      showWarning('Please enter an amount');
      return;
    }

    try {
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      const periodStart = manualInvoiceData.periodStart 
        ? new Date(manualInvoiceData.periodStart)
        : null;
      const periodEnd = manualInvoiceData.periodEnd
        ? new Date(manualInvoiceData.periodEnd)
        : null;

      await addDoc(collection(db, 'invoices'), {
        subscriptionId: null,
        customerId: doc(db, 'customers', id),
        amount: parseFloat(manualInvoiceData.amount),
        dueDate: Timestamp.fromDate(today),
        status: 'UNPAID',
        isManual: true,
        periodStart: periodStart ? Timestamp.fromDate(periodStart) : null,
        periodEnd: periodEnd ? Timestamp.fromDate(periodEnd) : null,
        notes: manualInvoiceData.notes || '',
        createdAt: Timestamp.now()
      });

      // If manual invoice has period dates, check if it overlaps with any subscription
      // and update nextBillingDate to skip the covered period
      if (periodStart && periodEnd) {
        try {
          // Get all active subscriptions for this customer
          const subscriptionsQuery = query(
            collection(db, 'subscriptions'),
            where('customerId', '==', doc(db, 'customers', id)),
            where('status', 'in', ['ACTIVE', 'TRIAL'])
          );
          const subscriptionsSnapshot = await getDocs(subscriptionsQuery);

          for (const subDoc of subscriptionsSnapshot.docs) {
            const subscription = subDoc.data();
            const subNextBillingDate = subscription.nextBillingDate?.toDate();
            
            if (!subNextBillingDate) continue;

            // Calculate the subscription's current billing period
            const subPeriodStart = subNextBillingDate;
            const subPeriodEnd = new Date(subPeriodStart);
            
            // Get plan to determine billing cycle
            const planDoc = await getDoc(subscription.planId);
            if (!planDoc.exists()) continue;
            
            const plan = planDoc.data();
            if (plan.billingCycle === 'WEEKLY') {
              subPeriodEnd.setDate(subPeriodEnd.getDate() + 7);
            } else if (plan.billingCycle === 'MONTHLY') {
              subPeriodEnd.setMonth(subPeriodEnd.getMonth() + 1);
            }

            // Check if manual invoice period overlaps with subscription period
            // Overlap: (periodStart <= subPeriodEnd) AND (periodEnd >= subPeriodStart)
            const periodsOverlap = 
              periodStart <= subPeriodEnd && periodEnd >= subPeriodStart;

            if (periodsOverlap) {
              // Manual invoice covers this subscription period, update nextBillingDate
              // For weekly: next billing = period end date
              // For monthly: next billing = next month's billing day
              let newNextBillingDate = new Date(periodEnd);
              
              if (plan.billingCycle === 'WEEKLY') {
                // For weekly, next billing is the period end date
                // No change needed, periodEnd is already the next billing date
              } else if (plan.billingCycle === 'MONTHLY') {
                const billingDay = parseInt(subscription.billingDay) || 1;
                const validDay = Math.max(1, Math.min(31, billingDay));
                newNextBillingDate.setMonth(newNextBillingDate.getMonth() + 1);
                newNextBillingDate.setDate(validDay);
              }

              await updateDoc(doc(db, 'subscriptions', subDoc.id), {
                nextBillingDate: Timestamp.fromDate(newNextBillingDate),
                updatedAt: Timestamp.now()
              });
            }
          }
        } catch (error) {
          console.error('Error updating subscription nextBillingDate:', error);
          // Don't fail the invoice creation if subscription update fails
        }
      }

      setManualInvoiceModal(false);
      setManualInvoiceData({ amount: '', periodStart: '', periodEnd: '', notes: '' });
      await showSuccess('Manual invoice created successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error creating manual invoice:', error);
      showError('Failed to create manual invoice: ' + (error.message || 'Unknown error'));
    }
  };

  const handleEditSubscription = (subscription) => {
    setEditingSubscription(subscription);
    setNewSubscriptionData({
      planId: subscription.planId?.id || subscription.planId || '',
      branchId: subscription.branchId || '',
      customPrice: subscription.customPrice || '',
      billingDay: subscription.billingDay || '',
      status: subscription.status || 'ACTIVE'
    });
    setNewSubscriptionModal(true);
  };

  const handleDeleteSubscription = async (subscriptionId) => {
    const result = await showConfirm(
      'Are you sure you want to delete this subscription?',
      'This will also delete all associated invoices. This action cannot be undone.'
    );
    if (!result.isConfirmed) return;

    try {
      // Check for associated invoices
      const invoicesQuery = query(
        collection(db, 'invoices'),
        where('subscriptionId', '==', doc(db, 'subscriptions', subscriptionId))
      );
      const invoicesSnapshot = await getDocs(invoicesQuery);
      
      if (invoicesSnapshot.size > 0) {
        const confirmDelete = await showConfirm(
          `This subscription has ${invoicesSnapshot.size} invoice(s). Are you sure you want to delete?`,
          'All invoices will be permanently deleted.'
        );
        if (!confirmDelete.isConfirmed) return;
      }

      await deleteDoc(doc(db, 'subscriptions', subscriptionId));
      await showSuccess('Subscription deleted successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error deleting subscription:', error);
      showError('Failed to delete subscription: ' + (error.message || 'Unknown error'));
    }
  };

  const handleUpdateSubscription = async () => {
    if (!newSubscriptionData.planId) {
      showWarning('Please select a plan');
      return;
    }

    try {
      // Normalize billingDay before saving
      let normalizedBillingDay = newSubscriptionData.billingDay || '';
      const planDoc = await getDoc(doc(db, 'plans', newSubscriptionData.planId));
      if (planDoc.exists()) {
        const plan = planDoc.data();
        if (plan.billingCycle === 'WEEKLY') {
          normalizedBillingDay = normalizedBillingDay.toUpperCase().trim() || 'MONDAY';
        } else if (plan.billingCycle === 'MONTHLY') {
          normalizedBillingDay = normalizedBillingDay.trim() || '1';
        }
      }

      const updateData = {
        planId: doc(db, 'plans', newSubscriptionData.planId),
        customPrice: newSubscriptionData.customPrice ? parseFloat(newSubscriptionData.customPrice) : null,
        billingDay: normalizedBillingDay,
        status: newSubscriptionData.status,
        updatedAt: Timestamp.now()
      };

      // Only update nextBillingDate if plan changed
      if (editingSubscription.planId?.id !== newSubscriptionData.planId) {
        const planDoc = await getDoc(doc(db, 'plans', newSubscriptionData.planId));
        if (planDoc.exists()) {
          const plan = planDoc.data();
          const today = new Date();
          let nextBillingDate = new Date(today);

          // Normalize billingDay
          let normalizedBillingDay = newSubscriptionData.billingDay || '';
          if (plan.billingCycle === 'WEEKLY') {
            normalizedBillingDay = normalizedBillingDay.toUpperCase().trim() || 'MONDAY';
          } else if (plan.billingCycle === 'MONTHLY') {
            normalizedBillingDay = normalizedBillingDay.trim() || '1';
          }

          if (plan.billingCycle === 'WEEKLY') {
            const daysOfWeek = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
            const targetDay = daysOfWeek.indexOf(normalizedBillingDay);
            if (targetDay === -1) {
              normalizedBillingDay = 'MONDAY';
            }
            const finalTargetDay = daysOfWeek.indexOf(normalizedBillingDay);
            const currentDay = today.getDay();
            let daysToAdd = finalTargetDay - currentDay;
            if (daysToAdd <= 0) daysToAdd += 7;
            nextBillingDate.setDate(today.getDate() + daysToAdd);
          } else if (plan.billingCycle === 'MONTHLY') {
            const day = parseInt(normalizedBillingDay) || 1;
            const validDay = Math.max(1, Math.min(31, day));
            nextBillingDate.setMonth(today.getMonth() + 1);
            nextBillingDate.setDate(validDay);
          }
          updateData.nextBillingDate = Timestamp.fromDate(nextBillingDate);
        }
      }

      await updateDoc(doc(db, 'subscriptions', editingSubscription.id), updateData);

      setNewSubscriptionModal(false);
      setEditingSubscription(null);
      setNewSubscriptionData({ planId: '', branchId: '', customPrice: '', billingDay: '', status: 'ACTIVE' });
      await showSuccess('Subscription updated successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error updating subscription:', error);
      showError('Failed to update subscription: ' + (error.message || 'Unknown error'));
    }
  };

  const submitNewSubscription = async () => {
    if (editingSubscription) {
      await handleUpdateSubscription();
      return;
    }

    if (!newSubscriptionData.planId) {
      showWarning('Please select a plan');
      return;
    }

    try {
      // Get plan to calculate next billing date
      const planDoc = await getDoc(doc(db, 'plans', newSubscriptionData.planId));
      if (!planDoc.exists()) {
        showError('Plan not found');
        return;
      }

      const plan = planDoc.data();
      const today = new Date();
      let nextBillingDate = new Date(today);

      // Normalize billingDay - uppercase for weekly, keep as is for monthly
      let normalizedBillingDay = newSubscriptionData.billingDay || '';
      if (plan.billingCycle === 'WEEKLY') {
        normalizedBillingDay = normalizedBillingDay.toUpperCase().trim() || 'MONDAY';
      } else if (plan.billingCycle === 'MONTHLY') {
        normalizedBillingDay = normalizedBillingDay.trim() || '1';
      }

      // Calculate next billing date based on billing cycle
      if (plan.billingCycle === 'WEEKLY') {
        const daysOfWeek = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        const targetDay = daysOfWeek.indexOf(normalizedBillingDay);
        if (targetDay === -1) {
          showWarning('Invalid billing day, using MONDAY as default');
          normalizedBillingDay = 'MONDAY';
        }
        const finalTargetDay = daysOfWeek.indexOf(normalizedBillingDay);
        const currentDay = today.getDay();
        let daysToAdd = finalTargetDay - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;
        nextBillingDate.setDate(today.getDate() + daysToAdd);
      } else if (plan.billingCycle === 'MONTHLY') {
        const day = parseInt(normalizedBillingDay) || 1;
        const validDay = Math.max(1, Math.min(31, day));
        nextBillingDate.setMonth(today.getMonth() + 1);
        nextBillingDate.setDate(validDay);
      } else if (plan.billingCycle === 'TRIAL') {
        const trialDays = plan.trialDays || 7;
        nextBillingDate.setDate(today.getDate() + trialDays);
      }

      await addDoc(collection(db, 'subscriptions'), {
        customerId: doc(db, 'customers', id),
        planId: doc(db, 'plans', newSubscriptionData.planId),
        customPrice: newSubscriptionData.customPrice ? parseFloat(newSubscriptionData.customPrice) : null,
        billingDay: normalizedBillingDay,
        status: plan.billingCycle === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
        nextBillingDate: Timestamp.fromDate(nextBillingDate),
        createdAt: Timestamp.now()
      });

      setNewSubscriptionModal(false);
      setNewSubscriptionData({ planId: '', branchId: '', customPrice: '', billingDay: '', status: 'ACTIVE' });
      await showSuccess('Subscription created successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error creating subscription:', error);
      showError('Failed to create subscription: ' + (error.message || 'Unknown error'));
    }
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
      loadCustomerData();
    } catch (error) {
      console.error('Error recording payment:', error);
      showError('Failed to record payment: ' + (error.message || 'Unknown error'));
    }
  };

  const exportToCSV = (data, filename) => {
    if (data.length === 0) {
      showWarning('No data to export');
      return;
    }

    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(header => row[header] || ''));

    const csvContent =
      headers.join(',') +
      '\n' +
      rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('Data exported to CSV successfully!');
  };

  const handleDeleteInvoice = async (invoiceId) => {
    const result = await showConfirm(
      'Are you sure you want to delete this invoice?',
      'This will also delete all associated payments. This action cannot be undone.'
    );
    if (!result.isConfirmed) return;

    try {
      // Check for associated payments
      const paymentsQuery = query(
        collection(db, 'payments'),
        where('invoiceId', '==', doc(db, 'invoices', invoiceId))
      );
      const paymentsSnapshot = await getDocs(paymentsQuery);
      
      if (paymentsSnapshot.size > 0) {
        const confirmDelete = await showConfirm(
          `This invoice has ${paymentsSnapshot.size} payment(s). Are you sure you want to delete?`,
          'All payments will be permanently deleted.'
        );
        if (!confirmDelete.isConfirmed) return;
      }

      await deleteDoc(doc(db, 'invoices', invoiceId));
      await showSuccess('Invoice deleted successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error deleting invoice:', error);
      showError('Failed to delete invoice: ' + (error.message || 'Unknown error'));
    }
  };

  const handleEditInvoice = async () => {
    if (!editInvoiceData.amount || !editInvoiceData.dueDate) {
      showWarning('Please fill in all required fields');
      return;
    }

    try {
      await updateDoc(doc(db, 'invoices', editInvoiceModal.invoice.id), {
        amount: parseFloat(editInvoiceData.amount),
        dueDate: Timestamp.fromDate(new Date(editInvoiceData.dueDate)),
        status: editInvoiceData.status,
        updatedAt: Timestamp.now()
      });

      setEditInvoiceModal({ isOpen: false, invoice: null });
      await showSuccess('Invoice updated successfully!');
      loadCustomerData();
    } catch (error) {
      console.error('Error updating invoice:', error);
      showError('Failed to update invoice: ' + (error.message || 'Unknown error'));
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

  const getStatusColor = (status) => {
    switch (status) {
      case 'PAID': return 'status-paid';
      case 'UNPAID': return 'status-unpaid';
      case 'OVERDUE': return 'status-overdue';
      case 'ACTIVE': return 'status-active';
      case 'SUSPENDED': return 'status-suspended';
      case 'TRIAL': return 'status-trial';
      default: return '';
    }
  };

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (!customer) {
    return null;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <button onClick={() => navigate('/customers')} className="btn-back">
          ← Back to Customers
        </button>
        <h1>{customer.name}</h1>
          <div className="customer-info">
            <p><strong>Store ID:</strong> {customer.storeId || 'N/A'}</p>
            <p><strong>Bank Name:</strong> {customer.bankName || 'N/A'}</p>
            <p><strong>Status:</strong> 
              <span className={`status-badge status-${(customer.status || 'ACTIVE').toLowerCase()}`} style={{ marginLeft: '8px' }}>
                {customer.status || 'ACTIVE'}
              </span>
            </p>
            <p><strong>Contact Person:</strong> {customer.contactPerson || 'N/A'}</p>
            <p><strong>Contact Phone:</strong> {customer.contactPhone || 'N/A'}</p>
          </div>
      </div>

      <div className="action-buttons">
        <button onClick={() => setManualInvoiceModal(true)} className="btn-primary">
          + Add Manual Invoice
        </button>
        {userRole === 'ADMIN' && (
          <button 
            onClick={() => {
              setEditingSubscription(null);
              setNewSubscriptionData({ planId: '', branchId: '', customPrice: '', billingDay: '', status: 'ACTIVE' });
              setNewSubscriptionModal(true);
            }} 
            className="btn-primary"
          >
            + Add New Subscription
          </button>
        )}
      </div>

      <div className="tabs">
        <button
          className={activeTab === 'subscriptions' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('subscriptions')}
        >
          Subscriptions
        </button>
        <button
          className={activeTab === 'invoices' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('invoices')}
        >
          Invoice History
        </button>
        <button
          className={activeTab === 'payments' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('payments')}
        >
          Payment History
        </button>
      </div>

      {activeTab === 'subscriptions' && (
        <div className="tab-content">
          {subscriptions.length === 0 ? (
            <p className="empty-state">No subscriptions found</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Next Billing</th>
                  <th>Amount</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map(sub => (
                  <tr key={sub.id}>
                    <td>{planNames[sub.planId?.id] || sub.planId?.id || 'N/A'}</td>
                    <td>
                      <span className={`status-badge ${getStatusColor(sub.status)}`}>
                        {sub.status}
                      </span>
                    </td>
                    <td>{formatDate(sub.nextBillingDate)}</td>
                    <td>{formatCurrency(sub.customPrice || 0)}</td>
                    <td>
                      <div className="action-buttons">
                        {userRole === 'ADMIN' && (
                          <>
                            <button
                              onClick={() => handleEditSubscription(sub)}
                              className="btn-edit"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteSubscription(sub.id)}
                              className="btn-danger"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {sub.status === 'ACTIVE' && (
                          <button
                            onClick={() => handleSuspendSubscription(sub.id)}
                            className="btn-secondary"
                          >
                            Pause
                          </button>
                        )}
                        {sub.status === 'SUSPENDED' && (
                          <button
                            onClick={() => handleResumeSubscription(sub.id)}
                            className="btn-primary"
                          >
                            Resume
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'invoices' && (
        <div className="tab-content">
          <div className="tab-header-actions">
            <button
              onClick={() => {
                const csvData = invoices.map(inv => ({
                  Amount: inv.amount,
                  'Due Date': formatDate(inv.dueDate),
                  Status: inv.status,
                  Type: inv.isManual ? 'Manual' : 'Automatic',
                  'Period Start': formatDate(inv.periodStart),
                  'Period End': formatDate(inv.periodEnd)
                }));
                exportToCSV(csvData, `invoices_${customer.name}_${new Date().toISOString().split('T')[0]}.csv`);
              }}
              className="btn-secondary"
            >
              Export Invoices CSV
            </button>
          </div>
          {invoices.length === 0 ? (
            <p className="empty-state">No invoices found</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Period</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const periodStart = formatDate(inv.periodStart);
                  const periodEnd = formatDate(inv.periodEnd);
                  const periodDisplay = periodStart !== 'N/A' && periodEnd !== 'N/A' 
                    ? `${periodStart} - ${periodEnd}` 
                    : 'N/A';
                  
                  return (
                  <tr key={inv.id}>
                    <td>{formatCurrency(inv.amount)}</td>
                    <td>{periodDisplay}</td>
                    <td>{formatDate(inv.dueDate)}</td>
                    <td>
                      <span className={`status-badge ${getStatusColor(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td>{inv.isManual ? 'Manual' : 'Automatic'}</td>
                    <td>
                      <div className="action-buttons">
                        {userRole === 'ADMIN' && (
                          <>
                            <button
                              onClick={() => {
                                setEditInvoiceModal({ isOpen: true, invoice: inv });
                                setEditInvoiceData({
                                  amount: inv.amount || '',
                                  dueDate: inv.dueDate?.toDate()?.toISOString().split('T')[0] || '',
                                  status: inv.status || 'UNPAID'
                                });
                              }}
                              className="btn-edit"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteInvoice(inv.id)}
                              className="btn-danger"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {inv.status !== 'PAID' && (
                          <button
                            onClick={() => {
                              setPaymentModal({ isOpen: true, invoice: inv });
                              setPaymentData({
                                amountPaid: inv.amount || '',
                                paymentDate: new Date().toISOString().split('T')[0],
                                notes: ''
                              });
                            }}
                            className="btn-action"
                          >
                            Record Payment
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="tab-content">
          <div className="tab-header-actions">
            <button
              onClick={() => {
                const csvData = payments.map(payment => ({
                  'Payment Date': formatDate(payment.paymentDate),
                  'Amount Paid': payment.amountPaid,
                  'Invoice Amount': payment.invoiceAmount,
                  Notes: payment.notes || ''
                }));
                exportToCSV(csvData, `payments_${customer.name}_${new Date().toISOString().split('T')[0]}.csv`);
              }}
              className="btn-secondary"
            >
              Export Payments CSV
            </button>
          </div>
          {payments.length === 0 ? (
            <p className="empty-state">No payments found</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Payment Date</th>
                  <th>Amount Paid</th>
                  <th>Invoice Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(payment => (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.paymentDate)}</td>
                    <td>{formatCurrency(payment.amountPaid)}</td>
                    <td>{formatCurrency(payment.invoiceAmount)}</td>
                    <td>{payment.notes || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal
        isOpen={manualInvoiceModal}
        onClose={() => setManualInvoiceModal(false)}
        title="Add Manual Invoice"
      >
        <div className="form-container">
          <div className="form-group">
            <label>Amount *</label>
            <input
              type="number"
              step="0.01"
              value={manualInvoiceData.amount}
              onChange={(e) => setManualInvoiceData({ ...manualInvoiceData, amount: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Period Start</label>
            <input
              type="date"
              value={manualInvoiceData.periodStart}
              onChange={(e) => setManualInvoiceData({ ...manualInvoiceData, periodStart: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Period End</label>
            <input
              type="date"
              value={manualInvoiceData.periodEnd}
              onChange={(e) => setManualInvoiceData({ ...manualInvoiceData, periodEnd: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={manualInvoiceData.notes}
              onChange={(e) => setManualInvoiceData({ ...manualInvoiceData, notes: e.target.value })}
              rows="3"
            />
          </div>
          <div className="modal-actions">
            <button onClick={() => setManualInvoiceModal(false)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={submitManualInvoice} className="btn-primary">
              Create Invoice
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={newSubscriptionModal}
        onClose={() => {
          setNewSubscriptionModal(false);
          setEditingSubscription(null);
          setNewSubscriptionData({ planId: '', branchId: '', customPrice: '', billingDay: '', status: 'ACTIVE' });
        }}
        title={editingSubscription ? "Edit Subscription" : "Add New Subscription"}
      >
        <div className="form-container">
          <div className="form-group">
            <label>Plan *</label>
            <select
              value={newSubscriptionData.planId}
              onChange={(e) => setNewSubscriptionData({ ...newSubscriptionData, planId: e.target.value })}
              required
            >
              <option value="">Select a plan</option>
              {plans.map(plan => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} - {formatCurrency(plan.basePrice)} ({plan.billingCycle})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Custom Price (optional)</label>
            <input
              type="number"
              step="0.01"
              value={newSubscriptionData.customPrice}
              onChange={(e) => setNewSubscriptionData({ ...newSubscriptionData, customPrice: e.target.value })}
              placeholder="Leave empty to use plan price"
            />
          </div>
          <div className="form-group">
            <label>Billing Day</label>
            {(() => {
              // Get selected plan to determine input type
              const selectedPlan = plans.find(p => p.id === newSubscriptionData.planId);
              if (selectedPlan?.billingCycle === 'WEEKLY') {
                return (
                  <select
                    value={newSubscriptionData.billingDay || 'MONDAY'}
                    onChange={(e) => setNewSubscriptionData({ ...newSubscriptionData, billingDay: e.target.value })}
                  >
                    <option value="MONDAY">Monday</option>
                    <option value="TUESDAY">Tuesday</option>
                    <option value="WEDNESDAY">Wednesday</option>
                    <option value="THURSDAY">Thursday</option>
                    <option value="FRIDAY">Friday</option>
                    <option value="SATURDAY">Saturday</option>
                    <option value="SUNDAY">Sunday</option>
                  </select>
                );
              } else if (selectedPlan?.billingCycle === 'MONTHLY') {
                return (
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={newSubscriptionData.billingDay || '1'}
                    onChange={(e) => setNewSubscriptionData({ ...newSubscriptionData, billingDay: e.target.value })}
                    placeholder="Day of month (1-31)"
                  />
                );
              } else {
                return (
                  <input
                    type="text"
                    value={newSubscriptionData.billingDay}
                    onChange={(e) => setNewSubscriptionData({ ...newSubscriptionData, billingDay: e.target.value })}
                    placeholder="MONDAY (for weekly) or 1-31 (for monthly)"
                  />
                );
              }
            })()}
          </div>
          {editingSubscription && (
            <div className="form-group">
              <label>Status *</label>
              <select
                value={newSubscriptionData.status}
                onChange={(e) => setNewSubscriptionData({ ...newSubscriptionData, status: e.target.value })}
                required
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="TRIAL">TRIAL</option>
              </select>
            </div>
          )}
          <div className="modal-actions">
            <button
              onClick={() => {
                setNewSubscriptionModal(false);
                setEditingSubscription(null);
                setNewSubscriptionData({ planId: '', branchId: '', customPrice: '', billingDay: '', status: 'ACTIVE' });
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button onClick={submitNewSubscription} className="btn-primary">
              {editingSubscription ? "Update Subscription" : "Create Subscription"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={paymentModal.isOpen}
        onClose={() => setPaymentModal({ isOpen: false, invoice: null })}
        title="Record Payment"
      >
        <div className="form-container">
          <div className="form-group">
            <label>Invoice Amount</label>
            <input
              type="text"
              value={formatCurrency(paymentModal.invoice?.amount || 0)}
              disabled
            />
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

      <Modal
        isOpen={editInvoiceModal.isOpen}
        onClose={() => {
          setEditInvoiceModal({ isOpen: false, invoice: null });
          setEditInvoiceData({ amount: '', dueDate: '', status: 'UNPAID' });
        }}
        title="Edit Invoice"
      >
        <div className="form-container">
          <div className="form-group">
            <label>Amount *</label>
            <input
              type="number"
              step="0.01"
              value={editInvoiceData.amount}
              onChange={(e) => setEditInvoiceData({ ...editInvoiceData, amount: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Due Date *</label>
            <input
              type="date"
              value={editInvoiceData.dueDate}
              onChange={(e) => setEditInvoiceData({ ...editInvoiceData, dueDate: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Status *</label>
            <select
              value={editInvoiceData.status}
              onChange={(e) => setEditInvoiceData({ ...editInvoiceData, status: e.target.value })}
              required
            >
              <option value="UNPAID">UNPAID</option>
              <option value="PAID">PAID</option>
              <option value="OVERDUE">OVERDUE</option>
            </select>
          </div>
          <div className="modal-actions">
            <button
              onClick={() => {
                setEditInvoiceModal({ isOpen: false, invoice: null });
                setEditInvoiceData({ amount: '', dueDate: '', status: 'UNPAID' });
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button onClick={handleEditInvoice} className="btn-primary">
              Update Invoice
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

