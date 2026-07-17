/**
 * All customer-facing copy in one module — Brand Book §3.6 voice & tone.
 *
 * Confident, not boastful. Warm, not cutesy. Precise, not jargon-heavy.
 * Sentence case everywhere. No emojis. Master tailors, never vendors.
 */

export const strings = {
  brand: {
    name: "draep",
    tagline: "Measured for you.",
  },

  landing: {
    heroHeadlinePre: "Your blouse,",
    heroHeadlineHighlight: "measured", // single orange highlight word
    heroHeadlinePost: "for you.",
    heroSubline: "Perfect fit · at-home Style Captain · transparent pricing",
    primaryCta: "Design your blouse",
    resumeCta: "Resume your design",
    startOver: "Start over",
    howTitle: "How it works",
    how1Title: "Design",
    how1Body: "Pick your cut, neck, and fit on the phone — every option shown on your blouse.",
    how2Title: "Home visit",
    how2Body: "Your Style Captain arrives in a 3-hour slot you choose and measures once.",
    how3Title: "Delivery & trials",
    how3Body: "Stitched, delivered, and trialed at home — fixes included.",
    rateTeaserTitle: "Transparent pricing",
    rateTeaserBody: "Every choice shows its price before you commit. No surprises on delivery.",
    serviceAreaTitle: "Now serving",
    serviceAreaBody: "Harlur · HSR Layout · Sarjapur · Kasavanahalli",
  },

  tape: {
    back: "Back",
    counter: (current: number, total: number) => `${current}/${total}`,
  },

  preview: {
    flipToFront: "Front view",
    flipToBack: "Back view",
    label: (description: string) => `Blouse preview: ${description}`,
  },

  priceBar: {
    total: "Total",
    inclAddons: "incl. add-ons",
    included: "Included",
    breakdownTitle: "Price breakdown",
    base: "Base stitching",
    close: "Close",
  },

  categories: {
    blouse_cut: "Blouse cut",
    blouse_length: "Blouse length",
    front_neck: "Front neck cut",
    back_cut: "Back cut",
    tying: "Tying mechanism",
    shoulder: "Shoulder",
    sleeve: "Sleeve style",
    neck_side: "Neck side",
  },

  fitScreen: {
    shoulderHeading: "Shoulder",
    sleeveHeading: "Sleeve style",
    neckSideHeading: "Neck side",
  },

  addonSection: {
    materialHeading: "Material add-ons",
    styleHeading: "Style it up",
    defaultCaption: "Off by default — pick what you like.",
    sharedCaption: "Also editable on the add-ons screen.",
  },

  review: {
    title: "Review your blouse",
    structureGroup: "Structure",
    fitGroup: "Fit",
    addOnsGroup: "Add-ons",
    noAddOns: "None",
    continue: "Continue",
    breakdownTitle: "Price breakdown",
    total: "Total payable",
  },

  contact: {
    title: "Where should we visit?",
    phoneLabel: "Phone number",
    nameLabel: "Full name",
    address1Label: "Address line 1",
    address2Label: "Address line 2 (optional)",
    pincodeLabel: "Pincode",
    mapLabel: "Set your location on the map",
    useMyLocation: "Use my location",
    outOfAreaTitle: "We're not in your area yet",
    outOfAreaBody:
      "Leave your phone number and we'll text the day Draep reaches you.",
    waitlistCta: "Notify me",
    continue: "Continue to payment",
    validation: {
      phone: "Enter a valid 10-digit mobile number",
      name: "Enter your full name",
      address1: "Address line 1 is required",
      pincode: "Enter a valid 6-digit pincode",
      pin: "Drag the pin to your address",
    },
  },

  pay: {
    title: "Pay for your blouse",
    summary: "Order summary",
    items: (n: number) => `${n} item${n === 1 ? "" : "s"}`,
    payCta: (amount: number) => `Pay ₹${amount} via UPI`,
    processing: "Redirecting to secure payment…",
    failureTitle: "Payment failed",
    failureBody: "No money was taken. Try again whenever you're ready.",
    retry: "Try again",
  },

  confirmed: {
    title: "Booking confirmed",
    body: "Your Style Captain will arrive at the slot you pick below.",
    orderId: "Order ID",
    pickSlotTitle: "Pick your home-visit slot",
    confirmSlot: "Confirm slot",
    summaryTitle: "What happens next",
    captainLine: (date: string, window: string) =>
      `Your Style Captain will arrive ${date}, ${window}.`,
    measureLine: "Measured once, remembered forever — your fit is saved for next time.",
    deliveryLine: "Stitched, delivered, trialed at home. Fixes are on us.",
    downloadCalendar: "Add to calendar",
  },

  errors: {
    generic: "Something went wrong. Please try again.",
  },
} as const;
