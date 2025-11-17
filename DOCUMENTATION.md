# Digi Payment System - Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Features](#features)
4. [Database Structure](#database-structure)
5. [Cloud Functions](#cloud-functions)
6. [User Roles & Permissions](#user-roles--permissions)
7. [Testing Guide](#testing-guide)
8. [Known Issues & Improvements](#known-issues--improvements)
9. [Deployment](#deployment)
10. [API Reference](#api-reference)

---

## Overview

**Digi Payment System** is a full-stack subscription and invoice management system designed for companies providing digital menu services to restaurants. The system automates invoice generation, tracks payments, manages customer subscriptions, and provides comprehensive analytics.

### Technology Stack

- **Frontend**: React (Vite), JavaScript, CSS
- **Backend**: Firebase Cloud Functions (Node.js)
- **Database**: Cloud Firestore (NoSQL)
- **Authentication**: Firebase Authentication
- **Scheduling**: Cloud Scheduler
- **Notifications**: SweetAlert2

---

## System Architecture

```
┌─────────────────┐
│   React App     │
│   (Frontend)    │
└────────┬────────┘
         │
         ├──► Firebase Auth (Email/Password)
         ├──► Firestore (Database)
         └──► Cloud Functions (Backend Logic)
                  │
                  └──► Cloud Scheduler (Daily Jobs)
```

### Key Components

1. **Frontend Pages**:

   - Dashboard
   - Customers Management
   - Customer Profile
   - Plans Management (Admin only)
   - Staff Management (Admin only)
   - Analytics & Reports

2. **Backend Services**:
   - Scheduled Invoice Generation
   - Overdue Invoice Updates
   - Manual Invoice Creation
   - Payment Recording
   - Subscription Management

---

## Features

### 1. Customer Management

- ✅ Create, Read, Update customers
- ✅ Search and filter customers
- ✅ Pagination (10 per page)
- ✅ Export to CSV
- ✅ View customer profiles with subscriptions, invoices, and payment history

### 2. Subscription Management

- ✅ Create subscriptions (Weekly/Monthly)
- ✅ Track subscription status (ACTIVE, SUSPENDED, TRIAL)
- ✅ Suspend/Resume subscriptions
- ✅ Custom pricing per subscription
- ✅ Automatic invoice generation based on billing cycle

### 3. Invoice Management

- ✅ Automatic invoice generation (daily at 2 AM UTC)
- ✅ Manual invoice creation
- ✅ Invoice editing (Admin only)
- ✅ Invoice status tracking (UNPAID, PAID, OVERDUE)
- ✅ Export invoices to CSV

### 4. Payment Management

- ✅ Record payments manually
- ✅ Link payments to invoices
- ✅ Payment history per customer
- ✅ Export payment history to CSV
- ✅ Automatic invoice status update on payment

### 5. Dashboard

- ✅ KPI Cards (Overdue Amount, Due Today, Active Subscriptions)
- ✅ Overdue Invoices list
- ✅ Due Today Invoices list
- ✅ All Unpaid Invoices list
- ✅ Trials Ending Soon
- ✅ Quick payment recording

### 6. Analytics & Reports

- ✅ Total Revenue (all time)
- ✅ Revenue by date range
- ✅ Customer count
- ✅ Active subscriptions count
- ✅ Invoice status breakdown
- ✅ Export reports to CSV
- ✅ Test invoice generation (Admin only)

### 7. Plans Management (Admin Only)

- ✅ Create, Read, Update, Delete plans
- ✅ Set base price and billing cycle (WEEKLY/MONTHLY)

### 8. Staff Management (Admin Only)

- ✅ Create staff accounts
- ✅ Assign roles (ADMIN/STAFF)
- ✅ Manage staff permissions

---

## Database Structure

### Collections

#### 1. `users`

```javascript
{
  uid: string,              // Firebase Auth UID
  email: string,
  role: "ADMIN" | "STAFF",  // User role
  createdAt: Timestamp
}
```

#### 2. `customers`

```javascript
{
  name: string,             // Restaurant name
  contactPerson: string,
  contactPhone: string,
  createdAt: Timestamp
}
```

#### 3. `plans`

```javascript
{
  name: string,             // Plan name
  basePrice: number,        // Base price in USD
  billingCycle: "WEEKLY" | "MONTHLY",
  createdAt: Timestamp
}
```

#### 4. `subscriptions`

```javascript
{
  customerId: DocumentReference,  // Reference to customers collection
  planId: DocumentReference,       // Reference to plans collection
  branchId: string,                 // Optional branch identifier
  customPrice: number,              // Override price (optional)
  billingDay: number,                // Day of month/week (1-31 or 1-7)
  nextBillingDate: Timestamp,       // Next invoice generation date
  status: "ACTIVE" | "SUSPENDED" | "TRIAL",
  createdAt: Timestamp
}
```

#### 5. `invoices`

```javascript
{
  subscriptionId: DocumentReference | null,  // null for manual invoices
  customerId: DocumentReference,
  amount: number,
  dueDate: Timestamp,
  status: "UNPAID" | "PAID" | "OVERDUE",
  isManual: boolean,              // true for manually created invoices
  periodStart: Timestamp | null,   // Billing period start
  periodEnd: Timestamp | null,     // Billing period end
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### 6. `payments`

```javascript
{
  invoiceId: DocumentReference,
  recordedByUserId: DocumentReference,  // Staff who recorded payment
  paymentDate: Timestamp,
  amountPaid: number,
  notes: string,
  createdAt: Timestamp
}
```

#### 7. `activityLog`

```javascript
{
  userId: DocumentReference | null,
  action: string,                  // e.g., "GENERATE_INVOICES", "RECORD_PAYMENT"
  timestamp: Timestamp,
  details: object                  // Additional action details
}
```

---

## Cloud Functions

### 1. `generateInvoices` (Scheduled)

**Schedule**: Daily at 2:00 AM UTC  
**Purpose**: Automatically generate invoices for subscriptions that are due

**How it works**:

1. Finds all ACTIVE and TRIAL subscriptions where `nextBillingDate <= today`
2. For each subscription:
   - Gets plan details
   - Calculates invoice amount (uses `customPrice` if set, otherwise `basePrice`)
   - Calculates billing period (start = `nextBillingDate`, end = start + billing cycle)
   - Creates invoice with status UNPAID
   - Updates subscription's `nextBillingDate` to next billing date
   - Converts TRIAL subscriptions to ACTIVE after first invoice
3. Commits all changes in a batch
4. Logs activity

**Trigger**: Cloud Scheduler (cron: `0 2 * * *`)

**Example**:

- Subscription with WEEKLY cycle, `nextBillingDate = 2025-11-20`
- On 2025-11-20 at 2 AM, invoice is created
- `nextBillingDate` updated to 2025-11-27

---

### 2. `updateOverdueInvoices` (Scheduled)

**Schedule**: Daily at 3:00 AM UTC  
**Purpose**: Mark unpaid invoices as OVERDUE if due date has passed

**How it works**:

1. Finds all invoices where:
   - `status == "UNPAID"`
   - `dueDate < today`
2. Updates status to "OVERDUE" in batch
3. Logs activity

**Trigger**: Cloud Scheduler (cron: `0 3 * * *`)

**Note**: This runs after `generateInvoices` to ensure new invoices are created first, then overdue status is updated.

---

### 3. `testGenerateInvoices` (Callable)

**Purpose**: Manually test invoice generation (for development/testing)

**How it works**:

- Same logic as `generateInvoices` but can be triggered manually
- Requires authentication
- Returns count of generated invoices

**Usage**: Called from Analytics page "Test Invoice Generation" button (Admin only)

---

### 4. `recordPayment` (Callable - DEPRECATED)

**Status**: ⚠️ Not used in frontend (replaced with direct Firestore operations)

**Original Purpose**: Record payments and update invoice status

**Current Implementation**: Frontend directly writes to Firestore `payments` collection and updates invoice status

---

### 5. `updateSubscriptionStatus` (Callable - DEPRECATED)

**Status**: ⚠️ Not used in frontend (replaced with direct Firestore operations)

**Original Purpose**: Suspend or resume subscriptions

**Current Implementation**: Frontend directly updates subscription document

---

### 6. `createManualInvoice` (Callable - DEPRECATED)

**Status**: ⚠️ Not used in frontend (replaced with direct Firestore operations)

**Original Purpose**: Create manual invoices for one-off payments

**Current Implementation**: Frontend directly creates invoice document

---

## User Roles & Permissions

### ADMIN

- ✅ Full access to all features
- ✅ Manage Plans
- ✅ Manage Staff
- ✅ Edit invoices
- ✅ Create/Edit customers
- ✅ Create subscriptions
- ✅ Suspend/Resume subscriptions
- ✅ Create manual invoices
- ✅ Record payments
- ✅ View Analytics
- ✅ Test invoice generation

### STAFF

- ✅ View customers
- ✅ View customer profiles
- ✅ Record payments
- ✅ View invoices
- ❌ Cannot edit invoices
- ❌ Cannot manage plans
- ❌ Cannot manage staff
- ❌ Cannot create subscriptions
- ❌ Cannot suspend/resume subscriptions

---

## Testing Guide

### Prerequisites

1. Firebase project set up
2. Firestore database initialized
3. Authentication enabled (Email/Password)
4. Cloud Functions deployed
5. At least one ADMIN user created

### Test Cases

#### 1. Authentication Tests

**Test 1.1: Login as Admin**

- Navigate to `/login`
- Enter admin email and password
- Verify redirect to `/dashboard`
- Verify "Plans" and "Staff" links visible in sidebar

**Test 1.2: Login as Staff**

- Navigate to `/login`
- Enter staff email and password
- Verify redirect to `/dashboard`
- Verify "Plans" and "Staff" links NOT visible in sidebar

**Test 1.3: Logout**

- Click "Logout" in sidebar
- Verify redirect to `/login`
- Verify cannot access protected routes

---

#### 2. Customer Management Tests

**Test 2.1: Create Customer**

- Navigate to `/customers`
- Click "+ Add New Customer"
- Fill in: Name (required), Contact Person, Contact Phone
- Click "Create Customer"
- Verify success message
- Verify customer appears in list

**Test 2.2: Edit Customer**

- Navigate to `/customers`
- Click "Edit" on a customer
- Modify name/contact info
- Click "Update Customer"
- Verify success message
- Verify changes reflected in list

**Test 2.3: Search Customers**

- Navigate to `/customers`
- Type in search box (by name, contact person, or phone)
- Verify filtered results
- Click "Clear" to reset

**Test 2.4: Pagination**

- Create 15+ customers
- Verify pagination controls appear
- Test "Previous" and "Next" buttons
- Verify page info displays correctly

**Test 2.5: Export Customers**

- Navigate to `/customers`
- Click "Export CSV"
- Verify CSV file downloads
- Verify file contains all customer data

---

#### 3. Subscription Management Tests

**Test 3.1: Create Subscription (Admin)**

- Navigate to customer profile
- Click "+ Add New Subscription"
- Select plan, enter custom price (optional), billing day
- Click "Create Subscription"
- Verify success message
- Verify subscription appears in Subscriptions tab

**Test 3.2: Suspend Subscription**

- Navigate to customer profile
- Find ACTIVE subscription
- Click "Pause"
- Verify success message
- Verify status changes to SUSPENDED
- Verify "Resume" button appears

**Test 3.3: Resume Subscription**

- Navigate to customer profile
- Find SUSPENDED subscription
- Click "Resume"
- Select resume date
- Verify success message
- Verify status changes to ACTIVE
- Verify `nextBillingDate` updated

**Test 3.4: Staff Cannot Create/Edit Subscriptions**

- Login as STAFF
- Navigate to customer profile
- Verify "+ Add New Subscription" button NOT visible
- Verify "Pause"/"Resume" buttons NOT visible

---

#### 4. Invoice Management Tests

**Test 4.1: Automatic Invoice Generation**

- Create subscription with `nextBillingDate = today`
- Wait for scheduled function OR click "Test Invoice Generation" in Analytics
- Verify invoice created in customer's Invoice History
- Verify invoice status is UNPAID
- Verify subscription's `nextBillingDate` updated

**Test 4.2: Create Manual Invoice**

- Navigate to customer profile
- Click "+ Add Manual Invoice"
- Enter amount, period dates (optional), notes
- Click "Create Invoice"
- Verify success message
- Verify invoice appears with `isManual = true`

**Test 4.3: Edit Invoice (Admin)**

- Navigate to customer profile → Invoice History
- Click "Edit" on an invoice
- Modify amount, due date, or status
- Click "Update Invoice"
- Verify success message
- Verify changes reflected

**Test 4.4: Invoice Status Updates**

- Create invoice with due date in the past
- Wait for `updateOverdueInvoices` function OR manually check
- Verify status changes to OVERDUE

**Test 4.5: Export Invoices**

- Navigate to customer profile → Invoice History
- Click "Export Invoices CSV"
- Verify CSV file downloads
- Verify file contains invoice data

---

#### 5. Payment Management Tests

**Test 5.1: Record Payment**

- Navigate to Dashboard or Customer Profile
- Click "Record Payment" on an unpaid invoice
- Enter amount paid, payment date, notes
- Click "Record Payment"
- Verify success message
- Verify invoice status changes to PAID
- Verify payment appears in Payment History

**Test 5.2: Payment History**

- Navigate to customer profile → Payment History tab
- Verify all payments for customer displayed
- Verify payment details (date, amount, notes)
- Click "Export Payments CSV"
- Verify CSV file downloads

**Test 5.3: Payment Updates Invoice Status**

- Record payment for UNPAID invoice
- Verify invoice status automatically changes to PAID
- Verify payment linked to invoice

---

#### 6. Dashboard Tests

**Test 6.1: KPI Cards**

- Navigate to `/dashboard`
- Verify "Overdue Amount" displays sum of overdue invoices
- Verify "Due Today" displays sum of invoices due today
- Verify "Active Subscriptions" displays count

**Test 6.2: Overdue Invoices Section**

- Create invoice with due date in the past
- Navigate to Dashboard
- Verify invoice appears in "Overdue Invoices" section
- Verify customer name, amount, due date, status displayed

**Test 6.3: Due Today Section**

- Create invoice with due date = today
- Navigate to Dashboard
- Verify invoice appears in "Due Today" section

**Test 6.4: All Unpaid Invoices Section**

- Create multiple unpaid invoices (various due dates)
- Navigate to Dashboard
- Verify all unpaid invoices appear in "All Unpaid Invoices" section

**Test 6.5: Quick Payment Recording**

- Navigate to Dashboard
- Click "Record Payment" on any invoice
- Complete payment form
- Verify payment recorded and invoice status updated
- Verify Dashboard refreshes

---

#### 7. Plans Management Tests (Admin Only)

**Test 7.1: Create Plan**

- Navigate to `/plans`
- Click "+ Add New Plan"
- Enter name, base price, billing cycle
- Click "Create Plan"
- Verify success message
- Verify plan appears in list

**Test 7.2: Edit Plan**

- Navigate to `/plans`
- Click "Edit" on a plan
- Modify details
- Click "Update Plan"
- Verify success message
- Verify changes reflected

**Test 7.3: Delete Plan**

- Navigate to `/plans`
- Click "Delete" on a plan (with no active subscriptions)
- Confirm deletion
- Verify success message
- Verify plan removed from list

**Test 7.4: Staff Cannot Access Plans**

- Login as STAFF
- Verify `/plans` route redirects or shows error
- Verify "Plans" link not in sidebar

---

#### 8. Staff Management Tests (Admin Only)

**Test 8.1: Create Staff**

- Navigate to `/staff`
- Click "+ Add New Staff"
- Enter email, password, role
- Click "Create Staff"
- Verify success message
- Verify staff appears in list

**Test 8.2: Update Staff Role**

- Navigate to `/staff`
- Click "Edit" on a staff member
- Change role (ADMIN ↔ STAFF)
- Click "Update Staff"
- Verify success message
- Verify role updated

**Test 8.3: Delete Staff**

- Navigate to `/staff`
- Click "Delete" on a staff member
- Confirm deletion
- Verify success message
- Verify staff removed from list

---

#### 9. Analytics Tests

**Test 9.1: View Analytics**

- Navigate to `/analytics`
- Verify KPI cards display:
  - Total Revenue
  - Revenue (Selected Period)
  - Total Customers
  - Active Subscriptions
  - Paid/Unpaid/Overdue Invoice counts

**Test 9.2: Date Range Filter**

- Navigate to `/analytics`
- Change start and end dates
- Verify "Revenue (Selected Period)" updates
- Verify other metrics remain unchanged

**Test 9.3: Export Report**

- Navigate to `/analytics`
- Click "Export Report"
- Verify CSV file downloads
- Verify file contains all metrics

**Test 9.4: Test Invoice Generation (Admin)**

- Navigate to `/analytics`
- Click "Test Invoice Generation"
- Verify success message with count
- Verify invoices created for eligible subscriptions
- Verify Analytics page refreshes

---

#### 10. Edge Cases & Error Handling

**Test 10.1: Invalid Login**

- Try logging in with wrong password
- Verify error message displayed

**Test 10.2: Missing Required Fields**

- Try creating customer without name
- Verify warning message
- Verify customer not created

**Test 10.3: Duplicate Customer**

- Create customer with same name
- Verify both customers created (duplicates allowed)

**Test 10.4: Delete Plan with Active Subscriptions**

- Try deleting plan that has active subscriptions
- Verify error message or prevention

**Test 10.5: Payment Amount Validation**

- Try recording payment with amount > invoice amount
- Verify warning or error message

**Test 10.6: Network Errors**

- Disconnect internet
- Try performing actions
- Verify error messages displayed

---

## Known Issues & Improvements

### Current Issues

1. **Cloud Functions Not Used for User Actions**

   - **Issue**: Frontend directly writes to Firestore for payments, subscriptions, invoices
   - **Impact**: No server-side validation, no activity logging for some actions
   - **Priority**: Medium

2. **No PDF Export**

   - **Issue**: Only CSV export available
   - **Impact**: Limited reporting options
   - **Priority**: Low

3. **No Email Notifications**

   - **Issue**: No email alerts for overdue invoices or payment confirmations
   - **Impact**: Manual follow-up required
   - **Priority**: High

4. **No Invoice Numbering**

   - **Issue**: Invoices don't have unique invoice numbers
   - **Impact**: Hard to reference invoices
   - **Priority**: Medium

5. **Date Format Inconsistency**

   - **Issue**: Dates displayed in different formats across pages
   - **Impact**: User confusion
   - **Priority**: Low

6. **No Bulk Operations**

   - **Issue**: Cannot record multiple payments or create multiple invoices at once
   - **Impact**: Time-consuming for large datasets
   - **Priority**: Medium

7. **No Payment Method Tracking**

   - **Issue**: Payments don't record payment method (cash, bank transfer, etc.)
   - **Impact**: Limited payment tracking
   - **Priority**: Low

8. **No Recurring Payment Support**
   - **Issue**: All payments must be recorded manually
   - **Impact**: No automation for recurring payments
   - **Priority**: Low

### Recommended Improvements

#### High Priority

1. **Email Notifications**

   - Send email when invoice is created
   - Send reminder for overdue invoices
   - Send confirmation when payment is recorded

2. **Invoice Numbering System**

   - Generate unique invoice numbers (e.g., INV-2025-001)
   - Display invoice number in all views
   - Allow searching by invoice number

3. **Server-Side Validation**

   - Move payment/subscription/invoice creation to Cloud Functions
   - Add comprehensive validation
   - Log all actions in activityLog

4. **Payment Receipts**
   - Generate PDF receipts for payments
   - Email receipts to customers
   - Store receipts in database

#### Medium Priority

5. **Advanced Search & Filtering**

   - Filter invoices by date range, status, amount
   - Filter customers by subscription status
   - Advanced search with multiple criteria

6. **Bulk Operations**

   - Bulk payment recording
   - Bulk invoice creation
   - Bulk subscription updates

7. **Dashboard Enhancements**

   - Charts and graphs for revenue trends
   - Monthly/yearly revenue comparison
   - Customer retention metrics

8. **Audit Trail**
   - Track all changes to invoices, subscriptions, customers
   - Show who made changes and when
   - Revert changes if needed

#### Low Priority

9. **PDF Export**

   - Export invoices as PDF
   - Export reports as PDF
   - Email PDF invoices to customers

10. **Payment Methods**

    - Track payment method (cash, bank transfer, credit card)
    - Payment method analytics
    - Payment method preferences per customer

11. **Multi-Currency Support**

    - Support multiple currencies
    - Currency conversion
    - Currency-specific reports

12. **Mobile App**

    - React Native mobile app
    - Push notifications
    - Mobile payment recording

13. **API for Third-Party Integration**

    - REST API for external systems
    - Webhook support
    - API documentation

14. **Advanced Analytics**
    - Revenue forecasting
    - Churn analysis
    - Customer lifetime value
    - Subscription health metrics

---

## Deployment

### Prerequisites

- Node.js 20+
- Firebase CLI installed (`npm install -g firebase-tools`)
- Firebase project created
- Firestore database initialized

### Frontend Deployment

```bash
cd frontend
npm install
npm run build
# Deploy to Firebase Hosting or your preferred hosting
```

### Cloud Functions Deployment

```bash
cd functions
npm install
firebase deploy --only functions
```

### Firestore Rules Deployment

```bash
firebase deploy --only firestore:rules
```

### Firestore Indexes Deployment

```bash
firebase deploy --only firestore:indexes
```

### Full Deployment

```bash
firebase deploy
```

---

## API Reference

### Firestore Collections

#### Create Customer

```javascript
await addDoc(collection(db, "customers"), {
  name: string,
  contactPerson: string,
  contactPhone: string,
});
```

#### Create Subscription

```javascript
await addDoc(collection(db, "subscriptions"), {
  customerId: doc(db, "customers", customerId),
  planId: doc(db, "plans", planId),
  customPrice: number,
  billingDay: number,
  nextBillingDate: Timestamp,
  status: "ACTIVE" | "SUSPENDED" | "TRIAL",
});
```

#### Create Invoice

```javascript
await addDoc(collection(db, "invoices"), {
  subscriptionId: doc(db, "subscriptions", subscriptionId) | null,
  customerId: doc(db, "customers", customerId),
  amount: number,
  dueDate: Timestamp,
  status: "UNPAID" | "PAID" | "OVERDUE",
  isManual: boolean,
  periodStart: Timestamp | null,
  periodEnd: Timestamp | null,
});
```

#### Record Payment

```javascript
await addDoc(collection(db, "payments"), {
  invoiceId: doc(db, "invoices", invoiceId),
  recordedByUserId: doc(db, "users", userId),
  paymentDate: Timestamp,
  amountPaid: number,
  notes: string,
});

// Update invoice status
await updateDoc(doc(db, "invoices", invoiceId), {
  status: "PAID",
});
```

### Cloud Functions

#### testGenerateInvoices

```javascript
import { httpsCallable } from "firebase/functions";

const testGenerate = httpsCallable(functions, "testGenerateInvoices");
const result = await testGenerate({});
// Returns: { success: true, message: string, count: number }
```

---

## Security Considerations

1. **Firestore Security Rules**: Ensure rules are properly configured to prevent unauthorized access
2. **Authentication**: All routes require authentication
3. **Role-Based Access**: Admin-only features protected in frontend and should be protected in backend
4. **Input Validation**: Validate all user inputs on both client and server
5. **CORS**: Cloud Functions have CORS enabled for frontend access

---

## Support & Maintenance

### Daily Tasks

- Monitor Cloud Functions logs for errors
- Check scheduled functions execution
- Review overdue invoices

### Weekly Tasks

- Review analytics and reports
- Check for failed invoice generations
- Verify payment recordings

### Monthly Tasks

- Review and update plans/pricing
- Audit user access and permissions
- Backup Firestore data

---

## Version History

- **v1.0.0** (Current)
  - Initial release
  - Customer, subscription, invoice, payment management
  - Automatic invoice generation
  - Analytics dashboard
  - CSV export functionality

---

## License

[Your License Here]

---

## Contact

For support or questions, contact [Your Contact Information]
