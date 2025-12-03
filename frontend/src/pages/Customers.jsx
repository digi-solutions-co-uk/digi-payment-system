import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  getDoc,
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
  const [subscriptionPrices, setSubscriptionPrices] = useState({});
  const [nextBillingDates, setNextBillingDates] = useState({});
  const [lastPaymentDates, setLastPaymentDates] = useState({});
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
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const navigate = useNavigate();

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount || 0);
  };

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

      // Load subscription prices, next billing dates, and last payment dates for all customers
      await Promise.all([
        loadSubscriptionPrices(customersList),
        loadNextBillingDates(customersList),
        loadLastPaymentDates(customersList),
      ]);
    } catch (error) {
      console.error("Error loading customers:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadSubscriptionPrices = async (customersList) => {
    try {
      const pricesMap = {};

      // Get all subscriptions
      const subscriptionsSnapshot = await getDocs(
        collection(db, "subscriptions")
      );
      const subscriptions = [];
      const planIds = new Set();

      subscriptionsSnapshot.forEach((doc) => {
        const data = doc.data();
        subscriptions.push({ id: doc.id, ...data });
        if (data.planId?.id) {
          planIds.add(data.planId.id);
        }
      });

      // Load all plan details (in parallel for better performance)
      const plansMap = {};
      await Promise.all(
        Array.from(planIds).map(async (planId) => {
          try {
            const planDoc = await getDoc(doc(db, "plans", planId));
            if (planDoc.exists()) {
              plansMap[planId] = planDoc.data();
            }
          } catch (error) {
            console.error(`Error loading plan ${planId}:`, error);
          }
        })
      );

      // Calculate price for each customer
      for (const customer of customersList) {
        // Find active subscriptions for this customer
        // Handle DocumentReference format (customerId.id or customerId.path)
        const customerSubscriptions = subscriptions.filter((sub) => {
          let subCustomerId = null;
          if (sub.customerId) {
            // Handle DocumentReference
            if (sub.customerId.id) {
              subCustomerId = sub.customerId.id;
            } else if (sub.customerId.path) {
              // Extract ID from path like "customers/abc123"
              const pathParts = sub.customerId.path.split("/");
              subCustomerId = pathParts[pathParts.length - 1];
            }
          }
          return (
            subCustomerId === customer.id &&
            (sub.status === "ACTIVE" || sub.status === "TRIAL")
          );
        });

        if (customerSubscriptions.length === 0) {
          pricesMap[customer.id] = null;
          continue;
        }

        // Calculate total price (sum of all active subscriptions)
        let totalPrice = 0;
        for (const sub of customerSubscriptions) {
          if (sub.customPrice !== null && sub.customPrice !== undefined) {
            totalPrice += sub.customPrice;
          } else if (sub.planId?.id && plansMap[sub.planId.id]) {
            totalPrice += plansMap[sub.planId.id].basePrice || 0;
          }
        }

        pricesMap[customer.id] = totalPrice > 0 ? totalPrice : null;
      }

      setSubscriptionPrices(pricesMap);
    } catch (error) {
      console.error("Error loading subscription prices:", error);
    }
  };

  const loadNextBillingDates = async (customersList) => {
    try {
      const datesMap = {};

      // Get all subscriptions
      const subscriptionsSnapshot = await getDocs(
        collection(db, "subscriptions")
      );
      const subscriptions = [];

      subscriptionsSnapshot.forEach((doc) => {
        const data = doc.data();
        subscriptions.push({ id: doc.id, ...data });
      });

      // Find next billing date for each customer (earliest date from active subscriptions)
      for (const customer of customersList) {
        const customerSubscriptions = subscriptions.filter((sub) => {
          let subCustomerId = null;
          if (sub.customerId) {
            if (sub.customerId.id) {
              subCustomerId = sub.customerId.id;
            } else if (sub.customerId.path) {
              const pathParts = sub.customerId.path.split("/");
              subCustomerId = pathParts[pathParts.length - 1];
            }
          }
          return (
            subCustomerId === customer.id &&
            (sub.status === "ACTIVE" || sub.status === "TRIAL") &&
            sub.nextBillingDate
          );
        });

        if (customerSubscriptions.length === 0) {
          datesMap[customer.id] = null;
          continue;
        }

        // Find the earliest next billing date
        const billingDates = customerSubscriptions
          .map((sub) => sub.nextBillingDate?.toDate())
          .filter((date) => date instanceof Date)
          .sort((a, b) => a - b);

        datesMap[customer.id] =
          billingDates.length > 0 ? billingDates[0] : null;
      }

      setNextBillingDates(datesMap);
    } catch (error) {
      console.error("Error loading next billing dates:", error);
    }
  };

  const loadLastPaymentDates = async (customersList) => {
    try {
      const datesMap = {};

      // Get all invoices
      const invoicesSnapshot = await getDocs(collection(db, "invoices"));
      const invoices = [];
      const customerInvoiceMap = {};

      invoicesSnapshot.forEach((doc) => {
        const data = doc.data();
        invoices.push({ id: doc.id, ...data });

        // Map invoices to customers
        let customerId = null;
        if (data.customerId) {
          if (data.customerId.id) {
            customerId = data.customerId.id;
          } else if (data.customerId.path) {
            const pathParts = data.customerId.path.split("/");
            customerId = pathParts[pathParts.length - 1];
          }
        }

        if (customerId) {
          if (!customerInvoiceMap[customerId]) {
            customerInvoiceMap[customerId] = [];
          }
          customerInvoiceMap[customerId].push(doc.id);
        }
      });

      // Get all payments
      const paymentsSnapshot = await getDocs(collection(db, "payments"));
      const payments = [];
      const invoicePaymentMap = {};

      paymentsSnapshot.forEach((doc) => {
        const data = doc.data();
        payments.push({ id: doc.id, ...data });

        // Map payments to invoices
        let invoiceId = null;
        if (data.invoiceId) {
          if (data.invoiceId.id) {
            invoiceId = data.invoiceId.id;
          } else if (data.invoiceId.path) {
            const pathParts = data.invoiceId.path.split("/");
            invoiceId = pathParts[pathParts.length - 1];
          }
        }

        if (invoiceId) {
          if (!invoicePaymentMap[invoiceId]) {
            invoicePaymentMap[invoiceId] = [];
          }
          invoicePaymentMap[invoiceId].push({
            date: data.paymentDate?.toDate(),
            amount: data.amountPaid,
          });
        }
      });

      // Find last payment date for each customer
      for (const customer of customersList) {
        const customerInvoiceIds = customerInvoiceMap[customer.id] || [];
        const allPaymentDates = [];

        for (const invoiceId of customerInvoiceIds) {
          const invoicePayments = invoicePaymentMap[invoiceId] || [];
          invoicePayments.forEach((payment) => {
            if (payment.date instanceof Date) {
              allPaymentDates.push(payment.date);
            }
          });
        }

        if (allPaymentDates.length === 0) {
          datesMap[customer.id] = null;
          continue;
        }

        // Find the most recent payment date
        const lastPaymentDate = allPaymentDates.sort((a, b) => b - a)[0];
        datesMap[customer.id] = lastPaymentDate;
      }

      setLastPaymentDates(datesMap);
    } catch (error) {
      console.error("Error loading last payment dates:", error);
    }
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    if (!(date instanceof Date)) return "N/A";
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Set new column and default to ascending
      setSortColumn(column);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const sortCustomers = (customersToSort) => {
    if (!sortColumn) return customersToSort;

    return [...customersToSort].sort((a, b) => {
      let aValue, bValue;

      switch (sortColumn) {
        case "name":
          aValue = (a.name || "").toLowerCase();
          bValue = (b.name || "").toLowerCase();
          break;
        case "storeId":
          aValue = (a.storeId || "").toLowerCase();
          bValue = (b.storeId || "").toLowerCase();
          break;
        case "status":
          aValue = (a.status || "ACTIVE").toLowerCase();
          bValue = (b.status || "ACTIVE").toLowerCase();
          break;
        case "subscriptionPrice":
          aValue = subscriptionPrices[a.id] ?? -1;
          bValue = subscriptionPrices[b.id] ?? -1;
          break;
        case "bankName":
          aValue = (a.bankName || "").toLowerCase();
          bValue = (b.bankName || "").toLowerCase();
          break;
        case "nextBillingDate":
          aValue = nextBillingDates[a.id];
          bValue = nextBillingDates[b.id];
          // Handle null dates - put them at the end
          if (!aValue && !bValue) return 0;
          if (!aValue) return 1;
          if (!bValue) return -1;
          aValue = aValue.getTime();
          bValue = bValue.getTime();
          break;
        case "lastPaymentDate":
          aValue = lastPaymentDates[a.id];
          bValue = lastPaymentDates[b.id];
          // Handle null dates - put them at the end
          if (!aValue && !bValue) return 0;
          if (!aValue) return 1;
          if (!bValue) return -1;
          aValue = aValue.getTime();
          bValue = bValue.getTime();
          break;
        default:
          return 0;
      }

      // Handle null/undefined values
      if (aValue === null || aValue === undefined) aValue = "";
      if (bValue === null || bValue === undefined) bValue = "";

      // Compare values
      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  };

  useEffect(() => {
    let filtered = customers;

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (customer) =>
          customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (customer.storeId &&
            customer.storeId
              .toLowerCase()
              .includes(searchTerm.toLowerCase())) ||
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

    // Apply sorting
    const sorted = sortCustomers(filtered);
    setFilteredCustomers(sorted);
    setCurrentPage(1);
  }, [
    searchTerm,
    statusFilter,
    customers,
    sortColumn,
    sortDirection,
    subscriptionPrices,
    nextBillingDates,
    lastPaymentDates,
  ]);

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
      "Subscription Price",
      "Next Billing Date",
      "Last Payment Date",
      "Bank Name",
    ];
    const rows = filteredCustomers.map((customer) => [
      customer.name,
      customer.storeId || "",
      customer.status || "ACTIVE",
      subscriptionPrices[customer.id]
        ? formatCurrency(subscriptionPrices[customer.id])
        : "No subscription",
      nextBillingDates[customer.id]
        ? formatDate(nextBillingDates[customer.id])
        : "N/A",
      lastPaymentDates[customer.id]
        ? formatDate(lastPaymentDates[customer.id])
        : "N/A",
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
                  <th className="sortable" onClick={() => handleSort("name")}>
                    Name
                    {sortColumn === "name" && (
                      <span className="sort-indicator">
                        {sortDirection === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort("storeId")}
                  >
                    Store ID
                    {sortColumn === "storeId" && (
                      <span className="sort-indicator">
                        {sortDirection === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                  <th className="sortable" onClick={() => handleSort("status")}>
                    Status
                    {sortColumn === "status" && (
                      <span className="sort-indicator">
                        {sortDirection === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort("subscriptionPrice")}
                  >
                    Subscription Price
                    {sortColumn === "subscriptionPrice" && (
                      <span className="sort-indicator">
                        {sortDirection === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort("nextBillingDate")}
                  >
                    Next Billing Date
                    {sortColumn === "nextBillingDate" && (
                      <span className="sort-indicator">
                        {sortDirection === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort("lastPaymentDate")}
                  >
                    Last Payment Date
                    {sortColumn === "lastPaymentDate" && (
                      <span className="sort-indicator">
                        {sortDirection === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort("bankName")}
                  >
                    Bank Name
                    {sortColumn === "bankName" && (
                      <span className="sort-indicator">
                        {sortDirection === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedCustomers.map((customer) => {
                  const customerStatus = customer.status || "ACTIVE";
                  const subscriptionPrice = subscriptionPrices[customer.id];
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
                      <td>
                        {subscriptionPrice !== null &&
                        subscriptionPrice !== undefined ? (
                          formatCurrency(subscriptionPrice)
                        ) : (
                          <span style={{ color: "#999" }}>No subscription</span>
                        )}
                      </td>
                      <td>
                        {nextBillingDates[customer.id] ? (
                          formatDate(nextBillingDates[customer.id])
                        ) : (
                          <span style={{ color: "#999" }}>N/A</span>
                        )}
                      </td>
                      <td>
                        {lastPaymentDates[customer.id] ? (
                          formatDate(lastPaymentDates[customer.id])
                        ) : (
                          <span style={{ color: "#999" }}>N/A</span>
                        )}
                      </td>
                      <td>{customer.bankName || "N/A"}</td>
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
