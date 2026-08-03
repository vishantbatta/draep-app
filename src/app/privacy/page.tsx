import type { Metadata } from "next";

import { LegalLayout, Section, SubHeading, Bullets, LegalTable, Callout } from "@/components/layout/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Draep collects, uses, stores and protects your personal data — including body measurements and photographs — under India's DPDP Act, 2023.",
};

const COMPANY = "Draep Technologies Pvt. Ltd.";

export default function PrivacyPage() {
  return (
    <LegalLayout
      eyebrow="Privacy policy"
      title="Privacy Policy"
      meta={
        <>
          {COMPANY} · Last updated 4 August 2026
          <br />
          www.draep.com · info@draep.com · +91 96621 04002
        </>
      }
    >
      <Section number="01" title="Who we are">
        <p>
          Draep is a custom fashion and tailoring platform operated by{" "}
          <strong>{COMPANY}</strong>, a company incorporated in India with its office in Bengaluru,
          Karnataka (&ldquo;Draep&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
        </p>
        <p>
          We are the <strong>data fiduciary</strong> for the personal data described in this policy
          under India&apos;s Digital Personal Data Protection Act, 2023 (&ldquo;DPDP Act&rdquo;).
        </p>
        <Bullets
          items={[
            <><strong>Grievance Officer:</strong> {COMPANY}, Bengaluru — info@draep.com, +91 96621 04002</>,
            <><strong>Privacy contact:</strong> info@draep.com</>,
          ]}
        />
      </Section>

      <Section number="02" title="Scope">
        <p>
          This policy covers everything we collect when you browse www.draep.com, book a home visit,
          message us on WhatsApp, receive a Style Captain visit, place a tailoring order, use our AI
          design or measurement features, or contact support.
        </p>
        <p>
          Draep operates as a network: Style Captains, tailors, boutiques, designers, embroidery
          partners and alteration specialists are independent partners who work to the Draep
          operating system. This policy explains exactly what of yours reaches them.
        </p>
      </Section>

      <Section number="03" title="What we collect">
        <SubHeading>3.1 Information you give us</SubHeading>
        <LegalTable
          head={["Category", "Examples", "Why we need it"]}
          rows={[
            ["Identity & contact", "Name, mobile number, country code, email", "Create your account, verify you by OTP, coordinate visits and deliveries"],
            ["Address", "Home and delivery address, landmark, pincode, access notes", "Serviceability check, home visit, fabric pickup, delivery"],
            ["Order & design", "Garment type, cut, neck, sleeve, add-ons, placements, fabric details, chosen tailor, special instructions", "Produce and price your garment, route it to the right partner"],
            ["Body measurements", "Up to 22 blouse measurements (shoulder, bust, lower bust, waist, armhole, sleeve, back depth and others), plus height and weight where given", "Stitch a garment that fits, generate CAD patterns, validate measurements before cutting"],
            ["Photographs", "Photos used for AI body measurement; inspiration images you upload; photos of your fabric at collection; QC photos of the finished garment", "Estimate measurements, replicate a design you like, record fabric condition, run quality control"],
            ["Payments", "Amount, transaction status, gateway reference, instrument type (UPI, card, netbanking, wallet)", "Take payment, issue invoices, process refunds"],
            ["Communications", "WhatsApp, call, SMS and email exchanges; ratings, feedback, complaints", "Support, quality control, dispute resolution"],
          ]}
        />
        <SubHeading>3.2 Information collected automatically</SubHeading>
        <p>
          Device and browser type, IP address, pages and screens viewed, referring links,
          approximate location derived from IP or pincode, session identifiers and cookies. See §10.
        </p>
        <SubHeading>3.3 Information from others</SubHeading>
        <p>
          Payment gateways (payment status), delivery and logistics partners, Style Captains and
          tailors (visit notes, production and QC updates), and referrals where an existing customer
          shares your contact with your consent.
        </p>
        <Callout>
          <p>
            <strong>We do not collect</strong> government ID numbers, health records, caste or
            religion data, or your financial account credentials. Draep will never ask you for a card
            PIN, password or OTP.
          </p>
        </Callout>
      </Section>

      <Section number="04" title="Body measurements and photos — our commitments">
        <p>
          Your measurements and body photographs are the most sensitive things you give us. We hold
          them to a stricter standard than everything else.
        </p>
        <Bullets
          items={[
            <>They are used <strong>only</strong> to make, alter and re-make garments for you, and to keep a measurement history so you never have to be measured twice.</>,
            <>Access is need-to-know: the Style Captain assigned to you, the certified tailor producing your order, the hub staff cutting your fabric, and authorised Draep operations staff. Access to measurement records is logged.</>,
            <>Your <strong>body photographs are not shared with tailors or hub staff</strong>. They are used by Draep&apos;s measurement pipeline to derive numbers; the network sees the measurements and the CAD pattern, not your photos.</>,
            <>We <strong>never</strong> sell, rent or share your measurements or body photos with advertisers, data brokers, or any third party for their own purposes.</>,
            <>We use your photos or measurements to <strong>train or improve our AI measurement models only with your separate, explicit opt-in consent</strong>. You can withdraw that consent at any time, and refusing has no effect on your order, price or timeline.</>,
            <>AI measurement is optional. An in-person Style Captain measurement is always available instead.</>,
            <>We do not publish your photos, before-and-after images, or images of your garment on social media or our website without your prior written consent.</>,
          ]}
        />
      </Section>

      <Section number="05" title="Why we process your data">
        <Bullets
          items={[
            <><strong>Delivering your order</strong> — booking, measuring, design selection, pricing, CAD pattern generation, routing to a hub and tailor, QC, delivery, alterations, and maintaining your measurement vault and order history.</>,
            <><strong>Payments</strong> — advances, balances, invoices, refunds and fraud prevention.</>,
            <><strong>Communication</strong> — order and visit updates over WhatsApp, SMS, call or email. These are service messages, not marketing.</>,
            <><strong>Quality and safety</strong> — measurement validation, alteration-reason analysis, tailor performance scoring, complaint investigation, and Style Captain conduct review.</>,
            <><strong>Network operations</strong> — matching orders to tailors by capacity and specialisation, capacity forecasting, and hub distribution planning.</>,
            <><strong>Improving the service</strong> — aggregated and de-identified analytics such as popular neck designs by city, common alteration reasons, seasonal demand, and fabric and design preferences. This work uses aggregated data, not your individual profile, and is never published in a way that identifies you.</>,
            <><strong>Marketing</strong> — offers and new-category announcements, only if you have consented. You can opt out at any time and it takes effect for future messages.</>,
            <><strong>Legal and accounting</strong> — tax records, statutory retention, lawful requests, and defending legal claims.</>,
          ]}
        />
        <p>
          Our lawful basis is your <strong>consent</strong>, together with the{" "}
          <strong>legitimate uses</strong> permitted under the DPDP Act, including compliance with law.
        </p>
      </Section>

      <Section number="06" title="Who we share it with, and exactly what they see">
        <LegalTable
          head={["Recipient", "What they receive"]}
          rows={[
            ["Style Captain assigned to you", "Name, phone, address, visit slot, order and design specification; records your measurements and fabric details"],
            ["Assembly hub", "Order specification, measurements, CAD pattern, fabric record. Contact details only as needed for routing"],
            ["Certified tailor / boutique / embroidery or alteration partner", "Order specification, measurements and CAD pattern needed to produce the garment. Not your body photos. Contact details only where they deliver directly"],
            ["Delivery and logistics partners", "Name, phone, delivery address"],
            ["Payment gateway", "Amount, order reference and the details required to process payment. We never store your full card or UPI credentials"],
            ["Communication providers", "Phone number or email, to send order notifications over WhatsApp, SMS or email"],
            ["Cloud hosting, backup, error-monitoring and analytics providers", "Data processed on our instructions, under contract"],
            ["Fabric or designer marketplace sellers", "Where you buy from a marketplace seller, the details needed to fulfil that purchase"],
            ["Professional advisers and authorities", "Where required by law, court order, or to protect rights, safety or property"],
          ]}
        />
        <p>
          Every network partner signs a confidentiality and data-protection undertaking as part of
          certification. Partners may not retain your data after the order, may not contact you
          outside the order, and may not use your data for their own marketing. Breach means removal
          from the network.
        </p>
        <p>
          If Draep is merged, acquired or reorganised, your data may transfer to the successor entity,
          which remains bound by this policy.
        </p>
        <Callout>
          <p><strong>We do not sell your personal data.</strong></p>
        </Callout>
      </Section>

      <Section number="07" title="Where your data is stored">
        <p>
          Our systems are hosted on cloud infrastructure located in India. Some service providers may
          process limited data outside India. Where that happens, transfers are only to countries not
          restricted by the Government of India, and under contracts requiring protection equivalent
          to this policy.
        </p>
      </Section>

      <Section number="08" title="How long we keep it">
        <LegalTable
          head={["Data", "Retention"]}
          rows={[
            ["Measurements and order history", "While your account is active, so repeat orders need no re-measurement. Deleted within 30 days of a deletion request"],
            ["Body photographs used for AI measurement", "12 months after the related order is completed, then deleted — unless you have opted in to longer retention for model improvement"],
            ["Fabric-condition and QC photographs", "24 months, to support fabric-damage and quality claims"],
            ["Inspiration images you upload", "12 months after the related order"],
            ["Payment and invoice records", "8 years, as required by Indian tax and accounting law"],
            ["Support and WhatsApp conversations", "24 months"],
            ["Website and app analytics", "14 months, in aggregated form thereafter"],
          ]}
        />
        <p>
          After these periods we delete the data or irreversibly anonymise it so it can no longer be
          linked to you.
        </p>
      </Section>

      <Section number="09" title="Your rights">
        <p>Under the DPDP Act you can:</p>
        <Bullets
          items={[
            <><strong>Access</strong> a summary of the personal data we hold about you and how we process it, including which network partners have handled your order.</>,
            <><strong>Correct or update</strong> inaccurate data, including your stored measurements.</>,
            <><strong>Erase</strong> your data where it is no longer needed for the purpose or for a legal obligation.</>,
            <><strong>Withdraw consent</strong> at any time, as easily as you gave it. Withdrawal applies going forward and may mean we cannot complete an open order.</>,
            <><strong>Nominate</strong> another person to exercise your rights in the event of your death or incapacity.</>,
            <><strong>Complain</strong> to us, and then to the Data Protection Board of India if you are not satisfied.</>,
          ]}
        />
        <p>
          To exercise a right, email info@draep.com or WhatsApp +91 96621 04002. We respond within{" "}
          <strong>30 days</strong>, and may verify your identity by OTP on your registered number.
        </p>
        <Callout title="Grievance redressal">
          <p>
            Grievance Officer, {COMPANY}, Bengaluru — info@draep.com, +91 96621 04002. Acknowledged
            within <strong>48 hours</strong>, resolved within <strong>30 days</strong>.
          </p>
        </Callout>
      </Section>

      <Section number="10" title="Cookies and analytics">
        <p>www.draep.com uses:</p>
        <Bullets
          items={[
            <><strong>Essential cookies</strong> — session, security, and draft-order state. These cannot be switched off.</>,
            <><strong>Analytics cookies</strong> — to understand how the booking and design flow performs.</>,
            <><strong>Marketing cookies</strong> — where used, to measure the performance of our advertising.</>,
          ]}
        />
        <p>
          You can control non-essential cookies through our cookie banner or your browser settings.
        </p>
      </Section>

      <Section number="11" title="Security">
        <p>
          HTTPS across the site and apps; OTP-based sign-in, so there is no password to leak;
          role-based access so each Style Captain, tailor, hub and staff member sees only what their
          role requires; encrypted storage for photographs and measurement records; audit logging of
          access to measurement data; and certification, vetting and confidentiality agreements for
          every network partner.
        </p>
        <p>
          No system is perfectly secure. If a personal data breach affects you, we will notify you
          and the Data Protection Board of India as required by law.
        </p>
      </Section>

      <Section number="12" title="Children">
        <p>
          Draep&apos;s services are for users <strong>18 and over</strong>. We do not process a
          child&apos;s data without verifiable parental consent, and we never use children&apos;s data
          for tracking or targeted advertising. Where a garment is being made for a minor, a parent or
          guardian must book, consent, and be present at the measurement visit.
        </p>
      </Section>

      <Section number="13" title="Changes to this policy">
        <p>
          We update this policy as Draep expands to new areas, categories and features. The
          &ldquo;Last updated&rdquo; date will change, and for material changes we will notify you on
          www.draep.com or over WhatsApp or email before the change takes effect.
        </p>
      </Section>

      <Section number="14" title="Contact">
        <Callout title={COMPANY}>
          <p>Bengaluru, Karnataka, India</p>
          <p>Email: info@draep.com</p>
          <p>Phone / WhatsApp: +91 96621 04002</p>
          <p>Website: www.draep.com</p>
        </Callout>
      </Section>
    </LegalLayout>
  );
}
