// Canonical loan status values used across the app
export const LoanStatus = Object.freeze({
  SUBMITTED: 'SUBMITTED',            // New application submitted by customer
  UNDER_REVIEW: 'UNDER REVIEW',      // Loan officer reviewing
  INFO_REQUIRED: 'INFO REQUIRED',    // Additional details requested
  PENDING_APPROVAL: 'PENDING APPROVAL', // Escalated to manager
  APPROVED: 'APPROVED',              // Manager approved
  REJECTED: 'REJECTED',              // Rejected by officer/manager
});
