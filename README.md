# Digi Payment System

A comprehensive subscription and invoice management system for digital menu service providers.

## Quick Start

### Prerequisites
- Node.js 20+
- Firebase account
- Firebase CLI (`npm install -g firebase-tools`)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd digi-payment-system
```

2. **Install dependencies**
```bash
# Frontend
cd frontend
npm install

# Backend (Cloud Functions)
cd ../functions
npm install
```

3. **Configure Firebase**
- Update `frontend/src/firebase/config.js` with your Firebase config
- Update `.firebaserc` with your project ID

4. **Deploy Firestore Rules & Indexes**
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

5. **Deploy Cloud Functions**
```bash
firebase deploy --only functions
```

6. **Run Frontend**
```bash
cd frontend
npm run dev
```

## Features

- ✅ **Customer Management** - Create, edit, search, and export customers
- ✅ **Subscription Management** - Track weekly/monthly subscriptions with automatic billing
- ✅ **Automatic Invoice Generation** - Daily scheduled invoice creation
- ✅ **Payment Tracking** - Record and track payments with full history
- ✅ **Dashboard** - Real-time KPIs and actionable invoice lists
- ✅ **Analytics & Reports** - Comprehensive reporting with CSV export
- ✅ **Role-Based Access** - ADMIN and STAFF roles with different permissions
- ✅ **Invoice Editing** - Correct invoice details after creation
- ✅ **Payment History** - Complete payment history per customer

## Documentation

For complete documentation, see [DOCUMENTATION.md](./DOCUMENTATION.md)

The documentation includes:
- System architecture
- Database structure
- Cloud Functions details
- Complete testing guide
- Known issues and improvements
- API reference

## Cloud Functions Schedule

- **Invoice Generation**: Daily at 2:00 AM UTC
- **Overdue Updates**: Daily at 3:00 AM UTC

## User Roles

### ADMIN
Full access to all features including:
- Customer, subscription, invoice, and payment management
- Plans and staff management
- Analytics and reporting

### STAFF
Limited access:
- View customers and invoices
- Record payments
- Cannot edit invoices or manage plans/staff

## Testing

See [DOCUMENTATION.md - Testing Guide](./DOCUMENTATION.md#testing-guide) for comprehensive test cases covering:
- Authentication
- Customer management
- Subscription management
- Invoice management
- Payment recording
- Dashboard functionality
- Analytics
- Edge cases

## Project Structure

```
digi-payment-system/
├── frontend/              # React application
│   ├── src/
│   │   ├── components/   # Reusable components
│   │   ├── pages/        # Page components
│   │   ├── contexts/     # React contexts
│   │   ├── firebase/     # Firebase config
│   │   └── utils/        # Utility functions
│   └── package.json
├── functions/            # Cloud Functions
│   ├── index.js          # Function definitions
│   └── package.json
├── firestore.rules       # Firestore security rules
├── firestore.indexes.json # Firestore indexes
├── firebase.json         # Firebase config
├── DOCUMENTATION.md      # Complete documentation
└── README.md            # This file
```

## Deployment

### Frontend
```bash
cd frontend
npm run build
# Deploy to Firebase Hosting or your preferred hosting
```

### Cloud Functions
```bash
firebase deploy --only functions
```

### Full Deployment
```bash
firebase deploy
```

## Key Improvements Needed

See [DOCUMENTATION.md - Known Issues & Improvements](./DOCUMENTATION.md#known-issues--improvements) for details.

**High Priority:**
- Email notifications for invoices and payments
- Invoice numbering system
- Server-side validation via Cloud Functions
- Payment receipts (PDF)

**Medium Priority:**
- Advanced search and filtering
- Bulk operations
- Dashboard enhancements with charts
- Complete audit trail

## Support

For detailed information, troubleshooting, and API reference, see [DOCUMENTATION.md](./DOCUMENTATION.md).

## License

[Your License Here]
