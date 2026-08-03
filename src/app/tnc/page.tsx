import type { Metadata } from "next";

import { LegalLayout, Section, SubHeading, Bullets, Steps, LegalTable, Callout } from "@/components/layout/LegalLayout";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The terms that govern your use of draep.com and Draep's custom tailoring services — orders, fabric, measurements, timelines, refunds and more.",
};

const COMPANY = "Draep Technologies Pvt. Ltd.";

export default function TermsPage() {
  return (
    <LegalLayout
      eyebrow="Terms & conditions"
      title="Terms & Conditions"
      meta={
        <>
          {COMPANY} · Last updated 4 August 2026 · Effective 4 August 2026
          <br />
          www.draep.com · info@draep.com · +91 96621 04002
        </>
      }
    >
      <Section number="01" title="About these terms">
        <p>
          These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern your use of www.draep.com, the
          Draep booking web app, the Draep customer app, our WhatsApp booking channel, and all
          tailoring, styling and alteration services provided by{" "}
          <strong>{COMPANY}</strong>, a company incorporated in India with its office in
          Bengaluru, Karnataka (&ldquo;Draep&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
        </p>
        <p>
          By booking a visit, placing an order, or using the site or app, you agree to these Terms.
          If you do not agree, please do not use the service.
        </p>
        <p>
          These Terms are read together with the Draep Privacy Policy, the Rate List published on
          www.draep.com, and the written order confirmation we send you. Where they conflict, the
          order confirmation prevails for that order.
        </p>
      </Section>

      <Section number="02" title="Eligibility">
        <p>
          You must be 18 or older and capable of entering a contract under the Indian Contract Act,
          1872. If you order for someone else, including a minor, you confirm you are authorised to
          do so, and a parent or guardian must be present at the measurement visit.
        </p>
      </Section>

      <Section number="03" title="What Draep is, and how an order works">
        <p>
          Draep is an <strong>infrastructure and technology platform for custom fashion</strong>. We
          do not own a production unit. We standardise measurement, design, cutting, production,
          quality control and fulfilment, and we run a distributed network of independent partners
          — tailors, boutiques, designers, alteration specialists, embroidery partners and Style
          Captains — who all work to the Draep operating system, plus Draep assembly hubs used for
          daily distribution.
        </p>
        <p>
          You contract with Draep. Draep is responsible to you for the order end to end, and in turn
          contracts the network partner who produces it.
        </p>
        <SubHeading>An order flows</SubHeading>
        <Steps
          items={[
            <><strong>Design</strong> — you choose a garment and options in the Draep design library and personalised design builder on www.draep.com, in the app, or over WhatsApp, and see the price before paying.</>,
            <><strong>Tailor selection</strong> — where the feature is available in your area, you may choose your certified tailor from the network. If you do not choose, Draep assigns a certified tailor based on capacity, specialisation and performance.</>,
            <><strong>Home visit</strong> — a Style Captain visits your home in a 3-hour slot, takes your body measurements per the Draep Measurement SOP, helps you finalise the style, and collects your fabric.</>,
            <><strong>Assembly hub</strong> — your fabric and specification are routed through a Draep hub, where CAD patterns are generated for precise cutting.</>,
            <><strong>Production</strong> — a certified tailor in the network stitches the garment to the Draep Tailor SOP; embroidery or specialist work may be done by a partner in the network.</>,
            <><strong>Quality control</strong> — the garment goes through the Draep QC framework before it leaves the hub.</>,
            <><strong>Delivery</strong> — the finished garment is delivered to your address, with alterations handled under §11.</>,
          ]}
        />
      </Section>

      <Section number="04" title="Service area">
        <p>
          Draep currently serves <strong>Bengaluru</strong>, starting with Harlur, HSR Layout,
          Sarjapur Road and Kasavanahalli and the surrounding 5 km radius, and is expanding across
          the city and to further cities over time. Serviceability is confirmed by pincode at
          booking. If your address falls outside the serviceable area, we may decline or cancel the
          order and will refund any amount paid in full.
        </p>
      </Section>

      <Section number="05" title="Categories">
        <p>
          Draep currently stitches <strong>saree blouses</strong>. As we expand, the same Terms apply
          to additional categories as they are launched, including women&apos;s suits, kurtas,
          dresses, men&apos;s shirts, trousers, suits, kidswear, uniforms, and standalone
          alterations. Category-specific timelines and rates are published on the Rate List.
        </p>
      </Section>

      <Section number="06" title="Booking, account and OTP">
        <p>
          We identify you by your mobile number and a one-time password. There is no password to
          remember, and equally, anyone with access to your number can access your account. You are
          responsible for keeping your number secure and for orders placed through it. Write to
          info@draep.com or WhatsApp +91 96621 04002 immediately if you believe your account has been
          misused.
        </p>
      </Section>

      <Section number="07" title="Prices, quotes and payment">
        <Bullets
          items={[
            <>All prices are in <strong>Indian Rupees (₹)</strong> and include applicable taxes unless the price breakdown says otherwise.</>,
            <>The price at checkout reflects the design options you select. If at the visit you change the style, add options, or your fabric needs additional work (lining, padding, extra panels, embroidery, embellishment), the price may change. <strong>We will tell you the revised amount and take your approval before proceeding.</strong> No work is done at a price you have not approved.</>,
            <>Payment is collected online through our payment gateway via UPI, cards, net banking or wallets. Where an advance is taken, production begins only after the advance is received.</>,
            <>The balance is due before delivery. We may hold delivery until it is paid.</>,
            <>Express delivery, premium styling, wedding packages, subscriptions and other add-on services are priced separately and shown before you pay.</>,
            <>Payment gateway fees, chargebacks and reversals are governed by the gateway&apos;s terms. If an amount is debited without an order being created, it is refunded to the original payment method within 7 business days.</>,
          ]}
        />
      </Section>

      <Section number="08" title="Your fabric">
        <p>
          Most Draep orders are stitched from fabric you supply. This is the highest-value thing you
          hand us, and these clauses matter.
        </p>
        <Bullets
          items={[
            <>You must own the fabric, or have permission to use it, and it must be legal to possess and not counterfeit.</>,
            <>The Style Captain records the condition, quantity and description of the fabric at collection, with photographs. Please review and confirm that record — it is the shared reference if a dispute arises.</>,
            <><strong>Insufficient fabric:</strong> if there is not enough fabric for the chosen style, we will tell you before cutting and offer alternatives — a modified style, additional fabric, or cancellation with a full refund of the stitching charge.</>,
            <><strong>Fabric behaviour:</strong> delicate, pre-worn, aged, sequinned, net, tissue, or loosely woven fabrics can tear, fray, shrink, bleed colour or show needle marks during normal cutting, stitching or pressing. Where the Style Captain flags this risk and you ask us to proceed, we stitch <strong>at your risk</strong> and are not liable for such damage.</>,
            <><strong>Draep Protection:</strong> where fabric is lost or damaged through the negligence of Draep, a Style Captain, a hub, or a network partner, we compensate you at the <strong>documented purchase value of the fabric</strong>, or, where no proof of value is available, up to <strong>₹10,000 or ten times the stitching charge for that garment, whichever is lower</strong>. Claims must be raised within 7 days of delivery or of us informing you of the damage. This applies whoever in the network handled the fabric — you do not have to chase a tailor.</>,
            <>Where you buy fabric through the Draep fabric marketplace, the fabric is supplied by the listed seller. Draep is liable for the stitching; defect and return terms for the fabric itself are shown on the product listing.</>,
          ]}
        />
      </Section>

      <Section number="09" title="Measurements and fit">
        <Bullets
          items={[
            <>Fit depends on accurate measurements. Please wear fitted clothing at the visit and follow the Style Captain&apos;s instructions; loose clothing over the measured area distorts readings.</>,
            <>Tell us if you are pregnant, recovering from surgery, or expect a significant change in body size. We may decline the order or advise waiting, because a garment measured today will not fit a materially different body later.</>,
            <>Your 22 body measurements are stored in your Draep measurement vault so repeat orders do not need re-measurement. You can ask us to re-measure, correct, or delete them at any time.</>,
            <>Measurements run through the Draep validation engine before production. If a reading looks physically implausible, we may pause the order and re-measure — this protects your fabric.</>,
            <>Once you approve the measurement sheet and design specification, they are locked for production. Later changes may not be possible, or may be chargeable.</>,
            <><strong>AI-assisted measurement:</strong> where you use photo-based or AI measurement instead of an in-person visit, the output is an <strong>estimate</strong>. You accept a higher risk of fit variance, and your remedy is the alterations and remake in §11.</>,
          ]}
        />
      </Section>

      <Section number="10" title="AI features, design inspiration and try-on">
        <p>
          Draep offers AI-assisted features including a personalised design builder, replication of
          design inspirations from images you upload, an AI designer agent, AI-based quality control,
          AI virtual try-on, and automated CAD pattern cutting.
        </p>
        <Bullets
          items={[
            <>AI outputs — recommended styles, generated designs, try-on previews and measurement estimates — are <strong>suggestions and visualisations, not guarantees</strong>. A try-on preview is an illustration, not a photograph of the finished garment.</>,
            <><strong>Images you upload:</strong> you confirm you have the right to use any inspiration image you send us and that it does not infringe anyone&apos;s copyright, trademark, design right or publicity right. You are responsible for what you upload. We will not knowingly reproduce a protected designer work, a branded logo, or a copyrighted print, and we may decline any request that appears to do so.</>,
            <>We interpret an inspiration image; we do not promise an identical copy. Fabric, drape, quantity and construction limits will produce differences, and the Style Captain will tell you what is achievable before you approve.</>,
            <>Automated CAD cutting is checked by a human at the hub. Human QC remains the final gate before delivery.</>,
          ]}
        />
      </Section>

      <Section number="11" title="Timelines, alterations and remakes">
        <Bullets
          items={[
            <>We give an estimated delivery date at order confirmation and communicate the SLA in writing. Estimates may be affected by fabric complexity, embroidery work, alteration loops, festival-season load, and events beyond our control (§16). If a delay caused by us exceeds 7 days beyond the promised date, you may cancel, receive a full refund of stitching charges, and have your fabric returned.</>,
            <><strong>Free alterations:</strong> we alter the garment free of charge for fit issues reported within <strong>7 days</strong> of delivery, for up to <strong>2</strong> alteration rounds.</>,
            <><strong>Remake:</strong> if the garment cannot be made to fit because of a Draep measurement or stitching error, and enough fabric is available, we remake it at no cost. If fabric is not available, we refund the stitching charge for that garment and Draep Protection under §8 applies to the fabric consumed.</>,
            <><strong>Not covered:</strong> changes to a design you approved, fit changes caused by body-weight change after measurement, damage from wear or washing, or fabric defects present before stitching.</>,
            <>Please follow the care instructions provided. Machine washing, harsh detergents or high-heat ironing can void the alteration guarantee for the damage they cause.</>,
          ]}
        />
      </Section>

      <Section number="12" title="Cancellations and refunds">
        <LegalTable
          head={["When you cancel", "What happens"]}
          rows={[
            ["Before the home visit", "Full refund of any amount paid, within 7 business days"],
            ["After the visit, before cutting", "Full refund of the stitching charge; fabric returned at the next delivery run"],
            ["After cutting has begun", "No refund of stitching charges — the fabric has been cut to your specification. Cut pieces are returned on request"],
            ["After delivery", "Refunds only where §11 applies"],
          ]}
        />
        <p>
          We may cancel and refund you in full if the fabric is unsuitable, the address is outside the
          service area, or we reasonably suspect fraud or abuse. Refunds are made to the original
          payment method.
        </p>
      </Section>

      <Section number="13" title="Home visits and conduct">
        <Bullets
          items={[
            <>Visits are scheduled in 3-hour slots. Please be available; if nobody is present, we may charge a revisit fee of ₹200 for the next attempt.</>,
            <>Style Captains carry Draep photo identification and follow a defined visit protocol. Please verify the ID before allowing entry, and do not admit anyone claiming to be from Draep who cannot show it.</>,
            <>We expect respectful conduct on both sides. We may refuse or terminate service in cases of harassment, abuse, unsafe premises or intoxication. Report any Style Captain or partner misconduct immediately to info@draep.com or +91 96621 04002 — every report is investigated, and partners can be removed from the network.</>,
          ]}
        />
      </Section>

      <Section number="14" title="Network partners, and what you agree not to do">
        <p>
          Tailors, boutiques, designers, embroidery partners, alteration specialists and Style
          Captains in the Draep network are independent businesses and contractors, not employees of
          Draep. They are certified against the Draep operating system, and Draep remains answerable
          to you for the order.
        </p>
        <p>You agree not to:</p>
        <Bullets
          items={[
            <>provide false contact, address or payment details;</>,
            <>bypass the platform by engaging a Draep Style Captain, tailor or partner directly for tailoring work for 12 months after they served you through Draep;</>,
            <>scrape, reverse-engineer, overload or interfere with www.draep.com, the app, or our APIs;</>,
            <>copy our design library, catalogue imagery, CAD patterns, measurement SOP, or content for commercial use;</>,
            <>use the service to launder goods or funds, or for any unlawful purpose.</>,
          ]}
        />
      </Section>

      <Section number="15" title="Intellectual property">
        <p>
          The Draep name, the alpha-tape mark, the logo, the design system, the design library and
          catalogue imagery, CAD patterns, the Measurement SOP, the Tailor SOP, the QC framework, and
          all site and app content are owned by {COMPANY} and may not be used or reproduced without
          written permission.
        </p>
        <p>
          Where you upload a reference image or design, you keep your rights in it and grant Draep a
          limited licence to use it solely to design, quote and produce your garment. We will only
          use photographs of you or your finished garment publicly, including on social media, with
          your prior consent.
        </p>
      </Section>

      <Section number="16" title="Liability">
        <Bullets
          items={[
            <>Draep is not liable for delays or failures caused by events beyond reasonable control — natural events, strikes, civil unrest, power or internet failure, epidemics, government restrictions, or courier failure.</>,
            <>To the maximum extent permitted by law, our total liability for any order is limited to <strong>the amounts you paid for that order plus the value of your fabric determined under §8</strong>.</>,
            <>We are not liable for indirect, incidental or consequential losses, including a missed wedding, event or occasion.</>,
            <>Nothing in these Terms limits liability that cannot be limited under Indian law, including under the Consumer Protection Act, 2019.</>,
          ]}
        />
      </Section>

      <Section number="17" title="Grievance redressal">
        <p>In line with the Consumer Protection (E-Commerce) Rules, 2020:</p>
        <Callout title={`Grievance Officer, ${COMPANY}`}>
          <p>Email: info@draep.com</p>
          <p>Phone: +91 96621 04002</p>
          <p>Bengaluru, Karnataka, India</p>
          <p className="mt-2 text-caption text-muted">
            Complaints are acknowledged within <strong>48 hours</strong> and resolved within{" "}
            <strong>30 days</strong>.
          </p>
        </Callout>
      </Section>

      <Section number="18" title="Governing law and disputes">
        <p>
          These Terms are governed by the laws of India. Subject to §17, the courts at{" "}
          <strong>Bengaluru, Karnataka</strong> have exclusive jurisdiction.
        </p>
      </Section>

      <Section number="19" title="Changes to these terms">
        <p>
          We may update these Terms as the service and its categories expand. The updated version
          takes effect when posted on www.draep.com and applies to orders placed after that date.
          Orders already confirmed continue under the Terms in force when they were placed.
        </p>
      </Section>

      <Section number="20" title="Contact">
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
