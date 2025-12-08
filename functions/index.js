const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();

// Helper function to get next billing date
// For weekly subscriptions: next billing date = period end date
// Example: Period 09/11/2025 - 16/11/2025, period ends on 16/11/2025
//          Next period: 17/11/2025 - 24/11/2025, period ends on 24/11/2025
//          So next billing = period end date
// Note: Invoice due date is set to period start (billing date), not period end
// For monthly subscriptions: next billing is next month's billing day
function getNextBillingDate(periodEndDate, billingCycle, billingDay) {
  const date = new Date(periodEndDate);

  if (billingCycle === "WEEKLY") {
    // For weekly subscriptions, the next billing date is simply the period end date
    // No calculation needed - just return the period end date
    return date;
  } else if (billingCycle === "MONTHLY") {
    // For monthly, use the billing day (day of month)
    const day = parseInt(billingDay) || 1;
    // Validate day is between 1-31
    const validDay = Math.max(1, Math.min(31, day));
    date.setMonth(date.getMonth() + 1);
    date.setDate(validDay);
  }

  return date;
}

// Scheduled function: Generate invoices daily
exports.generateInvoices = onSchedule(
  {
    schedule: "0 2 * * *", // Run daily at 2 AM
    timeZone: "UTC",
  },
  async (event) => {
    // Set to end of today (23:59:59.999) to include all subscriptions with nextBillingDate today
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    try {
      // Find subscriptions where nextBillingDate is today or in the past
      const subscriptionsSnapshot = await db
        .collection("subscriptions")
        .where("status", "in", ["ACTIVE", "TRIAL"])
        .where(
          "nextBillingDate",
          "<=",
          admin.firestore.Timestamp.fromDate(today)
        )
        .get();

      const batch = db.batch();
      const invoices = [];

      for (const subDoc of subscriptionsSnapshot.docs) {
        const subscription = subDoc.data();
        const subscriptionId = subDoc.id;

        // Check customer status - skip if customer has LEFT status
        const customerDoc = await db
          .collection("customers")
          .doc(subscription.customerId.id)
          .get();
        if (!customerDoc.exists) continue;
        const customer = customerDoc.data();
        if (customer.status === "LEFT") continue;

        // Get plan details
        const planDoc = await db
          .collection("plans")
          .doc(subscription.planId.id)
          .get();
        if (!planDoc.exists) continue;

        const plan = planDoc.data();
        const amount = subscription.customPrice || plan.basePrice;

        // Calculate period dates
        const periodStart = subscription.nextBillingDate.toDate();
        const periodEnd = new Date(periodStart);

        if (plan.billingCycle === "WEEKLY") {
          periodEnd.setDate(periodEnd.getDate() + 7);
        } else if (plan.billingCycle === "MONTHLY") {
          periodEnd.setMonth(periodEnd.getMonth() + 1);
        }

        // Check if invoice already exists for this period or overlapping period
        const periodStartTimestamp =
          admin.firestore.Timestamp.fromDate(periodStart);

        // Check for exact period match (same subscription, same periodStart)
        const exactMatchQuery = await db
          .collection("invoices")
          .where(
            "subscriptionId",
            "==",
            db.doc(`subscriptions/${subscriptionId}`)
          )
          .where("periodStart", "==", periodStartTimestamp)
          .get();

        // Check for overlapping invoices (same customer, overlapping periods)
        const allCustomerInvoicesQuery = await db
          .collection("invoices")
          .where("customerId", "==", subscription.customerId)
          .get();

        let hasOverlappingPaidInvoice = false;

        // Check exact match first
        if (!exactMatchQuery.empty) {
          const existingInvoice = exactMatchQuery.docs[0].data();
          if (existingInvoice.status === "PAID") {
            // Invoice already exists and is paid, just update nextBillingDate
            const newNextBillingDate = getNextBillingDate(
              periodEnd,
              plan.billingCycle,
              subscription.billingDay
            );
            const subscriptionUpdate = {
              nextBillingDate:
                admin.firestore.Timestamp.fromDate(newNextBillingDate),
            };
            if (subscription.status === "TRIAL") {
              subscriptionUpdate.status = "ACTIVE";
            }
            batch.update(subDoc.ref, subscriptionUpdate);
            continue; // Skip creating duplicate invoice
          } else if (
            existingInvoice.status === "UNPAID" ||
            existingInvoice.status === "OVERDUE"
          ) {
            // Invoice exists but unpaid - check if there's a payment that covers this period
            const paymentsQuery = await db
              .collection("payments")
              .where(
                "invoiceId",
                "==",
                db.doc(`invoices/${exactMatchQuery.docs[0].id}`)
              )
              .get();

            if (!paymentsQuery.empty) {
              // Payment exists for this invoice, mark it as PAID and update nextBillingDate
              batch.update(exactMatchQuery.docs[0].ref, {
                status: "PAID",
              });
              const newNextBillingDate = getNextBillingDate(
                periodEnd,
                plan.billingCycle,
                subscription.billingDay
              );
              const subscriptionUpdate = {
                nextBillingDate:
                  admin.firestore.Timestamp.fromDate(newNextBillingDate),
              };
              if (subscription.status === "TRIAL") {
                subscriptionUpdate.status = "ACTIVE";
              }
              batch.update(subDoc.ref, subscriptionUpdate);
              continue; // Skip creating duplicate invoice
            }
            // Invoice exists but unpaid and no payment - skip to avoid duplicate
            continue;
          }
        }

        // Check for overlapping paid invoices (manual or automatic)
        for (const invoiceDoc of allCustomerInvoicesQuery.docs) {
          const invoice = invoiceDoc.data();
          const invPeriodStart = invoice.periodStart?.toDate();
          const invPeriodEnd = invoice.periodEnd?.toDate();

          // Skip if no period dates
          if (!invPeriodStart || !invPeriodEnd) continue;

          // Check if periods overlap: (invPeriodStart <= periodEnd) AND (invPeriodEnd >= periodStart)
          const periodsOverlap =
            invPeriodStart <= periodEnd && invPeriodEnd >= periodStart;

          if (periodsOverlap && invoice.status === "PAID") {
            // Found a paid invoice that overlaps with this period
            hasOverlappingPaidInvoice = true;
            // Update nextBillingDate to skip this period
            const newNextBillingDate = getNextBillingDate(
              periodEnd,
              plan.billingCycle,
              subscription.billingDay
            );
            const subscriptionUpdate = {
              nextBillingDate:
                admin.firestore.Timestamp.fromDate(newNextBillingDate),
            };
            if (subscription.status === "TRIAL") {
              subscriptionUpdate.status = "ACTIVE";
            }
            batch.update(subDoc.ref, subscriptionUpdate);
            break; // Found overlapping invoice, no need to check more
          }
        }

        // If we found an overlapping paid invoice, skip creating new invoice
        if (hasOverlappingPaidInvoice) {
          continue;
        }

        // Create invoice
        const invoiceRef = db.collection("invoices").doc();
        const invoiceData = {
          subscriptionId: db.doc(`subscriptions/${subscriptionId}`),
          customerId: subscription.customerId,
          amount: amount,
          dueDate: admin.firestore.Timestamp.fromDate(periodStart), // Due date is the billing date (period start)
          status: "UNPAID",
          isManual: false,
          periodStart: admin.firestore.Timestamp.fromDate(periodStart),
          periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        batch.set(invoiceRef, invoiceData);
        invoices.push(invoiceData);

        // Update subscription
        const newNextBillingDate = getNextBillingDate(
          periodEnd,
          plan.billingCycle,
          subscription.billingDay
        );

        const subscriptionUpdate = {
          nextBillingDate:
            admin.firestore.Timestamp.fromDate(newNextBillingDate),
        };

        // If it was a TRIAL, set to ACTIVE
        if (subscription.status === "TRIAL") {
          subscriptionUpdate.status = "ACTIVE";
        }

        batch.update(subDoc.ref, subscriptionUpdate);
      }

      await batch.commit();

      // Log activity
      await db.collection("activityLog").add({
        action: "GENERATE_INVOICES",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        details: { count: invoices.length },
      });

      console.log(`Generated ${invoices.length} invoices`);
      return null;
    } catch (error) {
      console.error("Error generating invoices:", error);
      throw error;
    }
  }
);

// Scheduled function: Update overdue invoices
exports.updateOverdueInvoices = onSchedule(
  {
    schedule: "0 3 * * *", // Run daily at 3 AM
    timeZone: "UTC",
  },
  async (event) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

    try {
      const overdueSnapshot = await db
        .collection("invoices")
        .where("status", "==", "UNPAID")
        .where("dueDate", "<", todayTimestamp)
        .get();

      const batch = db.batch();

      overdueSnapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { status: "OVERDUE" });
      });

      await batch.commit();

      console.log(`Updated ${overdueSnapshot.size} invoices to OVERDUE`);
      return null;
    } catch (error) {
      console.error("Error updating overdue invoices:", error);
      throw error;
    }
  }
);

// Callable function: Record payment
exports.recordPayment = onCall(
  {
    enforceAppCheck: false,
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const data = request.data;
    const context = { auth: request.auth };

    const { invoiceId, amountPaid, paymentDate, notes } = data;

    if (!invoiceId || !amountPaid || !paymentDate) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    try {
      const invoiceRef = db.collection("invoices").doc(invoiceId);
      const invoiceDoc = await invoiceRef.get();

      if (!invoiceDoc.exists) {
        throw new HttpsError("not-found", "Invoice not found");
      }

      const batch = db.batch();

      // Create payment record
      const paymentRef = db.collection("payments").doc();
      batch.set(paymentRef, {
        invoiceId: invoiceRef,
        recordedByUserId: db.doc(`users/${context.auth.uid}`),
        paymentDate: admin.firestore.Timestamp.fromDate(new Date(paymentDate)),
        amountPaid: amountPaid,
        notes: notes || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update invoice status
      batch.update(invoiceRef, {
        status: "PAID",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log activity
      batch.set(db.collection("activityLog").doc(), {
        userId: db.doc(`users/${context.auth.uid}`),
        action: "RECORD_PAYMENT",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        details: { invoiceId, amountPaid },
      });

      await batch.commit();

      return { success: true, paymentId: paymentRef.id };
    } catch (error) {
      console.error("Error recording payment:", error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError(
        "internal",
        "Error recording payment: " + error.message
      );
    }
  }
);

// Callable function: Update subscription status
exports.updateSubscriptionStatus = onCall(
  {
    enforceAppCheck: false,
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const data = request.data;
    const context = { auth: request.auth };
    const { subscriptionId, newStatus, newNextBillingDate } = data;

    if (!subscriptionId || !newStatus) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    if (!["ACTIVE", "SUSPENDED", "CANCELED"].includes(newStatus)) {
      throw new HttpsError("invalid-argument", "Invalid status");
    }

    try {
      const subscriptionRef = db
        .collection("subscriptions")
        .doc(subscriptionId);
      const subscriptionDoc = await subscriptionRef.get();

      if (!subscriptionDoc.exists) {
        throw new HttpsError("not-found", "Subscription not found");
      }

      const updateData = {
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (newStatus === "ACTIVE" && newNextBillingDate) {
        updateData.nextBillingDate = admin.firestore.Timestamp.fromDate(
          new Date(newNextBillingDate)
        );
      }

      await subscriptionRef.update(updateData);

      // Log activity
      await db.collection("activityLog").add({
        userId: db.doc(`users/${context.auth.uid}`),
        action: "UPDATE_SUBSCRIPTION_STATUS",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        details: { subscriptionId, newStatus },
      });

      return { success: true };
    } catch (error) {
      console.error("Error updating subscription status:", error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError(
        "internal",
        "Error updating subscription: " + error.message
      );
    }
  }
);

// Callable function: Create manual invoice
exports.createManualInvoice = onCall(
  {
    enforceAppCheck: false,
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const data = request.data;
    const context = { auth: request.auth };
    const { customerId, amount, periodStart, periodEnd, notes } = data;

    if (!customerId || !amount) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    try {
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      const invoiceRef = db.collection("invoices").doc();
      await invoiceRef.set({
        subscriptionId: null,
        customerId: db.doc(`customers/${customerId}`),
        amount: amount,
        dueDate: admin.firestore.Timestamp.fromDate(today),
        status: "UNPAID",
        isManual: true,
        periodStart: periodStart
          ? admin.firestore.Timestamp.fromDate(new Date(periodStart))
          : null,
        periodEnd: periodEnd
          ? admin.firestore.Timestamp.fromDate(new Date(periodEnd))
          : null,
        notes: notes || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log activity
      await db.collection("activityLog").add({
        userId: db.doc(`users/${context.auth.uid}`),
        action: "CREATE_MANUAL_INVOICE",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        details: { invoiceId: invoiceRef.id, customerId, amount },
      });

      return { success: true, invoiceId: invoiceRef.id };
    } catch (error) {
      console.error("Error creating manual invoice:", error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError(
        "internal",
        "Error creating invoice: " + error.message
      );
    }
  }
);

// Manual test function for invoice generation (for testing)
exports.testGenerateInvoices = onCall(
  {
    enforceAppCheck: false,
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    // Set to end of today (23:59:59.999) to include all subscriptions with nextBillingDate today
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    try {
      const subscriptionsSnapshot = await db
        .collection("subscriptions")
        .where("status", "in", ["ACTIVE", "TRIAL"])
        .where(
          "nextBillingDate",
          "<=",
          admin.firestore.Timestamp.fromDate(today)
        )
        .get();

      const batch = db.batch();
      const invoices = [];

      for (const subDoc of subscriptionsSnapshot.docs) {
        const subscription = subDoc.data();
        const subscriptionId = subDoc.id;

        // Check customer status - skip if customer has LEFT status
        const customerDoc = await db
          .collection("customers")
          .doc(subscription.customerId.id)
          .get();
        if (!customerDoc.exists) continue;
        const customer = customerDoc.data();
        if (customer.status === "LEFT") continue;

        const planDoc = await db
          .collection("plans")
          .doc(subscription.planId.id)
          .get();
        if (!planDoc.exists) continue;

        const plan = planDoc.data();
        const amount = subscription.customPrice || plan.basePrice;

        const periodStart = subscription.nextBillingDate.toDate();
        const periodEnd = new Date(periodStart);

        if (plan.billingCycle === "WEEKLY") {
          periodEnd.setDate(periodEnd.getDate() + 7);
        } else if (plan.billingCycle === "MONTHLY") {
          periodEnd.setMonth(periodEnd.getMonth() + 1);
        }

        // Check if invoice already exists for this period or overlapping period
        const periodStartTimestamp =
          admin.firestore.Timestamp.fromDate(periodStart);

        // Check for exact period match (same subscription, same periodStart)
        const exactMatchQuery = await db
          .collection("invoices")
          .where(
            "subscriptionId",
            "==",
            db.doc(`subscriptions/${subscriptionId}`)
          )
          .where("periodStart", "==", periodStartTimestamp)
          .get();

        // Check for overlapping invoices (same customer, overlapping periods)
        const allCustomerInvoicesQuery = await db
          .collection("invoices")
          .where("customerId", "==", subscription.customerId)
          .get();

        let hasOverlappingPaidInvoice = false;

        // Check exact match first
        if (!exactMatchQuery.empty) {
          const existingInvoice = exactMatchQuery.docs[0].data();
          if (existingInvoice.status === "PAID") {
            // Invoice already exists and is paid, just update nextBillingDate
            const newNextBillingDate = getNextBillingDate(
              periodEnd,
              plan.billingCycle,
              subscription.billingDay
            );
            const subscriptionUpdate = {
              nextBillingDate:
                admin.firestore.Timestamp.fromDate(newNextBillingDate),
            };
            if (subscription.status === "TRIAL") {
              subscriptionUpdate.status = "ACTIVE";
            }
            batch.update(subDoc.ref, subscriptionUpdate);
            continue; // Skip creating duplicate invoice
          } else if (
            existingInvoice.status === "UNPAID" ||
            existingInvoice.status === "OVERDUE"
          ) {
            // Invoice exists but unpaid - check if there's a payment that covers this period
            const paymentsQuery = await db
              .collection("payments")
              .where(
                "invoiceId",
                "==",
                db.doc(`invoices/${exactMatchQuery.docs[0].id}`)
              )
              .get();

            if (!paymentsQuery.empty) {
              // Payment exists for this invoice, mark it as PAID and update nextBillingDate
              batch.update(exactMatchQuery.docs[0].ref, {
                status: "PAID",
              });
              const newNextBillingDate = getNextBillingDate(
                periodEnd,
                plan.billingCycle,
                subscription.billingDay
              );
              const subscriptionUpdate = {
                nextBillingDate:
                  admin.firestore.Timestamp.fromDate(newNextBillingDate),
              };
              if (subscription.status === "TRIAL") {
                subscriptionUpdate.status = "ACTIVE";
              }
              batch.update(subDoc.ref, subscriptionUpdate);
              continue; // Skip creating duplicate invoice
            }
            // Invoice exists but unpaid and no payment - skip to avoid duplicate
            continue;
          }
        }

        // Check for overlapping paid invoices (manual or automatic)
        for (const invoiceDoc of allCustomerInvoicesQuery.docs) {
          const invoice = invoiceDoc.data();
          const invPeriodStart = invoice.periodStart?.toDate();
          const invPeriodEnd = invoice.periodEnd?.toDate();

          // Skip if no period dates
          if (!invPeriodStart || !invPeriodEnd) continue;

          // Check if periods overlap: (invPeriodStart <= periodEnd) AND (invPeriodEnd >= periodStart)
          const periodsOverlap =
            invPeriodStart <= periodEnd && invPeriodEnd >= periodStart;

          if (periodsOverlap && invoice.status === "PAID") {
            // Found a paid invoice that overlaps with this period
            hasOverlappingPaidInvoice = true;
            // Update nextBillingDate to skip this period
            const newNextBillingDate = getNextBillingDate(
              periodEnd,
              plan.billingCycle,
              subscription.billingDay
            );
            const subscriptionUpdate = {
              nextBillingDate:
                admin.firestore.Timestamp.fromDate(newNextBillingDate),
            };
            if (subscription.status === "TRIAL") {
              subscriptionUpdate.status = "ACTIVE";
            }
            batch.update(subDoc.ref, subscriptionUpdate);
            break; // Found overlapping invoice, no need to check more
          }
        }

        // If we found an overlapping paid invoice, skip creating new invoice
        if (hasOverlappingPaidInvoice) {
          continue;
        }

        const invoiceRef = db.collection("invoices").doc();
        const invoiceData = {
          subscriptionId: db.doc(`subscriptions/${subscriptionId}`),
          customerId: subscription.customerId,
          amount: amount,
          dueDate: admin.firestore.Timestamp.fromDate(periodStart), // Due date is the billing date (period start)
          status: "UNPAID",
          isManual: false,
          periodStart: admin.firestore.Timestamp.fromDate(periodStart),
          periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        batch.set(invoiceRef, invoiceData);
        invoices.push(invoiceData);

        const newNextBillingDate = getNextBillingDate(
          periodEnd,
          plan.billingCycle,
          subscription.billingDay
        );

        const subscriptionUpdate = {
          nextBillingDate:
            admin.firestore.Timestamp.fromDate(newNextBillingDate),
        };

        if (subscription.status === "TRIAL") {
          subscriptionUpdate.status = "ACTIVE";
        }

        batch.update(subDoc.ref, subscriptionUpdate);
      }

      await batch.commit();

      return {
        success: true,
        message: `Generated ${invoices.length} invoices`,
        count: invoices.length,
      };
    } catch (error) {
      console.error("Error in test invoice generation:", error);
      throw new HttpsError(
        "internal",
        "Error generating invoices: " + error.message
      );
    }
  }
);
