const fs = require("fs");
const path = require("path");

// Try to require firebase-admin
let admin;
try {
  admin = require("firebase-admin");
} catch (error) {
  console.error("❌ Error: firebase-admin is not installed.");
  console.error("Please install it by running: npm install firebase-admin");
  console.error("Or run this script from the functions directory where it's already installed.");
  process.exit(1);
}

// Initialize Firebase Admin with credentials
// Try multiple authentication methods:
// 1. Service account key file (if GOOGLE_APPLICATION_CREDENTIALS is set or serviceAccountKey.json exists)
// 2. Application Default Credentials (requires: gcloud auth application-default login)
// 3. Firebase emulator (if FIRESTORE_EMULATOR_HOST is set)

let app;
try {
  // Check if app is already initialized
  app = admin.app();
  console.log("Using existing Firebase Admin app");
} catch (error) {
  // App not initialized, try to initialize
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const localServiceAccountPath = path.join(__dirname, "..", "serviceAccountKey.json");
  
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    // Use service account key file from environment variable
    const serviceAccount = require(serviceAccountPath);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: "digi-payment-system",
    });
    console.log("✅ Using service account key from GOOGLE_APPLICATION_CREDENTIALS");
  } else if (fs.existsSync(localServiceAccountPath)) {
    // Use local service account key file
    const serviceAccount = require(localServiceAccountPath);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: "digi-payment-system",
    });
    console.log("✅ Using local service account key file");
  } else if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Use emulator
    app = admin.initializeApp({
      projectId: "digi-payment-system",
    });
    console.log("✅ Using Firestore emulator");
  } else {
    // Try Application Default Credentials
    try {
      app = admin.initializeApp({
        projectId: "digi-payment-system",
      });
      console.log("✅ Using Application Default Credentials");
    } catch (initError) {
      console.error("\n❌ Firebase Admin initialization failed!");
      console.error("\nTo fix this, choose one of the following options:\n");
      console.error("Option 1: Use Application Default Credentials");
      console.error("  Run: gcloud auth application-default login");
      console.error("  Then run this script again.\n");
      console.error("Option 2: Use a Service Account Key");
      console.error("  1. Go to Firebase Console > Project Settings > Service Accounts");
      console.error("  2. Click 'Generate New Private Key'");
      console.error("  3. Save the file as 'serviceAccountKey.json' in the project root");
      console.error("  4. Run this script again.\n");
      console.error("Option 3: Set GOOGLE_APPLICATION_CREDENTIALS environment variable");
      console.error("  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json");
      console.error("  Then run this script again.\n");
      throw initError;
    }
  }
}

const db = admin.firestore();

// Firestore batch write limit
const BATCH_SIZE = 500;

async function importCustomers() {
  try {
    // Read the JSON file
    const jsonPath = path.join(__dirname, "..", "customers_with_contacts.json");
    const jsonData = fs.readFileSync(jsonPath, "utf8");
    const customers = JSON.parse(jsonData);

    console.log(`Found ${customers.length} customers to import`);

    // Check for existing customers to avoid duplicates
    const existingCustomersSnapshot = await db.collection("customers").get();
    const existingStoreIds = new Set();
    existingCustomersSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.storeId) {
        existingStoreIds.add(data.storeId);
      }
    });

    console.log(`Found ${existingStoreIds.size} existing customers in Firestore`);

    // Filter out duplicates and prepare data
    const customersToImport = [];
    const skipped = [];

    for (const customer of customers) {
      // Skip if storeId already exists
      if (customer.storeId && existingStoreIds.has(customer.storeId)) {
        skipped.push({
          name: customer.name,
          storeId: customer.storeId,
          reason: "Duplicate storeId",
        });
        continue;
      }

      // Map the data to Firestore format
      const customerData = {
        name: customer.name || "",
        contactPerson: customer.contactPerson || "",
        contactPhone: customer.contactPhone || "",
        storeId: customer.storeId || "",
        bankName: customer.bankName || "",
        status: customer.status === "Active" ? "ACTIVE" : customer.status?.toUpperCase() || "ACTIVE",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      customersToImport.push(customerData);

      // Track storeId to avoid duplicates within the same import
      if (customer.storeId) {
        existingStoreIds.add(customer.storeId);
      }
    }

    console.log(`\nImporting ${customersToImport.length} customers`);
    console.log(`Skipping ${skipped.length} duplicates`);

    if (skipped.length > 0) {
      console.log("\nSkipped customers:");
      skipped.slice(0, 10).forEach((item) => {
        console.log(`  - ${item.name} (storeId: ${item.storeId}) - ${item.reason}`);
      });
      if (skipped.length > 10) {
        console.log(`  ... and ${skipped.length - 10} more`);
      }
    }

    // Import in batches
    let imported = 0;
    for (let i = 0; i < customersToImport.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const batchCustomers = customersToImport.slice(i, i + BATCH_SIZE);

      batchCustomers.forEach((customerData) => {
        const docRef = db.collection("customers").doc();
        batch.set(docRef, customerData);
      });

      await batch.commit();
      imported += batchCustomers.length;
      console.log(`Imported ${imported}/${customersToImport.length} customers...`);
    }

    console.log(`\n✅ Successfully imported ${imported} customers to Firestore!`);
    if (skipped.length > 0) {
      console.log(`⚠️  Skipped ${skipped.length} duplicate customers`);
    }
  } catch (error) {
    console.error("❌ Error importing customers:", error);
    process.exit(1);
  }
}

// Run the import
importCustomers()
  .then(() => {
    console.log("\nImport completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });

