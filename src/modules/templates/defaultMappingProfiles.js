const defaultMappingProfiles = {
  mobily_details: [
    { placeholderNumber: 1, fieldKey: "fullName", transformer: "trim" },
    { placeholderNumber: 2, fieldKey: "nationalId_last4", transformer: "identity_last4" },
    { placeholderNumber: 3, fieldKey: "accountNumber", transformer: "trim" },
    { placeholderNumber: 4, fieldKey: "serviceNumber", transformer: "trim" },
    { placeholderNumber: 5, fieldKey: "debtYear", transformer: "plainNumber" },
    { placeholderNumber: 6, fieldKey: "debtAmount", transformer: "currency" },
    { placeholderNumber: 7, fieldKey: "accountNumber", transformer: "trim" }
  ],
  stc_details: [
    { placeholderNumber: 1, fieldKey: "fullName", transformer: "trim" },
    { placeholderNumber: 2, fieldKey: "debtAmount", transformer: "currency" },
    { placeholderNumber: 3, fieldKey: "accountNumber", transformer: "trim" },
    { placeholderNumber: 4, fieldKey: "serviceNumber", transformer: "trim" },
    { placeholderNumber: 5, fieldKey: "invoiceStatus", transformer: "trim" }
  ]
};

function getDefaultMappingProfile(templateName) {
  return defaultMappingProfiles[String(templateName || "").trim()] || null;
}

module.exports = {
  defaultMappingProfiles,
  getDefaultMappingProfile
};
