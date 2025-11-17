import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { Modal } from "../components/Modal";
import {
  showSuccess,
  showError,
  showWarning,
  showConfirm,
} from "../utils/alerts";
import "./Customers.css";

export function Customers() {
  const [customers, setCustomers] = useState([]);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [customerData, setCustomerData] = useState({
    name: "",
    contactPerson: "",
    contactPhone: "",
    storeId: "",
    bankName: "",
    status: "ACTIVE",
  });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const navigate = useNavigate();

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      const snapshot = await getDocs(collection(db, "customers"));
      const customersList = [];
      snapshot.forEach((doc) => {
        customersList.push({ id: doc.id, ...doc.data() });
      });
      setCustomers(customersList);
      setFilteredCustomers(customersList);
    } catch (error) {
      console.error("Error loading customers:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let filtered = customers;

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (customer) =>
          customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (customer.contactPerson &&
            customer.contactPerson
              .toLowerCase()
              .includes(searchTerm.toLowerCase())) ||
          (customer.contactPhone &&
            customer.contactPhone.includes(searchTerm)) ||
          (customer.storeId &&
            customer.storeId.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (customer.bankName &&
            customer.bankName.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Apply status filter
    if (statusFilter !== "ALL") {
      filtered = filtered.filter(
        (customer) => (customer.status || "ACTIVE") === statusFilter
      );
    }

    setFilteredCustomers(filtered);
    setCurrentPage(1);
  }, [searchTerm, statusFilter, customers]);

  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setCustomerData({
      name: customer.name || "",
      contactPerson: customer.contactPerson || "",
      contactPhone: customer.contactPhone || "",
      storeId: customer.storeId || "",
      bankName: customer.bankName || "",
      status: customer.status || "ACTIVE",
    });
    setModalOpen(true);
  };

  const handleUpdateCustomer = async () => {
    if (!customerData.name) {
      showWarning("Customer name is required");
      return;
    }

    try {
      await updateDoc(doc(db, "customers", editingCustomer.id), {
        name: customerData.name,
        contactPerson: customerData.contactPerson || "",
        contactPhone: customerData.contactPhone || "",
        storeId: customerData.storeId || "",
        bankName: customerData.bankName || "",
        status: customerData.status || "ACTIVE",
      });
      setModalOpen(false);
      setEditingCustomer(null);
      setCustomerData({
        name: "",
        contactPerson: "",
        contactPhone: "",
        storeId: "",
        bankName: "",
        status: "ACTIVE",
      });
      await showSuccess("Customer updated successfully!");
      loadCustomers();
    } catch (error) {
      console.error("Error updating customer:", error);
      showError(
        "Failed to update customer: " + (error.message || "Unknown error")
      );
    }
  };

  const handleDeleteCustomer = async (customerId, customerName) => {
    const result = await showConfirm(
      `Are you sure you want to delete "${customerName}"?`,
      "This will also delete all associated subscriptions, invoices, and payments. This action cannot be undone."
    );
    if (!result.isConfirmed) return;

    try {
      const batch = writeBatch(db);
      const customerRef = doc(db, "customers", customerId);

      // Get all associated subscriptions
      const subscriptionsQuery = query(
        collection(db, "subscriptions"),
        where("customerId", "==", customerRef)
      );
      const subscriptionsSnapshot = await getDocs(subscriptionsQuery);

      // Get all associated invoices
      const invoicesQuery = query(
        collection(db, "invoices"),
        where("customerId", "==", customerRef)
      );
      const invoicesSnapshot = await getDocs(invoicesQuery);

      // Get all payments for these invoices
      const paymentsToDelete = [];
      for (const invoiceDoc of invoicesSnapshot.docs) {
        const invoiceId = invoiceDoc.id;
        const paymentsQuery = query(
          collection(db, "payments"),
          where("invoiceId", "==", doc(db, "invoices", invoiceId))
        );
        const paymentsSnapshot = await getDocs(paymentsQuery);
        paymentsSnapshot.docs.forEach((paymentDoc) => {
          paymentsToDelete.push(paymentDoc.ref);
        });
      }

      if (subscriptionsSnapshot.size > 0 || invoicesSnapshot.size > 0) {
        const confirmDelete = await showConfirm(
          `This customer has ${subscriptionsSnapshot.size} subscription(s) and ${invoicesSnapshot.size} invoice(s). Are you sure you want to delete?`,
          "All associated data will be permanently deleted."
        );
        if (!confirmDelete.isConfirmed) return;
      }

      // Delete all payments
      paymentsToDelete.forEach((paymentRef) => {
        batch.delete(paymentRef);
      });

      // Delete all invoices
      invoicesSnapshot.docs.forEach((invoiceDoc) => {
        batch.delete(invoiceDoc.ref);
      });

      // Delete all subscriptions
      subscriptionsSnapshot.docs.forEach((subDoc) => {
        batch.delete(subDoc.ref);
      });

      // Delete customer
      batch.delete(customerRef);

      // Commit all deletions
      await batch.commit();
      await showSuccess(
        "Customer and all associated data deleted successfully!"
      );
      loadCustomers();
    } catch (error) {
      console.error("Error deleting customer:", error);
      showError(
        "Failed to delete customer: " + (error.message || "Unknown error")
      );
    }
  };

  const handleExportCSV = () => {
    const headers = [
      "Name",
      "Store ID",
      "Status",
      "Contact Person",
      "Contact Phone",
      "Bank Name",
    ];
    const rows = filteredCustomers.map((customer) => [
      customer.name,
      customer.storeId || "",
      customer.status || "ACTIVE",
      customer.contactPerson || "",
      customer.contactPhone || "",
      customer.bankName || "",
    ]);

    const csvContent =
      headers.join(",") +
      "\n" +
      rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `customers_${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess("Customers exported to CSV successfully!");
  };

  const handleCreateCustomer = async () => {
    if (!customerData.name) {
      showWarning("Customer name is required");
      return;
    }

    try {
      if (editingCustomer) {
        await handleUpdateCustomer();
        return;
      }

      await addDoc(collection(db, "customers"), {
        name: customerData.name,
        contactPerson: customerData.contactPerson || "",
        contactPhone: customerData.contactPhone || "",
        storeId: customerData.storeId || "",
        bankName: customerData.bankName || "",
        status: customerData.status || "ACTIVE",
      });
      setModalOpen(false);
      setCustomerData({
        name: "",
        contactPerson: "",
        contactPhone: "",
        storeId: "",
        bankName: "",
        status: "ACTIVE",
      });
      await showSuccess("Customer created successfully!");
      loadCustomers();
    } catch (error) {
      console.error("Error creating customer:", error);
      showError(
        "Failed to create customer: " + (error.message || "Unknown error")
      );
    }
  };

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  const totalPages = Math.ceil(filteredCustomers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Customers</h1>
        <div className="header-actions">
          <button onClick={handleExportCSV} className="btn-secondary">
            Export CSV
          </button>
          <button
            onClick={() => {
              setEditingCustomer(null);
              setCustomerData({
                name: "",
                contactPerson: "",
                contactPhone: "",
                storeId: "",
                bankName: "",
                status: "ACTIVE",
              });
              setModalOpen(true);
            }}
            className="btn-primary"
          >
            + Add New Customer
          </button>
        </div>
      </div>

      <div className="search-filter-bar">
        <input
          type="text"
          placeholder="Search customers by name, store ID, bank name, contact person, or phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="status-filter-select"
        >
          <option value="ALL">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING">Pending</option>
          <option value="LEFT">Left</option>
        </select>
        {(searchTerm || statusFilter !== "ALL") && (
          <button
            onClick={() => {
              setSearchTerm("");
              setStatusFilter("ALL");
            }}
            className="clear-search-btn"
          >
            Clear
          </button>
        )}
      </div>

      <div className="customers-table-container">
        {filteredCustomers.length === 0 ? (
          <p className="empty-state">
            {searchTerm
              ? "No customers found matching your search"
              : "No customers found"}
          </p>
        ) : (
          <>
            <table className="customers-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Store ID</th>
                  <th>Status</th>
                  <th>Bank Name</th>
                  <th>Contact Person</th>
                  <th>Contact Phone</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedCustomers.map((customer) => {
                  const customerStatus = customer.status || "ACTIVE";
                  return (
                    <tr key={customer.id}>
                      <td>{customer.name}</td>
                      <td>{customer.storeId || "N/A"}</td>
                      <td>
                        <span
                          className={`status-badge status-${customerStatus.toLowerCase()}`}
                        >
                          {customerStatus}
                        </span>
                      </td>
                      <td>{customer.bankName || "N/A"}</td>
                      <td>{customer.contactPerson || "N/A"}</td>
                      <td>{customer.contactPhone || "N/A"}</td>
                      <td>
                        <div className="action-buttons">
                          <button
                            onClick={() =>
                              navigate(`/customers/${customer.id}`)
                            }
                            className="btn-view"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleEditCustomer(customer)}
                            className="btn-edit"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteCustomer(customer.id, customer.name)
                            }
                            className="btn-danger"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="pagination">
                <button
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={currentPage === 1}
                  className="pagination-btn"
                >
                  Previous
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages} ({filteredCustomers.length}{" "}
                  customers)
                </span>
                <button
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingCustomer(null);
          setCustomerData({
            name: "",
            contactPerson: "",
            contactPhone: "",
            storeId: "",
            bankName: "",
            status: "ACTIVE",
          });
        }}
        title={editingCustomer ? "Edit Customer" : "Add New Customer"}
      >
        <div className="form-container">
          <div className="form-group">
            <label>Name *</label>
            <input
              type="text"
              value={customerData.name}
              onChange={(e) =>
                setCustomerData({ ...customerData, name: e.target.value })
              }
              required
              placeholder="Restaurant Name"
            />
          </div>
          <div className="form-group">
            <label>Store ID</label>
            <input
              type="text"
              value={customerData.storeId}
              onChange={(e) =>
                setCustomerData({
                  ...customerData,
                  storeId: e.target.value,
                })
              }
              placeholder="Store ID or Code"
            />
          </div>
          <div className="form-group">
            <label>Bank Name</label>
            <input
              type="text"
              value={customerData.bankName}
              onChange={(e) =>
                setCustomerData({
                  ...customerData,
                  bankName: e.target.value,
                })
              }
              placeholder="Bank Name"
            />
          </div>
          <div className="form-group">
            <label>Contact Person</label>
            <input
              type="text"
              value={customerData.contactPerson}
              onChange={(e) =>
                setCustomerData({
                  ...customerData,
                  contactPerson: e.target.value,
                })
              }
              placeholder="John Doe"
            />
          </div>
          <div className="form-group">
            <label>Contact Phone</label>
            <input
              type="tel"
              value={customerData.contactPhone}
              onChange={(e) =>
                setCustomerData({
                  ...customerData,
                  contactPhone: e.target.value,
                })
              }
              placeholder="+1234567890"
            />
          </div>
          <div className="form-group">
            <label>Status *</label>
            <select
              value={customerData.status}
              onChange={(e) =>
                setCustomerData({
                  ...customerData,
                  status: e.target.value,
                })
              }
              required
            >
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="LEFT">Left</option>
            </select>
          </div>
          <div className="modal-actions">
            <button
              onClick={() => {
                setModalOpen(false);
                setEditingCustomer(null);
                setCustomerData({
                  name: "",
                  contactPerson: "",
                  contactPhone: "",
                  storeId: "",
                });
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button onClick={handleCreateCustomer} className="btn-primary">
              {editingCustomer ? "Update Customer" : "Create Customer"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
