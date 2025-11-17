import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { showSuccess, showError, showConfirm } from '../utils/alerts';
import './Staff.css';

export function Staff() {
  const { currentUser } = useAuth();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStaff();
  }, []);

  const loadStaff = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const staffList = [];
      snapshot.forEach(doc => {
        staffList.push({ id: doc.id, ...doc.data() });
      });
      setStaff(staffList);
    } catch (error) {
      console.error('Error loading staff:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      await showSuccess('User role updated successfully!');
      loadStaff();
    } catch (error) {
      console.error('Error updating role:', error);
      showError('Failed to update role: ' + (error.message || 'Unknown error'));
    }
  };

  const handleDeleteStaff = async (userId, userEmail) => {
    // Prevent deleting yourself
    if (userId === currentUser?.uid) {
      showError('You cannot delete your own account');
      return;
    }

    const result = await showConfirm(
      `Are you sure you want to delete "${userEmail}"?`,
      'This action cannot be undone. The user will no longer be able to access the system.'
    );
    if (!result.isConfirmed) return;

    try {
      // Delete user document from Firestore
      await deleteDoc(doc(db, 'users', userId));
      
      // Note: Deleting the Firebase Auth user requires admin privileges
      // This would typically be done via Cloud Functions or Admin SDK
      // For now, we only delete the Firestore document
      
      await showSuccess('Staff member deleted successfully!');
      loadStaff();
    } catch (error) {
      console.error('Error deleting staff:', error);
      showError('Failed to delete staff: ' + (error.message || 'Unknown error'));
    }
  };

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Staff Management</h1>
      </div>

      <div className="staff-table-container">
        {staff.length === 0 ? (
          <p className="empty-state">No staff members found</p>
        ) : (
          <table className="staff-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(member => (
                <tr key={member.id}>
                  <td>{member.name || 'N/A'}</td>
                  <td>{member.email}</td>
                  <td>
                    <span className={`role-badge ${member.role === 'ADMIN' ? 'role-admin' : 'role-staff'}`}>
                      {member.role}
                    </span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        className="role-select"
                      >
                        <option value="STAFF">Staff</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <button
                        onClick={() => handleDeleteStaff(member.id, member.email)}
                        className="btn-danger"
                        disabled={member.id === currentUser?.uid}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

