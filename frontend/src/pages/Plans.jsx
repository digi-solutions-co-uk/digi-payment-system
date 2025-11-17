import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Modal } from '../components/Modal';
import { showSuccess, showError, showConfirm } from '../utils/alerts';
import './Plans.css';

export function Plans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [planData, setPlanData] = useState({
    name: '',
    basePrice: '',
    billingCycle: 'MONTHLY',
    trialDays: ''
  });

  useEffect(() => {
    loadPlans();
  }, []);

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
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (plan) => {
    setEditingPlan(plan);
    setPlanData({
      name: plan.name,
      basePrice: plan.basePrice.toString(),
      billingCycle: plan.billingCycle,
      trialDays: plan.trialDays?.toString() || ''
    });
    setModalOpen(true);
  };

  const handleDelete = async (planId) => {
    const result = await showConfirm('Are you sure you want to delete this plan?');
    if (!result.isConfirmed) return;
    
    try {
      await deleteDoc(doc(db, 'plans', planId));
      await showSuccess('Plan deleted successfully!');
      loadPlans();
    } catch (error) {
      console.error('Error deleting plan:', error);
      showError('Failed to delete plan: ' + (error.message || 'Unknown error'));
    }
  };

  const handleSubmit = async () => {
    try {
      const data = {
        name: planData.name,
        basePrice: parseFloat(planData.basePrice),
        billingCycle: planData.billingCycle,
        trialDays: planData.trialDays ? parseInt(planData.trialDays) : null
      };

      if (editingPlan) {
        await updateDoc(doc(db, 'plans', editingPlan.id), data);
      } else {
        await addDoc(collection(db, 'plans'), data);
      }

      setModalOpen(false);
      setEditingPlan(null);
      setPlanData({ name: '', basePrice: '', billingCycle: 'MONTHLY', trialDays: '' });
      await showSuccess(editingPlan ? 'Plan updated successfully!' : 'Plan created successfully!');
      loadPlans();
    } catch (error) {
      console.error('Error saving plan:', error);
      showError('Failed to save plan: ' + (error.message || 'Unknown error'));
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Plans</h1>
        <button onClick={() => setModalOpen(true)} className="btn-primary">
          + Add New Plan
        </button>
      </div>

      <div className="plans-table-container">
        {plans.length === 0 ? (
          <p className="empty-state">No plans found</p>
        ) : (
          <table className="plans-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Base Price</th>
                <th>Billing Cycle</th>
                <th>Trial Days</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(plan => (
                <tr key={plan.id}>
                  <td>{plan.name}</td>
                  <td>{formatCurrency(plan.basePrice)}</td>
                  <td>{plan.billingCycle}</td>
                  <td>{plan.trialDays || 'N/A'}</td>
                  <td>
                    <button onClick={() => handleEdit(plan)} className="btn-secondary">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(plan.id)} className="btn-danger">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingPlan(null);
          setPlanData({ name: '', basePrice: '', billingCycle: 'MONTHLY', trialDays: '' });
        }}
        title={editingPlan ? 'Edit Plan' : 'Add New Plan'}
      >
        <div className="form-container">
          <div className="form-group">
            <label>Name *</label>
            <input
              type="text"
              value={planData.name}
              onChange={(e) => setPlanData({ ...planData, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Base Price *</label>
            <input
              type="number"
              step="0.01"
              value={planData.basePrice}
              onChange={(e) => setPlanData({ ...planData, basePrice: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Billing Cycle *</label>
            <select
              value={planData.billingCycle}
              onChange={(e) => setPlanData({ ...planData, billingCycle: e.target.value })}
              required
            >
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="TRIAL">Trial</option>
            </select>
          </div>
          <div className="form-group">
            <label>Trial Days</label>
            <input
              type="number"
              value={planData.trialDays}
              onChange={(e) => setPlanData({ ...planData, trialDays: e.target.value })}
            />
          </div>
          <div className="modal-actions">
            <button
              onClick={() => {
                setModalOpen(false);
                setEditingPlan(null);
                setPlanData({ name: '', basePrice: '', billingCycle: 'MONTHLY', trialDays: '' });
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button onClick={handleSubmit} className="btn-primary">
              {editingPlan ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

