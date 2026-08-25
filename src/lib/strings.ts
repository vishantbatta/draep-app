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
    // Draft-hold state — time picked, captain assigned at payment.
    heldHeading: "Your visit time is held",
    heldCaption: "We'll match you with a style captain when you complete payment.",
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
    // Checkout blocked because the held slot was claimed elsewhere.
    slotLostCta: "Pick a new time",
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

  /** Bottom tab labels on /app (Explore / Create / Profile). */
  appTabs: {
    explore: "Explore",
    create: "Create",
    profile: "Profile",
    navLabel: "App sections",
  },

  /** Mid-flow login gate (bottom sheet) — phone+OTP to continue an action.
   *  Callers can override title/message for their surface (LoginGateSheet props). */
  loginGate: {
    title: "Login to generate",
    message: "Verify your phone number once — it keeps your design and orders safe.",
  },

  /** "Order Now" on the library design detail sheet (Explore tab). */
  libraryOrder: {
    cta: "Order now",
    busy: "Placing order…",
    error: "Couldn't place the order — please try again.",
    orderGateTitle: "Login to order",
    tryOnGateTitle: "Login to try it on",
  },

  /** Browse filters on the library page (upfront chips + All-filters sheet). */
  libraryFilters: {
    occasions: "Occasions",
    bodyTypes: "Body Types",
    celebrity: "Celebrity",
    allFilters: "All filters",
    sheetTitle: "Filters",
    occasionSection: "Occasion",
    bodyTypeSection: "Body type",
    celebritySection: "Celebrity",
    catalogueSection: "Style catalogue",
    addonsSection: "Add-ons",
    apply: (n: number) => (n > 0 ? `Apply (${n})` : "Apply"),
    reset: "Reset",
    clearAll: "Clear all",
    anyVariation: (name: string) => `Any ${name}`,
    noMatches: "No designs match these filters",
    noMatchesHint: "Try removing a filter or two",
    clearFilters: "Clear filters",
    loadError: "Couldn't load filters — try again.",
  },

  dashboard: {
    title: "Your account",
    greeting: (name: string | null) => (name ? `Hi, ${name}` : "Welcome back"),
    loginTitle: "Welcome to the Stitch Club",
    loginTagline: "Paint the world the way you want.",
    phoneLabel: "Phone number",
    sendCode: "Send code",
    verify: "Verify",
    resendCode: "Resend code",
    resendCodeIn: (seconds: number) => `Resend code in ${seconds}s`,
    codeResent: "We've sent you a new code.",
    useDifferentNumber: "Use a different number",
    demoHint: "Demo mode: any phone works with code 123456.",
    loginError: "Could not verify. Please try again.",
    profileTitle: "One last stitch",
    profileBody: "Tell us your name — your orders and fittings will know it's you.",
    nameLabel: "Your name",
    namePlaceholder: "What should we call you?",
    genderLabel: "Gender",
    genderMale: "Male",
    genderFemale: "Female",
    genderOther: "Other",
    profileSubmit: "Continue",
    profileError: "Could not save your details. Please try again.",
    activeDraft: "You have a design in progress",
    continueDesign: "Continue designing",
    ordersTitle: "Your orders",
    empty: "No orders yet — your first blouse is one tap away.",
    startDesign: "Start designing",
    reorder: "Re-order",
    loadError: "Could not load your orders.",
    retry: "Retry",
    logout: "Sign out",
    account: "Account",
  },

  account: {
    title: "Your account",
    edit: "Edit",
    editName: "Edit name",
    save: "Save",
    cancel: "Cancel",
    phoneLabel: "Phone",
    memberSince: (since: string) => `Stitch Club member since ${since}`,
    nameSaved: "Name updated.",
    nameError: "Could not save your name. Please try again.",
    addressesTitle: "Addresses",
    addressesHint: "Where your Style Captain can visit you.",
    addAddress: "Add address",
    addAddressTitle: "New address",
    searchLabel: "Search address",
    searchHint: "type like Google Maps",
    searchPlaceholder: "e.g. 5th Avenue, HSR Layout, Bangalore",
    searching: "Searching…",
    updatingFromPin: "Updating address from pin…",
    locating: "Finding your location…",
    expandMap: "Expand map",
    shrinkMap: "Shrink map",
    line1Label: "Address line 1",
    line1Placeholder: "House no, building, street",
    line2Label: "Address line 2",
    line2Placeholder: "Area, landmark (optional)",
    cityLabel: "City",
    stateLabel: "State",
    pincodeLabel: "Pincode",
    saveAddress: "Save address",
    emptyTitle: "No addresses yet",
    emptyBody: "Add one so your Style Captain knows where to visit.",
    loadError: "Could not load your addresses.",
    retry: "Retry",
    saveError: "Could not save this address. Please try again.",
    remove: "Remove",
    removeConfirm: "Remove this address?",
    removeConfirmBody: "Your Style Captain won't visit here anymore.",
    keep: "Keep",
    removeError: "Could not remove this address. Please try again.",
    signOut: "Sign out",
  },

  orderDetail: {
    title: "Order",
    loadingSr: "Loading your order…",
    back: "Your orders",
    support: "Support",
    fulfillmentLabel: "Fulfilment status",
    paymentLabel: "Payment status",
    fulfillmentShort: "Fulfilment",
    paymentShort: "Payment",
    visitTitle: "Home visit",
    addressTitle: "Visit address",
    visitStatusLabel: "Visit status",
    captainLabel: "Style captain",
    captainUnassigned: "To be assigned",
    completedLabel: "Completed",
    notesLabel: "Notes",
    selectionsTitle: "Your selections",
    addonsTitle: "Add-ons",
    basePrice: "Base price",
    garmentTotal: "Garment total",
    noteTitle: "Your note",
    noteAddCta: "Add a note",
    noteEditCta: "Edit",
    noteSheetTitle: "Your note",
    notePlaceholder:
      "Anything your style captain should know — fit preferences, occasion, styling ideas…",
    noteSave: "Save note",
    noteError: "Couldn't save your note. Please try again.",
    summaryTitle: "Payment summary",
    total: "Order total",
    paid: "Paid",
    balanceDue: "Balance due",
    paymentsTitle: "Payments",
    refund: "Refund",
    paymentMethod: (method: string | null) =>
      method ? method.replace(/_/g, " ").toUpperCase() : "Payment",
    viewInvoice: "View invoice",
    continueDraft: "Continue designing",
    changeAddress: "Change",
    addNewAddress: "Add new address",
    selecting: "Saving…",
    continueCta: "Continue",
    addAddressCta: "Add delivery address",
    // Bottom-bar CTA ladder (priority order): address → slot → booking
    selectAddressCta: "Select Address",
    selectSlotCta: "Select Slot",
    confirmBookingCta: "Confirm Booking",
    exploreMoreCta: "Explore More Designs",
    payBalanceCta: (amount: string) => `Pay ${amount} Balance`,
    // Prominent card above the CTA once COD is confirmed or the advance is paid
    bookingConfirmedTitle: "Booking confirmed",
    attachError: "Could not set the delivery address. Please try again.",
    addressPageTitle: "Delivery address",
    addressPageHint:
      "Saving adds it to your saved addresses and attaches it to this order.",
    backToOrder: "Back to order",
    pinNeeded: "Drop the map pin on your address before saving.",
    // Visit-slot sheet — Continue books the measurement visit
    slotSheetTitle: "Pick a visit slot",
    slotSheetHint:
      "Our style captain visits to take measurements. Pick a day and time that suits you.",
    slotToday: "Today",
    slotMorning: "Morning",
    slotAfternoon: "Afternoon",
    slotEvening: "Evening",
    slotNoneDay: "No slots left on this day — pick another.",
    slotSelect: "Select",
    slotLoadError: "Could not load available times.",
    slotRetry: "Try again",
    slotBookError: "Could not book this slot. Please try again.",
    changeSlot: "Change slot",
    // Bottom-card slot row once the hold is a real booking (COD confirmed / paid)
    visitConfirmed: (time: string | null, captain: string | null) =>
      captain ? `Visit confirmed · ${time} · ${captain}` : `Visit confirmed · ${time}`,
    // COD orders: the CTA pays the advance (total minus the ₹50 COD fee)
    payInAdvance: (amount: string) => `Pay ${amount} in Advance`,
    saveTag: (amount: string) => `Save ${amount}`,
    payInitError: "Could not start the payment. Please try again.",
    loadError: "Could not load this order.",
    notFound: "Order not found.",
    retry: "Try again",
  },

  payChoice: {
    // Sheet opened by the order-page Pay button
    title: "How would you like to pay?",
    onlineLabel: "UPI · Credit Card · Wallet · Netbanking · Bank Transfer",
    onlineTag: "Free",
    onlineCaption: "Pay the advance online now — no charges.",
    codLabel: "Cash on Delivery",
    codTag: (amount: string) => `+ ${amount}`,
    codCaption: "COD fee — pay any time before your slot to avoid it.",
    codError: "Could not switch to Cash on Delivery. Please try again.",
    // COD soft-confirm sheet — the save-money nudge before committing
    codSheetTitle: "Cash on Delivery",
    codSheetSaveTitle: (amount: string) => `Save ${amount} by paying online`,
    codSheetSaveBody: "The COD fee is waived when you pay the advance online instead.",
    codSheetHonestTitle: "It avoids dummy slot bookings",
    codSheetHonestBody:
      "The advance keeps visit slots for real bookings, so times stay open for everyone.",
    codSheetRefundTitle: "Refundable, no questions asked",
    codSheetRefundBody:
      "If anything goes wrong, your advance comes straight back to you.",
    codSheetOnlineCta: "Pay online instead",
    codSheetConfirmCta: "Continue with Cash on Delivery",
  },

  errors: {
    generic: "Something went wrong. Please try again.",
  },

  payConfirm: {
    // Post-Cashfree loading page (order-page "Pay ₹X to Book")
    eyebrow: "Payment",
    checkingTitle: "Confirming your payment",
    checkingBody:
      "We're checking with the payment gateway. This usually takes a few seconds — please keep this page open.",
    successEyebrow: "Payment received",
    successTitle: "Order confirmed",
    successBody:
      "Your payment went through and your home visit is booked. Taking you to your order…",
    viewOrder: "View order",
    failedEyebrow: "Payment pending",
    failedTitle: "We couldn't confirm your payment",
    failedBody:
      "If money was debited, it will reflect on your order shortly. You can also go back and try again.",
    backToOrder: "Back to order",
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
    // Camera stage (in-sheet getUserMedia viewfinder)
    shutterLabel: "Take photo",
    cameraCancel: "Cancel",
    cameraDenied: "Camera access was blocked. Allow it in your browser settings and try again.",
    cameraUnsupported: "Camera isn't available here — you can upload a photo instead.",
    cameraRetry: "Try again",
    cameraUseUpload: "Upload instead",
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
    // Final CTA on the extras step + completion view
    finalCta: "Generate Blouse",
    finalTitle: "Your blouse is ready",
    finalBody: "Every choice you made is reflected in the final drawings above.",
    finalKeepEditing: "Keep editing",
    finalDone: "Back to library",
    // AI render of the finished blouse (front / back / side)
    renderLoading: "Rendering your blouse…",
    renderFailed: "We couldn't render the preview images.",
    renderMissed: "Didn't render",
    renderRetry: "Retry",
    regenerate: "Regenerate",
    completeOrder: "Complete Order",
    // Pricing shown alongside options and as a running total
    estTotal: "Estimated total",
    priceTaxNote: "including taxes",
    priceSheetTitle: "Price breakdown",
    priceBaseLine: "Base blouse",
    priceSheetNote:
      "Estimate for your selections — the final price is confirmed when you book.",
    regenTitle: "Refine the render",
    regenBody: "Tell us what to change — we'll redraw the photos keeping your design.",
    regenPlaceholder: "e.g. make the piping thinner, deepen the back cut",
    regenCta: "Regenerate",
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
