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

  style: {
    heading: "Choose from our library",
    topHeading: "Share your design preference",
    subheading: "Upload a photo or pick from our library below.",
    uploadCta: "Upload your design",
    buildCta: "Build from scratch",
    or: "or",
    libraryHeading: "Choose from our library",
    librarySubheading: "Handpicked blouse designs — tap any to make it yours.",
    filterAll: "All",
    loadingLibrary: "Loading the library…",
    loadError: "Couldn't load designs. Pull down to retry.",
    emptyLibrary: "No designs match those filters yet.",
    detailLoading: "Loading this design…",
    detailError: "Couldn't load this design. Please try again.",
    designBy: "Worn by",
    alsoKnownFor: "Famous for",
    pieces: "pieces",
    designIncludes: "Design includes",
    startFromThis: "Draft this design",
    drafting: "Drafting…",
    drafted: "Open in review",
    fromPrice: (n: number) => `₹${n.toLocaleString("en-IN")}`,
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
    done: "Done",
    editCta: "Edit",
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
    continue: "Continue to scheduling",
    validation: {
      phone: "Enter a valid 10-digit mobile number",
      name: "Enter your full name",
      address1: "Address line 1 is required",
      pincode: "Enter a valid 6-digit pincode",
      pin: "Drag the pin to your address",
    },
  },

  schedule: {
    title: "Pick your home-visit slot",
    body: "Your Style Captain will arrive at the time you pick below. You can change this later if your plans shift.",
    confirmSlot: "Continue to payment",
    changeSlot: "Change slot",
    keepSlot: "Keep my slot",
    bookedHeading: "Your visit is scheduled",
    continueCta: "Continue to payment",
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
    body: "Your payment is confirmed and your visit is booked. We'll see you soon!",
    orderId: "Order ID",
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

  tryOn: {
    // CTA on the design detail bottom sheet
    cta: "Try it on",
    // Picker stage
    sheetTitle: "Try it on",
    creativeTitle: "See it on you",
    creativeBody:
      "Upload a clear, well-lit photo of yourself and our AI will drape this design on you in seconds.",
    howHeading: "How it works",
    step1Title: "Pick the design",
    step1Body: "We start from this blouse — exact cut, colour and detail.",
    step2Title: "Share a photo",
    step2Body: "Upload or take a clear, front-facing photo.",
    step3Title: "See it on you",
    step3Body: "Our AI stitches it onto your photo in a few seconds.",
    uploadCta: "Upload photo",
    captureCta: "Take a photo",
    photoTip: "Stand against a plain background · full torso in frame",
    // Loading stage
    loadingTitle: "Stitching it on you…",
    loadingBody: "Our AI is matching the fit and fabric to your photo.",
    // Result stage
    resultTitle: "Here's you in this design",
    resultTip: "This is an AI preview — your master tailor will perfect the real fit.",
    done: "Done",
    // Sharing
    shareSave: "Save",
    shareWhatsapp: "WhatsApp",
    shareMore: "More",
    shareToast: "Image saved to your device",
    shareError: "Couldn't share — try long-pressing the image instead.",
    // Chat / refine
    chatPlaceholder: "Describe a change…",
    chatSend: "Apply",
    chatMic: "Speak",
    chatRefining: "Refining…",
    chatListening: "Listening…",
    chatError: "Couldn't apply that. Try again.",
    suggestionsLabel: "Quick tweaks",
    // Errors
    errorTitle: "Couldn't generate that",
    errorRetry: "Try again",
  },

  myod: {
    // Banner CTA on the library page
    bannerEyebrow: "MYOD",
    bannerTitle: "Make your own Draep",
    bannerBody: "Design a blouse step by step — our AI builds it as you go.",
    bannerCta: "Start designing",
    // Chat-first configurator
    sheetTitle: "Make Your Own Draep",
    chooseEyebrow: "Choose your",
    loadingTree: "Loading your design options…",
    generating: "Designing…",
    done: "Done",
    tryOnCta: "Try it on",
    // Chat bar
    chatPlaceholder: "Describe a change…  e.g. make the neckline deeper",
    chatSend: "Apply",
    chatMic: "Speak",
    chatListening: "Listening…",
    chatError: "Couldn't apply that. Try again.",
    // Errors
    errorTitle: "Couldn't design that",
    errorRetry: "Try again",
  },

  stylist: {
    title: "Call a designer",
    subtitle: "Talk to our AI stylist over video",
    cta: "Call a designer",
    startCall: "Start video call",
    startCallBody:
      "Our AI fashion designer will guide you through a personalised blouse design consultation.",
    connecting: "Calling…",
    connected: "Connected",
    ringing: "Ringing…",
    ended: "Call ended",
    endCall: "End call",
    mute: "Mute",
    unmute: "Unmute",
    videoOn: "Video on",
    videoOff: "Video off",
    cameraOff: "Camera off",
    encrypted: "End-to-end encrypted",
    camPermissionTitle: "Camera & mic access needed",
    camPermissionBody:
      "Allow camera and microphone so our AI designer can see you and talk to you.",
    permDenied: "Camera access was blocked. Please allow it in your browser settings.",
    designsLabel: "Designs",
    errorTitle: "Couldn't start the call",
    errorRetry: "Try again",
    back: "Back",
    designFailed: "Couldn't render that design",
    // Design generation in progress
    sketching: "Sketching your design…",
    sketchingHint: "This usually takes under a minute",
    // Dropped-call error modal
    callDroppedTitle: "Call dropped",
    callDroppedBody: "Your connection was unstable, so the call ended.",
    // Back-arrow confirmation while a call is live
    endCallTitle: "End this call?",
    endCallBody:
      "The call will end and the design previews from this session will be lost.",
    keepCalling: "Keep calling",
    endNow: "End call",
    // Pre-call prep tips
    prepTitle: "Before you dial",
    prepLightTitle: "Find good light",
    prepLightBody: "Face a window or lamp so the designer sees you clearly.",
    prepFrameTitle: "Frame your upper body",
    prepFrameBody: "Sit back a little — waist up, fully in view.",
    prepQuietTitle: "Keep it quiet",
    prepQuietBody: "A calm space or earphones makes the chat easier.",
  },
} as const;
