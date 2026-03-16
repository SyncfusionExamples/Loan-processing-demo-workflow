// Canonical loan status values used across the app
export const LoanStatus = Object.freeze({
  NEW: 'NEW',
  // SUBMITTED: 'SUBMITTED',            // New application submitted by customer
  UNDER_REVIEW: 'UNDER REVIEW',      // Under review by Loan Officer
  INFO_REQUIRED: 'INFO REQUIRED',    // Additional information requested from applicant
  PENDING_APPROVAL: 'PENDING APPROVAL', // Awaiting Manager approval
  VALIDATING: 'VALIDATING',             // Sent to Site Officer for on-site validation
  SITE_VERIFIED: 'SITE_VERIFIED',       // Site Officer verified; awaiting Loan Officer decision
  INFO_UPDATED: 'INFO_UPDATED',         // Applicant has provided requested information
  APPROVED: 'APPROVED',              // Approved by Manager
  REJECTED: 'REJECTED',             // Rejected by reviewer
  SIGN_REQUIRED: 'SIGN_REQUIRED',    // Signature requested from applicant
});
